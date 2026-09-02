"""
Deterministic Tool Handlers for Groq Qwen Function Calling.

Implements backend function calls that LLM invocations can trigger:
- calculate_bunk_allowance: Calculates max safe skippable classes.
- calculate_required_classes: Calculates classes needed to reach 75%.
- get_lowest_attendance_course: Deterministic minimum percentage search.
- get_full_attendance_summary: Aggregates across all courses.
"""

import math
from typing import Optional, Dict, Any, List
from ..schemas.attendance import AttendanceSummary, AttendanceRecord

def calculate_bunk_allowance_math(
    attended: int, total: int, target_pct: float
) -> int:
    """
    Calculates the maximum integer number of classes a student can skip.
    Formula: x = floor((A - T * C) / T) = floor((100 * A - target_pct * C) / target_pct)
    """
    if total <= 0 or target_pct <= 0:
        return 0
    current_pct = (attended / total) * 100.0
    if current_pct < target_pct:
        return 0

    target = target_pct / 100.0
    max_skippable = math.floor((attended - target * total) / target)
    return max(0, int(max_skippable))

def calculate_required_classes_math(
    attended: int, total: int, target_pct: float
) -> int:
    """
    Calculates minimum consecutive classes required to reach or recover target percentage.
    Formula: x = ceil((target_pct * C - 100 * A) / (100 - target_pct))
    """
    if total <= 0 or target_pct <= 0:
        return 0
    if target_pct >= 100.0:
        return 9999 if attended < total else 0

    current_pct = (attended / total) * 100.0
    if current_pct >= target_pct:
        return 0

    target = target_pct / 100.0
    needed = math.ceil((target * total - attended) / (1.0 - target))
    return max(0, int(needed))

def get_current_attendance(attendance: AttendanceSummary) -> Dict[str, Any]:
    """
    Returns the overall attendance summary.
    """
    has_exact = attendance.totalClasses > 0
    margin = max(0.0, round(attendance.overallPercentage - 75.0, 2))
    overall_bunk = calculate_bunk_allowance_math(attendance.totalAttended, attendance.totalClasses, 75.0) if has_exact else None
    return {
        "overall_percentage": attendance.overallPercentage,
        "total_attended": attendance.totalAttended,
        "total_classes": attendance.totalClasses,
        "total_absent": attendance.totalAbsent,
        "total_courses": attendance.totalCourses,
        "student_name": attendance.studentName,
        "registration_number": attendance.registrationNumber,
        "has_exact_counts": has_exact,
        "margin_above_75": margin,
        "bunk_allowance_75": overall_bunk,
        "courses_summary": [
            {
                "code": c.code,
                "name": c.name,
                "percentage": c.percentage,
                "fraction": f"{c.attended}/{c.total}" if c.total > 0 else "Percentage only",
                "status": "Safe (≥75%)" if c.percentage >= 75.0 else "Action needed (<75%)"
            }
            for c in attendance.courses
        ]
    }

def get_course_attendance(attendance: AttendanceSummary, course_code: str) -> Dict[str, Any]:
    """
    Returns attendance details for a specific course code.
    """
    clean_code = course_code.replace(" ", "").upper()
    found = None
    for c in attendance.courses:
        if c.code.replace(" ", "").upper() == clean_code:
            found = c
            break

    if not found:
        for c in attendance.courses:
            if clean_code in c.code.replace(" ", "").upper():
                found = c
                break

    if not found:
        return {
            "error": f"Course '{course_code}' was not found in the student's attendance list.",
            "available_courses": [c.code for c in attendance.courses]
        }

    has_exact = found.total > 0
    bunk_75 = calculate_bunk_allowance_math(found.attended, found.total, 75.0) if has_exact else None
    req_75 = calculate_required_classes_math(found.attended, found.total, 75.0) if has_exact else None
    margin = max(0.0, round(found.percentage - 75.0, 2))

    return {
        "code": found.code,
        "name": found.name,
        "attended": found.attended,
        "total": found.total,
        "absent": found.absent,
        "percentage": found.percentage,
        "has_exact_counts": has_exact,
        "margin_above_75": margin,
        "bunk_allowance_75": bunk_75,
        "required_classes_75": req_75,
        "data_quality": found.dataQuality
    }

def get_lowest_attendance(attendance: AttendanceSummary) -> Dict[str, Any]:
    """
    Identifies the subject with the lowest attendance percentage.
    """
    if not attendance.courses:
        return {"error": "No courses available in attendance data."}

    lowest = min(attendance.courses, key=lambda c: c.percentage)
    has_exact = lowest.total > 0
    bunk_75 = calculate_bunk_allowance_math(lowest.attended, lowest.total, 75.0) if has_exact else None
    req_75 = calculate_required_classes_math(lowest.attended, lowest.total, 75.0) if has_exact else None

    return {
        "code": lowest.code,
        "name": lowest.name,
        "attended": lowest.attended,
        "total": lowest.total,
        "absent": lowest.absent,
        "percentage": lowest.percentage,
        "has_exact_counts": has_exact,
        "bunk_allowance_75": bunk_75,
        "required_classes_75": req_75
    }

