"""
Conversational AI Agent for ONEE.

Orchestrates tool-calling inference over Groq Qwen:
1. Grounded Attendance Injection: Formats current attendance summary into
   the system prompt so the model has exact course codes, percentages, and delivered counts.
2. Function Calling Loop: Executes attendance math tools (bunk allowance, recovery calculations)
   when the user asks specific policy or what-if questions.
3. Streaming Token Generator: Yields SSE chunks directly to the HTTP stream.
"""

import asyncio
import json
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional, AsyncGenerator
from ..schemas.attendance import AttendanceSummary
from ..schemas.chat import ChatMessage, ChatResponse, AgentActivity, ToolCallRecord
from .prompts import SYSTEM_PROMPT
from .tools import TOOL_DEFINITIONS, execute_tool
from ..services.groq_service import groq_service

logger = logging.getLogger(__name__)

def get_now_timestamp() -> str:
    return datetime.now().strftime("%H:%M:%S")

class OneeAgent:
    def __init__(self):
        pass

    def _build_system_messages(
        self,
        attendance: Optional[AttendanceSummary] = None,
        history: Optional[List[ChatMessage]] = None,
        user_message: str = ""
    ) -> List[Dict[str, Any]]:
        messages: List[Dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_PROMPT}
        ]

        if attendance:
            attendance_context = {
                "overall": {
                    "total_classes": attendance.totalClasses,
                    "total_attended": attendance.totalAttended,
                    "total_absent": attendance.totalAbsent,
                    "overall_percentage": attendance.overallPercentage,
                    "student_name": attendance.studentName,
                    "registration_number": attendance.registrationNumber
                },
                "courses": [
                    {
                        "code": c.code,
                        "name": c.name,
                        "attended": c.attended,
                        "total": c.total,
                        "absent": c.absent,
                        "percentage": c.percentage,
                        "data_quality": c.dataQuality
                    }
                    for c in attendance.courses
                ]
            }
            messages.append({
                "role": "system",
                "content": f"Structured Student Attendance Data:\n{json.dumps(attendance_context, indent=2)}"
            })
        else:
            messages.append({
                "role": "system",
                "content": "No attendance data is currently provided because the student has not opened their UMS attendance page yet."
            })

        if history:
            for h in history[-6:]:
                role = "user" if h.sender == "user" else "assistant"
                messages.append({"role": role, "content": h.text})

        messages.append({"role": "user", "content": user_message})
        return messages

    async def run(
        self,
        user_message: str,
        attendance: Optional[AttendanceSummary] = None,
        history: Optional[List[ChatMessage]] = None
    ) -> ChatResponse:
        activities: List[AgentActivity] = []
        tool_records: List[ToolCallRecord] = []
        now_ts = get_now_timestamp()

        if attendance:
            activities.append(
                AgentActivity(
                    id=f"act-{int(datetime.now().timestamp()*1000)}-1",
                    timestamp=now_ts,
                    title="Attendance context loaded",
                    detail=f"{attendance.totalCourses} courses · {attendance.overallPercentage}% aggregate",
                    status="completed"
                )
            )

        messages = self._build_system_messages(attendance, history, user_message)

        try:
            first_response = await groq_service.call_chat_completion(
                messages=messages,
                tools=TOOL_DEFINITIONS if attendance else None,
                tool_choice="auto" if attendance else "none",
                temperature=0.2
            )

            choice = first_response["choices"][0]
            message_obj = choice["message"]
            tool_calls = message_obj.get("tool_calls", [])
            metadata = first_response.get("_onee_metadata", {})
            if not tool_calls:
                final_text = message_obj.get("content", "")
                activities.append(
                    AgentActivity(
                        id=f"act-{int(datetime.now().timestamp()*1000)}-2",
                        timestamp=get_now_timestamp(),
                        title="Response generated",
                        status="completed"
                    )
                )
                return ChatResponse(
                    message=final_text.strip(),
                    activities=activities,
                    tool_calls=tool_records,
                    modelUsed=metadata.get("model_used"),
                    isFallback=metadata.get("fallback_used", False)
                )

            messages.append(message_obj)

            for tc in tool_calls:
                fn_name = tc["function"]["name"]
                raw_args = tc["function"].get("arguments", "{}")
                try:
                    fn_args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                except Exception:
                    fn_args = {}

                tool_ts = get_now_timestamp()
                activities.append(
                    AgentActivity(
                        id=f"act-{int(datetime.now().timestamp()*1000)}-{fn_name}",
                        timestamp=tool_ts,
                        title=f"Tool: {fn_name}",
                        detail=f"Args: {json.dumps(fn_args)}",
                        status="completed"
                    )
                )

                tool_result = execute_tool(
                    name=fn_name,
                    args=fn_args,
                    attendance=attendance,
                    current_history=history
                )
                tool_records.append(
                    ToolCallRecord(
                        toolName=fn_name,
                        arguments=fn_args,
                        result=tool_result
                    )
                )

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "name": fn_name,
                    "content": json.dumps(tool_result)
                })

            second_response = await groq_service.call_chat_completion(
                messages=messages,
                temperature=0.2
            )

            second_meta = second_response.get("_onee_metadata", metadata)
            final_text = second_response["choices"][0]["message"].get("content", "")
            activities.append(
                AgentActivity(
                    id=f"act-{int(datetime.now().timestamp()*1000)}-final",
                    timestamp=get_now_timestamp(),
                    title="Answer synthesized",
                    status="completed"
                )
            )

            return ChatResponse(
                message=final_text.strip(),
                activities=activities,
                tool_calls=tool_records,
                modelUsed=second_meta.get("model_used"),
                isFallback=second_meta.get("fallback_used", False)
            )

        except Exception as e:
            logger.exception("Error during agent execution")
            activities.append(
                AgentActivity(
                    id=f"act-err-{int(datetime.now().timestamp()*1000)}",
                    timestamp=get_now_timestamp(),
                    title="Agent fallback",
                    detail=str(e),
                    status="warning"
                )
            )
            return self._generate_fallback(user_message, attendance, activities)

    async def stream_run(
        self,
        user_message: str,
        attendance: Optional[AttendanceSummary] = None,
        history: Optional[List[ChatMessage]] = None
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Progressively streams agent response events (activities, tokens, completion).
        """
        activities: List[AgentActivity] = []
        tool_records: List[ToolCallRecord] = []
        now_ts = get_now_timestamp()

        if attendance:
            act1 = AgentActivity(
                id=f"act-{int(datetime.now().timestamp()*1000)}-1",
                timestamp=now_ts,
                title="Attendance context loaded",
                detail=f"{attendance.totalCourses} courses · {attendance.overallPercentage}% aggregate",
                status="completed"
            )
            activities.append(act1)
            yield {"type": "activity", "data": act1.model_dump()}

        messages = self._build_system_messages(attendance, history, user_message)

        try:
            # Check for tool call first if attendance provided
            first_response = await groq_service.call_chat_completion(
                messages=messages,
                tools=TOOL_DEFINITIONS if attendance else None,
                tool_choice="auto" if attendance else "none",
                temperature=0.2
            )

            choice = first_response["choices"][0]
            message_obj = choice["message"]
            tool_calls = message_obj.get("tool_calls", [])

            if tool_calls:
                messages.append(message_obj)
                for tc in tool_calls:
                    fn_name = tc["function"]["name"]
                    raw_args = tc["function"].get("arguments", "{}")
                    try:
                        fn_args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                    except Exception:
                        fn_args = {}

                    act_tool = AgentActivity(
                        id=f"act-{int(datetime.now().timestamp()*1000)}-{fn_name}",
                        timestamp=get_now_timestamp(),
                        title=f"Tool: {fn_name}",
                        detail=f"Args: {json.dumps(fn_args)}",
                        status="completed"
                    )
                    activities.append(act_tool)
                    yield {"type": "activity", "data": act_tool.model_dump()}

                    tool_result = execute_tool(fn_name, fn_args, attendance)
                    tool_records.append(
                        ToolCallRecord(
                            toolName=fn_name,
                            arguments=fn_args,
                            result=tool_result
                        )
                    )

                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc["id"],
                        "name": fn_name,
                        "content": json.dumps(tool_result)
                    })

            # Stream tokens progressively
            full_text = ""
            async for token in groq_service.stream_chat_completion(messages=messages, temperature=0.2):
                full_text += token
                yield {"type": "token", "data": token}

            final_act = AgentActivity(
                id=f"act-{int(datetime.now().timestamp()*1000)}-final",
                timestamp=get_now_timestamp(),
                title="Response complete",
                status="completed"
            )
            activities.append(final_act)
            yield {"type": "activity", "data": final_act.model_dump()}

            yield {
                "type": "done",
                "data": {
                    "message": full_text.strip(),
                    "activities": [a.model_dump() for a in activities],
                    "tool_calls": [t.model_dump() for t in tool_records]
                }
            }

        except Exception as e:
            logger.exception("Error during streaming agent execution")
            fallback = self._generate_fallback(user_message, attendance, activities)
            # Yield fallback tokens with natural cadence
            words = fallback.message.split(" ")
            for idx, word in enumerate(words):
                chunk = word + (" " if idx < len(words) - 1 else "")
                yield {"type": "token", "data": chunk}
                await asyncio.sleep(0.02)

            yield {
                "type": "done",
                "data": {
                    "message": fallback.message,
                    "activities": [a.model_dump() for a in fallback.activities],
                    "tool_calls": []
                }
            }

    def _generate_fallback(
        self,
        user_message: str,
        attendance: Optional[AttendanceSummary],
        activities: List[AgentActivity]
    ) -> ChatResponse:
        if not attendance or not attendance.courses:
            return ChatResponse(
                message="I can't read your attendance right now. Please open your LPU UMS Attendance section.",
                activities=activities
            )

        user_msg_upper = user_message.upper()
        target_course = None
        for c in attendance.courses:
            if c.code.upper() in user_msg_upper:
                target_course = c
                break

        user_msg_lower = user_message.lower()

        if target_course:
            if target_course.percentage < 75.0:
                from .tools import calculate_required_classes_math
                if target_course.total > 0:
                    needed = calculate_required_classes_math(
                        target_course.attended, target_course.total, 75.0
                    )
                    msg = f"For **{target_course.code} ({target_course.name})**:\n\n" \
                          f"• Current Attendance: **{target_course.percentage}%** ({target_course.attended}/{target_course.total} classes attended)\n" \
                          f"• **Target 75%:** You **cannot** safely skip any classes. You must attend the next **{needed} consecutive class{'es' if needed != 1 else ''}** to reach 75%."
                else:
                    msg = f"For **{target_course.code} ({target_course.name})**:\n\n" \
                          f"• Current Attendance: **{target_course.percentage}%** (below 75% threshold)\n" \
                          f"• You **cannot** safely skip any classes. Prioritize attending upcoming lectures."
            else:
                margin = target_course.percentage - 75.0
                if target_course.total > 0:
                    from .tools import calculate_bunk_allowance_math
                    allowance = calculate_bunk_allowance_math(
                        target_course.attended, target_course.total, 75.0
                    )
                    msg = f"For **{target_course.code} ({target_course.name})**:\n\n" \
                          f"• Current Attendance: **{target_course.percentage}%** ({target_course.attended}/{target_course.total} classes attended)\n" \
                          f"• **Bunk Allowance:** You can safely skip **{allowance} class{'es' if allowance != 1 else ''}** without falling below the 75% threshold."
                else:
                    msg = f"For **{target_course.code} ({target_course.name})**:\n\n" \
                          f"• Current Attendance: **{target_course.percentage}%** (a **{margin:.1f}% safe buffer** above 75%)\n" \
                          f"• You can safely miss up to 1 in every 4 classes while staying eligible."
            return ChatResponse(message=msg, activities=activities)

        if "buffer" in user_msg_lower or "overall" in user_msg_lower or "how many classes" in user_msg_lower or "skip" in user_msg_lower:
            margin = max(0.0, attendance.overallPercentage - 75.0)
            if attendance.totalClasses > 0:
                from .tools import calculate_bunk_allowance_math
                overall_allowance = calculate_bunk_allowance_math(
                    attendance.totalAttended, attendance.totalClasses, 75.0
                )
                msg = f"Your overall aggregate attendance is **{attendance.overallPercentage}%** across {attendance.totalCourses} subjects ({attendance.totalAttended}/{attendance.totalClasses} classes attended).\n\n" \
                      f"• **Total Safe Skips:** You can safely skip up to **{overall_allowance} class{'es' if overall_allowance != 1 else ''}** across your subjects combined while staying at or above 75%."
            else:
                msg = f"Your overall aggregate attendance is **{attendance.overallPercentage}%** across {attendance.totalCourses} subjects.\n\n" \
                      f"• You have a **{margin:.1f}% safety buffer** above 75%."
            return ChatResponse(message=msg, activities=activities)

        lowest = min(attendance.courses, key=lambda c: c.percentage) if attendance.courses else None
        if attendance.totalClasses > 0:
            msg = f"You are currently at **{attendance.overallPercentage}%** overall across {attendance.totalCourses} subjects ({attendance.totalAttended}/{attendance.totalClasses} classes attended).\n\n"
        else:
            msg = f"You are currently at **{attendance.overallPercentage}%** overall across {attendance.totalCourses} subjects.\n\n"
        if lowest:
            msg += f"• **Lowest Subject:** **{lowest.code}** is currently your lowest at **{lowest.percentage}%**."

        return ChatResponse(
            message=msg,
            activities=activities
        )

onee_agent = OneeAgent()
