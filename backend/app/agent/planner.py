"""
Computer Use Autonomous Planner for ONEE.

Given the student's goal and current page observation (harvested interactive DOM elements),
this module selects the next atomic browser action:
- Spatial Grounding: Matches target descriptions to actual DOM element IDs (onee-xxx).
- Structured Output: Generates click, type, scroll, wait, extract, or done actions.
- Verification Checks: Asserts expected post-action outcomes before advancing stages.
"""

import json
import logging
from typing import Dict, Any, List, Optional
from ..schemas.planner import (
    PlanActionRequest,
    PlanActionResponse,
    AgentActionModel,
    PageElementModel,
    VisionTargetCandidateModel,
    BoundingBoxModel,
    ConfidenceBreakdownModel
)
from ..services.groq_service import groq_service

logger = logging.getLogger(__name__)

PLANNER_SYSTEM_PROMPT = """You are ONEE, a cautious, highly reliable Hybrid Vision + DOM Computer-Use AI Browser Agent for Lovely Professional University (LPU) UMS.
Your mission is to autonomously navigate the real LPU UMS web interface on behalf of the student using both visual layout understanding and structured DOM grounding with an explicit perception-action-verification loop.

Operational Rules:
1. Spatial Grounding: You receive a structured list of actionable DOM elements with their `id` (e.g. `onee-001`), `text`, `role`, `tag`, and spatial coordinates `[x, y, width, height, centerX, centerY]`.
2. Action Selection: Select ONE next logical action to move closer to the goal.
3. Supported Actions:
   - {"action": "click", "elementId": "onee-xxx", "reason": "Short explanation", "expectedOutcome": "attendance_modal_opened"}
   - {"action": "type", "elementId": "onee-xxx", "text": "...", "reason": "..."}
   - {"action": "scroll", "direction": "down", "amount": 350, "reason": "...", "expectedOutcome": "attendance_card_visible"}
   - {"action": "wait", "durationMs": 1000, "reason": "..."}
   - {"action": "goBack", "reason": "..."}
   - {"action": "finish", "reason": "Goal reached"}
4. Attendance Navigation Strategy:
   - On Student Dashboard: Look for the Attendance Modal Trigger (onee-001) in the My Courses section or the "Academics" top menu.
   - Do NOT click Event QR Attendance banners, Hostel Booking, Fee Dashboard, or external sidebars.
   - NEVER click "My Class", "LPU Touch", "LPU Live", "YourDost", or sidebar shortcuts.
   - If Attendance Modal opens (`hasAttendanceTable: true`):
     - Select `finish` to extract the complete structured attendance table.
5. Verification Awareness: Specify `expectedOutcome` for every click or navigation action so ONEE can verify success before proceeding.
6. Strict JSON Output: Respond ONLY with a valid JSON object matching this schema:
{
  "thought": "Step-by-step reasoning about the current visual layout and target",
  "action": {
    "action": "click",
    "elementId": "onee-001",
    "reason": "Opening Attendance modal",
    "expectedOutcome": "attendance_modal_opened"
  },
  "visionTarget": {
    "targetDescription": "Attendance Info (ⓘ) button in My Courses",
    "bbox": {"x": 600, "y": 800, "width": 40, "height": 30},
    "confidence": 0.95
  },
  "isGoalComplete": false
}
"""

def heuristic_plan(request: PlanActionRequest) -> PlanActionResponse:
    """
    Deterministic fallback planner for LPU UMS navigation with spatial grounding and expected outcomes.
    """
    obs = request.observation

    # 1. If attendance table is already present/visible in DOM
    if obs.hasAttendanceTable:
        return PlanActionResponse(
            thought="Attendance modal table is open and visible in DOM.",
            action=AgentActionModel(
                action="finish",
                reason="Attendance table detected and ready for extraction.",
                expectedOutcome="attendance_table_extracted",
                confidenceBreakdown=ConfidenceBreakdownModel(
                    confidence=0.98,
                    semanticScore=1.0,
                    visualScore=0.95,
                    spatialScore=1.0,
                    visibilityScore=1.0,
                    interactionScore=1.0
                )
            ),
            isGoalComplete=True
        )

    # 2. Priority navigation sequence on Student Dashboard
    priority_keywords = [
        "attendance modal",
        "attendance :",
        "attendance info",
        "view attendance",
        "student attendance",
        "attendance",
        "academics"
    ]

    prev_clicked_ids = {
        act.get("elementId")
        for act in request.previousActions
        if act.get("action") == "click"
    }

    elements_by_priority: List[PageElementModel] = []
    for kw in priority_keywords:
        for el in obs.elements:
            text_lower = el.text.lower()
            if kw in text_lower or (el.href and kw.replace(" ", "") in el.href.lower()):
                if el not in elements_by_priority:
                    elements_by_priority.append(el)

    target_el = None
    for el in elements_by_priority:
        if el.id not in prev_clicked_ids:
            target_el = el
            break

    if target_el:
        expected = "attendance_modal_opened" if "attendance" in target_el.text.lower() else "menu_expanded"
        return PlanActionResponse(
            thought=f"Targeting '{target_el.text}' ({target_el.id}) at viewport ({target_el.centerX}, {target_el.centerY}).",
            action=AgentActionModel(
                action="click",
                elementId=target_el.id,
                reason=f"Clicking {target_el.text}",
                expectedOutcome=expected,
                confidenceBreakdown=ConfidenceBreakdownModel(
                    confidence=0.95,
                    semanticScore=0.96,
                    visualScore=0.94,
                    spatialScore=0.95,
                    visibilityScore=1.0,
                    interactionScore=1.0
                )
            ),
            visionTarget=VisionTargetCandidateModel(
                targetDescription=target_el.visualDescription or target_el.text,
                bbox=BoundingBoxModel(
                    x=target_el.x,
                    y=target_el.y,
                    width=target_el.width,
                    height=target_el.height
                ),
                confidence=0.95
            ),
            isGoalComplete=False
        )

    return PlanActionResponse(
        thought="Scrolling down to bring Attendance section into center viewport.",
        action=AgentActionModel(
            action="scroll",
            direction="down",
            amount=400,
            reason="Scrolling down to reveal Attendance section.",
            expectedOutcome="attendance_card_visible",
            confidenceBreakdown=ConfidenceBreakdownModel(
                confidence=0.85,
                semanticScore=0.8,
                visualScore=0.8,
                spatialScore=0.9,
                visibilityScore=1.0,
                interactionScore=1.0
            )
        ),
        isGoalComplete=False
    )

