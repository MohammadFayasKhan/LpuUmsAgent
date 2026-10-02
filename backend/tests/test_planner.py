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

@pytest.mark.asyncio
async def test_planner_heuristic_exam_waiting_for_render():
    obs = PageObservationModel(
        url="https://studentums.lpu.in/dashboard/examination/conduct/seatingplan",
        title="Examination Date Sheet",
        pageType="Examination Date Sheet / Seating Plan",
        isExamPage=True,
        isExamContentRendered=False,
        elements=[]
    )
    req = PlanActionRequest(
        goal="Check my date sheet and seating plan",
        step=1,
        observation=obs
    )
    res = heuristic_plan(req)
    assert res.action.action == "waitForRender"
    assert res.isGoalComplete is False

@pytest.mark.asyncio
async def test_planner_heuristic_exam_rendered_extracted():
    obs = PageObservationModel(
        url="https://studentums.lpu.in/dashboard/examination/conduct/seatingplan",
        title="Examination Date Sheet",
        pageType="Examination Date Sheet / Seating Plan",
        isExamPage=True,
        isExamContentRendered=True,
        elements=[]
    )
    req = PlanActionRequest(
        goal="Check my date sheet and seating plan",
        step=2,
        observation=obs
    )
    res = heuristic_plan(req)
    assert res.action.action == "finish"
    assert res.isGoalComplete is True

@pytest.mark.asyncio
async def test_planner_heuristic_exam_step_timeout_extracted():
    obs = PageObservationModel(
        url="https://studentums.lpu.in/dashboard/examination/conduct/seatingplan",
        title="Examination Date Sheet",
        pageType="Examination Date Sheet / Seating Plan",
        isExamPage=True,
        isExamContentRendered=False,
        elements=[]
    )
    req = PlanActionRequest(
        goal="Check my date sheet and seating plan",
        step=4,
        observation=obs
    )
    res = heuristic_plan(req)
    assert res.action.action == "finish"
    assert res.isGoalComplete is True

