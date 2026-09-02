import pytest
from app.schemas.planner import PlanActionRequest, PageObservationModel, PageElementModel
from app.agent.planner import plan_next_action, heuristic_plan

@pytest.mark.asyncio
async def test_planner_heuristic_attendance_found():
    obs = PageObservationModel(
        url="https://ums.lpu.in/lpuums/StudentDashboard.aspx",
        title="Student Dashboard",
        pageType="Student Dashboard",
        hasAttendanceTable=True,
        elements=[]
    )
    req = PlanActionRequest(
        goal="Go to my attendance and tell me which subject has the lowest attendance",
        step=1,
        observation=obs
    )
    res = await plan_next_action(req)
    assert res.action.action == "finish"
    assert res.isGoalComplete is True

@pytest.mark.asyncio
async def test_planner_heuristic_click_academics():
    elements = [
        PageElementModel(
            id="onee-001",
            tag="button",
            role="button",
            text="Academics",
            x=100,
            y=200,
            width=80,
            height=30
        ),
        PageElementModel(
            id="onee-002",
            tag="a",
            role="link",
            text="LPU Live",
            x=100,
            y=250,
            width=80,
            height=30
        )
    ]
    obs = PageObservationModel(
        url="https://ums.lpu.in/lpuums/StudentDashboard.aspx",
        title="Student Dashboard",
        pageType="Student Dashboard",
        hasAttendanceTable=False,
        elements=elements
    )
    req = PlanActionRequest(
        goal="Go to my attendance and find lowest",
        step=1,
        observation=obs
    )
    res = heuristic_plan(req)
    assert res.action.action == "click"
    assert res.action.elementId == "onee-001"
