import pytest
from app.schemas.attendance import AttendanceSummary, AttendanceRecord
from app.agent.tools import (
    get_current_attendance,
    get_course_attendance,
    get_lowest_attendance,
    calculate_bunk_allowance,
    calculate_required_classes,
    calculate_bunk_allowance_math,
    calculate_required_classes_math
)

@pytest.fixture
def sample_summary():
    return AttendanceSummary(
        studentName="Fayas",
        registrationNumber="12104928",
        totalCourses=3,
        totalClasses=21,
        totalAttended=18,
        totalAbsent=3,
        overallPercentage=85.71,
        courses=[
            AttendanceRecord(code="CSE329", name="Coding", attended=7, total=7, absent=0, percentage=100.0),
            AttendanceRecord(code="CSE330", name="Approaches", attended=6, total=7, absent=1, percentage=85.71),
            AttendanceRecord(code="INT373", name="Web Tech", attended=5, total=7, absent=2, percentage=71.43)
        ],
        fetchedAt="2026-09-01T12:00:00Z"
    )

def test_get_current_attendance(sample_summary):
    res = get_current_attendance(sample_summary)
    assert res["overall_percentage"] == 85.71
    assert res["total_attended"] == 18
    assert res["total_classes"] == 21
    assert res["total_courses"] == 3
    assert len(res["courses_summary"]) == 3

def test_get_course_attendance(sample_summary):
    res = get_course_attendance(sample_summary, "CSE330")
    assert res["code"] == "CSE330"
    assert res["attended"] == 6
    assert res["total"] == 7
    assert res["bunk_allowance_75"] == 1

    not_found = get_course_attendance(sample_summary, "NONEXISTENT")
    assert "error" in not_found

def test_get_lowest_attendance(sample_summary):
    res = get_lowest_attendance(sample_summary)
    assert res["code"] == "INT373"
    assert res["percentage"] == 71.43
    assert res["required_classes_75"] == 1

def test_bunk_allowance_math():
    # 50/53 at 75% target
    assert calculate_bunk_allowance_math(50, 53, 75.0) == 13
    # 6/7 at 75% target
    assert calculate_bunk_allowance_math(6, 7, 75.0) == 1
    # Below 75% -> 0
    assert calculate_bunk_allowance_math(5, 7, 75.0) == 0

def test_required_classes_math():
    # 5/7 at 75% target -> need 1 class (6/8 = 75%)
    assert calculate_required_classes_math(5, 7, 75.0) == 1
    # 50/70 at 75% target -> need 10 classes (60/80 = 75%)
    assert calculate_required_classes_math(50, 70, 75.0) == 10
    # Already above -> 0
    assert calculate_required_classes_math(8, 10, 75.0) == 0

def test_calculate_bunk_allowance_tool(sample_summary):
    course_res = calculate_bunk_allowance(sample_summary, course_code="CSE329", target_percentage=75.0)
    assert course_res["scope"] == "course"
    assert course_res["code"] == "CSE329"
    assert course_res["bunk_allowance"] == 2  # 7 / (7 + 2) = 7/9 = 77.7% >= 75%

    overall_res = calculate_bunk_allowance(sample_summary, target_percentage=75.0)
    assert overall_res["scope"] == "overall"
    assert overall_res["bunk_allowance"] >= 0
