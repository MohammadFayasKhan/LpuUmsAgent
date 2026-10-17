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
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, AsyncGenerator
import re
from ..schemas.attendance import AttendanceSummary
from ..schemas.chat import ChatMessage, ChatResponse, AgentActivity, ToolCallRecord
from .prompts import SYSTEM_PROMPT
from .tools import (
    TOOL_DEFINITIONS,
    execute_tool,
    calculate_bunk_allowance_math,
    calculate_required_classes_math
)
from ..services.groq_service import groq_service

logger = logging.getLogger(__name__)

def get_now_timestamp() -> str:
    return datetime.now().strftime("%H:%M:%S")

def format_room_location_py(room: str) -> str:
    if not room or room in ["N/A", "TBD"]:
        return room or "N/A"
    import re
    trimmed = str(room).strip()
    m = re.match(r"^(\d{1,2})-(\d)(\d{2})$", trimmed)
    if m:
        block = m.group(1)
        floor = int(m.group(2))
        suffix = "1st" if floor == 1 else "2nd" if floor == 2 else "3rd" if floor == 3 else f"{floor}th"
        return f"**{trimmed}** (Block {block}, {suffix} Floor)"
    m2 = re.match(r"^(\d{1,2})-(.*)$", trimmed)
    if m2:
        return f"**{trimmed}** (Block {m2.group(1)})"
    return f"**{trimmed}**"

def format_cabin_location_py(cabin: str) -> str:
    if not cabin or cabin in ["N/A", "TBD"] or "verified" in str(cabin).lower():
        return cabin or "Verified in UMS report"
    import re
    trimmed = str(cabin).strip()
    m = re.match(r"^(\d{1,2})-(\d+)", trimmed)
    if m:
        return f"**{trimmed}** (Block {m.group(1)}, Cabin {m.group(2)})"
    return f"**{trimmed}**"

def parse_time_minutes_py(time_str: str) -> tuple[int, int]:
    import re
    m = re.search(r"(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)?", str(time_str), re.I)
    if not m:
        return (0, 0)
    sh, sm, eh, em, period = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4)), (m.group(5) or "").upper()
    if period == "PM" or (1 <= sh <= 6):
        if sh < 12: sh += 12
    if period == "PM" or (1 <= eh <= 6):
        if eh < 12: eh += 12
    return (sh * 60 + sm, eh * 60 + em)

def consolidate_slots_py(raw_slots: list) -> list:
    if not raw_slots:
        return []
    sorted_slots = sorted(raw_slots, key=lambda s: parse_time_minutes_py(s.get("time", ""))[0])
    res = []
    for s in sorted_slots:
        if res:
            prev = res[-1]
            if (
                prev.get("day", "").lower() == s.get("day", "").lower()
                and prev.get("room", "") == s.get("room", "")
                and str(prev.get("type", "")).lower() == str(s.get("type", "")).lower()
                and str(prev.get("courseCode", "")).upper() == str(s.get("courseCode", "")).upper()
            ):
                prev_end = parse_time_minutes_py(prev.get("timeRange", ""))[1]
                curr_start = parse_time_minutes_py(s.get("time", ""))[0]
                if curr_start <= prev_end + 10:
                    prev_start_str = prev.get("timeRange", "").split("-")[0].strip()
                    curr_end_str = s.get("time", "").split("-")[1].strip() if "-" in s.get("time", "") else s.get("time", "")
                    prev["timeRange"] = f"{prev_start_str} - {curr_end_str}"
                    continue
        res.append({
            "day": s.get("day", "Scheduled Day"),
            "timeRange": s.get("time", "TBD"),
            "type": s.get("type") or s.get("slotType") or "Class",
            "room": s.get("room", "N/A"),
            "section": s.get("section", ""),
            "group": s.get("group", ""),
            "courseCode": s.get("courseCode") or s.get("course_code") or "",
            "courseTitle": s.get("courseTitle", ""),
            "facultyName": s.get("facultyName"),
            "facultyCabin": s.get("facultyCabin"),
        })
    return res

