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
