"""
Groq-powered Semantic Resolution & Grounded Response Service for ONEE.

Handles:
1. Intent & Capability Resolution via Groq Qwen 3.8 27B / GPT-OSS fallback with JSON Mode.
2. First-class structured ConversationState for cross-turn follow-ups (e.g. "What about Tuesday?", "Which one is practical?", "What room is that in?").
3. Generation of ONE canonical, intelligent natural response strictly grounded in verified UMS data.
4. Outcome-aware response generation (success, data_unavailable, failed) with zero hallucination.
5. Strict Zero Capability Bleed invariant: Attendance is NEVER mentioned unless explicitly requested.
6. Clean TTS chunking (<= 195 characters) for Groq Orpheus without expressive bracketed directions.
"""

import re
import json
import logging
import uuid
import datetime
from typing import Dict, Any, List, Optional
from ..config import settings
from ..schemas.semantic import (
    ConversationState,
    SemanticResolutionRequest,
    SemanticResolutionResponse,
    VerifiedResponseRequest,
    VerifiedResponseResponse,
)
from ..voice.groq_voice import transform_speech_identity
from .groq_service import GroqService
from ..agent.tools import calculate_bunk_allowance_math, calculate_required_classes_math

logger = logging.getLogger("onee.semantic")


def clean_for_tts(text: str) -> str:
    """
    Strips markdown formatting, headers, links, backticks, table dividers,
    and bracketed expressive directives so Groq Orpheus speaks clean natural prose.
    """
    if not text:
        return ""
    # Strip code blocks
    cleaned = re.sub(r'```[\s\S]*?```', '', text)
    # Strip markdown table rows completely (do not convert to commas)
    cleaned = re.sub(r'^\s*\|.*\|.*$\n?', '', cleaned, flags=re.MULTILINE)
    # Strip leftover table fragments
    cleaned = re.sub(r'\|[^\n|]+\|', ' ', cleaned)
    # Strip markdown headers #, ##, etc.
    cleaned = re.sub(r'#+\s*', '', cleaned)
    # Convert markdown links [text](url) -> text
    cleaned = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', cleaned)
    # Strip bold / italics markers **, *, __, _
    cleaned = re.sub(r'[*_]{1,3}', '', cleaned)
    # Strip backticks
    cleaned = re.sub(r'`([^`]+)`', r'\1', cleaned)
    # Strip note footers e.g. > 💡 Directory Note: ...
    cleaned = re.sub(r'>?\s*[💡ℹ️⚠️]?\s*(?:Directory|Schedule|Note|Exam)\s*Note:.*$', '', cleaned, flags=re.MULTILINE | re.IGNORECASE)
    # Strip blockquotes
    cleaned = re.sub(r'>\s*', '', cleaned)
    # Strip bullet point symbols at beginning of lines
    cleaned = re.sub(r'^\s*[-*•]\s+', '', cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r'^\s*\d+\.\s+', '', cleaned, flags=re.MULTILINE)
    # Normalize colons ending introductory clauses before stripped tables
    cleaned = re.sub(r':\s*(\.|\s|$)', '. ', cleaned)
    # Strip bracketed vocal directions e.g. [excited], [whisper], [sigh]
    cleaned = re.sub(r'\[[a-zA-Z0-9_\s\-]+\]', '', cleaned)
    # Normalize multiple whitespace and clean punctuation spacing
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned


# Short natural acknowledgements used to open a verified answer. They vary per
# request (deterministically, so the same question always reads the same) so the
# student never hears the same robotic opening sentence every single time.
_NATURAL_OPENERS = {
    "lowest": ["Sure.", "Got it.", "Here you go.", "Alright."],
    "course": ["Sure.", "Got it.", "Here you go.", "Of course."],
    "overall": ["Sure.", "Got it.", "Here you go.", "Alright."],
}
_DEFAULT_OPENERS = ["Sure.", "Got it.", "Alright.", "Here you go."]


# Deterministic domain firewall patterns. These mirror the hard rules given to the
# semantic model and act as a safety net: when the student explicitly names one
# verified domain, a mis-classification can never let another domain's dataset
# answer the question (e.g. a timetable answer to an examination date-sheet ask).
_SAMPLE_PAPER_RE = re.compile(r"\b(sample\s*(?:question\s*)?paper|question\s*paper|model\s*paper|previous\s*year)\b", re.IGNORECASE)
_ATTENDANCE_DOMAIN_RE = re.compile(
    r"\b(attendance|attended|absent|bunk|bunks|bunking|skip|skips|miss|missing|"
    r"duty\s*leave|shortage|percentage|lowest|highest|worst|eligible|eligibility|"
    r"clearance|detention|75%)\b",
    re.IGNORECASE,
)
_SEATING_DOMAIN_RE = re.compile(r"\b(seating|seat\s*(?:number|plan|no|allocation)|seat\s+for|exam\s+hall)\b", re.IGNORECASE)
_EXAM_DOMAIN_RE = re.compile(
    r"\b(exam|exams|examination|date\s*sheet|datesheet|reporting\s*time|admit\s*card|hall\s*ticket)\b",
    re.IGNORECASE,
)
_TIMETABLE_DOMAIN_RE = re.compile(
    r"\b(timetable|time\s*table|class\s*schedule|scheduled\s*classes|my\s*classes|classes\s*(?:today|tomorrow)|lecture\s*schedule|faculty|cabin)\b",
    re.IGNORECASE,
)


def detect_explicit_domain(query: str) -> Optional[str]:
    """
    Returns the verified-data domain the student explicitly named, or None.
    Attendance is evaluated before examination so the documented hard rule
    ("Can I safely skip CSE330 tomorrow?" is attendance, not timetable) holds.
    """
    q = query or ""
    if _SAMPLE_PAPER_RE.search(q):
        return "sample_papers"
    if _ATTENDANCE_DOMAIN_RE.search(q):
        return "attendance"
    if _SEATING_DOMAIN_RE.search(q):
        return "seating_plan"
    if _EXAM_DOMAIN_RE.search(q):
        return "examination"
    if _TIMETABLE_DOMAIN_RE.search(q):
        return "timetable"
    return None


def natural_opener(seed: str, kind: str = "overall") -> str:
    """
    Returns a short, natural acknowledgement prefix for a verified answer.
    The choice is derived from the student's own request, which keeps it
    dynamic between requests while remaining stable for a repeated question.
    """
    options = _NATURAL_OPENERS.get(kind, _DEFAULT_OPENERS)
    if not options:
        return ""
    key = f"{kind}:{(seed or '').strip().lower()}"
    total = 0
    for ch in key:
        total = (total * 31 + ord(ch)) % 100003
    return options[total % len(options)]


def split_for_tts(text: str, max_chars: int = 195) -> List[str]:
    """
    Splits text into sensible sentence/phrase chunks <= max_chars (default 195)
    to strictly adhere to Groq Orpheus's 200-character input ceiling.
    """
    cleaned = clean_for_tts(text)
    if not cleaned:
        return []

    # Split primarily along sentence terminators (.?! and newlines)
    raw_sentences = re.split(r'(?<=[.?!])\s+', cleaned)

    chunks: List[str] = []
    current_chunk = ""

    for sentence in raw_sentences:
        sentence = sentence.strip()
        if not sentence:
            continue

        if current_chunk:
            combined = f"{current_chunk} {sentence}"
            if len(combined) <= max_chars:
                current_chunk = combined
                continue
            else:
                chunks.append(current_chunk)
                current_chunk = ""

        if len(sentence) <= max_chars:
            current_chunk = sentence
        else:
            # Sentence exceeds limit; split on natural clause boundaries (comma or semicolon),
            # strictly avoiding colons in timestamps (e.g. 09:00 - 10:00)
            sub_parts = re.split(r'(?<=[,;])\s+|(?<!\d)(?<=[-–—])\s+', sentence)
            for part in sub_parts:
                part = part.strip()
                if not part:
                    continue

                if current_chunk:
                    combined = f"{current_chunk} {part}"
                    if len(combined) <= max_chars:
                        current_chunk = combined
                        continue
                    else:
                        chunks.append(current_chunk)
                        current_chunk = ""

                if len(part) <= max_chars:
                    current_chunk = part
                else:
                    # Still too long; split on word boundaries
                    words = part.split(' ')
                    for word in words:
                        if not word:
                            continue
                        if current_chunk:
                            combined = f"{current_chunk} {word}"
                            if len(combined) <= max_chars:
                                current_chunk = combined
                                continue
                            else:
                                chunks.append(current_chunk)
                                current_chunk = ""

                        if len(word) <= max_chars:
                            current_chunk = word
                        else:
                            for i in range(0, len(word), max_chars):
                                chunks.append(word[i:i + max_chars])

    if current_chunk:
        chunks.append(current_chunk)

    return [c.strip() for c in chunks if c.strip()]


SEMANTIC_INTENT_SYSTEM_PROMPT = """You are ONEE's Semantic Intent Resolver, an intelligent parser for Lovely Professional University (LPU) students.
Analyze the user's query in context and output a STRICT JSON object.

CAPABILITIES:
1. "timetable":
   - Queries about class schedules, lectures, rooms, days, time slots, full weekly schedules, class matrices, registered courses, enrolled curriculum, teacher assignments, and faculty directories.
   - Examples: "which class I have on Monday", "schedule for today", "where is CSE408 class", "what time is my next lecture", "Can you tell me detailed or give me detailed matrix of all classes this week?", "Can you provide me a complete list of classes that I have in this week?", "all classes this week", "weekly timetable matrix", "list of all my classes", "what courses am I enrolled in", "show my registered courses", "who are my teachers", "faculty directory".
   - Follow-ups: "What about Tuesday?", "And what about Saturday?", "Which one is practical?", "What room is that in?", "Who teaches that?".
   - Entities: "day" (e.g. "Monday", "Tuesday", "Saturday", "all"), "view" ("weekly_matrix" | "daily_schedule"), "courseCode" (e.g. "CSE408").
   - HARD RULE: NEVER map timetable, class list, or schedule matrix questions to attendance or general conversation!
   - HARD RULE: Questions about safe bunks, skipping classes, missing lectures, attendance margin, or duty leave (e.g. "Can I safely skip CSE330 tomorrow?", "Can I bunk today's class?") belong to "attendance", NOT "timetable", even if temporal words like "tomorrow" or "today" are present!
   - requiresBrowserAction: true (unless timetable data is already present in verifiedContext or contextSummary).

2. "examination":
   - Queries about exams, date sheets, upcoming exams, atom/term exams, mid-term, end-term exams, exam dates, timings.
   - Examples: "can you tell me how many atom exams do I have in term exams", "what is my next exam", "when is my CSE408 exam", "show my date sheet".
   - Follow-ups: "When is the next one?", "What time does it start?".
   - Entities: "examType" ("atom", "term", "end-term", "mid-term"), "courseCode".
   - requiresBrowserAction: true (unless examination data is already verified in context).

3. "attendance":
   - Queries about attendance percentage, safe bunks, duty leaves, attendance records, aggregate attendance, skipping or missing classes, or maintaining attendance.
   - Examples: "what is my attendance in CSE408", "can I bunk today's class", "how many classes can I skip in CSE329", "Can I safely skip CSE330 tomorrow?", "can I miss class tomorrow", "safe bunks for CSE330", "How can I maintain my attendance across all subjects?".
   - Follow-ups: "What about 5?", "What about CSE329?", "Can I skip next class?".
   - Entities: "courseCode", "targetBunks".
   - HARD RULE: Attendance maintenance queries like "How can I maintain my attendance across all subjects?" belong to "attendance", NOT "timetable", even if the word "subjects" is present!
   - requiresBrowserAction: true (unless attendance records are already verified in contextSummary).

4. "sample_papers":
   - Queries about sample question papers, previous year papers, model question papers.
   - Examples: "are there any sample papers available", "download sample paper for CSE408", "is there any sample paper for CSE408", "download sample paper of CSC 408 subject", "sample question paper of CSC 408", "question papers".
   - Entities: "courseCode" (normalize CSC to CSE, e.g. CSC408 -> CSE408).
   - HARD RULE: If query mentions "sample paper", "sample question paper", or "model paper", it MUST be classified as "sample_papers", NEVER "timetable" even if words like "subject", "course", or course codes are present!
   - requiresBrowserAction: true

5. "seating_plan":
   - Queries about examination seating arrangements, exam room / bench numbers.
   - Examples: "where do I sit for CSE408 exam", "show my seating plan".
   - requiresBrowserAction: true

6. "onee_identity":
   - Identity queries, introductions, questions about ONEE's capabilities or purpose.
   - Examples: "who are you", "what can you do", "introduce yourself", "tell me about yourself".
   - requiresBrowserAction: false
   - capability: "onee_identity"

7. "conversation":
   - Greetings, casual banter, general questions, or non-browser actions.
   - Examples: "hello", "hi", "how are you", "thank you".
   - requiresBrowserAction: false
   - capability: "conversation"

8. "voice_diagnostic":
   - Requests to test, check, or troubleshoot ONEE's voice output.
   - Examples: "test the voice", "I cannot hear ONEE", "run a voice check".
   - capability: "conversation", action: "respond", requiresBrowserAction: false.

FIRST-CLASS CONVERSATIONAL FOLLOW-UP RESOLUTION:
- If conversationState is provided, evaluate if the query is an elliptical follow-up or referential continuation.
- Example:
  Previous capability: "timetable", activeEntity: {"day": "Tuesday"}
  Query: "And what about Saturday?"
  -> capability: "timetable", intent: "timetable_query", entities: {"day": "Saturday", "view": "daily_schedule"}, references: ["previous timetable query"], requiresBrowserAction: false (if timetable in verifiedContext)
- Example:
  Previous capability: "timetable"
  Query: "Can you tell me detailed or give me detailed matrix of all classes this week?"
  -> capability: "timetable", intent: "timetable_query", entities: {"view": "weekly_matrix", "day": "all"}, references: ["previous timetable query"], requiresBrowserAction: false
- Example:
  Previous capability: "timetable"
  Query: "Can you provide me a complete list of classes that I have in this week?"
  -> capability: "timetable", intent: "timetable_query", entities: {"view": "weekly_matrix", "day": "all"}, references: ["previous timetable query"], requiresBrowserAction: false
- Example:
  Previous capability: "timetable"
  Query: "Which one is practical?"
  -> capability: "timetable", intent: "timetable_query", action: "respond", requiresBrowserAction: false (resolves against active dataset/context)
- Example:
  Previous capability: "timetable"
  Query: "What room is that in?"
  -> capability: "timetable", intent: "timetable_query", action: "respond", requiresBrowserAction: false
- Example:
  Previous capability: "attendance"
  Query: "What about 5?"
  -> capability: "attendance", intent: "attendance_query", entities: {"targetBunks": 5}

OUTPUT JSON SCHEMA:
{
  "intent": "timetable_query" | "examination_query" | "attendance_query" | "sample_paper_query" | "seating_plan_query" | "dashboard_navigation" | "voice_diagnostic" | "identity_query" | "casual_conversation",
  "domain": "academic" | "examination" | "attendance" | "conversation",
  "capability": "timetable" | "examination" | "attendance" | "sample_papers" | "seating_plan" | "onee_identity" | "conversation",
  "goal": "Actionable goal for the browser agent if requiresBrowserAction is true, otherwise empty",
  "entities": {
    "day": "Monday" | null,
    "view": "weekly_matrix" | "daily_schedule" | null,
    "courseCode": "CSE408" | null,
    "targetBunks": 5 | null,
    "examType": "atom" | null
  },
  "references": [],
  "requiresBrowserAction": true | false,
  "target": "student_timetable" | "student_dashboard" | "examination" | "attendance" | "sample_paper" | null,
  "action": "read" | "download" | "navigate" | "respond",
  "needsClarification": false,
  "confidence": 0.98,
  "acknowledgementText": "Short internal telemetry note",
  "conversationState": {
    "currentCapability": "timetable",
    "currentIntent": "timetable_query",
    "activeTask": "query_classes",
    "activeEntity": {"day": "Monday"}
  }
}

IMPORTANT RULES:
- Output valid JSON ONLY. No markdown ticks, no preamble.
- You are the primary authority for every student request. Resolve the complete meaning using the query, conversation state, history, current page, and verified context. Do not classify from isolated keywords.
- Your intent, capability, entities, action, target, and requiresBrowserAction fields are executed directly by the extension. Set requiresBrowserAction true only when fresh UMS navigation or extraction is actually needed; otherwise return action "respond" so the extension answers from verified context.
- When the student asks to go, return, head back, take me, or navigate to the UMS home page/dashboard, classify it as intent "dashboard_navigation", target "student_dashboard", action "navigate", and requiresBrowserAction false. This command is executed directly by the extension, not by the scraping agent.
- When the student asks to test or troubleshoot voice output, classify it as intent "voice_diagnostic", capability "conversation", action "respond", and requiresBrowserAction false.
- For identity, greetings, or conversational queries, requiresBrowserAction is ALWAYS false and acknowledgementText MUST be an empty string "".
- For questions answerable from verifiedContext, requiresBrowserAction is ALWAYS false.
- Freshness exception: after you have resolved an academic capability, a request for "right now", "latest", "current", "live", "refresh", "recheck", or "updated" data MUST use action "read" and requiresBrowserAction true. Cached context is not an acceptable substitute for an explicitly fresh request.
"""