def calculate_bunk_allowance(
    attendance: AttendanceSummary,
    course_code: Optional[str] = None,
    target_percentage: float = 75.0
) -> Dict[str, Any]:
    """
    Calculates how many classes a student can skip while staying at or above target percentage.
    """
    if course_code:
        course_res = get_course_attendance(attendance, course_code)
        if "error" in course_res:
            return course_res
        attended = course_res["attended"]
        total = course_res["total"]
        pct = course_res["percentage"]
        has_exact = total > 0
        allowance = calculate_bunk_allowance_math(attended, total, target_percentage) if has_exact else None
        margin = max(0.0, round(pct - target_percentage, 2))
        return {
            "scope": "course",
            "code": course_res["code"],
            "name": course_res["name"],
            "current_percentage": course_res["percentage"],
            "target_percentage": target_percentage,
            "bunk_allowance": allowance,
            "has_exact_counts": has_exact,
            "margin_above_target": margin,
            "buffer_ratio": f"{margin:.1f}% safety buffer"
        }
    else:
        has_exact = attendance.totalClasses > 0
        allowance = calculate_bunk_allowance_math(
            attendance.totalAttended,
            attendance.totalClasses,
            target_percentage
        ) if has_exact else None
        margin = max(0.0, round(attendance.overallPercentage - target_percentage, 2))
        return {
            "scope": "overall",
            "current_percentage": attendance.overallPercentage,
            "target_percentage": target_percentage,
            "bunk_allowance": allowance,
            "has_exact_counts": has_exact,
            "margin_above_target": margin,
            "buffer_ratio": f"{margin:.1f}% overall safety buffer"
        }

def calculate_required_classes(
    attendance: AttendanceSummary,
    course_code: Optional[str] = None,
    target_percentage: float = 75.0
) -> Dict[str, Any]:
    """
    Calculates consecutive classes a student must attend to reach or recover target percentage.
    """
    if course_code:
        course_res = get_course_attendance(attendance, course_code)
        if "error" in course_res:
            return course_res
        attended = course_res["attended"]
        total = course_res["total"]
        pct = course_res["percentage"]
        has_exact = total > 0
        needed = calculate_required_classes_math(attended, total, target_percentage) if has_exact else None
        return {
            "scope": "course",
            "code": course_res["code"],
            "name": course_res["name"],
            "current_percentage": course_res["percentage"],
            "target_percentage": target_percentage,
            "required_classes": needed,
            "has_exact_counts": has_exact
        }
    else:
        has_exact = attendance.totalClasses > 0
        needed = calculate_required_classes_math(
            attendance.totalAttended,
            attendance.totalClasses,
            target_percentage
        ) if has_exact else None
        return {
            "scope": "overall",
            "current_percentage": attendance.overallPercentage,
            "target_percentage": target_percentage,
            "required_classes": needed,
            "has_exact_counts": has_exact
        }

# Tool definitions schema for Groq API
TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "get_current_attendance",
            "description": "Returns the overall attendance summary, safety buffer, and overview of all enrolled subjects.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_course_attendance",
            "description": "Returns attendance details and safety margin for a specific course code (e.g. 'CSE330', 'INT416').",
            "parameters": {
                "type": "object",
                "properties": {
                    "course_code": {
                        "type": "string",
                        "description": "The course code to look up, e.g. 'INT416'"
                    }
                },
                "required": ["course_code"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "get_lowest_attendance",
            "description": "Finds the subject with the lowest attendance percentage among all enrolled courses.",
            "parameters": {
                "type": "object",
                "properties": {},
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_bunk_allowance",
            "description": "Calculates how many classes can be safely skipped while staying at or above a target percentage (default 75%).",
            "parameters": {
                "type": "object",
                "properties": {
                    "course_code": {
                        "type": "string",
                        "description": "Optional course code (e.g. 'INT416'). If omitted, calculates for overall attendance."
                    },
                    "target_percentage": {
                        "type": "number",
                        "description": "Target attendance threshold (e.g. 75, 80, 85, 90). Default is 75."
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "calculate_required_classes",
            "description": "Calculates the minimum number of consecutive classes a student must attend to reach or recover a target percentage (default 75%).",
            "parameters": {
                "type": "object",
                "properties": {
                    "course_code": {
                        "type": "string",
                        "description": "Optional course code (e.g. 'CSE339'). If omitted, calculates for overall attendance."
                    },
                    "target_percentage": {
                        "type": "number",
                        "description": "Target attendance threshold (e.g. 75, 80, 85, 90). Default is 75."
                    }
                },
                "required": []
            }
        }
    }
]

def execute_tool(tool_name: str, args: Dict[str, Any], attendance: AttendanceSummary) -> Any:
    if tool_name == "get_current_attendance":
        return get_current_attendance(attendance)
    elif tool_name == "get_course_attendance":
        return get_course_attendance(attendance, args.get("course_code", ""))
    elif tool_name == "get_lowest_attendance":
        return get_lowest_attendance(attendance)
    elif tool_name == "calculate_bunk_allowance":
        return calculate_bunk_allowance(
            attendance,
            course_code=args.get("course_code"),
            target_percentage=float(args.get("target_percentage", 75.0))
        )
    elif tool_name == "calculate_required_classes":
        return calculate_required_classes(
            attendance,
            course_code=args.get("course_code"),
            target_percentage=float(args.get("target_percentage", 75.0))
        )
    else:
        return {"error": f"Unknown tool: {tool_name}"}