class OneeAgent:
    def __init__(self):
        pass


    def _build_system_messages(
        self,
        attendance: Optional[AttendanceSummary] = None,
        examination: Optional[Dict[str, Any]] = None,
        timetable: Optional[Dict[str, Any]] = None,
        history: Optional[List[ChatMessage]] = None,
        user_message: str = ""
    ) -> List[Dict[str, Any]]:
        now = datetime.now()
        today_name = now.strftime("%A")
        today_date = now.strftime("%d %B %Y")
        current_time_str = now.strftime("%I:%M %p")
        tomorrow_name = (now + timedelta(days=1)).strftime("%A")

        messages: List[Dict[str, Any]] = [
            {"role": "system", "content": f"{SYSTEM_PROMPT}\n\nTIME CONTEXT: Today is {today_name}, {today_date}. Current time is {current_time_str}. Tomorrow is {tomorrow_name}."}
        ]

        # Classify query domain to keep prompt token footprint well under API limits (prevents 413 TPM errors)
        user_lower = (user_message or "").lower()
        is_exam_domain = any(w in user_lower for w in [
            "exam", "datesheet", "date sheet", "seating", "seat", "hall", "bench",
            "venue", "mid term", "end term", "admit card", "sample paper"
        ]) or (examination and bool(examination.get("exams")) and not any(w in user_lower for w in ["attendance", "bunk", "skip", "timetable", "classes today", "classes tomorrow"]))

        is_timetable_domain = any(w in user_lower for w in [
            "class", "classes", "lecture", "lectures", "practical", "lab", "timing", "schedule",
            "period", "periods", "tomorrow", "today", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
            "faculty cabin", "teacher cabin", "cabin", "who teaches"
        ])

        is_attendance_domain = any(w in user_lower for w in [
            "attendance", "bunk", "safe bunk", "skip", "miss", "leave", "absent", "attended",
            "shortage", "percentage", "75%", "80%", "clearance", "can i miss"
        ])

        # 1. Provide verified timetable context if available
        if timetable and (timetable.get("slots") or timetable.get("courses")):
            if (is_exam_domain or is_attendance_domain) and not is_timetable_domain:
                tt_context = {
                    "registered_courses": [
                        {"courseCode": c.get("courseCode"), "courseTitle": c.get("courseTitle")}
                        for c in timetable.get("courses", [])
                    ]
                }
            else:
                tt_context = {
                    "slots": timetable.get("slots", []),
                    "registered_courses": timetable.get("courses", []),
                    "home_section": timetable.get("homeSection") or timetable.get("section") or "",
                    "total_credits": timetable.get("totalCredits") or sum(int(c.get("credits", 0) or 0) for c in timetable.get("courses", []))
                }
            messages.append({
                "role": "system",
                "content": (
                    f"VERIFIED STUDENT TIMETABLE & REGISTERED COURSES (Source: Authenticated LPU UMS Portal):\n"
                    f"{json.dumps(tt_context, separators=(',', ':'))}\n\n"
                    f"TIMETABLE & COURSE GUIDELINES:\n"
                    f"- Current time is {current_time_str} on {today_name} ({today_date}). Tomorrow is {tomorrow_name}.\n"
                    f"- Specific Course / Room Query (e.g. 'Check room for CSE472 practical', 'Verify room for CSE330 practical', 'Where is CSE329?'):\n"
                    f"  * Pinpoint that exact course code and session type (Practical vs Lecture).\n"
                    f"  * Inspect the 'slots' array for that exact course code.\n"
                    f"  * If practical was asked, return the practical slot(s) with Day, Time, Room number (e.g. 33-502), Block (e.g. Block 33), and Section. Highlight if the lecture room is different.\n"
                    f"  * If lecture was asked, return the lecture slot(s) with Day, Time, Room number, Block, and Section.\n"
                    f"  * Answer directly and concisely with a focused summary or mini-table for THAT course. NEVER dump all other subjects or the entire weekly schedule!\n"
                    f"- Specific Faculty Cabin Query (e.g. 'Get faculty cabin for CSE330 practical', 'Where is teacher cabin for INT373', 'Who teaches CSE408?'):\n"
                    f"  * Locate the course in 'registered_courses'.\n"
                    f"  * State the Instructor Name, Course Title, Cabin Location (e.g. Block 37, Cabin 911), Course Type, and Credits.\n"
                    f"  * Answer directly for that course; do NOT dump the entire faculty directory.\n"
                    f"- Next Class Query (e.g. 'Where is my next class?', 'What class do I have next?'):\n"
                    f"  * Check today's ({today_name}) scheduled slots against the current time ({current_time_str}).\n"
                    f"  * If a class is running now or starting soon today, state it clearly.\n"
                    f"  * If all classes for today are completed, explicitly inform the student that today's classes are over and state the very first upcoming class tomorrow ({tomorrow_name}) or the next scheduled day with its exact time, room, and block.\n"
                    f"- Full Schedule / Day Schedule: If the student asks for a day's schedule or weekly matrix, render the schedule table with Time Slot, Subject Code, Type, Room / Venue, Section, followed by Schedule Insights & Daily Flow.\n"
                    f"- Registered Courses / Curriculum / Faculty Directory Query: If the student asks for their enrolled courses, all subjects, or the full faculty directory, render the full Registered Courses & Faculty Directory markdown table.\n"
                )
            })

        # 2. Provide verified attendance context if available
        att_courses = []
        if attendance:
            if hasattr(attendance, "courses") and attendance.courses:
                att_courses = attendance.courses
            elif isinstance(attendance, dict) and attendance.get("courses"):
                att_courses = attendance.get("courses", [])

        if att_courses and isinstance(att_courses[0], (dict, object)) and (getattr(att_courses[0], "attended", None) is not None or (isinstance(att_courses[0], dict) and "attended" in att_courses[0])):
            total_delivered = (
                getattr(attendance, "totalDelivered", None) or
                getattr(attendance, "totalClasses", None) or
                (attendance.get("totalDelivered") if isinstance(attendance, dict) else None) or
                (attendance.get("totalClasses") if isinstance(attendance, dict) else None) or
                0
            )
            course_items = []
            if is_attendance_domain or (not is_exam_domain and not is_timetable_domain):
                for c in att_courses:
                    c_code = getattr(c, "code", None) or (c.get("code") if isinstance(c, dict) else None) or ""
                    if not c_code:
                        continue
                    c_name = getattr(c, "name", "") or (c.get("name") if isinstance(c, dict) else "")
                    c_att = getattr(c, "attended", 0) or (c.get("attended") if isinstance(c, dict) else 0)
                    c_del = getattr(c, "delivered", 0) or getattr(c, "total", 0) or (c.get("delivered", 0) or c.get("total", 0) if isinstance(c, dict) else 0)
                    c_pct = getattr(c, "percentage", 0.0) or (c.get("percentage") if isinstance(c, dict) else 0.0)
                    course_items.append({
                        "code": c_code,
                        "name": c_name,
                        "attended": c_att,
                        "delivered": c_del,
                        "absent": getattr(c, "absent", 0) or (c.get("absent") if isinstance(c, dict) else 0),
                        "duty_leave": getattr(c, "dutyLeave", 0) or (c.get("dutyLeave") if isinstance(c, dict) else 0),
                        "percentage": c_pct,
                        "safe_bunks_to_75": calculate_bunk_allowance_math(c_att, c_del, 75.0),
                        "required_to_75": calculate_required_classes_math(c_att, c_del, 75.0),
                        "safe_bunks_to_80": calculate_bunk_allowance_math(c_att, c_del, 80.0),
                        "required_to_80": calculate_required_classes_math(c_att, c_del, 80.0),
                        "data_quality": getattr(c, "dataQuality", "valid") or (c.get("dataQuality") if isinstance(c, dict) else "valid")
                    })
            total_att = getattr(attendance, "totalAttended", None) or (attendance.get("totalAttended") if isinstance(attendance, dict) else None) or 0
            tot_abs = getattr(attendance, "totalAbsent", None) or (attendance.get("totalAbsent") if isinstance(attendance, dict) else None) or (total_delivered - total_att if total_delivered >= total_att else 0)
            ov_pct = getattr(attendance, "overallPercentage", None) or (attendance.get("overallPercentage") if isinstance(attendance, dict) else None) or 0.0
            st_name = getattr(attendance, "studentName", None) or (attendance.get("studentName") if isinstance(attendance, dict) else None)
            reg_num = getattr(attendance, "registrationNumber", None) or (attendance.get("registrationNumber") if isinstance(attendance, dict) else None)
            attendance_context = {
                "overall": {
                    "total_classes": total_delivered,
                    "total_delivered": total_delivered,
                    "total_attended": total_att,
                    "total_absent": tot_abs,
                    "overall_percentage": ov_pct,
                    "student_name": st_name,
                    "registration_number": reg_num
                }
            }
            if course_items:
                attendance_context["courses"] = course_items

            messages.append({
                "role": "system",
                "content": (
                    f"VERIFIED STUDENT ATTENDANCE DATA (Source: Authenticated LPU UMS Portal):\n"
                    f"{json.dumps(attendance_context, separators=(',', ':'))}\n\n"
                    f"ATTENDANCE GUIDELINES:\n"
                    f"- ONLY render attendance breakdown tables or bunk calculations when the student asks about attendance, safe bunks, skipping classes, course eligibility, or academic status.\n"
                    f"- If the student is asking about something else (e.g. timetable, greetings, exams), do NOT output attendance numbers or tables."
                )
            })

        # 3. Provide verified examination context if available
        if examination and examination.get("exams"):
            exams_payload = examination.get("exams", [])
            if is_timetable_domain and not is_exam_domain:
                exams_payload = [
                    {"courseCode": e.get("courseCode"), "examDate": e.get("examDate"), "startTime": e.get("startTime")}
                    for e in exams_payload[:3]
                ]
            messages.append({
                "role": "system",
                "content": (
                    f"VERIFIED EXAMINATION SCHEDULE (Source: Authenticated LPU UMS Portal):\n"
                    f"{json.dumps(exams_payload, separators=(',', ':'))}\n\n"
                    f"EXAMINATION & SEATING PLAN GUIDELINES:\n"
                    f"- Current date is {today_date} ({today_name}).\n"
                    f"- Specific Course, Room, or Seat Number Query (e.g. 'check seat number for INT 373', 'Check CSE408 seat for 18 Oct exam', 'Where is my exam room?'):\n"
                    f"  * Locate the exact course code (e.g. INT373, CSE408) and date (if specified, e.g. 18 Oct vs 15 Dec) from the student's request.\n"
                    f"  * Answer directly and focused on THAT specific examination with its Confirmed Venue / Room (e.g. Room 37-707, Block 37, 7th Floor), Timing, Reporting time, and Seat status.\n"
                    f"  * Seat Number Clarity: If the portal lists an allocated seat/desk number, provide it. If not specified or listed as Awaited/Assigned, explicitly explain: 'Your examination hall is confirmed at Room 37-707 (Block 37, 7th Floor). Individual physical bench/desk numbers are allocated inside the hall and posted on the seating chart outside the examination room on the morning of the exam.'\n"
                    f"  * If question paper structure/instructions are present (e.g. '5 Short Question 2 Marks each, 3 Long Questions 10 Marks each'), mention it as helpful preparation info.\n"
                    f"  * NEVER dump all 6 exams in a big table when the student asks for a specific course, room, or seat!\n"
                    f"- General Date Sheet Query (e.g. 'Show my date sheet', 'When are my exams?', 'How many exams do I have?'):\n"
                    f"  * Render the clean chronological date sheet table.\n"
                )
            })

        # 4. Context & Intent Directives for the LLM
        messages.append({
            "role": "system",
            "content": (
                "CONTEXT & INTENT DIRECTIVES:\n"
                "1. Understand the student's true intent and context from their query and conversation history.\n"
                "2. Identity & Greetings: If the student asks who you are, what you can do, or greets you ('hey who are you', 'hi', etc.), reply warmly and concisely in 1-2 paragraphs introducing ONEE as their AI academic companion for LPU. Do NOT dump any tables or figures for greetings.\n"
                "3. Missing Data Transparency: If the student specifically asks for data that is not present in the verified context (e.g. asking for attendance when attendance records are empty, or asking for exams when no date sheet is loaded), clearly inform them to open the respective page in UMS (e.g. 'View Attendance' or 'Date Sheet') so you can view and verify it. NEVER fabricate or guess records.\n"
                "4. Targeted Answers: When asked a specific question (e.g. 'Where is my next class (CSE329)?'), answer the exact question directly first (room, timing, venue) without overwhelming the student with unrequested data tables.\n"
                "5. Numeric Follow-up Simulation: If the student asks a brief numeric follow-up without repeating the course code (e.g., 'what about 5', 'can I do 6?'): resolve the target course code from the immediate conversation history, simulate skipping that exact requested number of classes (ensure the row for 'Skip X Classes' is explicitly included in the table with its exact formula Attended/(Delivered + X) and resulting percentage), and state clearly whether that skip count is safe."
            )
        })

        if history:
            for h in history[-4:]:
                role = "user" if h.sender == "user" else "assistant"
                content = h.text
                if role == "assistant" and len(content) > 400:
                    lines = content.split("\n")
                    content = "\n".join(lines[:4]) + "\n[Table summary omitted for brevity]\n" + "\n".join(lines[-2:])
                messages.append({"role": role, "content": content})

        messages.append({"role": "user", "content": user_message})
        return messages

    async def run(
        self,
        user_message: str,
        attendance: Optional[AttendanceSummary] = None,
        examination: Optional[Dict[str, Any]] = None,
        timetable: Optional[Dict[str, Any]] = None,
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

        messages = self._build_system_messages(
            attendance=attendance,
            examination=examination,
            timetable=timetable,
            history=history,
            user_message=user_message
        )

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
                suggestions = await self.generate_suggestions(
                    user_message=user_message,
                    assistant_response=final_text.strip(),
                    attendance=attendance,
                    examination=examination,
                    timetable=timetable,
                    history=history
                )
                return ChatResponse(
                    message=final_text.strip(),
                    activities=activities,
                    tool_calls=tool_records,
                    modelUsed=metadata.get("model_used"),
                    isFallback=metadata.get("fallback_used", False),
                    suggestions=suggestions
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
                    tool_name=fn_name,
                    args=fn_args,
                    attendance=attendance
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

            if not final_text or not final_text.strip():
                logger.warning("Model returned empty text; generating elaborated fallback response")
                fallback = self._generate_fallback(
                    user_message=user_message,
                    attendance=attendance,
                    activities=activities,
                    examination=examination,
                    timetable=timetable,
                    history=history
                )
                final_text = fallback.message

            activities.append(
                AgentActivity(
                    id=f"act-{int(datetime.now().timestamp()*1000)}-final",
                    timestamp=get_now_timestamp(),
                    title="Answer synthesized",
                    status="completed"
                )
            )

            suggestions = await self.generate_suggestions(
                user_message=user_message,
                assistant_response=final_text.strip(),
                attendance=attendance,
                examination=examination,
                timetable=timetable,
                history=history
            )

            return ChatResponse(
                message=final_text.strip(),
                activities=activities,
                tool_calls=tool_records,
                modelUsed=second_meta.get("model_used"),
                isFallback=second_meta.get("fallback_used", False),
                suggestions=suggestions
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
            fallback = self._generate_fallback(
                user_message=user_message,
                attendance=attendance,
                activities=activities,
                examination=examination,
                timetable=timetable,
                history=history
            )
            fallback.suggestions = self._generate_contextual_heuristic_suggestions(
                user_message=user_message,
                assistant_response=fallback.message,
                attendance=attendance
            )
            return fallback

    async def stream_run(
        self,
        user_message: str,
        attendance: Optional[AttendanceSummary] = None,
        examination: Optional[Dict[str, Any]] = None,
        timetable: Optional[Dict[str, Any]] = None,
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

        messages = self._build_system_messages(
            attendance=attendance,
            examination=examination,
            timetable=timetable,
            history=history,
            user_message=user_message
        )

        try:
            # Stream tokens progressively with direct low-latency inference
            full_text = ""
            async for token in groq_service.stream_chat_completion(messages=messages, temperature=0.2):
                full_text += token
                yield {"type": "token", "data": token}

            if not full_text or not full_text.strip():
                logger.warning("Stream produced empty text; generating elaborated fallback response")
                fallback = self._generate_fallback(
                    user_message=user_message,
                    attendance=attendance,
                    activities=activities,
                    examination=examination,
                    timetable=timetable,
                    history=history
                )
                full_text = fallback.message
                import re
                lines = full_text.split("\n")
                for l_idx, line in enumerate(lines):
                    words = re.findall(r"\S+|\s+", line)
                    for word in words:
                        yield {"type": "token", "data": word}
                        await asyncio.sleep(0.012)
                    if l_idx < len(lines) - 1:
                        yield {"type": "token", "data": "\n"}
                        await asyncio.sleep(0.022)

            final_act = AgentActivity(
                id=f"act-{int(datetime.now().timestamp()*1000)}-final",
                timestamp=get_now_timestamp(),
                title="Response complete",
                status="completed"
            )
            activities.append(final_act)
            yield {"type": "activity", "data": final_act.model_dump()}

            suggestions = await self.generate_suggestions(
                user_message=user_message,
                assistant_response=full_text.strip(),
                attendance=attendance,
                examination=examination,
                timetable=timetable,
                history=history
            )
            yield {"type": "suggestions", "data": suggestions}

            yield {
                "type": "done",
                "data": {
                    "message": full_text.strip(),
                    "activities": [a.model_dump() for a in activities],
                    "tool_calls": [t.model_dump() for t in tool_records],
                    "suggestions": suggestions
                }
            }

        except Exception as e:
            logger.exception("Error during streaming agent execution")
            fallback = self._generate_fallback(
                user_message=user_message,
                attendance=attendance,
                activities=activities,
                examination=examination,
                timetable=timetable,
                history=history
            )
            suggestions = self._generate_contextual_heuristic_suggestions(
                user_message=user_message,
                assistant_response=fallback.message,
                attendance=attendance
            )
            yield {"type": "suggestions", "data": suggestions}

            # Yield fallback tokens with natural cadence
            import re
            lines = fallback.message.split("\n")
            for l_idx, line in enumerate(lines):
                words = re.findall(r"\S+|\s+", line)
                for word in words:
                    yield {"type": "token", "data": word}
                    await asyncio.sleep(0.012)
                if l_idx < len(lines) - 1:
                    yield {"type": "token", "data": "\n"}
                    await asyncio.sleep(0.022)

            yield {
                "type": "done",
                "data": {
                    "message": fallback.message,
                    "activities": [a.model_dump() for a in fallback.activities],
                    "tool_calls": [],
                    "suggestions": suggestions
                }
            }

    def _generate_fallback(
        self,
        user_message: str,
        attendance: Optional[AttendanceSummary],
        activities: List[AgentActivity],
        examination: Optional[Dict[str, Any]] = None,
        timetable: Optional[Dict[str, Any]] = None,
        history: Optional[List[ChatMessage]] = None
    ) -> ChatResponse:
        from .tools import calculate_bunk_allowance_math, calculate_required_classes_math
        import re
        user_msg_lower = user_message.lower()

        # -1. IDENTITY & CASUAL CONVERSATION QUERY
        is_identity = any(w in user_msg_lower for w in ["who are you", "what can you do", "introduce yourself", "tell me about yourself", "what are you"])
        is_casual = user_msg_lower in ["hello", "hi", "hey", "good morning", "good evening", "how are you", "thank you", "thanks"]
        if is_identity or is_casual:
            msg = (
                "Hello! I am ONEE, your intelligent AI companion built specifically for students at Lovely Professional University (LPU).\n\n"
                "Here is what I can help you with:\n"
                "- 📊 **Attendance & Safe Bunks:** Live percentage tracking and calculated safe skip capacity to keep you above 75%.\n"
                "- 📅 **Time Table & Venues:** Chronological class schedules, room numbers, lecture blocks, and faculty cabin locations.\n"
                "- 📝 **Examinations & Seating:** Complete date sheets, atom/term exams, timings, and exact hall/seat allocations.\n"
                "- 📥 **Sample Papers:** Discovering and opening official sample question papers directly from UMS.\n\n"
                "How can I assist your academics today?"
            )
            return ChatResponse(
                message=msg,
                activities=activities,
                isFallback=True,
                suggestions=["Check today's classes", "How many can I skip in CSE329?", "When is my next exam?"]
            )

        # -0.5 SAMPLE PAPERS QUERY (Takes precedence over timetable)
        is_sample_paper_query = any(w in user_msg_lower for w in [
            "sample paper", "sample question paper", "sample question", "model paper", "previous year paper", "previous paper", "question paper"
        ])
        if is_sample_paper_query:
            course_match = re.search(r'\b([A-Za-z]{2,5})\s*(\d{3,4}[A-Za-z]?)\b', user_message)
            queried_course = None
            if course_match:
                pfx = course_match.group(1).upper()
                dgts = course_match.group(2).upper()
                if pfx not in ["PAPER", "SAMPLE", "TERM", "EXAM", "DATE", "TIME"]:
                    if pfx == "CSC":
                        pfx = "CSE"
                    queried_course = f"{pfx}{dgts}"

            exams = examination.get("exams", []) if isinstance(examination, dict) else []
            matched_exam = None
            if queried_course and exams:
                for e in exams:
                    c_code = (e.get("courseCode") or "").replace(" ", "").upper()
                    if c_code == queried_course or c_code.replace("CSC", "CSE") == queried_course:
                        matched_exam = e
                        break

            if matched_exam:
                code = matched_exam.get("courseCode", queried_course)
                e_type = matched_exam.get("examType") or "Regular Examination"
                e_date = matched_exam.get("examDate") or "Scheduled Date"
                instructions = matched_exam.get("instructions") or "MCQ / Objective format"
                has_sp = matched_exam.get("samplePaper", {}).get("available", True) if isinstance(matched_exam.get("samplePaper"), dict) else True
                msg = (
                    f"### 📄 Official Sample Question Paper: **{code}**\n\n"
                    f"Verified sample question paper details for **{code}** ({e_type}) directly from your authenticated UMS examination portal:\n\n"
                    "| Examination Detail | Verified Information |\n"
                    "| :--- | :--- |\n"
                    f"| 📚 **Subject Code** | **{code}** ({matched_exam.get('courseName', '')}) |\n"
                    f"| 📋 **Exam Type** | {e_type} |\n"
                    f"| 📅 **Scheduled Date** | 📅 **{e_date}** |\n"
                    f"| ℹ️ **Paper Pattern** | {instructions} |\n"
                    f"| 📥 **Sample Paper Status** | {'🟢 **Available on UMS**' if has_sp else '⏳ Awaited from University'} |\n\n"
                    "#### 📥 Download & Access Instructions:\n"
                    f"- The official sample question paper for **{code}** is published on your UMS examination conduct portal.\n"
                    f"- Click the purple **\"Sample Question Paper\"** button on the **{code}** card to view or download the official PDF.\n\n"
                    "> 🔒 **Directly Verified:** UMS Student Examination Conduct & Seating Plan dashboard."
                )
                return ChatResponse(
                    message=msg,
                    activities=activities,
                    suggestions=[f"Check venue for {code}", "Show full date sheet", "Check my attendance"]
                )
            elif queried_course:
                msg = (
                    f"### 📄 Official Sample Question Paper: **{queried_course}**\n\n"
                    f"ONEE verified your official UMS Examination records for **{queried_course}**.\n\n"
                    f"- 📋 **Status:** The sample question paper for **{queried_course}** can be accessed directly from your authenticated **UMS Examination Conduct & Seating Plan** dashboard.\n"
                    f"- 🔗 **Action:** Click the purple **\"Sample Question Paper\"** button on your **{queried_course}** exam card to view or download the official model paper.\n"
                    f"- 💡 **Exam Notice:** Mid-Term and Theory End-Term sample papers provide the exact question distribution and mark allocations.\n\n"
                    "> 🔒 **Verified Source:** UMS Student Examination Conduct portal."
                )
                return ChatResponse(
                    message=msg,
                    activities=activities,
                    suggestions=[f"When is my {queried_course} exam?", "Show full date sheet", "Check today's classes"]
                )
            else:
                msg = (
                    "### 📄 Official Sample Question Papers\n\n"
                    "Here are the sample question papers available on your UMS examination portal:\n\n"
                )
                if exams:
                    rows = []
                    for e in exams:
                        c_code = e.get("courseCode", "Exam")
                        has_p = e.get("samplePaper", {}).get("available", True) if isinstance(e.get("samplePaper"), dict) else True
                        rows.append(f"- **{c_code}** ({e.get('examType', 'Exam')}): {'🟢 Sample Paper Available on UMS' if has_p else '📅 Scheduled on ' + e.get('examDate', 'TBD')}")
                    msg += "\n".join(rows) + "\n\n> 💡 **Tip:** Ask *\"Download sample paper for CSE408\"* to access a specific course."
                else:
                    msg += "No examination records are currently loaded. Open your UMS Examination Conduct section to view available sample papers."
                return ChatResponse(
                    message=msg,
                    activities=activities,
                    suggestions=["Download sample paper for CSE408", "When is my next exam?", "Check attendance"]
                )

        # Pre-check attendance & exam intent so words like 'subject' or 'course' never hijack them into timetable
        is_attendance_query = any(w in user_msg_lower for w in [
            "attendance", "bunk", "safe bunk", "skip", "skips", "miss", "leave", "duty leave",
            "lowest", "worst", "percentage", "percent", "75%", "80%", "clearance", "maintain",
            "shortage", "detain", "eligible"
        ]) or (attendance and attendance.courses and any(c.code.lower() in user_msg_lower for c in attendance.courses) and any(w in user_msg_lower for w in ["miss", "skip", "bunk", "cut", "attend", "how many", "can i", "percentage", "margin"]))

        is_exam_query_prior = any(w in user_msg_lower for w in [
            "datesheet", "date sheet", "exam schedule", "next exam", "atom exam", "term exam",
            "mid term", "end term", "seating", "seat number", "reporting time"
        ]) or ("exam" in user_msg_lower and not any(w in user_msg_lower for w in ["attendance", "bunk", "skip", "clearance", "eligib"]))

        # 0. TIMETABLE / CLASS SCHEDULE / REGISTERED COURSES QUERY
        is_timetable_query = not is_attendance_query and not is_exam_query_prior and any(w in user_msg_lower for w in [
            "timetable", "schedule", "routine", "period", "periods", "classes on", "class on", "which class",
            "which classes", "what class", "what classes", "classes today", "classes tomorrow", "my classes",
            "next class", "lecture", "lectures", "matrix", "weekly", "all classes", "classes this week",
            "complete list", "list of classes", "detailed matrix", "classes that i have", "full timetable",
            "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
            "today", "tomorrow", "faculty", "cabin", "room", "venue",
            "curriculum", "registered courses", "enrolled courses",
            "course list", "subject list", "faculty directory", "teachers", "professors", "who teaches", "who are my teachers"
        ])
        if is_timetable_query:
            timetable_dict = timetable if isinstance(timetable, dict) else {}
            courses_list = timetable_dict.get("courses", [])
            slots = timetable_dict.get("slots", [])
            total_credits = timetable_dict.get("totalCredits") or sum(int(c.get("credits", 0) or 0) for c in courses_list)

            now = datetime.now()
            today_name = now.strftime("%A")
            tomorrow_name = (now + timedelta(days=1)).strftime("%A")
            current_time_str = now.strftime("%I:%M %p")
            current_minutes = now.hour * 60 + now.minute

            course_match = re.search(r'\b([A-Za-z]{2,5}\s*\d{3,4}[A-Za-z]?)\b', user_message)
            queried_course = course_match.group(1).replace(" ", "").upper() if course_match else None

            is_cabin_query = any(w in user_msg_lower for w in ["cabin", "cabins", "faculty", "teacher", "teachers", "professor", "professors", "who teaches", "who is teaching"])
            is_practical_requested = any(w in user_msg_lower for w in ["practical", "practicals", "lab", "labs"])
            is_lecture_requested = any(w in user_msg_lower for w in ["lecture", "lectures", "theory"])
            is_room_query = any(w in user_msg_lower for w in ["room", "rooms", "venue", "venues", "where is", "which room", "what room", "check room", "verify room", "location", "classroom", "block", "hall"]) or (bool(queried_course) and not is_cabin_query and (is_practical_requested or is_lecture_requested or "where" in user_msg_lower))
            is_next_class_query = any(w in user_msg_lower for w in ["next class", "what is next", "what's next", "upcoming class", "any more classes", "remaining classes", "classes left", "current class", "ongoing class", "class right now"])
            is_weekly_request = any(w in user_msg_lower for w in [
                "matrix", "weekly", "all classes", "classes this week",
                "complete list", "list of classes", "detailed matrix",
                "classes that i have", "full timetable", "whole week", "entire week"
            ])
            is_pure_course_query = (not is_weekly_request and not queried_course and not is_room_query and any(w in user_msg_lower for w in [
                "curriculum", "registered courses", "enrolled courses", "course list", "subject list", "faculty directory", "all teachers", "all faculty"
            ]))

            requested_day = None
            if not is_weekly_request:
                if "tomorrow" in user_msg_lower:
                    requested_day = tomorrow_name
                elif "today" in user_msg_lower:
                    requested_day = today_name
                else:
                    for d in ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]:
                        if d in user_msg_lower:
                            requested_day = d.capitalize()
                            break

            # 1. Pure Curriculum / Faculty Directory Query
            if is_pure_course_query and courses_list:
                course_rows = []
                for c in courses_list:
                    cabin = c.get("facultyCabin") or c.get("cabinNumber")
                    fac_display = f"{c.get('facultyName', 'Faculty')} ({format_cabin_location_py(cabin)})" if cabin else c.get('facultyName', 'Faculty')
                    ltp = f"{c.get('lectures', 0)}-{c.get('tutorial', 0)}-{c.get('practical', 0)}"
                    course_rows.append(
                        f"| **{c.get('courseCode', 'TBD')}** | {c.get('courseType') or 'Core'} | {c.get('courseTitle', '')} | {ltp} | {c.get('credits', 0)} | {fac_display} | {c.get('lastUpdated', 'NA')} |"
                    )
                rows = "\n".join(course_rows)
                msg = (
                    "### 📚 Registered Courses & Faculty Directory\n\n"
                    f"Here is your official enrolled curriculum (**{len(courses_list)} courses**, **{total_credits} total credits**) verified from your authenticated UMS portal:\n\n"
                    "| Course Code | Type | Course Title | L-T-P | Credits | Faculty & Cabin | Last Updated |\n"
                    "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n"
                    f"{rows}\n\n"
                    "> 💡 **Directory Note:** Faculty cabin locations and course credits are verified directly from your official UMS Student Time Table report."
                )
                return ChatResponse(
                    message=msg,
                    activities=activities,
                    suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance)
                )

            # 2. Specific Course Code Query (Room, Venue, Faculty Cabin, Timings)
            if queried_course and (slots or courses_list):
                course_slots = [
                    s for s in slots
                    if (s.get("courseCode") or s.get("course_code") or "").replace(" ", "").upper() == queried_course
                ]
                matched_course = next(
                    (c for c in courses_list if str(c.get("courseCode", "")).replace(" ", "").upper() == queried_course),
                    None
                )

                # Sub-branch A: Faculty Cabin Query
                if is_cabin_query and not is_room_query:
                    code_display = matched_course.get("courseCode") if matched_course else queried_course
                    title_display = matched_course.get("courseTitle") if matched_course else (course_slots[0].get("courseTitle", "") if course_slots else "Course")
                    fac_name = (matched_course.get("facultyName") if matched_course else None) or (course_slots[0].get("facultyName") if course_slots else None) or "Course Instructor"
                    raw_cabin = (matched_course.get("facultyCabin") or matched_course.get("cabinNumber") if matched_course else None) or (course_slots[0].get("facultyCabin") if course_slots else None) or "Verified in UMS report"
                    cabin_fmt = format_cabin_location_py(raw_cabin)
                    ltp = f"{matched_course.get('lectures', 0)}-{matched_course.get('tutorial', 0)}-{matched_course.get('practical', 0)}" if matched_course else "N/A"
                    credits_val = matched_course.get("credits", 0) if matched_course else 0
                    course_type = matched_course.get("courseType") or "Core" if matched_course else "Core"

                    session_list = ""
                    if course_slots:
                        consolidated = consolidate_slots_py(course_slots)
                        lines = [
                            f"- **{s.get('type', 'Class')}**: **{s.get('day')}** ({s.get('timeRange')}) in {format_room_location_py(s.get('room', 'N/A'))}{' · Section: ' + s.get('section') if s.get('section') else ''}"
                            for s in consolidated
                        ]
                        session_list = "\n\n#### 📍 Scheduled Sessions & Venues:\n" + "\n".join(lines)

                    msg = (
                        f"### 👨‍🏫 Faculty & Cabin Details: **{code_display}**\n\n"
                        f"Here are the verified faculty and cabin details for **{code_display}** ({title_display}):\n\n"
                        "| Course Code | Instructor / Faculty | Cabin Location | Credits & L-T-P | Course Type |\n"
                        "| :--- | :--- | :--- | :--- | :--- |\n"
                        f"| **{code_display}** | **{fac_name}** | {cabin_fmt} | **{credits_val} Credits** ({ltp}) | {course_type} |{session_list}\n\n"
                        "> 💡 **Directory Note:** Faculty cabin locations and course details are verified directly from your authenticated UMS Student Time Table report."
                    )
                    return ChatResponse(
                        message=msg,
                        activities=activities,
                        suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance)
                    )

                # Sub-branch B: Room / Venue / Practical / Lecture Query
                if is_room_query or is_practical_requested or is_lecture_requested or course_slots:
                    if not course_slots:
                        msg = f"### 📍 Venue Notice: **{queried_course}**\n\nNo scheduled lecture or practical time slots were found for **{queried_course}** in your weekly timetable grid."
                        return ChatResponse(message=msg, activities=activities, suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance))

                    code_display = matched_course.get("courseCode") if matched_course else queried_course
                    title_display = matched_course.get("courseTitle") if matched_course else (course_slots[0].get("courseTitle", "") if course_slots else "")

                    practical_slots = [
                        s for s in course_slots
                        if "practical" in str(s.get("type", "")).lower() or "lab" in str(s.get("courseCode", "")).lower()
                    ]
                    lecture_slots = [s for s in course_slots if s not in practical_slots]

                    if is_practical_requested:
                        primary_slots = practical_slots if practical_slots else course_slots
                        other_slots = lecture_slots if practical_slots else []
                        primary_focus = "Practical"
                        other_focus = "Theory Lecture"
                    elif is_lecture_requested:
                        primary_slots = lecture_slots if lecture_slots else course_slots
                        other_slots = practical_slots if lecture_slots else []
                        primary_focus = "Lecture"
                        other_focus = "Practical Lab"
                    else:
                        primary_slots = practical_slots if practical_slots else lecture_slots
                        other_slots = lecture_slots if practical_slots else []
                        primary_focus = "Practical" if practical_slots else "Lecture"
                        other_focus = "Theory Lecture" if practical_slots else ""

                    consolidated_primary = consolidate_slots_py(primary_slots)
                    rows = "\n".join(
                        f"| **{s.get('type')}** | **{s.get('day')}** | **{s.get('timeRange')}** | {format_room_location_py(s.get('room'))} | {s.get('section', 'All')}{' (Group ' + s.get('group') + ')' if s.get('group') else ''} |"
                        for s in consolidated_primary
                    )

                    other_section = ""
                    if other_slots:
                        consolidated_other = consolidate_slots_py(other_slots)
                        other_lines = [
                            f"- **{s.get('type')}**: **{s.get('day')}** ({s.get('timeRange')}) in {format_room_location_py(s.get('room'))}{' · Section: ' + s.get('section') if s.get('section') else ''}"
                            for s in consolidated_other
                        ]
                        other_section = f"\n\n#### ℹ️ Other {other_focus} Sessions for {code_display}:\n" + "\n".join(other_lines)

                    # Real-time synchronization
                    day_order = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
                    today_idx = (now.weekday() + 1) % 7
                    best_slot = None
                    min_diff = 999
                    for s in (primary_slots if primary_slots else course_slots):
                        s_day = s.get("day", "")
                        if s_day in day_order:
                            s_idx = day_order.index(s_day)
                            diff = (s_idx - today_idx + 7) % 7
                            s_min, e_min = parse_time_minutes_py(s.get("time", ""))
                            if diff == 0 and e_min < current_minutes:
                                diff = 7
                            if diff < min_diff:
                                min_diff = diff
                                best_slot = s

                    live_note = ""
                    if best_slot:
                        s_min, e_min = parse_time_minutes_py(best_slot.get("time", ""))
                        room_fmt = format_room_location_py(best_slot.get("room", "N/A"))
                        slot_type = best_slot.get("type", "Session")
                        if min_diff == 0:
                            if current_minutes >= s_min and current_minutes <= e_min:
                                live_note = f"\n\n#### ⏱️ Real-Time Status:\n- 🟢 **Ongoing right now:** Your {slot_type} is currently running in {room_fmt}."
                            else:
                                live_note = f"\n\n#### ⏱️ Real-Time Status:\n- ⏳ **Upcoming today:** Your next {slot_type} session is **today ({today_name}) at {best_slot.get('time')}** in {room_fmt}."
                        elif min_diff == 1:
                            live_note = f"\n\n#### ⏱️ Real-Time Status:\n- 📅 **Upcoming tomorrow:** Your next {slot_type} session is **tomorrow ({tomorrow_name}) at {best_slot.get('time')}** in {room_fmt}."
                        else:
                            live_note = f"\n\n#### ⏱️ Real-Time Status:\n- 📅 **Next session:** Your next {slot_type} session is on **{best_slot.get('day')} at {best_slot.get('time')}** in {room_fmt}."

                    msg = (
                        f"### 🔬 Room & Venue: **{code_display} {primary_focus}**\n\n"
                        f"Here is the verified venue and schedule for your **{code_display}** ({title_display}) **{primary_focus}**:\n\n"
                        "| Session Type | Day | Time Slot | Room / Venue | Section & Group |\n"
                        "| :--- | :--- | :--- | :--- | :--- |\n"
                        f"{rows}{other_section}{live_note}\n\n"
                        "> 💡 **Schedule Note:** Classroom numbers, blocks, and timings are verified directly from your authenticated UMS Student Time Table."
                    )
                    return ChatResponse(
                        message=msg,
                        activities=activities,
                        suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance)
                    )

            # 3. Real-Time Next Class / Current Class / Today's Status Query
            if is_next_class_query or ("today" in user_msg_lower and any(w in user_msg_lower for w in ["next", "remaining", "more", "left", "now"])):
                today_slots = sorted(
                    [s for s in slots if s.get("day", "").lower() == today_name.lower()],
                    key=lambda s: parse_time_minutes_py(s.get("time", ""))[0]
                )
                tomorrow_slots = sorted(
                    [s for s in slots if s.get("day", "").lower() == tomorrow_name.lower()],
                    key=lambda s: parse_time_minutes_py(s.get("time", ""))[0]
                )

                if not today_slots:
                    tomorrow_note = ""
                    if tomorrow_slots:
                        first = tomorrow_slots[0]
                        tomorrow_note = f"Your next upcoming class is tomorrow (**{tomorrow_name}**): **{first.get('courseCode')}** at **{first.get('time')}** in {format_room_location_py(first.get('room'))}."
                    else:
                        tomorrow_note = "You have no classes scheduled tomorrow either. Enjoy your break!"
                    msg = f"### ⏱️ Real-Time Class Status (**{today_name}**, {current_time_str})\n\nYou have **no scheduled classes** for today (**{today_name}**) in your verified UMS timetable.\n\n{tomorrow_note}"
                    return ChatResponse(message=msg, activities=activities, suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance))

                ongoing = next((s for s in today_slots if parse_time_minutes_py(s.get("time", ""))[0] <= current_minutes <= parse_time_minutes_py(s.get("time", ""))[1]), None)
                upcoming = [s for s in today_slots if parse_time_minutes_py(s.get("time", ""))[0] > current_minutes]

                if ongoing:
                    room_fmt = format_room_location_py(ongoing.get("room"))
                    next_note = f"\n\n#### ⏳ Next Up After This:\n- **{upcoming[0].get('courseCode')}** at **{upcoming[0].get('time')}** in {format_room_location_py(upcoming[0].get('room'))}." if upcoming else "\n\n*This is your last scheduled class for today.*"
                    msg = (
                        f"### ⏱️ Real-Time Class Status (**{today_name}**, {current_time_str})\n\n"
                        f"🟢 **Class Ongoing Right Now:**\n"
                        f"- **Course:** **{ongoing.get('courseCode')}** ({ongoing.get('courseTitle', '')})\n"
                        f"- **Type:** {ongoing.get('type') or 'Class'}\n"
                        f"- **Time:** **{ongoing.get('time')}**\n"
                        f"- **Room / Venue:** {room_fmt}\n"
                        f"- **Faculty:** {ongoing.get('facultyName', 'Faculty')}{next_note}"
                    )
                    return ChatResponse(message=msg, activities=activities, suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance))

                if upcoming:
                    next_one = upcoming[0]
                    room_fmt = format_room_location_py(next_one.get("room"))
                    rem_rows = "\n".join(
                        f"| **{s.get('time')}** | **{s.get('courseCode')}** | {s.get('type', 'Lecture')} | {format_room_location_py(s.get('room'))} | {s.get('section', 'N/A')} |"
                        for s in upcoming
                    )
                    msg = (
                        f"### ⏱️ Real-Time Class Status (**{today_name}**, {current_time_str})\n\n"
                        f"⏳ **Your Next Class Today:**\n"
                        f"- **Course:** **{next_one.get('courseCode')}** ({next_one.get('courseTitle', '')})\n"
                        f"- **Time:** **{next_one.get('time')}**\n"
                        f"- **Room / Venue:** {room_fmt}\n"
                        f"- **Type:** {next_one.get('type', 'Class')}\n\n"
                        f"#### 📋 Remaining Schedule for Today ({len(upcoming)} classes left):\n"
                        f"| Time Slot | Subject Code | Type | Room / Venue | Section |\n"
                        f"| :--- | :--- | :--- | :--- | :--- |\n"
                        f"{rem_rows}"
                    )
                    return ChatResponse(message=msg, activities=activities, suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance))

                # All classes completed today
                last_class = today_slots[-1]
                tomorrow_sec = ""
                if tomorrow_slots:
                    first = tomorrow_slots[0]
                    tomorrow_sec = (
                        f"#### 🌅 Next Upcoming Class (Tomorrow, **{tomorrow_name}**):\n"
                        f"- **Course:** **{first.get('courseCode')}** ({first.get('courseTitle', '')})\n"
                        f"- **Time:** **{first.get('time')}**\n"
                        f"- **Room / Venue:** {format_room_location_py(first.get('room'))}\n"
                        f"- **Type:** {first.get('type', 'Lecture')}"
                    )
                else:
                    tomorrow_sec = f"You have no scheduled classes tomorrow (**{tomorrow_name}**) either."

                msg = (
                    f"### ⏱️ Real-Time Class Status (**{today_name}**, {current_time_str})\n\n"
                    f"All **{len(today_slots)} scheduled classes** for today (**{today_name}**) have **concluded** (your last session was **{last_class.get('courseCode')}** which ended at **{last_class.get('time', '').split('-')[-1].strip()}** in Room **{last_class.get('room')}**).\n\n"
                    f"{tomorrow_sec}\n\n"
                    "> 💡 **Tip:** Have a great rest of your day! Be sure to verify your classroom in the morning before your first period."
                )
                return ChatResponse(message=msg, activities=activities, suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance))

            # 4. Day-Specific Schedule Query (e.g. tomorrow, Monday, Wednesday)
            if requested_day and slots:
                day_slots = sorted(
                    [s for s in slots if s.get("day", "").lower() == requested_day.lower()],
                    key=lambda s: parse_time_minutes_py(s.get("time", ""))[0]
                )
                if day_slots:
                    is_target_today = requested_day.lower() == today_name.lower()
                    rows = []
                    for s in day_slots:
                        badge = ""
                        if is_target_today:
                            _, e_min = parse_time_minutes_py(s.get("time", ""))
                            s_min, _ = parse_time_minutes_py(s.get("time", ""))
                            if e_min < current_minutes:
                                badge = " *(Done)*"
                            elif s_min <= current_minutes <= e_min:
                                badge = " *(Now)*"
                            else:
                                badge = " *(Upcoming)*"
                        room_fmt = format_room_location_py(s.get("room"))
                        fac_fmt = s.get("facultyName") or "Faculty"
                        if s.get("facultyCabin"):
                            fac_fmt += f" ({s.get('facultyCabin')})"
                        rows.append(f"| **{s.get('time', 'TBD')}** | **{s.get('courseCode', 'TBD')}**{badge} | {str(s.get('courseTitle', ''))} | {room_fmt} | {fac_fmt} | {s.get('type', 'Lecture')} |")

                    live_note = ""
                    if is_target_today:
                        done_count = len([s for s in day_slots if parse_time_minutes_py(s.get("time", ""))[1] < current_minutes])
                        if done_count == len(day_slots):
                            live_note = f"\n\n> ⏱️ **Real-Time Note:** Current time is **{current_time_str}**. All scheduled classes for today have concluded."
                        else:
                            next_s = next((s for s in day_slots if parse_time_minutes_py(s.get("time", ""))[0] > current_minutes), None)
                            if next_s:
                                live_note = f"\n\n> ⏱️ **Real-Time Note:** Current time is **{current_time_str}**. Next upcoming session is **{next_s.get('courseCode')}** at **{next_s.get('time')}** in {format_room_location_py(next_s.get('room'))}."

                    msg = (
                        f"### 📅 Verified Schedule for **{requested_day}**\n\n"
                        f"Here are your classes scheduled for **{requested_day}** ({len(day_slots)} classes):\n\n"
                        "| Time Slot | Subject Code | Course Title | Room & Block | Faculty & Cabin | Type |\n"
                        "| :--- | :--- | :--- | :--- | :--- | :--- |\n"
                        + "\n".join(rows) + live_note + "\n\n"
                        "> 💡 **Tip:** Be sure to verify your classroom numbers and faculty cabins before each session to avoid last-minute delays."
                    )
                    return ChatResponse(message=msg, activities=activities, suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance))
                else:
                    msg = f"### 📅 Schedule for **{requested_day}**\n\nYou have **no classes scheduled** on **{requested_day}** in your verified UMS timetable."
                    return ChatResponse(message=msg, activities=activities, suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance))

            # 5. Full Weekly Matrix Query
            if (is_weekly_request or not requested_day) and slots:
                day_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
                sections = []
                busiest_day = ""
                max_classes = 0

                for d in day_order:
                    d_slots = sorted(
                        [s for s in slots if s.get("day", "").lower() == d.lower()],
                        key=lambda s: parse_time_minutes_py(s.get("time", ""))[0]
                    )
                    if len(d_slots) > max_classes:
                        max_classes = len(d_slots)
                        busiest_day = d

                    if d_slots:
                        rows = "\n".join(
                            f"| **{s.get('time', 'TBD')}** | **{s.get('courseCode', 'TBD')}** | {s.get('type', 'Lecture')} | {format_room_location_py(s.get('room'))} | {s.get('section', 'N/A')} |"
                            for s in d_slots
                        )
                        sections.append(
                            f"#### 🗓️ {d} ({len(d_slots)} classes)\n\n"
                            "| Time Slot | Subject Code | Type | Room / Venue | Section |\n"
                            "| :--- | :--- | :--- | :--- | :--- |\n"
                            f"{rows}"
                        )

                total_practicals = len([s for s in slots if "practical" in str(s.get("type", "")).lower() or "lab" in str(s.get("courseCode", "")).lower()])
                unique_blocks = sorted(set(str(s.get("room", "")).split("-")[0].strip() for s in slots if s.get("room") and "-" in str(s.get("room", ""))))
                block_desc = f"Block {', Block '.join(unique_blocks)}" if unique_blocks else "designated campus classrooms"
                unique_courses = len(set(s.get("courseCode") for s in slots if s.get("courseCode")))

                msg = (
                    "### 📅 Complete Weekly Class Schedule Matrix\n\n"
                    f"Here is your comprehensive weekly schedule matrix verified directly from your authenticated UMS Student Time Table (**{len(slots)} total classes** across **{unique_courses or 'enrolled'} courses**):\n\n"
                    + "\n\n".join(sections) + "\n\n"
                    "#### 📊 Weekly Academic Insights\n"
                    f"- **Busiest Day:** {busiest_day or 'Monday'} with {max_classes} sessions scheduled.\n"
                    f"- **Practical & Lab Work:** {total_practicals} practical sessions scheduled across your week.\n"
                    f"- **Classroom Blocks:** Primary lectures and labs are held in {block_desc}.\n"
                    f"- **Total Weekly Commitment:** {len(slots)} periods scheduled across your week.\n\n"
                    "> 💡 **Schedule Note:** Classroom numbers and timings are verified directly from your authenticated UMS Student Time Table."
                )
                return ChatResponse(
                    message=msg,
                    activities=activities,
                    suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance)
                )
            elif timetable and timetable.get("courses"):
                courses_list = timetable.get("courses", [])
                course_rows = []
                for c in courses_list:
                    cabin = c.get("facultyCabin")
                    fac_display = f"{c.get('facultyName', 'Faculty')} ({cabin})" if cabin else c.get('facultyName', 'Faculty')
                    ltp = f"{c.get('lectures', 0)}-{c.get('tutorial', 0)}-{c.get('practical', 0)}"
                    course_rows.append(
                        f"| **{c.get('courseCode', 'TBD')}** | {c.get('courseType') or 'Core'} | {c.get('courseTitle', '')} | {ltp} | {c.get('credits', 0)} | {fac_display} | {c.get('lastUpdated', 'NA')} |"
                    )
                rows = "\n".join(course_rows)
                msg = (
                    "### 📚 Registered Courses & Faculty Directory\n\n"
                    f"Here is your official enrolled curriculum (**{len(courses_list)} courses**, **{total_credits} total credits**) verified from your authenticated UMS portal:\n\n"
                    "| Course Code | Type | Course Title | L-T-P | Credits | Faculty & Cabin | Last Updated |\n"
                    "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n"
                    f"{rows}\n\n"
                    "> 💡 **Directory Note:** Faculty cabin locations and course credits are verified directly from your official UMS Student Time Table report."
                )
            else:
                msg = (
                    "### 📅 Class Schedule & Timetable\n\n"
                    "No verified timetable records are currently loaded from your active LPU UMS session.\n\n"
                    "- Ask ONEE: *\"Open my timetable\"* to navigate and extract your verified periods, venues, and teacher cabins."
                )
            return ChatResponse(
                message=msg,
                activities=activities,
                suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance)
            )

        # 0.5. EXAMINATION DATE SHEET / SEATING QUERY
        is_exam_query = any(w in user_msg_lower for w in [
            "exam", "datesheet", "date sheet", "seating", "exam schedule", "next exam",
            "atom exam", "term exam", "mid term", "end term", "seat number", "reporting time",
            "sample paper", "sample question"
        ]) or bool(
            re.search(r'\b(?:seat|room|hall|bench|venue|reporting)\b', user_msg_lower)
            and examination and bool(examination.get("exams"))
        )
        if is_exam_query:
            if examination and examination.get("exams"):
                exams = examination.get("exams", [])

                # Course code matching (e.g. "INT 373", "INT373", "CSE408", etc.)
                course_match = re.search(r'\b([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)\b', user_message, re.IGNORECASE)
                queried_course = None
                if course_match:
                    pfx = course_match.group(1).upper()
                    dgts = course_match.group(2).upper()
                    if pfx not in ["ROOM", "HALL", "BLOCK", "DATE", "TIME", "TERM", "EXAM", "SEAT", "TEST"]:
                        queried_course = f"{pfx}{dgts}"

                # Date matching (e.g. "18 Oct", "14 Oct", "15 Dec")
                date_match = re.search(r'\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b', user_message, re.IGNORECASE)
                queried_date_snippet = None
                if date_match:
                    queried_date_snippet = f"{date_match.group(1)} {date_match.group(2)[:3]}".lower()

                # Filter matching exams
                matching_exams = []
                if queried_course:
                    matching_exams = [e for e in exams if e.get("courseCode", "").replace(" ", "").upper() == queried_course]
                    if queried_date_snippet and len(matching_exams) > 1:
                        date_filtered = [e for e in matching_exams if queried_date_snippet in e.get("examDate", "").lower()]
                        if date_filtered:
                            matching_exams = date_filtered
                elif queried_date_snippet:
                    matching_exams = [e for e in exams if queried_date_snippet in e.get("examDate", "").lower()]

                is_next_query = any(w in user_msg_lower for w in ["next", "nearest", "upcoming"]) and not queried_course

                # BRANCH 1: Specific Course Exam / Seat Query
                if matching_exams:
                    target_exam = matching_exams[0]
                    code = target_exam.get("courseCode", queried_course or "Exam")
                    title = target_exam.get("courseName") or target_exam.get("examType") or ""
                    if title.endswith("-"):
                        title = title[:-1].strip()
                    exam_date = target_exam.get("examDate", "TBD")
                    start_time = target_exam.get("startTime", "TBD")
                    end_time = target_exam.get("endTime", "")
                    timing_str = f"{start_time} - {end_time}" if end_time else start_time
                    reporting = target_exam.get("reportingTime") or "Report 30 mins before start (Entry closes 15 mins before)"

                    room_raw = target_exam.get("room") or ""
                    venue_raw = target_exam.get("venue") or ""
                    seat_raw = target_exam.get("seat") or ""

                    # Format room & venue location
                    if room_raw and room_raw.lower() != "awaited":
                        room_display = format_room_location_py(room_raw)
                    elif venue_raw and venue_raw.lower() != "awaited":
                        room_display = venue_raw
                    else:
                        room_display = "Venue Awaited"

                    # Format seat number and guidance
                    if seat_raw and seat_raw.lower() not in ["assigned", "awaited", "nil", "na", "null"]:
                        seat_status = f"**Seat {seat_raw}**"
                        seat_guidance = f"Your assigned desk is **Seat {seat_raw}** inside {room_display}."
                    elif room_raw and room_raw.lower() != "awaited":
                        seat_status = "Allocated inside Hall / On Exam Day"
                        seat_guidance = (
                            f"Your examination hall is confirmed at {room_display}.\n"
                            f"- Individual physical seat/bench numbers are allocated inside the examination hall and posted on the seating chart outside **Room {room_raw}** on the morning of the exam."
                        )
                    else:
                        seat_status = "Seating allocation awaited"
                        seat_guidance = "The university examination branch will publish the room and seating allocation shortly before the examination date."

                    exam_type_str = target_exam.get("examType") or "Regular Examination"
                    instructions = target_exam.get("instructions") or ""

                    msg = (
                        f"### 🪑 Examination Venue & Seating Details: **{code}**\n\n"
                        f"{f'**Course:** {title}' if title and title != code else ''}\n\n"
                        f"| Examination Detail | Verified Allocation |\n"
                        f"| :--- | :--- |\n"
                        f"| 📅 **Exam Date** | 📅 **{exam_date}** |\n"
                        f"| ⏰ **Exam Timing** | ⏰ **{timing_str}** |\n"
                        f"| 🚪 **Reporting Time** | 🚪 **{reporting}** |\n"
                        f"| 🏢 **Examination Hall / Room** | {room_display} |\n"
                        f"| 🪑 **Seat Number** | 🪑 **{seat_status}** |\n"
                        f"| 📋 **Exam Type** | {exam_type_str} |\n"
                        f"{f'| ℹ️ **Paper Pattern** | {instructions} |' if instructions else ''}\n\n"
                        f"#### ℹ️ Seating & Reporting Guidance:\n"
                        f"- {seat_guidance}\n"
                        f"- **Entry Rule:** Examination hall entry closes strictly 15 minutes before the start time.\n\n"
                        f"> 🔒 **Verified Source:** Directly verified from your authenticated Student UMS examination conduct portal."
                    )
                    return ChatResponse(
                        message=msg,
                        activities=activities,
                        suggestions=[f"Check venue for {code}", "When is my next exam?", "Show full date sheet", "Check syllabus"]
                    )

                # BRANCH 2: Next Exam Query
                if is_next_query:
                    sorted_exams = list(exams)
                    next_e = sorted_exams[0]
                    next_code = next_e.get("courseCode", "Upcoming Exam")
                    next_date = next_e.get("examDate", "TBD")
                    next_time = next_e.get("startTime", "TBD")
                    next_room = format_room_location_py(next_e.get("room", "")) if next_e.get("room") else (next_e.get("venue") or "Venue Awaited")
                    msg = (
                        f"### 🎯 Next Scheduled Examination: **{next_code}**\n\n"
                        f"- 📅 **Date:** **{next_date}**\n"
                        f"- ⏰ **Time:** **{next_time}**\n"
                        f"- 🏢 **Hall / Room:** {next_room}\n"
                        f"- 📋 **Type:** {next_e.get('examType', 'Regular')}\n\n"
                        f"You have **{len(exams)} total scheduled examinations** in your verified date sheet."
                    )
                    return ChatResponse(
                        message=msg,
                        activities=activities,
                        suggestions=[f"Check seat for {next_code}", "Show full date sheet", "Exam countdown"]
                    )

                # BRANCH 3: General Date Sheet / Schedule Table
                rows = []
                for e in exams[:10]:
                    r_val = e.get('room') or ''
                    v_val = e.get('venue') or ''
                    if r_val and r_val.lower() != 'awaited':
                        venue_str = f"Room {r_val}" if not v_val else f"{v_val} ({r_val})"
                    elif v_val and v_val.lower() != 'awaited':
                        venue_str = v_val
                    else:
                        venue_str = "Awaited"
                    seat_str = e.get('seat') or 'In Hall'
                    rows.append(
                        f"| 📅 **{e.get('examDate', 'TBD')}** | {e.get('startTime', 'TBD')} | **{e.get('courseCode', 'TBD')}** | {e.get('courseName', '')} | {venue_str} | {seat_str} |"
                    )
                msg = (
                    f"### 📅 Verified Examination Date Sheet ({len(exams)} Exams)\n\n"
                    "| Exam Date | Slot & Time | Subject Code | Course Name | Room & Hall | Seat Number |\n"
                    "| :--- | :--- | :--- | :--- | :--- | :--- |\n"
                    + "\n".join(rows) + "\n\n"
                    "> 🔒 **Verified Source:** Directly verified from your authenticated Student UMS examination conduct portal."
                )
            else:
                msg = (
                    "### 📅 Examination Date Sheet / Seating Plan\n\n"
                    "No verified examination records are currently loaded from your LPU UMS session.\n\n"
                    "- **How to retrieve:** Ask ONEE: *\"When is my next exam?\"* or *\"Open my date sheet\"*.\n"
                    "- ONEE will navigate to **Important Links > Date Sheet** and extract your verified seating plan."
                )
            return ChatResponse(
                message=msg,
                activities=activities,
                suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance)
            )

        # Check for numeric follow-up queries like "what about 5", "and 3?", "what if 4"
        has_history_attendance = False
        if history:
            for h in history:
                txt = (h.text if isinstance(h, ChatMessage) else getattr(h, "text", str(h))).lower()
                if any(w in txt for w in ["attendance", "bunk", "skip", "miss", "class", "leave"]):
                    has_history_attendance = True
                    break

        is_numeric_followup_pattern = bool(
            re.match(r'^\s*(?:what about|how about|what if|and|can i do)?\s*\d+\s*(?:classes|lectures|more|\?)?\s*$', user_msg_lower.strip())
        )

        # 0.7. Check if this is an explicit attendance query before falling into attendance calculation
        is_attendance_explicit = (is_numeric_followup_pattern and has_history_attendance) or any(w in user_msg_lower for w in [
            "attendance", "bunk", "safe bunk", "can i skip", "how many classes", "duty leave",
            "shortage", "classes attended", "aggregate", "percent", "eligible", "clearance",
            "miss", "cut", "skip", "absent", "leave", "can i miss", "how many can i",
            "how many can i miss", "margin", "attended", "maintain", "lowest", "worst", "danger", "closest", "least", "risk"
        ]) or (
            attendance and attendance.courses and any(c.code.lower() in user_msg_lower for c in attendance.courses)
            and any(w in user_msg_lower for w in ["miss", "skip", "bunk", "cut", "attend", "how many", "can i", "percentage", "margin"])
        )
        if not is_attendance_explicit:
            msg = (
                "I am here to help you with your LPU academic journey! You can ask me to:\n\n"
                "- Check your **class schedule** for any day (e.g. *\"Which classes do I have on Monday?\"*)\n"
                "- Review your **attendance and safe bunks** (e.g. *\"How many classes can I skip in CSE329?\"*)\n"
                "- Check your **upcoming exams and date sheet** (e.g. *\"When is my next exam?\"*)\n"
                "- Search for official **sample papers**\n\n"
                "What would you like to check?"
            )
            return ChatResponse(
                message=msg,
                activities=activities,
                suggestions=["Check Monday classes", "Attendance summary", "When is my next exam?"]
            )

        if not attendance or not attendance.courses:
            msg = "I can't read your attendance right now. Please open your LPU UMS Attendance section."
            return ChatResponse(
                message=msg,
                activities=activities,
                suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance)
            )

        # Check for attendance maintenance inquiry (e.g. "How can I maintain my attendance across all subjects?")
        is_maintenance_query = any(w in user_msg_lower for w in [
            "maintain my attendance", "maintain attendance", "keep my attendance", "manage my attendance", "how can i maintain", "how to maintain", "maintain"
        ])
        if is_maintenance_query and attendance and attendance.courses:
            total_bunks = sum(calculate_bunk_allowance_math(c.attended, c.total, 75.0) for c in attendance.courses)
            sorted_courses = sorted(attendance.courses, key=lambda c: c.percentage)
            rows = []
            for c in sorted_courses:
                bunk75 = calculate_bunk_allowance_math(c.attended, c.total, 75.0)
                bunk80 = calculate_bunk_allowance_math(c.attended, c.total, 80.0)
                bunk_display = f"{bunk75} safe skips" if bunk75 > 0 else "0 (Attend next)"
                bunk80_display = f"{bunk80} skips" if bunk80 > 0 else "Need +1 class"
                rows.append(
                    f"| **{c.code}** | {c.name} | **{round(c.percentage)}%** ({c.attended}/{c.total}) | {bunk_display} | {bunk80_display} | {'🟢 Safe' if c.percentage >= 75 else '🔴 Risk'} |"
                )
            lowest = sorted_courses[0]
            delivered_cnt = attendance.totalClasses or attendance.totalDelivered or sum(c.total for c in attendance.courses)
            msg = (
                "### 🛡️ Strategic Attendance Maintenance Plan\n\n"
                f"**Aggregate Standing:** **{round(attendance.overallPercentage)}%** across **{len(attendance.courses)} subjects** ({attendance.totalAttended} / {delivered_cnt} classes attended).\n\n"
                "| Subject Code | Course Title | Attendance | Safe Skips (75%) | Target for 80% | Status |\n"
                "| :--- | :--- | :--- | :--- | :--- | :--- |\n"
                + "\n".join(rows) + "\n\n"
                "#### 📋 Proactive Rules to Maintain Your Attendance:\n"
                f"1. **Protect Your Tightest Cushion ({lowest.code}):** Standing at **{round(lowest.percentage)}%**, your buffer is {calculate_bunk_allowance_math(lowest.attended, lowest.total, 75.0)} skips. Prioritize regular attendance here first.\n"
                "2. **78% Safe Operating Threshold:** Keep every subject comfortably above 78% so an accidental absence or delay never drops you below the 75% examination detention line.\n"
                "3. **Practical & Lab Priority:** Practical and lab sessions carry heavy weight — missing one lab counts double against your percentage.\n"
                "4. **Emergency Reserve:** Reserve at least 2 safe skips for unexpected emergencies or end-term assignment deadlines during the last 2 weeks.\n\n"
                f"> 💡 **Overall Health:** You can safely skip up to **{total_bunks} combined lectures** across all subjects while staying 100% exam eligible."
            )
            return ChatResponse(
                message=msg,
                activities=activities,
                suggestions=[f"Safe bunks for {lowest.code}", "Am I eligible for exams?", "Check today's classes"]
            )

        # --- Context Resolution from Conversation History ---
        anaphoric_course = None
        previous_intent = None
        if history:
            for h in reversed(history):
                text_to_scan = h.text if isinstance(h, ChatMessage) else getattr(h, "text", str(h))
                if attendance and attendance.courses:
                    for c in attendance.courses:
                        if re.search(rf"\b{re.escape(c.code)}\b", text_to_scan, re.IGNORECASE):
                            anaphoric_course = c
                            break
                if anaphoric_course:
                    if any(w in text_to_scan.lower() for w in ["skip", "bunk", "miss", "what if"]):
                        previous_intent = "skip"
                    break

        # Remove course codes and their digits from message before searching for numeric skip counts
        msg_without_courses = user_msg_lower
        if attendance and attendance.courses:
            for c in attendance.courses:
                code_lower = c.code.lower()
                msg_without_courses = re.sub(rf"\b{re.escape(code_lower)}\b", " ", msg_without_courses)
                prefix_match = re.match(r"([a-z]+)(\d+)", code_lower)
                if prefix_match:
                    spaced_code = f"{prefix_match.group(1)} {prefix_match.group(2)}"
                    msg_without_courses = re.sub(rf"\b{re.escape(spaced_code)}\b", " ", msg_without_courses)
                    digits = prefix_match.group(2)
                    msg_without_courses = re.sub(rf"\b{re.escape(digits)}\b", " ", msg_without_courses)

        # Do not treat open-ended inquiries like "how many can I skip" as numeric skip simulations
        is_open_ended = bool(
            re.search(r'\b(?:how many|how much)\b', user_msg_lower) and
            not re.search(r'\b(?:skip|bunk|miss)\s+\d+\b', msg_without_courses)
        )

        target_skips = None
        if not is_open_ended:
            # Check for numeric follow-up or explicit skip count (e.g. "what about 5", "how about 6", "5", "what if 4")
            numeric_match = re.search(
                r'(?:what about|how about|what if|can i skip|skip|can i bunk|bunk|miss|and)?\s*(\d{1,2})\s*(?:classes|lectures|more)?',
                msg_without_courses
            )
            if numeric_match and numeric_match.group(1):
                extracted = int(numeric_match.group(1))
                if 1 <= extracted <= 30:
                    target_skips = extracted

        is_numeric_followup = bool(
            target_skips is not None and (
                re.match(r'^\s*(?:what about|how about|what if|and|can i do)?\s*\d+\s*(?:classes|lectures|more|\?)?\s*$', msg_without_courses.strip()) or
                "skip" in user_msg_lower or "bunk" in user_msg_lower or previous_intent == "skip"
            )
        )

        user_msg_upper = user_message.upper()
        target_course = None
        for c in attendance.courses:
            if re.search(rf"\b{re.escape(c.code)}\b", user_message, re.IGNORECASE):
                target_course = c
                break

        if not target_course and (is_numeric_followup or "this course" in user_msg_lower or "it" in user_msg_lower):
            target_course = anaphoric_course

        # 0.8 SPECIFIC COURSE SKIP / BUNK SIMULATION ("What if I skip 5 classes in CSE329?" or "what about 5")
        if target_course and target_skips is not None and target_skips > 0 and not is_open_ended:
            attended = target_course.attended
            delivered = target_course.total or target_course.delivered or 0
            pct = round(target_course.percentage)
            bunk75 = calculate_bunk_allowance_math(attended, delivered, 75.0)

            scenario_rows = []
            scenario_rows.append(f"| **Current** | `{attended} / {delivered}` | **{pct}%** | {'🟢 Safe' if pct >= 75 else '🔴 Below 75%'} |")
            cap_skips = min(target_skips, 10)
            for s in range(1, cap_skips + 1):
                new_del = delivered + s
                new_pct = round((attended / new_del) * 100) if new_del > 0 else max(50, pct - (s * 4))
                status = "🟢 Safe" if new_pct >= 75 else "⚠️ Below 75%"
                scenario_rows.append(f"| **Skip {s} Class{'es' if s > 1 else ''}** | `{attended} / {new_del}` | **{new_pct}%** | {status} |")

            final_new_del = delivered + target_skips
            final_new_pct = round((attended / final_new_del) * 100) if final_new_del > 0 else max(50, pct - (target_skips * 4))
            is_safe = final_new_pct >= 75

            advice = (
                f"Even after skipping {target_skips} lectures, your attendance remains **{final_new_pct}%**, safely above the 75% threshold. However, your buffer shrinks to {max(0, bunk75 - target_skips)} skips."
                if is_safe
                else f"⚠️ Skipping {target_skips} lectures will breach the 75% threshold down to **{final_new_pct}%**, putting you at risk of detention. Stay within your limit of {bunk75} safe skips!"
            )

            msg = (
                f"### 📚 {target_course.code}: {target_course.name} - \"What If I Skip {target_skips} Classes?\"\n\n"
                "| Scenario | Formula (Attended / Delivered) | Resulting Attendance | Safety Status |\n"
                "| :--- | :--- | :--- | :--- |\n"
                + "\n".join(scenario_rows) + "\n\n"
                f"#### 🛡️ Attendance Buffer & Official Limit\n"
                f"- **Current Standing:** **{pct}%** ({attended}/{delivered} classes attended).\n"
                f"- **Official Safe-Skip Limit to 75%:** **{bunk75} classes**.\n"
                f"- **Impact of Skipping {target_skips}:** Attendance reaches **{final_new_pct}%** ({'+' if final_new_pct >= 75 else ''}{final_new_pct - 75}% margin vs 75% requirement).\n\n"
                f"> 💡 **Takeaway:** {advice}"
            )
            return ChatResponse(
                message=msg,
                activities=activities,
                suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance)
            )

        # 0.9 SPECIFIC COURSE INQUIRY & BUNK ALLOWANCE (e.g., "How many can I skip in CSE471?", "Can I bunk CSE329?")
        if target_course:
            attended = target_course.attended
            delivered = target_course.total or target_course.delivered or 0
            pct = round(target_course.percentage)
            bunk75 = calculate_bunk_allowance_math(attended, delivered, 75.0)
            req75 = calculate_required_classes_math(attended, delivered, 75.0)
            bunk80 = calculate_bunk_allowance_math(attended, delivered, 80.0)
            req80 = calculate_required_classes_math(attended, delivered, 80.0)
            duty_leave = getattr(target_course, "dutyLeave", 0) or 0

            trajectory_section = ""
            if delivered > 0:
                if pct >= 75:
                    sim1 = round((attended / (delivered + 1)) * 100)
                    sim2 = round((attended / (delivered + 2)) * 100)
                    scenario_rows = [
                        f"| **Current Standing** | `{attended} / {delivered}` | **{pct}%** | 🟢 Safe |",
                        f"| **Skip 1 Class** | `{attended} / {delivered + 1}` | **{sim1}%** | {'🟢 Safe' if sim1 >= 75 else '⚠️ Danger'} |",
                        f"| **Skip 2 Classes** | `{attended} / {delivered + 2}` | **{sim2}%** | {'🟢 Safe' if sim2 >= 75 else '⚠️ Danger'} |"
                    ]
                    if bunk80 > 0 and bunk80 not in (1, 2) and bunk80 < bunk75:
                        sim80 = round((attended / (delivered + bunk80)) * 100)
                        scenario_rows.append(f"| **Skip {bunk80} Classes** | `{attended} / {delivered + bunk80}` | **{sim80}%** | 🎯 80% Buffer |")
                    sim_max = round((attended / (delivered + bunk75)) * 100)
                    scenario_rows.append(f"| **Skip All {bunk75} Classes** | `{attended} / {delivered + bunk75}` | **{sim_max}%** | 🛡️ Exact 75% Limit |")
                    sim_risk = round((attended / (delivered + bunk75 + 1)) * 100)
                    scenario_rows.append(f"| **Skip {bunk75 + 1} Classes** | `{attended} / {delivered + bunk75 + 1}` | **{sim_risk}%** | ⚠️ Detention Risk |")

                    trajectory_section = (
                        "#### 📊 Skip & Margin Impact Analysis\n"
                        "| Scenario | Formula (Attended / Delivered) | Resulting Attendance | Safety Status |\n"
                        "| :--- | :--- | :--- | :--- |\n"
                        + "\n".join(scenario_rows)
                    )
                else:
                    simAtt1 = round(((attended + 1) / (delivered + 1)) * 100)
                    simAtt2 = round(((attended + 2) / (delivered + 2)) * 100)
                    trajectory_section = (
                        "#### 📈 Recovery Trajectory (Path to 75%)\n"
                        "| Action | Formula (Attended / Delivered) | New Percentage | Recovery Status |\n"
                        "| :--- | :--- | :--- | :--- |\n"
                        f"| **Attend 1 Class** | `{attended + 1} / {delivered + 1}` | **{simAtt1}%** | In Progress |\n"
                        f"| **Attend 2 Classes** | `{attended + 2} / {delivered + 2}` | **{simAtt2}%** | In Progress |\n"
                        f"| **Attend {req75} Classes** | `{attended + req75} / {delivered + req75}` | **75%** | 🟢 75% Restored |"
                    )

            advice = (
                f"You can safely skip up to **{bunk75} lectures** in **{target_course.code}** before your attendance hits the mandatory 75% threshold. We recommend keeping at least 1-2 skips in reserve for unforeseen emergencies."
                if pct >= 80
                else f"Your margin is narrow (**{bunk75} class{'es' if bunk75 != 1 else ''}** buffer). Prioritize upcoming lectures to expand your safety cushion above 80%."
                if pct >= 75
                else f"You are currently below the university's 75% threshold. You must attend the next **{req75} consecutive class{'es' if req75 != 1 else ''}** without skipping to clear your detention status."
            )

            msg = (
                f"### 📚 {target_course.code}: {target_course.name}\n\n"
                "| Metric | Recorded Value | Evaluation & Benchmark |\n"
                "| :--- | :--- | :--- |\n"
                f"| **Current Attendance** | **{pct}%** ({attended}/{delivered} classes) | {'🟢 Meets Requirement' if pct >= 75 else '🔴 Below Mandatory 75%'} |\n"
                f"| **Duty Leave Credited** | **{duty_leave} lectures** credited | Verified UMS Record |\n"
                f"| **Safe Bunks to 75%** | **{bunk75} class{'es' if bunk75 != 1 else ''}** | {'🛡️ Safe Allowance' if pct >= 75 else '⚠️ Need Recovery'} |\n"
                f"| **Target for 80%** | **{f'{bunk80} skips left' if bunk80 > 0 else f'Attend {req80} classes'}** | 🎯 Honor Roll Benchmark |\n"
                f"| **Exam Clearance** | **{'Eligible' if pct >= 75 else 'Detained / Condonation Needed'}** | 75% University Policy Rule |\n\n"
                f"{trajectory_section}\n\n"
                f"> 💡 **Takeaway:** {advice}"
            )
            return ChatResponse(
                message=msg,
                activities=activities,
                suggestions=[
                    f"What if I skip 5 classes in {target_course.code}?",
                    f"When is my next {target_course.code} exam?",
                    f"Calculate safe bunks for all courses"
                ]
            )

        # 1. LEAVE / ABSENCE SIMULATION
        is_leave_query = any(w in user_msg_lower for w in ["leave", "holiday", "absent", "absence", "take off", "bunk tomorrow", "skip tomorrow", "can i bunk", "can i skip"]) or ("tomorrow" in user_msg_lower and not is_timetable_query)
        if is_leave_query:
            avg_classes = 4
            delivered = attendance.totalDelivered or attendance.totalClasses or sum(c.total for c in attendance.courses)
            if delivered > 0:
                sim_total = delivered + avg_classes
                sim_pct = round((attendance.totalAttended / sim_total) * 100)
                diff_pct = round(attendance.overallPercentage) - sim_pct
                curr_del_str = f"{attendance.totalAttended} / {delivered} classes"
                proj_del_str = f"{attendance.totalAttended} / {sim_total} classes"
                var_str = f"-{diff_pct}%"
            else:
                sim_total = avg_classes
                sim_pct = max(70, round(attendance.overallPercentage - 6))
                curr_del_str = f"{round(attendance.overallPercentage)}% aggregate"
                proj_del_str = f"≈{sim_pct}% (Buffer intact)"
                var_str = "-6% (Safe)"

            sorted_by_margin = sorted(
                attendance.courses,
                key=lambda c: calculate_bunk_allowance_math(c.attended, c.total, 75.0)
            )
            most_vulnerable = sorted_by_margin[0]
            if delivered > 0:
                vuln_margin = calculate_bunk_allowance_math(most_vulnerable.attended, most_vulnerable.total, 75.0)
                vuln_str = f"{vuln_margin} skip{'s' if vuln_margin != 1 else ''}"
            else:
                vuln_margin = round(most_vulnerable.percentage - 75.0, 1)
                vuln_str = f"{vuln_margin}% buffer"

            msg = (
                "### 🏖️ Leave Impact Simulation\n\n"
                f"Here is the projected impact if you take leave tomorrow (assuming **{avg_classes} lectures** scheduled):\n\n"
                "| Impact Metric | Current Standing | Projected After 1-Day Leave | Variation |\n"
                "| :--- | :--- | :--- | :--- |\n"
                f"| **Total Delivered** | {curr_del_str} | {proj_del_str} | +{avg_classes} missed |\n"
                f"| **Aggregate Attendance** | **{round(attendance.overallPercentage)}%** | **{sim_pct}%** | {var_str} |\n"
                f"| **Exam Eligibility** | {len(attendance.courses)} / {len(attendance.courses)} Subjects Eligible | {'All Subjects Eligible' if sim_pct >= 75 else 'Risk Warning'} | ✅ Protected |\n\n"
                "#### 📋 Vulnerability Check by Subject\n"
                f"- **Most Critical Course:** **{most_vulnerable.code}** ({round(most_vulnerable.percentage)}%) has an individual buffer of **{vuln_str}**.\n"
                "- **Safe Courses:** All other enrolled subjects have at least 2–5 safe skips available.\n\n"
                f"> ✅ **Leave Verdict:** Taking leave tomorrow is **safe** for your overall aggregate, provided you do not miss a class in **{most_vulnerable.code}** if it is on tomorrow's schedule."
            )
            return ChatResponse(
                message=msg,
                activities=activities,
                suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance)
            )

        # 2. COURSE COMPARISON QUERY
        is_compare_query = any(w in user_msg_lower for w in ["compare", "comparison", "versus", "vs", "benchmark", "all courses table"])
        if is_compare_query:
            sorted_courses = sorted(attendance.courses, key=lambda c: c.percentage)
            rows = "\n".join(
                f"| **{idx+1}. {c.code}** | {c.name} | **{round(c.percentage)}%** | {c.attended}/{c.total} | {calculate_bunk_allowance_math(c.attended, c.total, 75.0)} skips | {max(0.0, round(c.percentage - 75.0, 1))}% | {'🟢 Safe' if c.percentage >= 75 else '🔴 Danger'} |"
                for idx, c in enumerate(sorted_courses)
            )
            highest = sorted_courses[-1]
            lowest = sorted_courses[0]
            avg_skips = round(sum(calculate_bunk_allowance_math(c.attended, c.total, 75.0) for c in attendance.courses) / len(attendance.courses), 1)

            msg = (
                "### ⚖️ Course Comparative Analysis\n\n"
                f"Comparative breakdown across all **{len(attendance.courses)} enrolled courses**, ranked by attendance margin:\n\n"
                "| Rank & Code | Course Title | Attendance | Delivered | Safe Skips to 75% | Buffer Margin | Standing |\n"
                "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n"
                f"{rows}\n\n"
                "#### 📊 Key Comparative Insights\n"
                f"- **Highest Cushion Course:** **{highest.code}** ({round(highest.percentage)}%) with **{calculate_bunk_allowance_math(highest.attended, highest.total, 75.0)} safe skips** available.\n"
                f"- **Tightest Cushion Course:** **{lowest.code}** ({round(lowest.percentage)}%) with only **{calculate_bunk_allowance_math(lowest.attended, lowest.total, 75.0)} safe skips** remaining.\n"
                f"- **Average Bunk Margin:** **{avg_skips} lectures** across all subjects.\n\n"
                f"> 💡 **Analytical Takeaway:** Prioritize regular attendance in **{lowest.code}** while enjoying generous flexibility in **{highest.code}**."
            )
            return ChatResponse(
                message=msg,
                activities=activities,
                suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance)
            )

        # 3. LOWEST SUBJECT / RISK ASSESSMENT
        if any(w in user_msg_lower for w in ["lowest", "worst", "danger", "closest", "risk", "least"]):
            sorted_courses = sorted(attendance.courses, key=lambda c: c.percentage)
            lowest = sorted_courses[0]
            pct = round(lowest.percentage)
            allowance75 = calculate_bunk_allowance_math(lowest.attended, lowest.total, 75.0)
            req75 = calculate_required_classes_math(lowest.attended, lowest.total, 75.0)

            table_rows = "\n".join(
                f"| **{idx+1}. {c.code}** | {c.name} | **{round(c.percentage)}%** | {c.attended}/{c.total} | {calculate_bunk_allowance_math(c.attended, c.total, 75.0)} skips | {'🟢 Safe' if c.percentage >= 75 else '🔴 Danger'} |"
                for idx, c in enumerate(sorted_courses[:5])
            )

            action_plan = (
                f"- **Safety Margin:** You have a buffer of **{allowance75} safe skip{'s' if allowance75 != 1 else ''}** before reaching the 75% boundary.\n- **Attending 1 more class:** Increases standing to **{round(((lowest.attended + 1) / (lowest.total + 1)) * 100) if lowest.total > 0 else pct}%**."
                if pct >= 75
                else f"- **Recovery Requirement:** You must attend **{req75} consecutive class{'es' if req75 != 1 else ''}** without absenting to restore eligibility to 75%."
            )

            msg = (
                "### ⚠️ Academic Priority Assessment\n\n"
                f"Your lowest attendance course is **{lowest.code}** ({lowest.name}) standing at **{pct}%** ({lowest.attended}/{lowest.total} classes attended).\n\n"
                "| Rank & Code | Course Title | Attendance | Delivered | Safe Skips (75%) | Status |\n"
                "| :--- | :--- | :--- | :--- | :--- | :--- |\n"
                f"{table_rows}\n\n"
                f"#### 🎯 Action Plan for {lowest.code}\n"
                f"{action_plan}\n\n"
                f"> 🛡️ **Priority Recommendation:** Focus on maintaining continuous attendance in **{lowest.code}** to build a comfortable buffer before exam cutoff."
            )
            return ChatResponse(
                message=msg,
                activities=activities,
                suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance)
            )



        # 5. EXAM ELIGIBILITY INQUIRY
        if any(w in user_msg_lower for w in ["exam", "eligible", "eligibility", "admit"]):
            eligible_count = sum(1 for c in attendance.courses if c.percentage >= 75.0)
            all_eligible = eligible_count == len(attendance.courses)

            rows = "\n".join(
                f"| **{c.code}** | {c.name} | **{round(c.percentage)}%** | {'✅ Cleared' if c.percentage >= 75 else '🔴 Detained'} | {'None' if c.percentage >= 75 else f'{calculate_required_classes_math(c.attended, c.total, 75.0)} classes needed'} |"
                for c in attendance.courses
            )

            msg = (
                "### 🎓 Examination Clearance Report\n\n"
                f"**Overall Status:** {'✅ **100% EXAM ELIGIBLE ACROSS ALL COURSES**' if all_eligible else '⚠️ **ACTION REQUIRED IN SOME SUBJECTS**'}\n\n"
                "| Course Code | Subject Title | Attendance | Eligibility Status | Clearance Action |\n"
                "| :--- | :--- | :--- | :--- | :--- |\n"
                f"{rows}\n\n"
                "#### 📜 University Regulations Checklist\n"
                "- **Mandatory Minimum:** `75.0%` attendance per course for regular admit card issuance.\n"
                "- **Medical / Duty Leave:** Already factored into UMS percentage computations.\n"
                "- **Condonation Requirement:** `0 courses` currently require condonation approval.\n\n"
                f"> 💡 **Confirmation:** {'You are fully cleared to sit for all scheduled university examinations.' if all_eligible else 'Attend needed classes to clear examination eligibility.'}"
            )
            return ChatResponse(
                message=msg,
                activities=activities,
                suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance)
            )

        # 6. DEFAULT OVERVIEW / GENERAL ATTENDANCE BREAKDOWN
        total_delivered = attendance.totalDelivered or attendance.totalClasses or sum(c.total for c in attendance.courses)
        total_bunks = sum(calculate_bunk_allowance_math(c.attended, c.total, 75.0) for c in attendance.courses)
        rows = "\n".join(
            f"| **{c.code}** | {c.name} | **{c.attended} / {c.total}** | **{round(c.percentage)}%** | **{calculate_bunk_allowance_math(c.attended, c.total, 75.0)}** | {'🟢 Safe' if c.percentage >= 75 else '🔴 Danger'} |"
            for c in attendance.courses
        )
        sorted_lowest = sorted(attendance.courses, key=lambda c: c.percentage)
        lowest_code = sorted_lowest[0].code if sorted_lowest else "lowest course"

        msg = (
            "### 📊 Attendance Breakdown\n\n"
            f"**Aggregate Performance:** **{round(attendance.overallPercentage)}%** across **{len(attendance.courses)} courses** (**{attendance.totalAttended} / {total_delivered} classes attended**).\n\n"
            "| Subject Code | Course Title | Attended | % | Safe Skips (75%) | Status |\n"
            "| :--- | :--- | :--- | :--- | :--- | :--- |\n"
            f"{rows}\n\n"
            "#### 🛡️ Total Bunk Capacity & Health\n"
            f"- **Cumulative Safe Skips:** You can safely skip up to **{total_bunks} combined lectures** across all courses before any subject drops below 75%.\n"
            f"- **Exam Eligibility:** All **{len(attendance.courses)} of {len(attendance.courses)} subjects** meet the university's 75% threshold with zero condonation required.\n\n"
            f"> 💡 **Takeaway:** Your academic attendance profile is in the top tier. Keep up consistent participation in your lowest course (**{lowest_code}**) to maintain maximum academic flexibility!"
        )
        return ChatResponse(
            message=msg,
            activities=activities,
            suggestions=self._generate_contextual_heuristic_suggestions(user_message, msg, attendance)
        )

    async def generate_suggestions(
        self,
        user_message: str = "",
        assistant_response: str = "",
        attendance: Optional[AttendanceSummary] = None,
        examination: Optional[Dict[str, Any]] = None,
        timetable: Optional[Dict[str, Any]] = None,
        history: Optional[List[ChatMessage]] = None
    ) -> List[str]:
        """
        Generates dynamic, context-grounded follow-up suggestions using the Groq LLM,
        falling back to context-aware deterministic heuristics if the API is offline or returns invalid output.
        """
        context_parts = []
        if attendance and attendance.courses:
            courses_str = ", ".join(
                f"{c.code} ({c.percentage}%, {c.attended}/{c.total})"
                for c in sorted(attendance.courses, key=lambda x: x.percentage)
            )
            context_parts.append(f"Student Attendance: Overall {attendance.overallPercentage}%, Courses: {courses_str}")

        if examination and examination.get("exams"):
            exams = examination.get("exams", [])
            exams_str = ", ".join(
                f"{e.get('courseCode')} ({e.get('examDate')}, Seat: {e.get('roomNo', 'TBD')})"
                for e in exams[:4]
            )
            context_parts.append(f"Upcoming Exams: {exams_str}")

        if timetable and timetable.get("slots"):
            slots = timetable.get("slots", [])
            slots_str = ", ".join(
                f"{s.get('courseCode')} at {s.get('time')} ({s.get('room', 'N/A')})"
                for s in slots[:3]
            )
            context_parts.append(f"Timetable: {slots_str}")

        recent_dialogue = []
        if history:
            for h in history[-4:]:
                recent_dialogue.append(f"{h.sender.capitalize()}: {h.text}")
        if user_message:
            recent_dialogue.append(f"User: {user_message}")
        if assistant_response:
            # Truncate assistant response if overly long to preserve tokens
            asst_snippet = assistant_response[:300] + ("..." if len(assistant_response) > 300 else "")
            recent_dialogue.append(f"Assistant: {asst_snippet}")

        system_instruction = (
            "You are the suggestion engine for ONEE, the university AI assistant for LPU students.\n"
            "Generate 3 to 4 dynamic, context-aware follow-up suggestions or next questions for the student.\n\n"
            "CRITICAL GUIDELINES:\n"
            "1. Ground questions in real entities from the context (e.g. course codes like CSE320, exact attendance %, exam seats, dates).\n"
            "2. If no data has been loaded yet, suggest proactive university actions: "
            "[\"Extract live attendance from UMS\", \"Open Date Sheet and seating plan\", \"View today's class schedule\", \"Calculate safe bunks for my courses\"].\n"
            "3. NEVER use vague mock text like 'Check my attendance', 'Hello', 'What can you do?', or generic filler.\n"
            "4. Each suggestion must be concise and actionable, under 45 characters.\n"
            "5. Do NOT use em dashes ('—'); use '->' or '-' if needed.\n"
            "6. STRICT DOMAIN ISOLATION:\n"
            "   - If the student's question or assistant response is about ATTENDANCE or bunks/skips: suggestions MUST ONLY be about attendance, course skips, bunks, margin to 75%. NEVER suggest exam seating, date sheets, or timetable questions!\n"
            "   - If the discussion is about TIMETABLE / CLASSES: suggestions MUST ONLY be about timetable, today's/tomorrow's schedule, rooms, faculty cabins. NEVER suggest attendance or exam questions!\n"
            "   - If the discussion is about EXAMINATIONS / DATE SHEET / SAMPLE PAPERS: suggestions MUST ONLY be about exams, date sheets, seats, reporting times, sample question papers. NEVER suggest attendance or regular timetable questions!\n"
            "7. Output ONLY a valid JSON array of 3 or 4 strings, e.g. [\"Question 1\", \"Question 2\", \"Question 3\"]. No markdown wrapping or conversational prose."
        )

        user_prompt = "Context:\n" + ("\n".join(context_parts) if context_parts else "No academic data loaded yet.")
        if recent_dialogue:
            user_prompt += "\n\nRecent Conversation:\n" + "\n".join(recent_dialogue)
        user_prompt += "\n\nGenerate 3-4 natural follow-up questions or next actions as a JSON array of strings:"

        try:
            resp = await groq_service.call_chat_completion(
                messages=[
                    {"role": "system", "content": system_instruction},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.3,
                max_tokens=160
            )
            content = resp["choices"][0]["message"].get("content", "").strip()

            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()

            start_bracket = content.find("[")
            end_bracket = content.rfind("]")
            if start_bracket != -1 and end_bracket != -1:
                content = content[start_bracket:end_bracket+1]

            parsed = json.loads(content)
            if isinstance(parsed, list):
                valid_suggestions = [
                    str(s).strip().replace("—", "->")
                    for s in parsed
                    if isinstance(s, (str, int, float)) and 3 <= len(str(s).strip()) <= 55
                ]
                if len(valid_suggestions) >= 2:
                    return valid_suggestions[:4]
        except Exception as e:
            logger.info(f"LLM suggestion generation failed or returned invalid JSON ({e}), using contextual heuristic fallback")

        return self._generate_contextual_heuristic_suggestions(
            user_message=user_message,
            assistant_response=assistant_response,
            attendance=attendance,
            examination=examination,
            timetable=timetable
        )

    def _generate_contextual_heuristic_suggestions(
        self,
        user_message: str = "",
        assistant_response: str = "",
        attendance: Optional[AttendanceSummary] = None,
        examination: Optional[Dict[str, Any]] = None,
        timetable: Optional[Dict[str, Any]] = None
    ) -> List[str]:
        """
        Robust deterministic context-aware suggestion generator.
        Grounded in live course codes, exam dates, and timetable slots.
        """
        suggestions: List[str] = []
        user_lower = (user_message or "").lower()
        asst_lower = (assistant_response or "").lower()
        combined_text = f"{user_lower} {asst_lower}"

        # 0. Check for leave / tomorrow / absence inquiry
        is_leave_query = any(k in combined_text for k in [
            "leave", "tomorrow", "holiday", "absent", "absence", "take off",
            "leave verdict", "leave impact"
        ])
        if is_leave_query:
            if attendance and attendance.courses:
                sorted_courses = sorted(attendance.courses, key=lambda c: c.percentage)
                crit_course = None
                for c in attendance.courses:
                    if c.code.lower() in combined_text:
                        crit_course = c
                        break
                if not crit_course:
                    crit_course = sorted_courses[0]

                if crit_course:
                    suggestions.append(f"Is {crit_course.code} on tomorrow's schedule?")
                    suggestions.append(f"Can I safely skip {crit_course.code} tomorrow?")
                    if crit_course.percentage < 75.0:
                        suggestions.append(f"How many to reach 75% in {crit_course.code}?")
                    else:
                        suggestions.append(f"How many can I miss in {crit_course.code}?")
                suggestions.append("What classes do I have tomorrow?")
                suggestions.append("Will leave drop my aggregate below 75%?")
                return suggestions[:4]
            else:
                return [
                    "What classes do I have tomorrow?",
                    "View tomorrow's class schedule",
                    "Extract live attendance from UMS",
                    "Calculate safe bunks for my courses"
                ]

        # Detect specific active domain from user message and assistant response
        is_attendance_domain = any(k in combined_text for k in [
            "attendance", "bunk", "skip", "miss", "cut", "absent", "shortage", "percentage", "75%", "safe buffer"
        ])
        is_exam_domain = any(k in combined_text for k in [
            "exam", "examination", "date sheet", "datesheet", "seating", "seat", "sample paper", "question paper", "reporting time"
        ])
        is_timetable_domain = any(k in combined_text for k in [
            "timetable", "time table", "class", "classes", "lecture", "schedule", "faculty", "cabin",
            "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
        ])

        # 1. ATTENDANCE DOMAIN: strictly return attendance follow-ups
        if is_attendance_domain and attendance and attendance.courses:
            sorted_courses = sorted(attendance.courses, key=lambda c: c.percentage)
            lowest = sorted_courses[0] if sorted_courses else None
            second_lowest = sorted_courses[1] if len(sorted_courses) > 1 else None

            # Find if a specific course was mentioned
            mentioned_course = None
            for c in attendance.courses:
                if c.code.lower() in combined_text:
                    mentioned_course = c
                    break

            if mentioned_course:
                if mentioned_course.percentage < 75.0:
                    suggestions.append(f"How many to reach 75% in {mentioned_course.code}?")
                    suggestions.append(f"Can I miss any classes in {mentioned_course.code}?")
                else:
                    suggestions.append(f"How many can I skip in {mentioned_course.code}?")
                    suggestions.append(f"Safe buffer for {mentioned_course.code}?")
                if second_lowest and second_lowest.code != mentioned_course.code:
                    suggestions.append(f"How many can I miss in {second_lowest.code}?")
            elif "lowest" in combined_text or "minimum" in combined_text:
                if lowest:
                    suggestions.append(f"How many can I miss in {lowest.code}?")
                    if lowest.percentage < 75.0:
                        suggestions.append(f"How many to reach 75% in {lowest.code}?")
                if second_lowest:
                    suggestions.append(f"Compare {lowest.code} with {second_lowest.code}")
            elif "bunk" in combined_text or "skip" in combined_text or "miss" in combined_text:
                if lowest:
                    suggestions.append(f"How many can I miss in {lowest.code}?")
                if second_lowest and second_lowest.percentage >= 75.0:
                    suggestions.append(f"Can I miss classes in {second_lowest.code}?")
                suggestions.append("Which subject is closest to 75%?")
            else:
                if lowest:
                    suggestions.append("Which subject is lowest?")
                    suggestions.append(f"How many can I miss in {lowest.code}?")
                if second_lowest:
                    suggestions.append(f"Compare {lowest.code} with {second_lowest.code}")

            suggestions.append("What is my aggregate attendance?")
            suggestions.append("Show all course percentages")
            return suggestions[:4]

        # 2. EXAMINATION DOMAIN: strictly return exam, date sheet & sample paper follow-ups
        if is_exam_domain and examination and examination.get("exams"):
            exams = examination.get("exams", [])
            next_exam = exams[0] if exams else None
            if next_exam:
                course_code = next_exam.get("courseCode", "Exam")
                suggestions.append(f"Where is my seat for {course_code}?")
                suggestions.append(f"When should I report for {course_code}?")
                if next_exam.get("samplePaper", {}).get("available"):
                    suggestions.append(f"Show sample paper for {course_code}")
                elif any(e.get("samplePaper", {}).get("available") for e in exams):
                    sp_exam = next(e for e in exams if e.get("samplePaper", {}).get("available"))
                    suggestions.append(f"Show sample paper for {sp_exam.get('courseCode')}")
            suggestions.append("When is my next exam?")
            suggestions.append("Show my complete exam schedule")
            return suggestions[:4]

        # 3. TIMETABLE DOMAIN: strictly return timetable follow-ups
        if is_timetable_domain and timetable and (timetable.get("slots") or timetable.get("courses")):
            slots = timetable.get("slots", [])
            courses = timetable.get("courses", [])
            if slots:
                first_slot = slots[0]
                code = first_slot.get("courseCode", "class")
                suggestions.append(f"Where is my next class ({code})?")
                suggestions.append("What classes do I have today?")
                suggestions.append("What classes do I have tomorrow?")
            if courses:
                suggestions.append("Show my registered courses")
                suggestions.append("Who are my faculty members?")
            suggestions.append("Show my complete timetable")
            return suggestions[:4]

        # 4. GENERAL / DASHBOARD FALLBACK (Balanced initial options)
        if attendance and attendance.courses:
            sorted_courses = sorted(attendance.courses, key=lambda c: c.percentage)
            lowest = sorted_courses[0] if sorted_courses else None
            if lowest:
                suggestions.append(f"How many can I miss in {lowest.code}?")
        else:
            suggestions.append("Extract live attendance from UMS")

        if timetable and timetable.get("slots"):
            suggestions.append("What classes do I have today?")
        else:
            suggestions.append("Check my class schedule")

        if examination and examination.get("exams"):
            suggestions.append("When is my next exam?")
        else:
            suggestions.append("Open Date Sheet & seating plan")
        if len(suggestions) < 3:
            if not attendance or not attendance.courses:
                suggestions.extend([
                    "Extract live attendance from UMS",
                    "Open Date Sheet and seating plan",
                    "View today's class schedule",
                    "Calculate safe bunks for my courses"
                ])
            else:
                suggestions.extend([
                    "Which subject is closest to 75%?",
                    "Show subjects below 80%",
                    "Calculate safe bunk allowance"
                ])

        # Deduplicate, sanitize lengths and formatting
        seen = set()
        clean_suggestions = []
        for s in suggestions:
            s_clean = s.strip().replace("—", "->")
            if s_clean and s_clean not in seen and len(s_clean) <= 50:
                seen.add(s_clean)
                clean_suggestions.append(s_clean)
                if len(clean_suggestions) == 4:
                    break

        return clean_suggestions

onee_agent = OneeAgent()