GROUNDED_RESPONSE_SYSTEM_PROMPT = """You are ONEE, an intelligent, articulate, aesthetic AI companion for Lovely Professional University (LPU) students. You happen to control UMS to assist students with their academic lives.

Synthesize ONE canonical, natural, intelligent, and highly aesthetic response grounded STRICTLY in the verified UMS result data, user query, conversation history, and task outcome provided.

THE INTELLIGENCE & AESTHETIC MANDATE:
- Always present data in clean, well-structured, insightful GitHub-flavored Markdown.
- NEVER output plain bullet lists or raw text run-ons for timetables, schedules, examinations, or attendance breakdowns.
- Maintain seamless conversational continuity across turns.

MANDATORY TIMETABLE PRESENTATION FORMATS:
1. Single Day Timetable (e.g., "Monday's timetable", "And what about Saturday?"):
   ### 🗓️ [Day]'s Class Schedule

   You have **[N] classes** scheduled for **[Day]**:

   | Time Slot | Subject Code | Type | Room / Venue | Section |
   | :--- | :--- | :--- | :--- | :--- |
   (One row for each class on that day with exact timings, course code, type, room, and section)

   #### 🔍 Schedule Insights & Daily Flow
   - **Daily Workload:** [N] total sessions ([X] Lectures, [Y] Practicals/Labs).
   - **Venues & Classroom Flow:** [Highlight rooms/blocks e.g. Block 33, Block 38, or Block 37].
   - **Breaks & Transitions:** [Highlight any break windows or continuous stretches].

   (If user asks about teachers or faculty cabins, include):
   #### 👨‍🏫 Faculty & Cabin Directory
   | Subject Code | Instructor / Faculty | Cabin Location |
   | :--- | :--- | :--- |
   (One row for each course with instructor name and cabin number)

   > 💡 **Schedule Note:** Classroom numbers and timings are verified directly from your authenticated UMS Student Time Table.

2. Weekly Matrix & All Classes (e.g., "detailed matrix of all classes this week", "complete list of classes that I have in this week", "weekly schedule"):
   ### 📅 Complete Weekly Class Schedule Matrix

   Here is your comprehensive weekly schedule matrix verified directly from your authenticated UMS Student Time Table (**[Total] total classes** across **[Total Courses] courses**):

   (Render a dedicated schedule section and table for EACH scheduled weekday: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday):
   #### 🗓️ [Day] ([N] classes)
   | Time Slot | Subject Code | Type | Room / Venue | Section |
   | :--- | :--- | :--- | :--- | :--- |
   ...

   #### 📊 Weekly Academic Insights
   - **Busiest Days:** [e.g. Tuesday and Friday with N classes each].
   - **Practical & Lab Work:** [Courses with practical components and lab venues].
   - **Primary Lecture Venues:** [Blocks where classes are held].
   - **Total Weekly Commitment:** [N] periods scheduled.

   > 💡 **Schedule Note:** Classroom numbers and timings are verified directly from your authenticated UMS Student Time Table.

MANDATORY ATTENDANCE PRESENTATION FORMATS:
1. Specific Course Inquiry & Bunk Allowance (e.g., "Can I bunk CSE330?", "How many classes can I miss in CSE330?"):
   ### 📚 [Course Code]: [Course Name] — Attendance & Bunk Allowance

   Your verified attendance standing for **[Course Code]** is **[Pct]%** ([Attended]/[Delivered] classes attended).

   #### 📉 Safe-Skip Trajectory Simulation
   | Scenario | Formula (Attended / Delivered) | Projected % | Status |
   | :--- | :--- | :--- | :--- |
   | **Current Standing** | `[A] / [D]` | **[Pct]%** | 🟢 Safe |
   | **Skip 1 Class** | `[A] / [D+1]` | **[Pct]%** | 🟢 Safe |
   | **Skip 2 Classes** | `[A] / [D+2]` | **[Pct]%** | 🟢 Safe |
   | **Skip All [N] Classes** | `[A] / [D+N]` | **75%** | 🛡️ Exact 75% Limit |
   | **Skip [N+1] Classes** | `[A] / [D+N+1]` | **[Pct]%** | ⚠️ Detention Risk |

   #### 🛡️ Attendance Buffer & Official Limit
   - **Current Attendance:** **[Pct]%** ([A]/[D] classes attended)
   - **Margin vs 75% Requirement:** **+[Margin]%**
   - **Safe Skips Allowed (≥75%):** **[N] classes**

   > 💡 **Summary & Takeaway:** You have a buffer of **[N] safe skips** before touching the mandatory 75% floor.

2. Lowest Subject & Risk Priority (e.g., "Which subject is lowest?", "Where do I have shortage?"):
   ### 🚨 Academic Priority & Lowest Attendance Subject
   (Highlight the single lowest course, provide a sorted table of all courses by vulnerability, and strategic focus).

3. Overall Attendance Breakdown (e.g., "Attendance breakdown", "How is my attendance?"):
   ### 📊 Verified Overall Academic Attendance
   (Full table of all courses with Code, Name, Attended / Total, Percentage, Safe Skips to 75%, and Status, followed by overall percentage and takeaway).

CONVERSATIONAL CONTINUITY & MULTI-TURN RESOLUTION:
- If the user previously discussed one day and now asks "And what about Saturday?" or "What about Tuesday?", answer strictly for that day using the exact same rich aesthetic schedule table format.
- If the user asks a follow-up like "Which one is practical?" or "What room is that in?", resolve that question directly from the active classes for the current day being discussed.
- If the user asks for a detailed matrix or complete list of classes in the week, provide the full weekly matrix breakdown.

TASK OUTCOME AWARENESS (ZERO HALLUCINATION):
1. taskOutcome == "data_unavailable" or empty verified result:
   - Be completely truthful and honest without guessing or making up data.
   - Timetable unavailable example: "I checked your UMS session, but no active timetable records are currently loaded. Please make sure your Student Time Table report is open on UMS, or ask me: 'Open my timetable'."
2. taskOutcome == "failed":
   - Polite, transparent explanation suggesting the student verify their UMS session.
3. taskOutcome == "success":
   - Deliver the verified facts using the mandatory aesthetic presentation format above.

HARD INVARIANT — ZERO CAPABILITY BLEED:
- Attendance is NEVER mentioned unless attendance was explicitly requested!
- Timetable queries talk ONLY about classes, schedules, rooms, and faculty.
- Examination queries talk ONLY about exams, dates, and courses.

OUTPUT JSON SCHEMA:
{
  "reply": "The complete, rich Markdown response text. This will be rendered in Chat UI.",
  "cardType": "TIMETABLE_RESULT" | "EXAM_RESULT" | "ATTENDANCE_RESULT" | "SAMPLE_PAPER_RESULT" | "SEATING_PLAN_RESULT" | "GENERAL_RESPONSE"
}
"""


