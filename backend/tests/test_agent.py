import pytest
from app.schemas.attendance import AttendanceSummary, AttendanceRecord
from app.agent.agent import onee_agent

@pytest.mark.asyncio
async def test_agent_run_deterministic_grounding():
    summary = AttendanceSummary(
        studentName="Fayas",
        registrationNumber="12104928",
        totalCourses=2,
        totalClasses=14,
        totalAttended=13,
        totalAbsent=1,
        overallPercentage=92.86,
        courses=[
            AttendanceRecord(code="CSE329", name="Coding", attended=7, total=7, absent=0, percentage=100.0),
            AttendanceRecord(code="CSE330", name="Approaches", attended=6, total=7, absent=1, percentage=85.71)
        ],
        fetchedAt="2026-09-01T12:00:00Z"
    )

    response = await onee_agent.run("Which subject has my lowest attendance?", attendance=summary)
    assert response.message is not None
    assert "CSE330" in response.message or "85.71" in response.message
    assert len(response.activities) > 0
    assert response.suggestions is not None
    assert len(response.suggestions) > 0

@pytest.mark.asyncio
async def test_agent_generate_suggestions_grounded():
    summary = AttendanceSummary(
        studentName="Fayas",
        registrationNumber="12104928",
        totalCourses=2,
        totalClasses=14,
        totalAttended=13,
        totalAbsent=1,
        overallPercentage=92.86,
        courses=[
            AttendanceRecord(code="CSE329", name="Coding", attended=7, total=7, absent=0, percentage=100.0),
            AttendanceRecord(code="CSE330", name="Approaches", attended=6, total=7, absent=1, percentage=85.71)
        ],
        fetchedAt="2026-09-01T12:00:00Z"
    )

    suggs = await onee_agent.generate_suggestions(
        user_message="Can I skip CSE330?",
        assistant_response="You can skip 1 class.",
        attendance=summary
    )
    assert isinstance(suggs, list)
    assert len(suggs) >= 2
    # Verify suggestions are non-empty and concise
    for s in suggs:
        assert len(s) <= 50
        assert "—" not in s
    # Verify grounded in real course code
    assert any("CSE330" in s or "CSE329" in s for s in suggs)

@pytest.mark.asyncio
async def test_agent_conversational_continuity_numeric_followup():
    from app.schemas.chat import ChatMessage
    summary = AttendanceSummary(
        studentName="Fayas",
        registrationNumber="12104928",
        totalCourses=2,
        totalClasses=50,
        totalAttended=48,
        totalAbsent=2,
        overallPercentage=96.0,
        courses=[
            AttendanceRecord(code="CSE329", name="PRELUDE TO COMPETITIVE CODING", attended=24, total=24, absent=0, percentage=100.0),
            AttendanceRecord(code="CSE408", name="DESIGN AND ANALYSIS OF ALGORITHMS", attended=24, total=26, absent=2, percentage=92.31)
        ],
        fetchedAt="2026-09-01T12:00:00Z"
    )

    history = [
        ChatMessage(sender="user", text="what if i skip 4 classes in cse329?"),
        ChatMessage(sender="assistant", text="Here is your skip impact analysis for CSE329.")
    ]

    response = await onee_agent.run("what about 5", attendance=summary, history=history)
    assert response.message is not None
    # Must retain CSE329 context from history
    assert "CSE329" in response.message
    # Must generate the skip 5 simulation table
    import re
    assert bool(re.search(r"Skip[\s\u202f]*5", response.message, re.IGNORECASE))
    assert "Formula" in response.message
    assert "24" in response.message and "29" in response.message  # Attended 24 / Delivered (24 + 5) = 29
    assert len(response.suggestions) > 0
    assert any("CSE" in s or "attendance" in s.lower() or "skip" in s.lower() for s in response.suggestions)