async def plan_next_action(request: PlanActionRequest) -> PlanActionResponse:
    """
    Decides the next active computer-use action using Qwen LLM with spatial-vision context.
    """
    obs = request.observation

    if obs.hasAttendanceTable:
        return PlanActionResponse(
            thought="Attendance table is actively visible in DOM.",
            action=AgentActionModel(
                action="finish",
                reason="Attendance table detected and ready for analysis.",
                expectedOutcome="attendance_table_extracted"
            ),
            isGoalComplete=True
        )

    elements_summary = [
        {
            "id": el.id,
            "text": el.text[:50] if el.text else "",
            "tag": el.tag,
            "role": el.role,
            "bounds": [el.x, el.y, el.width, el.height]
        }
        for el in obs.elements[:25]
    ]

    prompt_context = {
        "user_goal": request.goal,
        "current_step": request.step,
        "max_steps": request.maxSteps,
        "current_url": obs.url,
        "page_type": obs.pageType,
        "viewport": {"width": obs.viewportWidth, "height": obs.viewportHeight},
        "has_attendance_table": obs.hasAttendanceTable,
        "spatial_elements": elements_summary,
        "previous_actions": request.previousActions[-3:] if request.previousActions else [],
        "retry_context": request.retryContext
    }

    messages = [
        {"role": "system", "content": PLANNER_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": f"Decide the next ONE action to achieve the goal.\n\nContext:\n{json.dumps(prompt_context, indent=2)}"
        }
    ]

    try:
        response = await groq_service.call_chat_completion(
            messages=messages,
            temperature=0.1,
            max_tokens=400
        )

        metadata = response.get("_onee_metadata", {})
        model_used = metadata.get("model_used")
        is_fallback = metadata.get("fallback_used", False)

        content = response["choices"][0]["message"].get("content", "")
        clean_json = content.strip()

        if "```json" in clean_json:
            clean_json = clean_json.split("```json")[1].split("```")[0].strip()
        elif "```" in clean_json:
            clean_json = clean_json.split("```")[1].split("```")[0].strip()

        data = json.loads(clean_json)

        action_data = data.get("action", {})
        action_type = action_data.get("action", "finish")
        element_id = action_data.get("elementId")
        reason = action_data.get("reason", "Executing next navigation step")
        expected_outcome = action_data.get("expectedOutcome")

        valid_ids = {el.id for el in obs.elements}
        if action_type == "click" and (not element_id or element_id not in valid_ids):
            logger.warning(f"Planner suggested invalid elementId '{element_id}'. Falling back to spatial heuristic.")
            return heuristic_plan(request)

        vision_data = data.get("visionTarget")
        vision_target = None
        if vision_data:
            bbox_data = vision_data.get("bbox")
            bbox = BoundingBoxModel(**bbox_data) if bbox_data else None
            vision_target = VisionTargetCandidateModel(
                targetDescription=vision_data.get("targetDescription", reason),
                bbox=bbox,
                confidence=float(vision_data.get("confidence", 0.9))
            )

        return PlanActionResponse(
            thought=data.get("thought", ""),
            action=AgentActionModel(
                action=action_type,
                elementId=element_id,
                text=action_data.get("text"),
                direction=action_data.get("direction"),
                amount=action_data.get("amount"),
                value=action_data.get("value"),
                durationMs=action_data.get("durationMs"),
                reason=reason,
                expectedOutcome=expected_outcome
            ),
            visionTarget=vision_target,
            isGoalComplete=data.get("isGoalComplete", action_type == "finish"),
            finalAnswer=data.get("finalAnswer"),
            modelUsed=model_used,
            isFallback=is_fallback
        )

    except Exception as e:
        logger.warning(f"Error calling LLM planner: {e}. Using deterministic spatial heuristic.")
        return heuristic_plan(request)