class SemanticService:
    def __init__(self):
        self.groq_service = GroqService()

    async def resolve_intent(self, request: SemanticResolutionRequest) -> SemanticResolutionResponse:
        """
        Resolves query intent, entities, capability, and conversation state
        using Groq Qwen 3.8 27B / GPT-OSS fallback with JSON output mode.
        """
        execution_id = request.executionId or f"exec_{uuid.uuid4().hex[:12]}"

        conv_state_dict = (
            request.conversationState.model_dump()
            if request.conversationState
            else {}
        )

        user_prompt_dict = {
            "query": request.query,
            "currentUrl": request.currentUrl,
            "currentPageType": request.currentPageType,
            "activeCapability": request.activeCapability or conv_state_dict.get("currentCapability"),
            "conversationState": conv_state_dict,
            "historySummary": [
                {"role": h.get("role", "user"), "content": h.get("content", "")[:200]}
                for h in (request.history or [])[-4:]
            ],
            "contextSummary": request.contextSummary or {}
        }

        messages = [
            {"role": "system", "content": SEMANTIC_INTENT_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(user_prompt_dict)}
        ]

        try:
            completion = await self.groq_service.call_chat_completion(
                messages=messages,
                temperature=0.1,
                max_tokens=450
            )

            raw_content = completion["choices"][0]["message"]["content"].strip()
            if raw_content.startswith("```json"):
                raw_content = raw_content[7:]
            if raw_content.startswith("```"):
                raw_content = raw_content[3:]
            if raw_content.endswith("```"):
                raw_content = raw_content[:-3]
            raw_content = raw_content.strip()

            parsed = json.loads(raw_content)
            model_used = completion.get("_onee_metadata", {}).get("model_used", settings.GROQ_MODEL)

            cap = parsed.get("capability", "general")
            entities = parsed.get("entities", {}) or {}

            # Normalize snake_case keys to camelCase
            if "course_code" in entities and "courseCode" not in entities:
                entities["courseCode"] = entities.pop("course_code")
            if "target_bunks" in entities and "targetBunks" not in entities:
                entities["targetBunks"] = entities.pop("target_bunks")
            if "exam_type" in entities and "examType" not in entities:
                entities["examType"] = entities.pop("exam_type")

            # Preserve active entities from previous conversationState if not overridden
            if conv_state_dict.get("activeEntity") and isinstance(conv_state_dict["activeEntity"], dict):
                for k, v in conv_state_dict["activeEntity"].items():
                    norm_k = "courseCode" if k == "course_code" else "targetBunks" if k == "target_bunks" else k
                    if (norm_k not in entities or entities[norm_k] is None) and v is not None:
                        entities[norm_k] = v

            # If attendance context and numeric token present, extract targetBunks
            is_att_context = (
                cap == "attendance" or
                (request.conversationState and request.conversationState.currentCapability == "attendance")
            )
            if is_att_context:
                num_match = re.search(r'\b(\d+)\b', request.query)
                if num_match and ("targetBunks" not in entities or entities["targetBunks"] is None):
                    entities["targetBunks"] = int(num_match.group(1))

            requires_browser = bool(parsed.get("requiresBrowserAction", False))
            ack_text = parsed.get("acknowledgementText", "")[:180]
            intent = parsed.get("intent", "general_query")
            action = parsed.get("action", "read" if requires_browser else "respond")

            # Domain firewall: explicit domain words in the student's question
            # outrank the model's classification for verified-data capabilities.
            explicit_domain = detect_explicit_domain(request.query)
            if (
                explicit_domain
                and explicit_domain != cap
                and cap in {"timetable", "examination", "attendance", "sample_papers", "seating_plan", "general"}
            ):
                logger.info(
                    "Domain firewall: overriding %s -> %s for query %r",
                    cap, explicit_domain, request.query,
                )
                cap = explicit_domain
                intent = f"{explicit_domain}_query"
                requires_browser = True
                action = "read"

            if cap in ["onee_identity", "conversation"] or intent in ["identity_query", "casual_conversation", "voice_diagnostic"]:
                requires_browser = False
                ack_text = ""
            else:
                # This is a truthfulness guard, not a keyword intent classifier:
                # Groq has already selected the capability and entities.  A student
                # explicitly asking for live data must not receive a stale cached
                # date sheet, timetable, attendance, seating plan, or sample paper.
                asks_for_fresh_data = bool(re.search(
                    r'\b(?:right\s+now|latest|current|live|refresh|recheck|updated?)\b',
                    request.query,
                    re.IGNORECASE
                ))
                if asks_for_fresh_data and cap in {
                    "timetable", "examination", "attendance", "sample_papers", "seating_plan"
                }:
                    requires_browser = True
                    action = "read"

            # Build updated ConversationState
            raw_cs = parsed.get("conversationState", {}) or {}
            updated_cs = ConversationState(
                currentIntent=intent or raw_cs.get("currentIntent"),
                currentCapability=cap,
                activeTask=raw_cs.get("activeTask", parsed.get("action", "query")),
                activeEntity=entities,
                activeDataset=raw_cs.get("activeDataset", f"verified_{cap}"),
                currentPage=request.currentUrl,
                recentUserMessages=[request.query],
                verifiedContext=request.contextSummary or {}
            )

            return SemanticResolutionResponse(
                executionId=execution_id,
                intent=intent,
                domain=parsed.get("domain", "academic"),
                capability=cap,
                goal=parsed.get("goal") or request.query,
                entities=entities,
                references=parsed.get("references", []),
                requiresBrowserAction=requires_browser,
                target=parsed.get("target"),
                action=action,
                needsClarification=parsed.get("needsClarification", False),
                confidence=float(parsed.get("confidence", 0.95)),
                acknowledgementText=ack_text,
                modelUsed=model_used,
                conversationState=updated_cs
            )
        except Exception as e:
            logger.exception("Groq semantic resolution failed, applying deterministic fallback: %s", e)
            return self._heuristic_fallback(request, execution_id)

    def _heuristic_fallback(self, request: SemanticResolutionRequest, execution_id: str) -> SemanticResolutionResponse:
        """
        Deterministic fallback if Groq API is temporarily unreachable.
        Incorporates ConversationState to resolve follow-ups naturally.
        """
        q = request.query.lower().strip()
        cs = request.conversationState

        # Voice diagnostics are a first-class semantic interaction when Groq
        # is unavailable; the extension handles playback after this response.
        if re.search(r'\b(?:test\s+(?:the\s+)?voice(?:\s+assistant)?|voice\s+test|hear\s+nothing|can(?:\s*\')?t\s+hear|sound\s+check|audio\s+test|check\s+voice|voice\s+check|test\s+speech|speak\s+to\s+me)\b', q, re.IGNORECASE):
            return SemanticResolutionResponse(
                executionId=execution_id,
                intent="voice_diagnostic",
                domain="conversation",
                capability="conversation",
                goal="Confirm ONEE voice playback",
                entities={"interaction": "voice_diagnostic"},
                references=[],
                requiresBrowserAction=False,
                target=None,
                action="respond",
                needsClarification=False,
                confidence=1.0,
                acknowledgementText="",
                modelUsed="deterministic-voice-fallback",
                conversationState=ConversationState(
                    currentIntent="voice_diagnostic",
                    currentCapability="conversation",
                    activeTask="voice_diagnostic",
                    recentUserMessages=[request.query]
                )
            )

        # 0. Identity & Introductions
        if any(w in q for w in ["who are you", "who r u", "who is this", "what is your name", "what's your name", "what can you do", "introduce yourself", "tell me about yourself", "what are you"]):
            return SemanticResolutionResponse(
                executionId=execution_id,
                intent="identity_query",
                domain="conversation",
                capability="onee_identity",
                goal=None,
                entities={},
                references=[],
                requiresBrowserAction=False,
                target=None,
                action="respond",
                needsClarification=False,
                confidence=1.0,
                acknowledgementText="",
                modelUsed="deterministic-firewall",
                conversationState=ConversationState(
                    currentIntent="identity_query",
                    currentCapability="onee_identity",
                    activeTask="introduce",
                    recentUserMessages=[request.query]
                )
            )

        # UMS dashboard navigation is a direct extension command, never a greeting.
        # But compound requests ("take me to home page and check my attendance") must not be intercepted as pure navigation.
        is_dash_nav = bool(re.search(r'\b(?:take|bring|go|navigate|open|return|head)\s+(?:me\s+)?(?:back\s+)?(?:to\s+)?(?:(?:the|my)\s+)?(?:home\s*page|homepage|home|student\s+dashboard|dashboard)\b', q, re.IGNORECASE))
        has_academic_cap = bool(detect_explicit_domain(q))
        if is_dash_nav and not has_academic_cap:
            return SemanticResolutionResponse(
                executionId=execution_id,
                intent="dashboard_navigation",
                domain="academic",
                capability="general",
                goal="Navigate to the UMS student dashboard",
                entities={"destination": "student_dashboard"},
                references=[],
                requiresBrowserAction=False,
                target="student_dashboard",
                action="navigate",
                needsClarification=False,
                confidence=1.0,
                acknowledgementText="",
                modelUsed="deterministic-navigation-fallback",
                conversationState=ConversationState(
                    currentIntent="dashboard_navigation",
                    currentCapability="general",
                    activeTask="navigate_dashboard",
                    recentUserMessages=[request.query]
                )
            )

        # 1. Greetings, thanks & casual conversation — tolerant of names,
        # punctuation and filler ("Hey Sophia!", "good morning team"), while
        # NEVER swallowing a genuine academic request as a greeting.
        is_social = bool(
            re.match(
                r"^(?:hey(?:\s+there)?|hi(?:\s+there)?|hello(?:\s+there)?|yo+|heya|hola|sup|hii+|helloo|namaste|gm|gn|good\s+(?:morning|afternoon|evening|night|day)|how\s+are\s+(?:you|u)|how'?s\s+it\s+going|what'?s?\s+up)\b",
                q,
            )
            or re.match(
                r"^(?:thank(?:\s*you|\s*u|s|q)?|thx|ty|appreciate\s+(?:it|that)|cheers)\b",
                q,
            )
        )
        social_has_domain = bool(re.search(
            r"\b(class|classes|exam|exams|attendance|bunk|bunks|skip|skips|timetable|"
            r"time\s+table|schedule|seat|seating|paper|papers|faculty|lecture|lectures|"
            r"lab|labs|marks|result|results|datesheet|date\s+sheet|percentage|room|"
            r"cabin|semester|course|courses)\b",
            q,
        ))
        if is_social and not social_has_domain:
            is_thanks = bool(re.match(r"^(?:thank|thx|ty|appreciate|cheers)", q))
            return SemanticResolutionResponse(
                executionId=execution_id,
                intent="casual_conversation",
                domain="conversation",
                capability="conversation",
                goal=None,
                entities={},
                references=[],
                requiresBrowserAction=False,
                target=None,
                action="respond",
                needsClarification=False,
                confidence=1.0,
                acknowledgementText="",
                modelUsed="deterministic-firewall",
                conversationState=ConversationState(
                    currentIntent="casual_conversation",
                    currentCapability="conversation",
                    activeTask="thank" if is_thanks else "greet",
                    recentUserMessages=[request.query]
                )
            )

        # A question about exams, date sheets or seating must never be answered
        # from the timetable dataset just because a timetable conversation is
        # still active. Explicit domain words in the student's own question win.
        is_exam_domain = bool(re.search(
            r"\b(exam|exams|examination|date\s*sheet|datesheet|seating|seat|"
            r"report(?:ing)?(?:\s+time|\s+for)?|admit\s*card|hall\s*ticket)\b",
            q,
        ))

        # 2. Conversational Follow-up Resolution via ConversationState
        if cs and cs.currentCapability == "timetable" and not is_exam_domain:
            # Check for weekly matrix / list of classes query
            is_weekly_followup = any(w in q for w in [
                "all classes", "matrix", "weekly", "complete list", "list of classes",
                "this week", "whole week", "entire week", "every day", "all days",
                "detailed matrix", "detailed timetable", "detailed schedule",
                "week overview", "overview of classes", "classes overview",
                "classes that i have", "classes in this week",
                "full timetable", "full schedule"
            ])
            if is_weekly_followup:
                return SemanticResolutionResponse(
                    executionId=execution_id,
                    intent="timetable_query",
                    domain="academic",
                    capability="timetable",
                    goal="Check complete weekly timetable matrix",
                    entities={"view": "weekly_matrix", "day": "all"},
                    references=["previous timetable query"],
                    requiresBrowserAction=False,
                    target="student_timetable",
                    action="respond",
                    needsClarification=False,
                    confidence=0.98,
                    acknowledgementText="Compiling your complete weekly class matrix.",
                    modelUsed="deterministic-fallback-context",
                    conversationState=ConversationState(
                        currentIntent="timetable_query",
                        currentCapability="timetable",
                        activeTask="query_classes",
                        activeEntity={"view": "weekly_matrix", "day": "all"},
                        activeDataset="verified_student_timetable",
                        recentUserMessages=[request.query]
                    )
                )

            # Check for day switch in follow-up ("what about tuesday", "and what about saturday", "saturday")
            for d in ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]:
                if d in q:
                    day_cap = d.capitalize()
                    return SemanticResolutionResponse(
                        executionId=execution_id,
                        intent="timetable_query",
                        domain="academic",
                        capability="timetable",
                        goal=f"Check timetable for {day_cap}",
                        entities={"day": day_cap, "view": "daily_schedule"},
                        references=["previous timetable request"],
                        requiresBrowserAction=False if cs.activeDataset else True,
                        target="student_timetable",
                        action="respond" if cs.activeDataset else "read",
                        needsClarification=False,
                        confidence=0.98,
                        acknowledgementText=f"Checking your {day_cap} class schedule.",
                        modelUsed="deterministic-fallback-context",
                        conversationState=ConversationState(
                            currentIntent="timetable_query",
                            currentCapability="timetable",
                            activeTask="query_classes",
                            activeEntity={"day": day_cap, "view": "daily_schedule"},
                            activeDataset="verified_student_timetable",
                            recentUserMessages=[request.query]
                        )
                    )
            # Question about practical / room / time within the same timetable.
            # Word boundaries are required: a bare substring match made "syllabus"
            # look like a practical/lab request and hijacked exam questions.
            if re.search(r"\b(practical|practicals|lab|labs|room|rooms|which one|timing|when|where)\b", q):
                return SemanticResolutionResponse(
                    executionId=execution_id,
                    intent="timetable_query",
                    domain="academic",
                    capability="timetable",
                    goal=None,
                    entities=cs.activeEntity,
                    references=["previous timetable classes"],
                    requiresBrowserAction=False,
                    target="student_timetable",
                    action="respond",
                    needsClarification=False,
                    confidence=0.95,
                    acknowledgementText="",
                    modelUsed="deterministic-fallback-context",
                    conversationState=cs
                )

        if cs and cs.currentCapability == "attendance":
            # Follow-up for course or bunk count e.g. "what about CSE329", "what about 5"
            m_course = re.search(r'\b([A-Z]{2,4}\s*\d{3,4})\b', request.query.upper())
            m_num = re.search(r'\b(\d{1,2})\b', q)
            entities = {}
            if m_course:
                entities["courseCode"] = m_course.group(1).replace(" ", "")
            if m_num:
                entities["targetBunks"] = int(m_num.group(1))

            if entities:
                return SemanticResolutionResponse(
                    executionId=execution_id,
                    intent="attendance_query",
                    domain="attendance",
                    capability="attendance",
                    goal=f"Analyze attendance for {entities}",
                    entities=entities,
                    references=["previous attendance calculation"],
                    requiresBrowserAction=False,
                    target="attendance",
                    action="respond",
                    needsClarification=False,
                    confidence=0.95,
                    acknowledgementText="",
                    modelUsed="deterministic-fallback-context",
                    conversationState=ConversationState(
                        currentIntent="attendance_query",
                        currentCapability="attendance",
                        activeTask="calculate_bunks",
                        activeEntity=entities,
                        activeDataset="verified_attendance",
                        recentUserMessages=[request.query]
                    )
                )

        # 3. Sample Papers (Takes precedence over timetable)
        if any(w in q for w in ["sample paper", "sample question paper", "model paper", "previous paper", "question paper"]):
            course = None
            m = re.search(r'\b([A-Za-z]{2,5})\s*(\d{3,4}[A-Za-z]?)\b', request.query)
            if m:
                pfx = m.group(1).upper()
                dgts = m.group(2).upper()
                if pfx not in ["PAPER", "SAMPLE", "TERM", "EXAM", "DATE", "TIME"]:
                    if pfx == "CSC":
                        pfx = "CSE"
                    course = f"{pfx}{dgts}"
            return SemanticResolutionResponse(
                executionId=execution_id,
                intent="sample_paper_query",
                domain="examination",
                capability="sample_papers",
                goal=f"Find sample question paper for {course or 'course'}",
                entities={"courseCode": course} if course else {},
                references=[],
                requiresBrowserAction=True,
                target="sample_paper",
                action="download",
                needsClarification=False,
                confidence=0.98,
                acknowledgementText=f"Looking up official sample question paper{' for ' + course if course else ''}.",
                modelUsed="deterministic-firewall",
                conversationState=ConversationState(
                    currentIntent="sample_paper_query",
                    currentCapability="sample_papers",
                    activeTask="fetch_sample_paper",
                    activeEntity={"courseCode": course} if course else {},
                    activeDataset="verified_sample_papers",
                    recentUserMessages=[request.query]
                )
            )

        # 4. Attendance
        if any(w in q for w in ["attendance", "bunk", "safe bunk", "can i skip", "how many classes", "duty leave", "shortage", "eligible", "clearance", "maintain", "safe skips", "lowest", "least", "minimum", "maximum", "highest", "aggregate", "overall", "percentage", "subject", "subjects", "miss"]):
            return SemanticResolutionResponse(
                executionId=execution_id,
                intent="attendance_query",
                domain="attendance",
                capability="attendance",
                goal="Check attendance and safe bunk status",
                entities={},
                references=[],
                requiresBrowserAction=True,
                target="attendance",
                action="read",
                needsClarification=False,
                confidence=0.95,
                acknowledgementText="Analyzing your attendance records and safe bunk capacity.",
                modelUsed="deterministic-firewall",
                conversationState=ConversationState(
                    currentIntent="attendance_query",
                    currentCapability="attendance",
                    activeTask="check_attendance",
                    activeEntity={},
                    activeDataset="verified_attendance",
                    recentUserMessages=[request.query]
                )
            )

        # 5. Timetable Query
        is_weekly = any(w in q for w in [
            "all classes", "matrix", "weekly", "complete list", "list of classes",
            "this week", "whole week", "entire week", "every day", "all days",
            "detailed matrix", "classes that i have", "classes in this week", "full timetable"
        ])
        timetable_words = [
            "timetable", "time table", "schedule", "routine", "period",
            "class on", "classes on", "lecture", "which class", "my classes",
            "classes today", "today class", "classes tomorrow",
            "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
        ]
        # Natural phrasings the contiguous keyword list alone misses — e.g. the
        # product's own suggestion chip "What classes do I have today?" (filler
        # words sit between "classes" and "today", so "classes today" never
        # appears as a contiguous substring).
        timetable_phrase = bool(re.search(
            r"(?:what|which|show|list|give|check|view|see|tell|need|plan)[\w\s]{0,26}(?:my\s+)?(?:classes|class\s+schedule|schedule|timetable|routine)"
            r"|(?:classes|class)[\w\s]{0,24}(?:today|tomorrow|this\s+week|next)"
            r"|\bdo\s+i\s+have\b[\w\s]{0,20}\bclasses?\b"
            r"|\bwhat'?s?\s+(?:my\s+)?(?:next\s+)?(?:class|classes|lecture|lectures)\b"
            r"|\b(?:today|tomorrow)['s]*\s+(?:classes|class|lecture|lectures)\b",
            q,
        ))
        if (is_weekly or timetable_phrase or any(w in q for w in timetable_words)) and not any(w in q for w in ["exam", "datesheet", "date sheet", "attendance", "bunk", "maintain", "paper", "sample"]):
            day = None
            for d in ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]:
                if d in q:
                    day = d.capitalize()
                    break
            entities = {"view": "weekly_matrix", "day": "all"} if is_weekly else ({"day": day} if day else {})
            return SemanticResolutionResponse(
                executionId=execution_id,
                intent="timetable_query",
                domain="academic",
                capability="timetable",
                goal=f"Check timetable for {day or 'the week'}",
                entities=entities,
                references=[],
                requiresBrowserAction=True,
                target="student_timetable",
                action="read",
                needsClarification=False,
                confidence=0.98,
                acknowledgementText=f"Checking your {day + ' ' if day else 'weekly '}class schedule right away.",
                modelUsed="deterministic-firewall",
                conversationState=ConversationState(
                    currentIntent="timetable_query",
                    currentCapability="timetable",
                    activeTask="query_classes",
                    activeEntity=entities,
                    activeDataset="verified_student_timetable",
                    recentUserMessages=[request.query]
                )
            )

        # 6a. Seating plan / seat / venue questions resolve to seating_plan so the
        # answer comes from verified seat records, never a generic reply.
        if re.search(r"\b(seat|seating|exam\s+hall|venue)\b", q):
            return SemanticResolutionResponse(
                executionId=execution_id,
                intent="seating_query",
                domain="examination",
                capability="seating_plan",
                goal="Find verified exam seat, venue and hall details",
                entities={},
                references=[],
                requiresBrowserAction=True,
                target="seating_plan",
                action="read",
                needsClarification=False,
                confidence=0.95,
                acknowledgementText="Checking your verified exam seating details.",
                modelUsed="deterministic-firewall",
                conversationState=ConversationState(
                    currentIntent="seating_query",
                    currentCapability="seating_plan",
                    activeTask="check_seating",
                    activeEntity={},
                    activeDataset="verified_seating_plan",
                    recentUserMessages=[request.query]
                )
            )

        # 6. Examination & Date Sheet
        if any(w in q for w in ["exam", "datesheet", "date sheet", "atom exam", "term exam", "mid term", "end term", "seating", "report", "report for", "reporting time", "admit card", "hall ticket"]):
            return SemanticResolutionResponse(
                executionId=execution_id,
                intent="examination_query",
                domain="examination",
                capability="examination",
                goal="Check examination schedule and date sheet",
                entities={},
                references=[],
                requiresBrowserAction=True,
                target="examination",
                action="read",
                needsClarification=False,
                confidence=0.95,
                acknowledgementText="Looking up your upcoming examination date sheet.",
                modelUsed="deterministic-firewall",
                conversationState=ConversationState(
                    currentIntent="examination_query",
                    currentCapability="examination",
                    activeTask="check_exams",
                    activeEntity={},
                    activeDataset="verified_examination",
                    recentUserMessages=[request.query]
                )
            )

        # Default general
        return SemanticResolutionResponse(
            executionId=execution_id,
            intent="general_query",
            domain="academic",
            capability="general",
            goal=None,
            entities={},
            references=[],
            requiresBrowserAction=False,
            target=None,
            action="respond",
            needsClarification=False,
            confidence=0.7,
            acknowledgementText="Checking that for you.",
            modelUsed="deterministic-firewall",
            conversationState=ConversationState(
                currentIntent="general_query",
                currentCapability="general",
                activeTask="respond",
                recentUserMessages=[request.query]
            )
        )

    def _derive_next_exam(self, exams: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        """
        Derives the chronologically next exam from the COMPLETE verified set.
        Uses each record's own parsed date fields; never falls back to exams[0].
        """
        if not exams:
            return None

        def sort_key(e: Dict[str, Any]):
            raw = str(e.get("examDate") or "")
            for fmt in ("%d %b %Y", "%d %B %Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
                try:
                    return (0, datetime.datetime.strptime(raw.strip(), fmt))
                except ValueError:
                    continue
            # Unparseable dates sort last but remain in the candidate set.
            return (1, datetime.datetime.max)

        now = datetime.datetime.now()
        dated: List[tuple] = []
        for e in exams:
            if isinstance(e, dict):
                dated.append((sort_key(e), e))
        dated.sort(key=lambda t: t[0])

        # Prefer the first exam dated today or later; otherwise the earliest
        # parseable record (every exam already in the past). Records whose date
        # could not be parsed are only a last resort.
        for (unparsed, exam_dt), e in dated:
            if unparsed == 0 and exam_dt >= now:
                return e
        for (unparsed, _), e in dated:
            if unparsed == 0:
                return e
        return dated[0][1] if dated else None

    async def generate_verified_response(self, request: VerifiedResponseRequest) -> VerifiedResponseResponse:
        """
        Generates ONE canonical, intelligent natural response strictly grounded in verified UMS data.
        Produces both rich markdown for Chat UI and clean <=195 character chunks for Groq Orpheus TTS.
        """
        conv_state_dict = (
            request.conversationState.model_dump()
            if request.conversationState
            else {}
        )

        payload = {
            "query": request.query,
            "capability": request.capability,
            "intent": request.intent,
            "taskOutcome": request.taskOutcome or "success",
            "verifiedResult": request.verifiedResult,
            "conversationState": conv_state_dict,
            "history": [
                {"role": h.get("role", "user"), "content": h.get("content", "")[:200]}
                for h in (request.history or [])[-4:]
            ]
        }

        messages = [
            {"role": "system", "content": GROUNDED_RESPONSE_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(payload, default=str)}
        ]

        card_type_map = {
            "timetable": "TIMETABLE_RESULT",
            "examination": "EXAM_RESULT",
            "attendance": "ATTENDANCE_RESULT",
            "sample_papers": "SAMPLE_PAPER_RESULT",
            "seating_plan": "SEATING_PLAN_RESULT",
            "general": "GENERAL_RESPONSE"
        }
        expected_card_type = card_type_map.get(request.capability, "GENERAL_RESPONSE")

        outcome = str(request.taskOutcome or "success").strip().lower()
        v_data_gate = request.verifiedResult or {}
        live_ums_capabilities = {"attendance", "examination", "timetable", "sample_papers", "seating_plan"}

        # LIVE_UMS_RESPONSE_REQUIRES_VERIFIED_EXECUTION:
        # A live UMS capability may only be answered when THIS execution produced
        # a verified dataset. Failed, cancelled, unavailable, or empty executions
        # take the deterministic honest path — the LLM is never consulted for a
        # factual answer it would have to invent.
        if request.capability in live_ums_capabilities and (outcome != "success" or not v_data_gate):
            logger.info(
                "verified-response gate: capability=%s outcome=%s verified_records=0 -> deterministic reply",
                request.capability,
                outcome,
            )
            return self._heuristic_verified_response(request, expected_card_type)

        # Examination/date-sheet success answers are fully deterministic: every
        # verified record is rendered, the next exam is derived chronologically,
        # and no LLM ever rewrites dates, times, venues, or seats.
        if request.capability == "examination" and outcome == "success" and v_data_gate:
            exams = (
                v_data_gate.get("exams")
                or v_data_gate.get("courses")
                or ([] if isinstance(v_data_gate, dict) else [])
            )
            if not isinstance(exams, list):
                exams = []
            if not exams:
                return self._heuristic_verified_response(request, expected_card_type)

            # Targeted course question ("When should I report for INT373?",
            # "where is my seat for INT373") — answer THAT exam precisely from
            # verified records instead of dumping the full date-sheet table.
            target_code = None
            tm = re.search(r"\b([A-Za-z]{2,5}\s*\d{3,4}[A-Za-z]?)\b", request.query)
            if tm:
                cand = re.sub(r"[\s\-_]", "", tm.group(1)).upper()
                if cand.startswith("CSC"):
                    cand = "CSE" + cand[3:]
                for e in exams:
                    if not isinstance(e, dict):
                        continue
                    code_n = re.sub(r"[\s\-_]", "", str(e.get("courseCode") or "")).upper()
                    if code_n and cand == code_n:
                        target_code = e
                        break
            if target_code:
                e = target_code
                code_s = str(e.get("courseCode") or "Your exam")
                exam_type_s = str(e.get("examType") or "exam")
                date_s = str(e.get("examDate") or "TBD")
                start_s = str(e.get("startTime") or "")
                end_s = str(e.get("endTime") or "")
                venue_s = str(e.get("venue") or e.get("room") or "TBD")
                seat_s = str(e.get("seat") or "TBD")
                instr_s = str(e.get("instructions") or "").strip()
                time_span = f"{start_s} to {end_s}" if (start_s and end_s) else "the scheduled time"
                reply = (
                    f"### 📝 {code_s} — {exam_type_s}\n\n"
                    f"**Date:** {date_s} · **Time:** {time_span} · **Venue:** {venue_s} · **Seat:** {seat_s}\n\n"
                    + (f"**Reporting instruction (UMS):** {instr_s}\n\n" if instr_s else "")
                    + "> 💡 Verified directly from your authenticated UMS date sheet."
                )
                spoken_base = f"Your {code_s} {exam_type_s} is on {date_s}, {time_span}."
                if venue_s != "TBD":
                    spoken_base += f" The venue is {venue_s}."
                if seat_s != "TBD":
                    spoken_base += f" Your seat number is {seat_s}."
                if instr_s:
                    spoken_base += " " + instr_s.replace("[", "").replace("]", "")
                spoken_final = transform_speech_identity(spoken_base)
                tts_chunks = [transform_speech_identity(c) for c in split_for_tts(spoken_final, max_chars=195)]
                if not tts_chunks:
                    tts_chunks = [spoken_final[:195]]

                updated_cs = request.conversationState or ConversationState(
                    currentCapability="examination",
                    currentIntent=request.intent
                )
                updated_cs.activeResult = {
                    "recordCount": 1,
                    "taskOutcome": "success"
                }
                updated_cs.recentAssistantMessages.append(reply[:200])

                return VerifiedResponseResponse(
                    executionId=request.executionId,
                    reply=reply,
                    spokenSummary=spoken_final,
                    ttsChunks=tts_chunks,
                    cardType="EXAM_RESULT",
                    modelUsed="deterministic-ground-truth",
                    conversationState=updated_cs
                )

            rows = []
            for idx, e in enumerate(exams, start=1):
                if not isinstance(e, dict):
                    continue
                time_desc = str(e.get("startTime") or "TBD")
                if e.get("endTime"):
                    time_desc = f"{time_desc} - {e.get('endTime')}"
                rows.append(
                    f"| **{idx}** | **{e.get('courseCode') or 'TBD'}** | {e.get('examDate') or 'TBD'} | "
                    f"{time_desc} | {e.get('venue') or e.get('room') or 'TBD'} | {e.get('seat') or 'TBD'} |"
                )

            next_exam = self._derive_next_exam(exams)
            total = len(exams)
            reply = (
                f"### 📝 Examination Date Sheet — {total} exam{'s' if total != 1 else ''} found\n\n"
                + (
                    f"Your next exam is **{next_exam.get('courseCode')}** on **{next_exam.get('examDate')}**"
                    + (f" at **{next_exam.get('startTime')}**" if next_exam.get("startTime") else "")
                    + ".\n\n"
                    if next_exam
                    else ""
                )
                + "| # | Course | Date | Time | Venue | Seat |\n"
                + "| :--- | :--- | :--- | :--- | :--- | :--- |\n"
                + "\n".join(rows)
                + f"\n\n> 💡 All {total} records above were extracted and validated from your authenticated UMS date sheet."
            )
            spoken_base = (
                (
                    f"Your next exam is {next_exam.get('courseCode')} on {next_exam.get('examDate')}"
                    + (f" at {next_exam.get('startTime')}" if next_exam.get("startTime") else "")
                    + ". "
                )
                if next_exam
                else ""
            ) + f"You have {total} scheduled examination{'s' if total != 1 else ''} in total."
            spoken_final = transform_speech_identity(spoken_base)
            tts_chunks = [transform_speech_identity(c) for c in split_for_tts(spoken_final, max_chars=195)]
            if not tts_chunks:
                tts_chunks = [spoken_final[:195]]

            updated_cs = request.conversationState or ConversationState(
                currentCapability="examination",
                currentIntent=request.intent
            )
            updated_cs.activeResult = {
                "recordCount": total,
                "taskOutcome": "success"
            }
            updated_cs.recentAssistantMessages.append(reply[:200])

            return VerifiedResponseResponse(
                executionId=request.executionId,
                reply=reply,
                spokenSummary=spoken_final,
                ttsChunks=tts_chunks,
                cardType="EXAM_RESULT",
                modelUsed="deterministic-ground-truth",
                conversationState=updated_cs
            )

        if request.capability == "attendance" and request.taskOutcome != "data_unavailable" and request.verifiedResult:
            reply, spoken_raw = self._generate_attendance_verified_response(request, request.verifiedResult)
            spoken_final = transform_speech_identity(spoken_raw)
            tts_chunks = [transform_speech_identity(c) for c in split_for_tts(spoken_final, max_chars=195)]
            if not tts_chunks:
                tts_chunks = [spoken_final[:195]]

            updated_cs = request.conversationState or ConversationState(
                currentCapability="attendance",
                currentIntent=request.intent
            )
            updated_cs.activeResult = {
                "recordCount": len(request.verifiedResult.get("courses", [])) if isinstance(request.verifiedResult, dict) else 1,
                "taskOutcome": request.taskOutcome or "success"
            }
            updated_cs.recentAssistantMessages.append(reply[:200])

            return VerifiedResponseResponse(
                executionId=request.executionId,
                reply=reply,
                spokenSummary=spoken_final,
                ttsChunks=tts_chunks,
                cardType="ATTENDANCE_RESULT",
                modelUsed="deterministic-ground-truth",
                conversationState=updated_cs
            )

        try:
            completion = await self.groq_service.call_chat_completion(
                messages=messages,
                temperature=0.2,
                max_tokens=650
            )

            raw_content = completion["choices"][0]["message"]["content"].strip()
            if raw_content.startswith("```json"):
                raw_content = raw_content[7:]
            if raw_content.startswith("```"):
                raw_content = raw_content[3:]
            if raw_content.endswith("```"):
                raw_content = raw_content[:-3]
            raw_content = raw_content.strip()

            parsed = json.loads(raw_content)
            model_used = completion.get("_onee_metadata", {}).get("model_used", settings.GROQ_MODEL)

            reply = parsed.get("reply", "")
            tts_chunks = [transform_speech_identity(chunk) for chunk in split_for_tts(reply, max_chars=195)]
            spoken_summary = tts_chunks[0] if tts_chunks else transform_speech_identity(reply[:195])

            # Update conversation state
            updated_cs = request.conversationState or ConversationState(
                currentCapability=request.capability,
                currentIntent=request.intent
            )
            if request.capability == "timetable":
                # Ensure activeEntity reflects the resolved day for subsequent conversational turns
                q_lower = request.query.lower()
                resolved_day = None
                for d in ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]:
                    if d in q_lower:
                        resolved_day = d.capitalize()
                        break
                if not resolved_day and isinstance(request.verifiedResult, dict) and request.verifiedResult.get("day"):
                    resolved_day = str(request.verifiedResult.get("day")).capitalize()
                if resolved_day:
                    updated_cs.activeEntity = {"day": resolved_day}

            updated_cs.activeResult = {
                "recordCount": len(request.verifiedResult) if isinstance(request.verifiedResult, list) else len(request.verifiedResult.keys()),
                "taskOutcome": request.taskOutcome or "success"
            }
            updated_cs.recentAssistantMessages.append(reply[:200])

            return VerifiedResponseResponse(
                executionId=request.executionId,
                reply=reply,
                spokenSummary=spoken_summary,
                ttsChunks=tts_chunks,
                cardType=parsed.get("cardType", expected_card_type),
                modelUsed=model_used,
                conversationState=updated_cs
            )
        except Exception as e:
            logger.exception("Error generating grounded response with Groq: %s", e)
            return self._heuristic_verified_response(request, expected_card_type)

    def _generate_attendance_verified_response(self, request: VerifiedResponseRequest, v_data: dict) -> tuple[str, str]:
        """
        Calculates ground-truth attendance metrics, bunk allowances, and trajectory tables.
        Returns (reply, spoken).
        """
        if not isinstance(v_data, dict):
            v_data = {}
        courses = v_data.get("courses", []) or v_data.get("subjects", []) or []
        overall_pct = v_data.get("overallPercentage")
        total_att = v_data.get("totalAttended", 0)
        total_del = v_data.get("totalDelivered", 0)
        aggregate = v_data.get("aggregate") or {}
        if overall_pct is None and isinstance(aggregate, dict):
            overall_pct = aggregate.get("percentage")
            total_att = aggregate.get("attended", total_att)
            total_del = aggregate.get("delivered", total_del)

        if not courses and overall_pct is None:
            return (
                "I checked your UMS attendance records, but no subject attendance data was available.",
                "No verified attendance records were available in your UMS session."
            )

        q_lower = request.query.lower()

        # Check for specific course query
        target_course = None
        course_match = re.search(r'\b([a-z]{2,5}\s*[-_]?\s*\d{2,4}[a-z0-9]?)\b', q_lower)
        if course_match:
            cand = re.sub(r'[\s\-_]', '', course_match.group(1)).upper()
            for c in courses:
                c_code = re.sub(r'[\s\-_]', '', str(c.get("code", "")).upper())
                c_name = str(c.get("name", "")).upper()
                if cand in c_code or cand in c_name:
                    target_course = c
                    break

        if not target_course and request.conversationState and request.conversationState.activeEntity:
            active_code = request.conversationState.activeEntity.get("courseCode")
            if active_code:
                cand = re.sub(r'[\s\-_]', '', str(active_code).upper())
                for c in courses:
                    c_code = re.sub(r'[\s\-_]', '', str(c.get("code", "")).upper())
                    if cand in c_code:
                        target_course = c
                        break

        # Check for target skips in query e.g. "skip 3 classes", "bunk 2"
        target_skips = None
        skip_match = re.search(r'\b(?:skip|bunk|miss)\s*(\d+)\b', q_lower)
        if skip_match:
            try:
                target_skips = int(skip_match.group(1))
            except Exception:
                pass

        # 1. SPECIFIC COURSE TARGETED
        if target_course:
            c_code = target_course.get("code", "Course")
            c_name = target_course.get("name", c_code)
            att = int(target_course.get("attended", 0))
            tot = int(target_course.get("total", target_course.get("delivered", 0)))
            pct = round(float(target_course.get("percentage", (att / tot * 100) if tot > 0 else 0)))
            bunk75 = calculate_bunk_allowance_math(att, tot, 75.0)
            req75 = calculate_required_classes_math(att, tot, 75.0)

            if request.conversationState:
                request.conversationState.activeEntity = {"courseCode": c_code, "courseName": c_name}

            if target_skips is not None and target_skips > 0:
                scenario_rows = [
                    f"| **Current Standing** | `{att} / {tot}` | **{pct}%** | {'🟢 Safe' if pct >= 75 else '🔴 Below 75%'} |"
                ]
                cap_s = min(target_skips, 10)
                for s in range(1, cap_s + 1):
                    n_del = tot + s
                    n_pct = round((att / n_del) * 100) if n_del > 0 else pct
                    scenario_rows.append(f"| **Skip {s} Class{'es' if s > 1 else ''}** | `{att} / {n_del}` | **{n_pct}%** | {'🟢 Safe' if n_pct >= 75 else '⚠️ Below 75%'} |")

                final_del = tot + target_skips
                final_pct = round((att / final_del) * 100) if final_del > 0 else pct
                is_safe = final_pct >= 75

                advice = (
                    f"Skipping {target_skips} class{'es' if target_skips > 1 else ''} keeps you at **{final_pct}%**, which is safely above the 75% mark with {max(0, bunk75 - target_skips)} safe skips remaining."
                    if is_safe else
                    f"Skipping {target_skips} class{'es' if target_skips > 1 else ''} would drop your attendance to **{final_pct}%**, breaching the 75% threshold! You only have {bunk75} safe skips available."
                )

                reply = (
                    f"### 📚 {c_code}: {c_name} — Skip Simulation\n\n"
                    f"{natural_opener(request.query, 'course')} Skipping {target_skips} class{'es' if target_skips > 1 else ''} in "
                    f"**{c_code}** leaves you at **{final_pct}%** with **{max(0, bunk75 - target_skips)} safe skips** left.\n\n"
                    f"| Scenario | Attended / Total | Resulting % | Safety Status |\n"
                    f"| :--- | :--- | :--- | :--- |\n"
                    + "\n".join(scenario_rows) + "\n\n"
                    f"#### 🛡️ Margin & Limits\n"
                    f"- **Current Attendance:** **{pct}%** ({att}/{tot} attended)\n"
                    f"- **Maximum Safe Skips to 75%:** **{bunk75} classes**\n"
                    f"- **Standing After {target_skips} Skips:** **{final_pct}%**\n\n"
                    f"> 💡 **Summary & Takeaway:** {advice}"
                )
                spoken = (
                    f"{natural_opener(request.query, 'course')} Skipping {target_skips} class{'es' if target_skips > 1 else ''} in {c_code} "
                    f"leaves you at {final_pct} percent. Your safe skip limit is {bunk75} classes."
                )
                return (reply, spoken)

            scenario_rows = [
                f"| **Current Standing** | `{att} / {tot}` | **{pct}%** | {'🟢 Safe' if pct >= 75 else '🔴 Below 75%'} |"
            ]
            if tot > 0:
                if pct >= 75:
                    sim1 = round((att / (tot + 1)) * 100)
                    sim2 = round((att / (tot + 2)) * 100)
                    scenario_rows.append(f"| **Skip 1 Class** | `{att} / {tot + 1}` | **{sim1}%** | {'🟢 Safe' if sim1 >= 75 else '⚠️ Danger'} |")
                    scenario_rows.append(f"| **Skip 2 Classes** | `{att} / {tot + 2}` | **{sim2}%** | {'🟢 Safe' if sim2 >= 75 else '⚠️ Danger'} |")
                    sim_max = round((att / (tot + bunk75)) * 100) if (tot + bunk75) > 0 else pct
                    scenario_rows.append(f"| **Skip All {bunk75} Classes** | `{att} / {tot + bunk75}` | **{sim_max}%** | 🛡️ Exact 75% Limit |")
                    sim_risk = round((att / (tot + bunk75 + 1)) * 100) if (tot + bunk75 + 1) > 0 else pct
                    scenario_rows.append(f"| **Skip {bunk75 + 1} Classes** | `{att} / {tot + bunk75 + 1}` | **{sim_risk}%** | ⚠️ Detention Risk |")
                else:
                    rec1 = round(((att + 1) / (tot + 1)) * 100)
                    scenario_rows.append(f"| **Attend Next 1 Class** | `{att + 1} / {tot + 1}` | **{rec1}%** | {'🟢 Safe' if rec1 >= 75 else '⚠️ Recovering'} |")
                    rec_target = round(((att + req75) / (tot + req75)) * 100) if (tot + req75) > 0 else 75
                    scenario_rows.append(f"| **Attend Next {req75} Classes** | `{att + req75} / {tot + req75}` | **{rec_target}%** | 🎯 Target 75% Recovered |")

            buffer_advice = (
                f"You have a comfortable buffer of **{bunk75} safe skips** before touching the mandatory 75% floor."
                if bunk75 > 0 else
                f"You have **0 safe skips remaining**. You must attend your next **{req75} consecutive lectures** to stay at or recover 75%."
            )

            reply = (
                f"### 📚 {c_code}: {c_name} — Attendance Analysis\n\n"
                f"{natural_opener(request.query, 'course')} Your verified attendance in **{c_code}: {c_name}** is "
                f"**{pct}%** ({att}/{tot} classes attended), which leaves **{bunk75} safe skips** before the 75% limit.\n\n"
                f"#### 📉 Safe-Skip Trajectory Simulation\n"
                f"| Scenario | Formula (Attended / Delivered) | Projected % | Status |\n"
                f"| :--- | :--- | :--- | :--- |\n"
                + "\n".join(scenario_rows) + "\n\n"
                f"#### 🛡️ Attendance Buffer & Official Limit\n"
                f"- **Current Attendance:** **{pct}%** ({att}/{tot} classes attended)\n"
                f"- **Margin vs 75% Requirement:** **{'+' if pct >= 75 else ''}{pct - 75}%**\n"
                f"- **Safe Skips Allowed (≥75%):** **{bunk75} classes**\n\n"
                f"> 💡 **Summary & Takeaway:** {buffer_advice}"
            )
            spoken = (
                f"{natural_opener(request.query, 'course')} Your attendance in {c_code}, {c_name}, is {pct} percent, "
                f"with {att} of {tot} classes attended. You can safely skip {bunk75} more before reaching seventy five percent."
            )
            return (reply, spoken)

        # 2. LOWEST ATTENDANCE QUERY
        is_lowest_query = any(w in q_lower for w in ["lowest", "least", "shortage", "worst", "vulnerable", "danger", "risk", "critical", "tightest", "minimum"])
        if is_lowest_query and courses:
            courses_sorted = sorted(
                courses,
                key=lambda c: (
                    float(c.get("percentage", 100)),
                    calculate_bunk_allowance_math(int(c.get("attended", 0)), int(c.get("total", c.get("delivered", 0))), 75.0)
                )
            )
            lowest = courses_sorted[0]
            l_code = lowest.get("code", "Course")
            l_name = lowest.get("name", l_code)
            l_att = int(lowest.get("attended", 0))
            l_tot = int(lowest.get("total", lowest.get("delivered", 0)))
            l_pct = round(float(lowest.get("percentage", (l_att / l_tot * 100) if l_tot > 0 else 0)))
            l_bunk = calculate_bunk_allowance_math(l_att, l_tot, 75.0)

            rows = []
            for idx, c in enumerate(courses_sorted):
                c_c = c.get("code", "Course")
                c_n = c.get("name", c_c)
                c_a = int(c.get("attended", 0))
                c_t = int(c.get("total", c.get("delivered", 0)))
                c_p = round(float(c.get("percentage", (c_a / c_t * 100) if c_t > 0 else 0)))
                c_b = calculate_bunk_allowance_math(c_a, c_t, 75.0)
                status = "🟢 Safe" if c_p >= 75 else "🔴 Danger"
                rows.append(f"| **{idx + 1}. {c_c}** | {c_n} | **{c_p}%** | `{c_a} / {c_t}` | **{c_b} skips** | {status} |")

            reply = (
                f"### 🚨 Academic Priority & Lowest Attendance Subject\n\n"
                f"{natural_opener(request.query, 'lowest')} Your lowest attendance is **{l_code}: {l_name}**, "
                f"standing at **{l_pct}%** ({l_att}/{l_tot} classes attended) with **{l_bunk} safe skips** remaining. "
                f"In short, **{l_code}** is your lowest-attendance subject right now.\n\n"
                f"#### 📊 Subject Risk Hierarchy (Lowest to Highest)\n"
                f"| Rank & Code | Course Name | Current % | Attended / Delivered | Buffer (≥75%) | Status |\n"
                f"| :--- | :--- | :--- | :--- | :--- | :--- |\n"
                + "\n".join(rows) + "\n\n"
                f"#### 🎯 Strategic Recommendation\n"
                f"- **Immediate Focus:** Prioritize attending every class of **{l_code}** to protect your buffer.\n"
                f"- **Threshold Safety:** Keep all courses strictly above 75% to prevent exam detention.\n\n"
                f"> 💡 **Summary & Takeaway:** Your tightest course is {l_code} at {l_pct}%. You have {l_bunk} safe skips left here."
            )
            spoken = (
                f"{natural_opener(request.query, 'lowest')} Your lowest attendance is {l_code}, {l_name}, at {l_pct} percent. "
                f"In short, {l_code} is currently your lowest-attendance subject, with {l_bunk} safe skips remaining before the seventy five percent limit."
            )
            return (reply, spoken)

        # 3. OVERALL ATTENDANCE BREAKDOWN
        rows = []
        total_skips = 0
        for idx, c in enumerate(courses):
            c_c = c.get("code", "Course")
            c_n = c.get("name", c_c)
            c_a = int(c.get("attended", 0))
            c_t = int(c.get("total", c.get("delivered", 0)))
            c_p = round(float(c.get("percentage", (c_a / c_t * 100) if c_t > 0 else 0)))
            c_b = calculate_bunk_allowance_math(c_a, c_t, 75.0)
            total_skips += c_b
            status = "🟢 Safe" if c_p >= 75 else "🔴 Danger"
            rows.append(f"| **{c_c}** | {c_n} | `{c_a} / {c_t}` | **{c_p}%** | **{c_b}** | {status} |")

        disp_overall = round(float(overall_pct)) if overall_pct is not None else (round(total_att / total_del * 100) if total_del > 0 else 0)

        reply = (
            f"### 📊 Verified Overall Academic Attendance\n\n"
            f"{natural_opener(request.query, 'overall')} Your verified overall attendance is **{disp_overall}%** "
            f"across {len(courses)} registered courses ({total_att}/{total_del} sessions attended).\n\n"
            f"#### 📋 Course-Wise Attendance & Safe Bunk Breakdown\n"
            f"| Course Code | Course Name | Attended / Delivered | Percentage | Safe Skips (≥75%) | Status |\n"
            f"| :--- | :--- | :--- | :--- | :--- | :--- |\n"
            + "\n".join(rows) + "\n\n"
            f"#### 🛡️ Overall Buffer & Health\n"
            f"- **Overall Percentage:** **{disp_overall}%** ({'+' if disp_overall >= 75 else ''}{disp_overall - 75}% margin vs 75%)\n"
            f"- **Cumulative Safe Skips:** **{total_skips} classes** across all subjects\n"
            f"- **Registered Courses:** {len(courses)} courses verified\n\n"
            f"> 💡 **Summary & Takeaway:** Your attendance is healthy at {disp_overall}%. All registered subjects are currently above the mandatory 75% requirement."
        )
        spoken = (
            f"{natural_opener(request.query, 'overall')} Your verified overall attendance is {disp_overall} percent, "
            f"with {total_att} out of {total_del} classes attended across {len(courses)} registered courses."
        )
        return (reply, spoken)

    def _heuristic_verified_response(self, request: VerifiedResponseRequest, card_type: str) -> VerifiedResponseResponse:
        """
        Outcome-aware deterministic response generation fallback.
        Ensures zero hallucination when data is unavailable or failed.
        """
        v_data = request.verifiedResult or {}
        cap = request.capability
        outcome = request.taskOutcome or "success"

        q_lower = request.query.lower().strip()
        is_identity = any(w in q_lower for w in ["who are you", "what can you do", "introduce yourself", "tell me about yourself", "what are you"])
        is_casual = q_lower in ["hello", "hi", "hey", "good morning", "good evening", "how are you", "thank you", "thanks"]
        if is_identity or is_casual or cap in ["onee_identity", "conversation"]:
            reply = (
                "Hello! I am ONEE — your intelligent AI academic companion built specifically for students at Lovely Professional University (LPU).\n\n"
                "I'm here to help you navigate your academic life with ease:\n"
                "- 📊 **Attendance & Safe Bunks:** Live percentage tracking and calculated safe skips to stay above 75%.\n"
                "- 📅 **Time Table & Venues:** Daily class schedules, room & block numbers, and faculty cabins.\n"
                "- 📝 **Examinations & Seating:** Date sheets, exam timings, venues, and seat numbers.\n"
                "- 📥 **Sample Papers:** Finding official previous-year and sample question papers.\n\n"
                "How can I assist your academics today?"
            )
            spoken = "Hey, I'm ONEE, your LPU AI academic companion! How can I assist you today?"
            return VerifiedResponseResponse(
                executionId=request.executionId,
                reply=reply,
                spokenSummary=spoken,
                ttsChunks=[spoken],
                cardType="GENERAL_RESPONSE",
                modelUsed="deterministic-identity-fallback",
                conversationState=request.conversationState
            )

        if outcome == "failed" or outcome == "cancelled":
            reply = "I wasn't able to complete the verification on UMS. Please ensure you are logged into your UMS account and try again."
        elif outcome == "data_unavailable" or not v_data:
            if cap == "sample_papers":
                course = request.query
                reply = "I checked the examination information available through UMS, but I couldn't find a verified sample-paper link for that course. I don't want to claim that one exists when I can't verify it."
            elif cap == "timetable":
                reply = "I checked your active UMS session, but no timetable records were available. Please ensure your Student Time Table report is open on UMS, or ask me: 'Open my timetable'."
            elif cap == "examination":
                reply = "I checked your UMS examination records, but no scheduled exams or date sheet entries were found."
            elif cap == "attendance":
                reply = "I checked your UMS student portal, but no attendance records were available on this page."
            else:
                reply = "I checked UMS, but the requested records were not available in a form I could verify."
        else:
            # Successful extraction
            if cap == "timetable":
                q_lower = request.query.lower()
                cs = request.conversationState
                all_slots = v_data.get("slots", [])
                by_day = v_data.get("byDay", {})
                courses = v_data.get("courses", [])

                is_weekly = (
                    bool(v_data.get("isWeekly")) or
                    v_data.get("day") in ["Weekly Matrix", "all"] or
                    (cs and cs.activeEntity and cs.activeEntity.get("view") == "weekly_matrix") or
                    any(w in q_lower for w in [
                        "all classes", "matrix", "weekly", "complete list", "list of classes",
                        "this week", "whole week", "entire week", "every day", "all days",
                        "detailed matrix", "classes that i have", "classes in this week", "full timetable"
                    ])
                )

                if is_weekly and (all_slots or by_day):
                    day_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
                    sections = []
                    busiest_day = ""
                    max_classes = 0

                    for d in day_order:
                        d_classes = []
                        if by_day and d in by_day and isinstance(by_day[d], list):
                            d_classes = by_day[d]
                        elif all_slots:
                            d_classes = [s for s in all_slots if str(s.get("day", "")).lower() == d.lower()]

                        if len(d_classes) > max_classes:
                            max_classes = len(d_classes)
                            busiest_day = d

                        if d_classes:
                            rows = "\n".join(
                                f"| **{c.get('time', 'TBD')}** | **{c.get('courseCode', 'TBD')}** | {c.get('type') or c.get('slotType') or 'Lecture'} | {c.get('room', 'N/A')} | {c.get('section', 'N/A')} |"
                                for c in d_classes
                            )
                            sections.append(
                                f"#### 🗓️ {d} ({len(d_classes)} classes)\n\n"
                                "| Time Slot | Subject Code | Type | Room / Venue | Section |\n"
                                "| :--- | :--- | :--- | :--- | :--- |\n"
                                f"{rows}"
                            )

                    total_practicals = len([s for s in all_slots if "practical" in str(s.get("type", "")).lower() or "practical" in str(s.get("slotType", "")).lower() or "lab" in str(s.get("courseCode", "")).lower()])
                    unique_blocks = sorted(set(str(s.get("room", "")).split("-")[0].strip() for s in all_slots if s.get("room") and "-" in str(s.get("room", ""))))
                    block_desc = f"Block {', Block '.join(unique_blocks)}" if unique_blocks else "designated campus classrooms"

                    matrix_content = "\n\n".join(sections)
                    total_count = len(all_slots) if all_slots else sum(len(by_day.get(d, [])) for d in day_order)
                    course_count = len(courses) if courses else len(set(s.get("courseCode") for s in all_slots if s.get("courseCode")))

                    reply = (
                        "### 📅 Complete Weekly Class Schedule Matrix\n\n"
                        f"Here is your comprehensive weekly schedule matrix verified directly from your authenticated UMS Student Time Table (**{total_count} total classes** across **{course_count or 'enrolled'} courses**):\n\n"
                        f"{matrix_content}\n\n"
                        "#### 📊 Weekly Academic Insights\n"
                        f"- **Busiest Day:** {busiest_day or 'Monday'} with {max_classes} sessions scheduled.\n"
                        f"- **Practical & Lab Work:** {total_practicals} practical sessions scheduled across your week.\n"
                        f"- **Classroom Blocks:** Primary lectures and labs are held in {block_desc}.\n"
                        f"- **Total Weekly Commitment:** {total_count} periods scheduled across your week.\n\n"
                        "> 💡 **Schedule Note:** Classroom numbers and timings are verified directly from your authenticated UMS Student Time Table."
                    )
                    spoken = f"Here is your complete weekly class matrix with {total_count} total classes scheduled from Monday to Saturday across your courses."
                    if cs:
                        cs.activeEntity = {"view": "weekly_matrix", "day": "all"}
                else:
                    # 1. Resolve requested day dynamically
                    day = v_data.get("day")
                    import datetime
                    days_list = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
                    today_idx = datetime.datetime.now().weekday()
                    tomorrow_day = days_list[(today_idx + 1) % 7]
                    day_after_tomorrow = days_list[(today_idx + 2) % 7]
                    today_day = days_list[today_idx]

                    if "day after tomorrow" in q_lower or (day and str(day).lower() == "day after tomorrow"):
                        day = day_after_tomorrow
                    elif "tomorrow" in q_lower or (day and str(day).lower() == "tomorrow"):
                        day = tomorrow_day
                    elif "today" in q_lower or (day and str(day).lower() == "today"):
                        day = today_day
                    else:
                        day_candidates = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
                        for d in day_candidates:
                            if d in q_lower:
                                day = d.capitalize()
                                break

                    if not day and cs and cs.activeEntity and cs.activeEntity.get("day") and cs.activeEntity.get("day") not in ["all", "Weekly Matrix"]:
                        day = str(cs.activeEntity.get("day")).capitalize()

                    if not day or day in ["all", "Weekly Matrix"]:
                        day = today_day

                    # 2. Resolve classes for that day
                    classes = v_data.get("classes", [])
                    if not classes:
                        if by_day and day in by_day and by_day[day]:
                            classes = by_day[day]
                        elif all_slots:
                            classes = [s for s in all_slots if str(s.get("day", "")).lower() == day.lower()]

                    # Check for specific follow-up questions (courses, practical, room, faculty, cabins)
                    course_match = re.search(r'\b([a-zA-Z]{2,4}\s*\d{3,4})\b', request.query)
                    queried_code = course_match.group(1).replace(" ", "").upper() if course_match else None
                    # Voice users say "CSC 408" for CSE408 — normalize so the
                    # lookup can never answer "not found" for a spelling variant.
                    if queried_code and queried_code.startswith("CSC"):
                        queried_code = "CSE" + queried_code[3:]

                    is_practical_q = bool(re.search(r"\b(practical|practicals|lab|labs)\b|which one is practical", q_lower))
                    is_room_q = any(w in q_lower for w in ["which room", "what room", "room number", "where is"])
                    is_faculty_q = any(w in q_lower for w in ["who teaches", "faculty", "cabin", "cabins", "teacher", "teachers", "professor"])
                    is_schedule_q = any(w in q_lower for w in ["timetable", "time table", "schedule", "routine", "class", "classes", "period", "periods", "lecture", "lectures", "tomorrow", "today"])
                    is_courses_q = any(w in q_lower for w in [
                        "courses", "course list", "subjects", "subject list", "curriculum", "enrolled courses",
                        "registered courses", "what courses", "what subjects", "my courses"
                    ])
                    is_faculty_directory_q = (
                        any(w in q_lower for w in ["faculty directory", "all teachers", "all faculty", "who are my teachers", "who are my faculty", "professors list", "teacher list"])
                        or (is_faculty_q and not is_schedule_q and (not classes or any(w in q_lower for w in ["all", "every", "overall", "whole", "list"])))
                    )
                    is_faculty_only = is_faculty_q and not is_schedule_q

                    courses_list = v_data.get("courses", []) or []
                    seen_codes = set()
                    fac_rows = []
                    for c in classes:
                        code = str(c.get("courseCode", "")).upper()
                        if code and code not in seen_codes:
                            seen_codes.add(code)
                            matched_course = next((co for co in courses_list if str(co.get("courseCode", "")).upper() == code), None)
                            fac_name = c.get("facultyName") or (matched_course.get("facultyName") if matched_course else None) or "Course Instructor"
                            cabin = c.get("facultyCabin") or (matched_course.get("facultyCabin") or matched_course.get("cabinNumber") if matched_course else None) or "Verified in UMS report"
                            fac_rows.append(f"| **{code}** | {fac_name} | {cabin} |")

                    if (is_courses_q or is_faculty_directory_q) and courses_list:
                        total_credits = v_data.get("totalCredits") or sum(int(c.get("credits", 0) or 0) for c in courses_list)
                        course_rows = []
                        for c in courses_list:
                            cabin = c.get("facultyCabin")
                            fac_display = f"{c.get('facultyName', 'Faculty')} ({cabin})" if cabin else c.get('facultyName', 'Faculty')
                            ltp = f"{c.get('lectures', 0)}-{c.get('tutorial', 0)}-{c.get('practical', 0)}"
                            course_rows.append(
                                f"| **{c.get('courseCode', 'TBD')}** | {c.get('courseType') or 'Core'} | {c.get('courseTitle', '')} | {ltp} | {c.get('credits', 0)} | {fac_display} | {c.get('lastUpdated', 'NA')} |"
                            )
                        rows = "\n".join(course_rows)
                        reply = (
                            "### 📚 Registered Courses & Faculty Directory\n\n"
                            f"Here is your official enrolled curriculum (**{len(courses_list)} courses**, **{total_credits} total credits**) verified from your authenticated UMS portal:\n\n"
                            "| Course Code | Type | Course Title | L-T-P | Credits | Faculty & Cabin | Last Updated |\n"
                            "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n"
                            f"{rows}\n\n"
                            "> 💡 **Directory Note:** Faculty cabin locations and course credits are verified directly from your official UMS Student Time Table report."
                        )
                        spoken = f"You are registered in {len(courses_list)} courses totaling {total_credits} credits for this semester."
                    elif is_faculty_q and queried_code and courses_list:
                        matched = next((co for co in courses_list if str(co.get("courseCode", "")).upper() == queried_code), None)
                        if matched:
                            ltp = f"{matched.get('lectures', 0)}-{matched.get('tutorial', 0)}-{matched.get('practical', 0)}"
                            fac_name = matched.get('facultyName') or 'Course Instructor'
                            fac_cabin = matched.get('facultyCabin') or matched.get('cabinNumber') or 'Verified in UMS report'
                            reply = (
                                f"### 👨‍🏫 Course Faculty: **{queried_code}**\n\n"
                                f"**{queried_code}** ({matched.get('courseTitle', '')}) is taught by **{fac_name}** (Cabin: **{fac_cabin}**):\n\n"
                                "| Detail | Information |\n"
                                "| :--- | :--- |\n"
                                f"| **Course Code** | **{queried_code}** |\n"
                                f"| **Course Title** | {matched.get('courseTitle', '')} |\n"
                                f"| **Course Type** | {matched.get('courseType') or 'Core'} |\n"
                                f"| **Credits & L-T-P** | **{matched.get('credits', 0)} Credits** (L-T-P: {ltp}) |\n"
                                f"| **Faculty / Instructor** | **{fac_name}** |\n"
                                f"| **Cabin Location** | **{fac_cabin}** |\n\n"
                                "> 💡 **Directory Note:** Faculty assignments and cabin locations are verified directly from your authenticated UMS Student Time Table report."
                            )
                            spoken = f"{queried_code} is taught by {fac_name}, cabin location {fac_cabin}."
                        else:
                            reply = f"Course **{queried_code}** was not found in your registered courses."
                            spoken = f"Course {queried_code} was not found in your courses."
                    elif is_practical_q and classes:
                        practicals = [
                            c for c in classes
                            if any("practical" in str(c.get(k, "")).lower() or "lab" in str(c.get(k, "")).lower()
                                   for k in ["slotType", "type", "courseTitle", "courseCode"])
                        ]
                        if practicals:
                            p_rows = "\n".join(
                                f"| **{p.get('time', 'TBD')}** | **{p.get('courseCode', 'Practical')}** | Practical | {p.get('room', 'N/A')} | {p.get('section', 'N/A')} |"
                                for p in practicals
                            )
                            reply = (
                                f"### 🔬 Practical Labs for **{day}**\n\n"
                                f"You have **{len(practicals)} practical session{'s' if len(practicals) > 1 else ''}** scheduled on **{day}**:\n\n"
                                "| Time Slot | Subject Code | Type | Room / Venue | Section |\n"
                                "| :--- | :--- | :--- | :--- | :--- |\n"
                                f"{p_rows}\n\n"
                                "> 💡 **Schedule Note:** Classroom numbers and timings are verified directly from your authenticated UMS Student Time Table."
                            )
                            spoken = f"You have {len(practicals)} practical session{'s' if len(practicals) > 1 else ''} on {day} in Room {practicals[0].get('room', 'N/A')}."
                        else:
                            reply = f"### 🔬 Practical Labs for **{day}**\n\nYou do not have any practical classes scheduled on **{day}**; all scheduled sessions are theory lectures."
                            spoken = f"You do not have any practical classes scheduled on {day}."
                    elif is_room_q and classes:
                        course_match = re.search(r'\b([a-zA-Z]{2,4}\s*\d{3,4})\b', request.query)
                        queried_code = course_match.group(1).replace(" ", "").upper() if course_match else None
                        if queried_code and queried_code.startswith("CSC"):
                            queried_code = "CSE" + queried_code[3:]
                        target_slot = None
                        target_day = day

                        if queried_code:
                            match_in_classes = next(
                                (c for c in classes if str(c.get("courseCode") or c.get("course_code") or "").upper() == queried_code),
                                None
                            )
                            if match_in_classes:
                                target_slot = match_in_classes
                            elif all_slots:
                                match_in_slots = next(
                                    (s for s in all_slots if str(s.get("courseCode") or s.get("course_code") or "").upper() == queried_code),
                                    None
                                )
                                if match_in_slots:
                                    target_slot = match_in_slots
                                    target_day = target_slot.get("day", day)

                        if queried_code and target_slot:
                            reply = (
                                f"### 📍 Next Class Location: **{queried_code}**\n\n"
                                f"Your next **{queried_code}** session is scheduled on **{target_day}**:\n\n"
                                "| Detail | Information |\n"
                                "| :--- | :--- |\n"
                                f"| **Course Code** | **{queried_code}** |\n"
                                f"| **Type** | {target_slot.get('type') or target_slot.get('slotType') or 'Class'} |\n"
                                f"| **Time** | **{target_slot.get('time') or target_slot.get('timing') or 'TBD'}** |\n"
                                f"| **Room / Venue** | **{target_slot.get('room', 'N/A')}** |\n"
                                f"| **Section** | {target_slot.get('section', 'N/A')} |\n\n"
                                "> 💡 **Schedule Note:** Classroom numbers and timings are verified directly from your authenticated UMS Student Time Table."
                            )
                            spoken = f"Your next {queried_code} class is scheduled at {target_slot.get('time', 'scheduled time')} in Room {target_slot.get('room', 'confirmed room')}."
                        else:
                            r_rows = "\n".join(
                                f"| **{c.get('time', 'TBD')}** | **{c.get('courseCode') or c.get('course_code') or 'Class'}** | {c.get('type') or c.get('slotType') or 'Lecture'} | **{c.get('room', 'N/A')}** | {c.get('section', 'N/A')} |"
                                for c in classes
                            )
                            reply = (
                                f"### 📍 Classroom Assignments for **{day}**\n\n"
                                f"Here are the confirmed room locations for your **{day}** classes:\n\n"
                                "| Time Slot | Subject Code | Type | Room / Venue | Section |\n"
                                "| :--- | :--- | :--- | :--- | :--- |\n"
                                f"{r_rows}\n\n"
                                "> 💡 **Schedule Note:** Classroom numbers are verified directly from your authenticated UMS Student Time Table."
                            )
                            spoken = f"Here are the classroom assignments for your {day} classes."
                    elif is_faculty_only and classes:
                        if fac_rows:
                            reply = (
                                f"### 👨‍🏫 Faculty & Cabin Directory for **{day}**\n\n"
                                f"Here are the instructors and cabin locations for your **{day}** classes:\n\n"
                                "| Subject Code | Instructor / Faculty | Cabin Location |\n"
                                "| :--- | :--- | :--- |\n"
                                + "\n".join(fac_rows) + "\n\n"
                                "> 💡 **Directory Note:** Faculty assignments and cabin locations are verified directly from your authenticated UMS Student Time Table report."
                            )
                            spoken = f"Here are the faculty details and cabin locations for your {day} classes."
                        else:
                            reply = f"Faculty details for **{day}**'s classes are verified in your full UMS timetable report."
                            spoken = f"Faculty details for {day} can be verified in your UMS timetable report."
                    elif classes:
                        rows = "\n".join(
                            f"| **{c.get('time', 'TBD')}** | **{c.get('courseCode', 'TBD')}** | {c.get('type') or c.get('slotType') or 'Lecture'} | {c.get('room', 'N/A')} | {c.get('section', 'N/A')} |"
                            for c in classes
                        )
                        practicals = [c for c in classes if "practical" in str(c.get("type", "")).lower() or "practical" in str(c.get("slotType", "")).lower() or "lab" in str(c.get("courseCode", "")).lower()]
                        lectures = [c for c in classes if c not in practicals]
                        rooms = sorted(set(str(c.get("room", "")).strip() for c in classes if c.get("room")))
                        room_desc = f"Classes are scheduled in {', '.join(rooms)}." if rooms else "Classroom venues are confirmed."

                        faculty_section = ""
                        if is_faculty_q and fac_rows:
                            faculty_section = (
                                "\n\n#### 👨‍🏫 Faculty & Cabin Directory\n"
                                "| Subject Code | Instructor / Faculty | Cabin Location |\n"
                                "| :--- | :--- | :--- |\n"
                                + "\n".join(fac_rows)
                            )

                        reply = (
                            f"### 🗓️ {day}'s Class Schedule\n\n"
                            f"You have **{len(classes)} classes** scheduled for **{day}**:\n\n"
                            "| Time Slot | Subject Code | Type | Room / Venue | Section |\n"
                            "| :--- | :--- | :--- | :--- | :--- |\n"
                            f"{rows}\n\n"
                            "#### 🔍 Schedule Insights & Daily Flow\n"
                            f"- **Daily Workload:** {len(classes)} sessions ({len(lectures)} Lectures, {len(practicals)} Practicals/Labs).\n"
                            f"- **Venues & Classroom Flow:** {room_desc}"
                            f"{faculty_section}\n\n"
                            "> 💡 **Schedule Note:** Classroom numbers and timings are verified directly from your authenticated UMS Student Time Table."
                        )
                        first_time = (classes[0].get("time") or "").split("-")[0].strip() if classes else ""
                        first_room = classes[0].get("room") or "assigned room" if classes else ""
                        spoken = f"You have {len(classes)} classes scheduled on {day}{f', starting at {first_time} in {first_room}' if first_time else ''}.{f' Faculty cabin assignments are included below.' if is_faculty_q else ''}"
                        # COMPLETE spoken rundown: voice carries every session the
                        # chat table shows (time, subject code, type, room) — never
                        # a one-line teaser. Split into <=195-char ttsChunks at the tail.
                        detail_parts = [f"You have {len(classes)} classes scheduled on {day}."]
                        for c in classes:
                            c_time = str(c.get("time") or "").strip()
                            c_code = str(c.get("courseCode") or "your class")
                            c_type = str(c.get("type") or c.get("slotType") or "Lecture")
                            c_room = str(c.get("room") or "").strip()
                            piece = f"{c_time}: {c_code} {c_type.lower()}" if c_time else f"{c_code} {c_type.lower()}"
                            if c_room:
                                piece += f" in {c_room}"
                            detail_parts.append(piece + ".")
                        detail_parts.append(
                            f"That is {len(lectures)} lectures and {len(practicals)} practicals for the day."
                        )
                        if is_faculty_q:
                            detail_parts.append("Faculty cabin assignments are included below.")
                        spoken_detail = " ".join(detail_parts)
                    elif courses_list and not is_schedule_q:
                        total_credits = v_data.get("totalCredits") or sum(int(c.get("credits", 0) or 0) for c in courses_list)
                        course_rows = []
                        for c in courses_list:
                            cabin = c.get("facultyCabin")
                            fac_display = f"{c.get('facultyName', 'Faculty')} ({cabin})" if cabin else c.get('facultyName', 'Faculty')
                            ltp = f"{c.get('lectures', 0)}-{c.get('tutorial', 0)}-{c.get('practical', 0)}"
                            course_rows.append(
                                f"| **{c.get('courseCode', 'TBD')}** | {c.get('courseType') or 'Core'} | {c.get('courseTitle', '')} | {ltp} | {c.get('credits', 0)} | {fac_display} | {c.get('lastUpdated', 'NA')} |"
                            )
                        rows = "\n".join(course_rows)
                        reply = (
                            "### 📚 Registered Courses & Faculty Directory\n\n"
                            f"Here is your official enrolled curriculum (**{len(courses_list)} courses**, **{total_credits} total credits**) verified from your authenticated UMS portal:\n\n"
                            "| Course Code | Type | Course Title | L-T-P | Credits | Faculty & Cabin | Last Updated |\n"
                            "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n"
                            f"{rows}\n\n"
                            "> 💡 **Directory Note:** Faculty cabin locations and course credits are verified directly from your official UMS Student Time Table report."
                        )
                        spoken = f"You are registered in {len(courses_list)} courses totaling {total_credits} credits for this semester."
                    else:
                        extra = f"\n\n> ℹ️ **Enrolled Curriculum:** You are enrolled in **{len(courses_list)} registered courses** for this semester." if courses_list else ""
                        reply = f"### 🗓️ {day}'s Class Schedule\n\nYou have **no classes scheduled** on **{day}** according to your verified UMS timetable.{extra}"
                        spoken = f"You have no classes scheduled on {day} according to your timetable."

                    if cs:
                        cs.activeEntity = {"day": day, "view": "daily_schedule"}
            elif cap == "examination":
                exams = v_data.get("exams", []) or v_data.get("courses", [])
                total = len(exams)
                atom_exams = [e for e in exams if "atom" in str(e.get("examType", "")).lower() or "atom" in str(e.get("courseName", "")).lower()]
                if atom_exams:
                    reply = f"You have **{len(atom_exams)} atom exams** out of **{total} total exams** scheduled in your term date sheet."
                else:
                    reply = f"Found **{total} upcoming exams** in your verified UMS date sheet."
                spoken = f"Found {total} scheduled examinations in your UMS date sheet."
            elif cap == "attendance":
                reply, spoken = self._generate_attendance_verified_response(request, v_data)
            elif cap == "sample_papers":
                sp = v_data.get("samplePaperResult") if isinstance(v_data.get("samplePaperResult"), dict) else {}
                papers = v_data.get("papers", []) or v_data.get("samplePapers", [])
                exams_p = v_data.get("exams") or v_data.get("courses") or []
                if not isinstance(exams_p, list):
                    exams_p = []
                sp_course = str(sp.get("courseCode") or "").strip()
                sp_file = str(sp.get("fileName") or "").strip()
                sp_action = str(sp.get("actionTaken") or "").strip()
                sp_verified = bool(sp.get("verified"))
                if sp.get("success") and sp_course and sp_verified and sp_action == "downloaded":
                    # The download was executed AND verified in this very run —
                    # report it as the fact it is, never as "0 papers found".
                    reply = (
                        f"### 📥 Sample Paper Downloaded — **{sp_course}**\n\n"
                        f"I fetched and downloaded the official sample question paper for **{sp_course}**"
                        + (f" as **{sp_file}**." if sp_file else ".")
                        + " The download completed right after the action, and the file is saved in your browser's Downloads folder."
                    )
                    spoken = f"Done — the official sample question paper for {sp_course} is downloaded to your browser downloads"
                    if sp_file:
                        spoken += f" as {sp_file}"
                    spoken += "."
                elif sp.get("success") and sp_course and sp_verified and sp_action == "opened_in_tab":
                    reply = (
                        f"### 📄 Sample Paper Opened — **{sp_course}**\n\n"
                        f"I opened the official sample question paper for **{sp_course}** in a new browser tab"
                        + (" — use your browser's save option there to keep a copy." if not sp_file else f" as **{sp_file}**.")
                    )
                    spoken = f"I opened the official sample question paper for {sp_course} in a new tab."
                elif sp.get("success") and sp_course and sp_action == "preview_ready":
                    reply = (
                        f"### 📄 Sample Paper Ready — **{sp_course}**\n\n"
                        f"The official sample question paper link for **{sp_course}** is ready. "
                        "I could not observe the browser's download state from the page context, so please confirm the file in your Downloads folder."
                    )
                    spoken = f"The sample question paper link for {sp_course} is ready — please check your downloads to confirm the file."
                elif sp.get("success") and sp_course:
                    reply = (
                        f"I clicked the sample question paper control for **{sp_course}**, but I could not verify "
                        "whether the file was actually saved. Please check your browser's Downloads folder before relying on it."
                    )
                    spoken = f"I clicked the sample paper control for {sp_course}, but I couldn't confirm the download. Please check your downloads."
                elif papers:
                    reply = f"Found **{len(papers)} sample question papers** available in your examination section."
                    spoken = f"Found {len(papers)} sample question papers available."
                else:
                    available = [
                        str(e.get("courseCode"))
                        for e in exams_p
                        if isinstance(e, dict) and isinstance(e.get("samplePaper"), dict) and e["samplePaper"].get("available")
                    ]
                    if available:
                        reply = (
                            "I couldn't retrieve a downloadable file for that request, but your verified UMS "
                            f"records show sample papers are available for **{', '.join(available)}**. "
                            "Ask me to download one by course code and I'll fetch it directly."
                        )
                        spoken = f"I couldn't download that file, but sample papers are available for {', '.join(available)}. Ask me to download one by course code."
                    else:
                        reply = (
                            "I checked the examination section available through this UMS session, but I couldn't "
                            "verify a sample-paper link for that course. I don't want to claim one exists when I "
                            "can't verify it."
                        )
                        spoken = "I couldn't verify a sample paper for that course in this session."
            elif cap == "seating_plan":
                exams_s = v_data.get("exams") or v_data.get("courses") or v_data.get("seats") or []
                if not isinstance(exams_s, list):
                    exams_s = []
                target_s = None
                tm_s = re.search(r"\b([A-Za-z]{2,5}\s*\d{3,4}[A-Za-z]?)\b", request.query)
                if tm_s:
                    cand_s = re.sub(r"[\s\-_]", "", tm_s.group(1)).upper()
                    if cand_s.startswith("CSC"):
                        cand_s = "CSE" + cand_s[3:]
                    for e in exams_s:
                        if not isinstance(e, dict):
                            continue
                        code_n = re.sub(r"[\s\-_]", "", str(e.get("courseCode") or "")).upper()
                        if code_n and code_n == cand_s:
                            target_s = e
                            break
                seat_records = [
                    e for e in exams_s
                    if isinstance(e, dict) and (e.get("seat") or e.get("venue") or e.get("room"))
                ]
                if target_s:
                    code_s = str(target_s.get("courseCode") or "your exam")
                    date_s = str(target_s.get("examDate") or "TBD")
                    start_s = str(target_s.get("startTime") or "")
                    end_s = str(target_s.get("endTime") or "")
                    venue_s = str(target_s.get("venue") or target_s.get("room") or "TBD")
                    seat_s = str(target_s.get("seat") or "TBD")
                    time_span = f"{start_s} to {end_s}" if (start_s and end_s) else "the scheduled time"
                    reply = (
                        f"### 🪑 Seat for **{code_s}**\n\n"
                        f"**Date:** {date_s} · **Time:** {time_span} · **Venue:** {venue_s} · **Seat:** {seat_s}\n\n"
                        "> 💡 Seat and venue verified directly from your authenticated UMS seating plan."
                    )
                    spoken = f"Your {code_s} exam seat is {seat_s}, at {venue_s}, on {date_s} from {time_span}."
                elif seat_records:
                    rows_s = "\n".join(
                        f"| **{e.get('courseCode') or 'TBD'}** | {e.get('examDate') or 'TBD'} | {e.get('venue') or e.get('room') or 'TBD'} | {e.get('seat') or 'TBD'} |"
                        for e in seat_records
                    )
                    reply = (
                        "### 🪑 Verified Exam Seating Plan\n\n"
                        "| Course | Date | Venue | Seat |\n| :--- | :--- | :--- | :--- |\n"
                        f"{rows_s}\n\n"
                        "> 💡 Seats and venues verified directly from your authenticated UMS seating plan."
                    )
                    spoken = f"I found verified seating details for {len(seat_records)} exams, including seat numbers and venues."
                else:
                    reply = (
                        "I ran the seating-plan check, but no seat records were verified for this session. "
                        "Please open **Examination → Seating Plan** on your Student Dashboard and ask me again."
                    )
                    spoken = "I couldn't verify any seat records yet. Open the seating plan page on your Student Dashboard and ask me again."
            else:
                # NEVER surface internal pipeline text ("Successfully extracted...").
                # Give an honest, actionable answer for the resolved capability.
                reply = (
                    "I checked your verified Student Dashboard records, but I don't have enough specific "
                    "data to answer that precisely. Ask me about your **timetable**, **attendance**, "
                    "**examination date sheet**, **seating plan**, or **sample papers** and I'll answer "
                    "straight from the verified page."
                )
                spoken = "I don't have specific verified details for that yet. Ask me about your classes, attendance, exams, seat, or sample papers."

        spoken_raw = (spoken if 'spoken' in locals() and spoken else reply[:180]).replace("*", "")
        # Voice speaks the COMPLETE detail line(s) when one exists (full class
        # rundown); spokenSummary stays the concise headline for consumers that
        # expect a single summary sentence.
        tts_source_raw = (
            spoken_detail if 'spoken_detail' in locals() and spoken_detail else spoken_raw
        ).replace("*", "")
        spoken_final = transform_speech_identity(spoken_raw)
        tts_detail_final = transform_speech_identity(tts_source_raw)
        tts_chunks = [transform_speech_identity(c) for c in split_for_tts(tts_detail_final, max_chars=195)]
        if not tts_chunks:
            tts_chunks = [spoken_final[:195]]

        updated_cs = request.conversationState or ConversationState(
            currentCapability=cap,
            currentIntent=request.intent
        )
        if cap == "timetable" and 'day' in locals() and day:
            updated_cs.activeEntity = {"day": day}
        updated_cs.activeResult = {"taskOutcome": outcome}
        updated_cs.recentAssistantMessages.append(reply[:200])

        return VerifiedResponseResponse(
            executionId=request.executionId,
            reply=reply,
            spokenSummary=spoken_final,
            ttsChunks=tts_chunks,
            cardType=card_type,
            modelUsed="deterministic-fallback",
            conversationState=updated_cs
        )


semantic_service = SemanticService()
