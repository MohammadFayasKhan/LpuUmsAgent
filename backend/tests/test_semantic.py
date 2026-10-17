"""
Unit and integration tests for ONEE Groq Semantic Resolution and Grounded Response API.
"""

import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.schemas.semantic import SemanticResolutionRequest
from app.services.semantic_service import SemanticService

client = TestClient(app)

def test_semantic_resolve_timetable(monkeypatch):
    """Deterministic routing test: the LLM completion is fixed here because this
    test asserts INTENT ROUTING CONTRACT, not live-model output. (The previous
    live Groq call made this test flaky: temperature variance occasionally
    omitted requiresBrowserAction or produced an over-long acknowledgement.)"""
    from app.services.semantic_service import semantic_service

    async def fake_completion(*args, **kwargs):
        return {
            "choices": [{"message": {"content": """{
                \"intent\": \"timetable_query\",
                \"capability\": \"timetable\",
                \"goal\": \"Check timetable for Monday\",
                \"entities\": {\"day\": \"Monday\"},
                \"references\": [],
                \"requiresBrowserAction\": true,
                \"action\": \"read\",
                \"needsClarification\": false,
                \"confidence\": 0.97,
                \"acknowledgementText\": \"Checking your Monday class schedule.\"
            }"""}}],
            "_onee_metadata": {"model_used": "test-groq"}
        }

    monkeypatch.setattr(semantic_service.groq_service, "call_chat_completion", fake_completion)

    response = client.post("/api/intent/resolve", json={
        "query": "which class I have on Monday",
        "executionId": "test_exec_001",
        "currentUrl": "https://ums.lpu.in/lpuums/frmStudentTimeTable.aspx"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["executionId"] == "test_exec_001"
    assert data["capability"] == "timetable"
    assert data["intent"] in ["timetable_query", "timetable"]
    assert data["requiresBrowserAction"] is True
    assert len(data["acknowledgementText"]) > 0
    assert len(data["acknowledgementText"]) <= 180

def test_semantic_resolve_exam():
    response = client.post("/api/intent/resolve", json={
        "query": "can you tell me how many atom exams do I have in term exams",
        "executionId": "test_exec_002"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["executionId"] == "test_exec_002"
    assert data["capability"] == "examination"
    assert "exam" in data["intent"]

def test_semantic_resolve_dashboard_navigation():
    response = client.post("/api/intent/resolve", json={
        "query": "can you head back to homepage",
        "executionId": "test_exec_dashboard"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["intent"] == "dashboard_navigation"
    assert data["target"] == "student_dashboard"
    assert data["action"] == "navigate"

@pytest.mark.asyncio
async def test_semantic_model_action_is_not_overridden_by_command_keywords(monkeypatch):
    service = SemanticService()

    async def fake_completion(*args, **kwargs):
        return {
            "choices": [{"message": {"content": """{
                \"intent\": \"attendance_query\",
                \"domain\": \"attendance\",
                \"capability\": \"attendance\",
                \"goal\": \"Answer from verified attendance\",
                \"entities\": {\"courseCode\": \"CSE472\"},
                \"references\": [],
                \"requiresBrowserAction\": false,
                \"target\": \"attendance\",
                \"action\": \"respond\",
                \"needsClarification\": false,
                \"confidence\": 0.99,
                \"acknowledgementText\": \"\"
            }"""}}],
            "_onee_metadata": {"model_used": "test-groq"}
        }

    monkeypatch.setattr(service.groq_service, "call_chat_completion", fake_completion)
    result = await service.resolve_intent(SemanticResolutionRequest(
        query="show me my CSE472 attendance",
        executionId="test_semantic_authority",
        contextSummary={"hasFullAttendance": True, "totalDelivered": 28}
    ))

    # "show me" formerly forced browser automation despite the semantic result.
    assert result.action == "respond"
    assert result.requiresBrowserAction is False


@pytest.mark.asyncio
async def test_semantic_freshness_request_forces_verified_browser_read(monkeypatch):
    service = SemanticService()

    async def fake_completion(*args, **kwargs):
        return {
            "choices": [{"message": {"content": """{
                \"intent\": \"examination_query\",
                \"domain\": \"examination\",
                \"capability\": \"examination\",
                \"goal\": \"Answer from cached date sheet\",
                \"entities\": {},
                \"references\": [],
                \"requiresBrowserAction\": false,
                \"target\": \"examination\",
                \"action\": \"respond\",
                \"needsClarification\": false,
                \"confidence\": 0.99,
                \"acknowledgementText\": \"\"
            }"""}}],
            "_onee_metadata": {"model_used": "test-groq"}
        }

    monkeypatch.setattr(service.groq_service, "call_chat_completion", fake_completion)
    result = await service.resolve_intent(SemanticResolutionRequest(
        query="show me my date sheet right now",
        executionId="test_semantic_freshness",
        contextSummary={"hasFullExamination": True}
    ))

    assert result.capability == "examination"
    assert result.action == "read"
    assert result.requiresBrowserAction is True

def test_voice_diagnostic_fallback_is_semantic():
    service = SemanticService()
    result = service._heuristic_fallback(
        SemanticResolutionRequest(query="I cannot hear ONEE, test the voice", executionId="test_voice_diag"),
        "test_voice_diag"
    )
    assert result.intent == "voice_diagnostic"
    assert result.capability == "conversation"
    assert result.action == "respond"

def test_verified_response_timetable(monkeypatch):
    # Deterministic unit test: the LLM leg is disabled so the grounded
    # fallback contract (short spokenSummary, <=195-char chunks) is asserted
    # regardless of live Groq availability.
    async def _llm_disabled(*args, **kwargs):
        raise RuntimeError("LLM disabled in unit test")

    from app.services.semantic_service import semantic_service
    monkeypatch.setattr(semantic_service.groq_service, "call_chat_completion", _llm_disabled)

    response = client.post("/api/chat/verified-response", json={
        "executionId": "test_exec_003",
        "query": "which class I have on Monday",
        "intent": "timetable_query",
        "capability": "timetable",
        "verifiedResult": {
            "day": "Monday",
            "classes": [
                {"courseCode": "CSE408", "time": "09:00 AM - 10:00 AM", "room": "34-601"},
                {"courseCode": "INT219", "time": "11:00 AM - 12:00 PM", "room": "33-204"}
            ]
        }
    })
    assert response.status_code == 200
    data = response.json()
    assert data["executionId"] == "test_exec_003"
    assert data["cardType"] == "TIMETABLE_RESULT"
    assert len(data["spokenSummary"]) <= 195
    # Should not mention attendance
    assert "attendance" not in data["reply"].lower()
    assert "attendance" not in data["spokenSummary"].lower()
    assert "ttsChunks" in data
    assert isinstance(data["ttsChunks"], list)
    for chunk in data["ttsChunks"]:
        assert len(chunk) <= 195
        assert "[" not in chunk or "]" not in chunk  # No [excited] or raw markdown links

def test_split_for_tts_logic():
    from app.services.semantic_service import split_for_tts, clean_for_tts
    long_text = (
        "Sure. I checked your Monday timetable. You have four classes: CSE329 from 9:30 to 10:20 AM in R-38-917, "
        "CSE472 from 10:20 to 11:10 AM in R-33-301, another CSE472 practical from 11:10 AM to 12:00 PM in R-33-502, "
        "and CSE330 practical from 1:40 to 2:30 PM in R-37-911. Your Monday is therefore fairly packed, especially during the morning."
    )
    chunks = split_for_tts(long_text, max_chars=195)
    assert len(chunks) >= 2
    for chunk in chunks:
        assert len(chunk) <= 195
        assert len(chunk.strip()) > 0

    markdown_text = "### Timetable for **Monday**\n- [CSE408](https://ums.lpu.in) in `34-601` | 9:00 AM\n[excited] Great schedule!"
    cleaned = clean_for_tts(markdown_text)
    assert "#" not in cleaned
    assert "*" not in cleaned
    assert "`" not in cleaned
    assert "[excited]" not in cleaned

def test_followup_resolution_with_conversation_state():
    response = client.post("/api/intent/resolve", json={
        "query": "what about Tuesday?",
        "executionId": "test_exec_004",
        "conversationState": {
            "currentCapability": "timetable",
            "currentIntent": "timetable_query",
            "activeTask": "query_classes",
            "activeEntity": {"day": "Monday"}
        }
    })
    assert response.status_code == 200
    data = response.json()
    assert data["capability"] == "timetable"
    assert data["intent"] in ["timetable_query", "timetable"]
    assert "conversationState" in data
    assert data["conversationState"]["currentCapability"] == "timetable"

def test_outcome_aware_response_data_unavailable():
    response = client.post("/api/chat/verified-response", json={
        "executionId": "test_exec_005",
        "query": "is there any sample paper for CSE408",
        "intent": "sample_paper_query",
        "capability": "sample_papers",
        "taskOutcome": "data_unavailable",
        "verifiedResult": {}
    })
    assert response.status_code == 200
    data = response.json()
    assert "attendance" not in data["reply"].lower()
    # Truthful explanation without hallucination
    assert any(term in data["reply"].lower() for term in ["couldn't find", "not available", "sample", "verify"])
    for chunk in data["ttsChunks"]:
        assert len(chunk) <= 195

def test_multi_turn_tuesday_with_raw_slots(monkeypatch):
    # Tests the exact screenshot scenario: user asks for Monday, then Tuesday,
    # and verifiedResult has raw slots for both days
    async def _llm_disabled(*args, **kwargs):
        raise RuntimeError("LLM disabled in unit test")

    from app.services.semantic_service import semantic_service
    monkeypatch.setattr(semantic_service.groq_service, "call_chat_completion", _llm_disabled)

    response = client.post("/api/chat/verified-response", json={
        "executionId": "test_exec_006",
        "query": "Can you tell me which classes I have on Tuesday?",
        "intent": "timetable_query",
        "capability": "timetable",
        "conversationState": {
            "currentCapability": "timetable",
            "currentIntent": "timetable_query",
            "activeEntity": {"day": "Monday"}
        },
        "history": [
            {"role": "user", "content": "which class I have on Monday"},
            {"role": "assistant", "content": "Sure. I checked your Monday timetable. You have four classes scheduled."}
        ],
        "verifiedResult": {
            "slots": [
                {"day": "Monday", "courseCode": "CSE329", "time": "9:30 AM - 10:20 AM", "room": "R-38-917", "type": "Theory"},
                {"day": "Monday", "courseCode": "CSE472", "time": "10:20 AM - 11:10 AM", "room": "R-33-301", "type": "Theory"},
                {"day": "Monday", "courseCode": "CSE472", "time": "11:10 AM - 12:00 PM", "room": "R-33-502", "type": "Practical"},
                {"day": "Monday", "courseCode": "CSE330", "time": "1:40 PM - 2:30 PM", "room": "R-37-911", "type": "Practical"},
                {"day": "Tuesday", "courseCode": "CSE408", "time": "9:00 AM - 10:00 AM", "room": "34-601", "type": "Theory"},
                {"day": "Tuesday", "courseCode": "INT219", "time": "10:00 AM - 11:00 AM", "room": "33-204", "type": "Theory"},
                {"day": "Tuesday", "courseCode": "CSE320", "time": "11:00 AM - 12:00 PM", "room": "34-501", "type": "Practical"},
                {"day": "Tuesday", "courseCode": "PEV106", "time": "12:00 PM - 1:00 PM", "room": "34-302", "type": "Theory"},
                {"day": "Tuesday", "courseCode": "CSE316", "time": "1:40 PM - 2:30 PM", "room": "38-601", "type": "Theory"}
            ],
            "byDay": {
                "Monday": [
                    {"day": "Monday", "courseCode": "CSE329", "time": "9:30 AM - 10:20 AM", "room": "R-38-917", "type": "Theory"},
                    {"day": "Monday", "courseCode": "CSE472", "time": "10:20 AM - 11:10 AM", "room": "R-33-301", "type": "Theory"},
                    {"day": "Monday", "courseCode": "CSE472", "time": "11:10 AM - 12:00 PM", "room": "R-33-502", "type": "Practical"},
                    {"day": "Monday", "courseCode": "CSE330", "time": "1:40 PM - 2:30 PM", "room": "R-37-911", "type": "Practical"}
                ],
                "Tuesday": [
                    {"day": "Tuesday", "courseCode": "CSE408", "time": "9:00 AM - 10:00 AM", "room": "34-601", "type": "Theory"},
                    {"day": "Tuesday", "courseCode": "INT219", "time": "10:00 AM - 11:00 AM", "room": "33-204", "type": "Theory"},
                    {"day": "Tuesday", "courseCode": "CSE320", "time": "11:00 AM - 12:00 PM", "room": "34-501", "type": "Practical"},
                    {"day": "Tuesday", "courseCode": "PEV106", "time": "12:00 PM - 1:00 PM", "room": "34-302", "type": "Theory"},
                    {"day": "Tuesday", "courseCode": "CSE316", "time": "1:40 PM - 2:30 PM", "room": "38-601", "type": "Theory"}
                ]
            }
        }
    })
    assert response.status_code == 200
    data = response.json()
    reply = data["reply"].lower()
    # Must answer for Tuesday, NOT say no classes or repeat Monday
    assert "tuesday" in reply
    assert "no classes" not in reply
    assert any(c in reply for c in ["cse408", "int219", "cse320", "pev106", "cse316"])
    assert data["conversationState"]["activeEntity"]["day"] == "Tuesday"

def test_resolver_routes_report_and_seat_questions():
    """'report for' and 'seat' queries must never fall through to general."""
    from app.services.semantic_service import SemanticService
    from app.schemas.semantic import SemanticResolutionRequest

    service = SemanticService()
    r1 = service._heuristic_fallback(
        SemanticResolutionRequest(query="When should I report for INT373?", executionId="t_rep"), "t_rep"
    )
    assert r1.capability == "examination"

    r2 = service._heuristic_fallback(
        SemanticResolutionRequest(query="Where is my seat for INT373?", executionId="t_seat"), "t_seat"
    )
    assert r2.capability == "seating_plan"


def test_targeted_exam_answer_for_reporting_query():
    response = client.post("/api/chat/verified-response", json={
        "executionId": "t_exam",
        "query": "When should I report for INT373?",
        "intent": "examination_query",
        "capability": "examination",
        "taskOutcome": "success",
        "verifiedResult": {"exams": [
            {"courseCode": "INT373", "examDate": "19 Dec 2026", "startTime": "09:30",
             "endTime": "12:30", "examType": "Theory End Term", "venue": "Block 38",
             "seat": "R-14", "instructions": "[Report 30 minutes before the start of exam]"},
            {"courseCode": "CSE408", "examDate": "15 Dec 2026", "startTime": "09:30",
             "endTime": "12:30", "examType": "Theory End Term", "venue": "Block 34", "seat": "R-07"}
        ]}
    })
    assert response.status_code == 200
    data = response.json()
    assert "INT373" in data["reply"]
    assert "19 Dec 2026" in data["reply"]
    assert "Successfully extracted" not in data["reply"]
    joined = " ".join(data["ttsChunks"])
    assert "INT373" in joined
    # Brackets are stripped so TTS never reads punctuation aloud.
    assert "[" not in joined and "]" not in joined


def test_sample_paper_verified_download_reported_accurately():
    from app.services.semantic_service import SemanticService
    from app.schemas.semantic import VerifiedResponseRequest

    service = SemanticService()
    resp = service._heuristic_verified_response(
        VerifiedResponseRequest(
            executionId="t_sp",
            query="download sample paper for CSE408",
            intent="sample_paper_query",
            capability="sample_papers",
            taskOutcome="success",
            verifiedResult={"samplePaperResult": {
                "success": True, "verified": True, "actionTaken": "downloaded",
                "courseCode": "CSE408", "fileName": "CSE408_Sample.pdf"
            }}
        ),
        "SAMPLE_PAPER_RESULT",
    )
    assert "Downloaded" in resp.reply
    assert "CSE408_Sample.pdf" in resp.reply
    assert "Found **0" not in resp.reply
    assert "Successfully extracted" not in resp.reply


def test_sample_paper_unavailable_reports_real_alternatives():
    from app.services.semantic_service import SemanticService
    from app.schemas.semantic import VerifiedResponseRequest

    service = SemanticService()
    resp = service._heuristic_verified_response(
        VerifiedResponseRequest(
            executionId="t_sp2",
            query="sample paper for CSC408",
            intent="sample_paper_query",
            capability="sample_papers",
            taskOutcome="success",
            verifiedResult={"exams": [
                {"courseCode": "INT373", "samplePaper": {"available": True}},
                {"courseCode": "CSE471", "samplePaper": {"available": True}}
            ]}
        ),
        "SAMPLE_PAPER_RESULT",
    )
    assert "Found **0" not in resp.reply
    assert "INT373" in resp.reply


def test_seating_plan_reply_contains_verified_seat():
    from app.services.semantic_service import SemanticService
    from app.schemas.semantic import VerifiedResponseRequest

    service = SemanticService()
    resp = service._heuristic_verified_response(
        VerifiedResponseRequest(
            executionId="t_se",
            query="Where is my seat for INT373?",
            intent="seating_query",
            capability="seating_plan",
            taskOutcome="success",
            verifiedResult={"exams": [
                {"courseCode": "INT373", "examDate": "19 Dec 2026", "startTime": "09:30",
                 "endTime": "12:30", "venue": "Block 38", "seat": "R-14"}
            ]}
        ),
        "SEATING_PLAN_RESULT",
    )
    assert "INT373" in resp.reply
    assert "R-14" in resp.reply
    assert "Successfully extracted" not in resp.reply


def test_timetable_spoken_detail_lists_every_class():
    from app.services.semantic_service import SemanticService
    from app.schemas.semantic import VerifiedResponseRequest

    service = SemanticService()
    resp = service._heuristic_verified_response(
        VerifiedResponseRequest(
            executionId="t_tt",
            query="what classes do I have on Thursday",
            intent="timetable_query",
            capability="timetable",
            taskOutcome="success",
            verifiedResult={
                "day": "Thursday",
                "classes": [
                    {"courseCode": "CSE471", "time": "10:20-11:10 AM", "type": "Lecture", "room": "33-307"},
                    {"courseCode": "CSE471", "time": "11:10-12:00 AM", "type": "Lecture", "room": "33-307"},
                    {"courseCode": "INT373", "time": "12:00-12:50 PM", "type": "Practical", "room": "37-904"}
                ]
            }
        ),
        "TIMETABLE_RESULT",
    )
    joined = " ".join(resp.ttsChunks)
    # Voice speaks EVERY class, not a one-line teaser.
    assert "CSE471" in joined and "INT373" in joined
    # Rooms and times read naturally.
    assert "Block 33, Room 307" in joined
    assert " to " in joined
    assert len(resp.spokenSummary) <= 195
    for chunk in resp.ttsChunks:
        assert len(chunk) <= 195

def test_faculty_query_with_csc_typo_resolves_to_cse():
    """'cabin number for CSC 408' must find CSE408, never 'not found'."""
    from app.services.semantic_service import SemanticService
    from app.schemas.semantic import VerifiedResponseRequest

    service = SemanticService()
    resp = service._heuristic_verified_response(
        VerifiedResponseRequest(
            executionId="t_csc",
            query="hey can you tell me cabin number for CSC 408 lecturer",
            intent="timetable_query",
            capability="timetable",
            taskOutcome="success",
            verifiedResult={
                "day": "Thursday",
                "classes": [
                    {"courseCode": "CSE408", "time": "10:20-11:10 AM", "type": "Lecture",
                     "room": "34-808", "facultyName": "Dr. Sharma", "facultyCabin": "34-210"}
                ],
                "courses": [
                    {"courseCode": "CSE408", "courseTitle": "Design and Analysis of Algorithms",
                     "facultyName": "Dr. Sharma", "facultyCabin": "34-210"}
                ]
            }
        ),
        "TIMETABLE_RESULT",
    )
    assert "was not found" not in resp.reply
    assert "CSE408" in resp.reply
    assert "Dr. Sharma" in resp.reply


# ---------------------------------------------------------------------------
# Deterministic routing regressions (LLM leg disabled): the exact phrasings
# that leaked to general_query in production and produced wrong replies —
# a greeting answered with a UMS "records not available" error, and the
# product's own suggestion chip "What classes do I have today?" unrouted.
# ---------------------------------------------------------------------------

def _disable_llm(monkeypatch):
    from app.services.semantic_service import semantic_service

    async def _raise(*args, **kwargs):
        raise RuntimeError("LLM disabled for deterministic routing test")

    monkeypatch.setattr(semantic_service.groq_service, "call_chat_completion", _raise)


def test_greeting_with_name_resolves_to_conversation(monkeypatch):
    """'Hey Sophia!' must be conversation — never general_query, which used to
    launch the browser agent and reply 'requested records were not available'."""
    _disable_llm(monkeypatch)
    response = client.post("/api/intent/resolve", json={
        "query": "Hey Sophia!",
        "executionId": "test_exec_greet_name"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["intent"] == "casual_conversation"
    assert data["capability"] == "conversation"
    assert data["requiresBrowserAction"] is False
    assert data["action"] == "respond"


def test_greeting_variants_resolve_to_conversation(monkeypatch):
    _disable_llm(monkeypatch)
    for phrase in ["hello there", "good morning team", "yo", "thanks a lot", "how are you?"]:
        data = client.post("/api/intent/resolve", json={"query": phrase}).json()
        assert data["capability"] == "conversation", phrase
        assert data["requiresBrowserAction"] is False, phrase


def test_academic_request_never_swallowed_as_greeting(monkeypatch):
    _disable_llm(monkeypatch)
    data = client.post("/api/intent/resolve", json={"query": "hi, can I bunk tomorrow's class"}).json()
    assert data["capability"] == "attendance"

    data = client.post("/api/intent/resolve", json={"query": "hey, what classes do I have today"}).json()
    assert data["capability"] == "timetable"


def test_classes_today_routes_to_timetable(monkeypatch):
    """The product's own suggestion chip phrase must resolve to timetable."""
    _disable_llm(monkeypatch)
    for phrase in [
        "What classes do I have today?",
        "what class do i have tomorrow",
        "which classes do i have this week",
    ]:
        response = client.post("/api/intent/resolve", json={"query": phrase})
        assert response.status_code == 200
        data = response.json()
        assert data["capability"] == "timetable", phrase
        assert "timetable" in data["intent"], phrase
        assert data["requiresBrowserAction"] is True, phrase
