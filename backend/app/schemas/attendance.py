"""
Attendance Pydantic Schemas for ONEE Backend.

Defines serialized structures for attendance records matching the Chrome extension:
- DetailedSessionRecord: Individual lecture records with date, time, and status (P/A/DL).
- AttendanceRecord: Subject aggregate (code, name, attended, total, percentage).
- AttendanceSummary: Complete student dataset with aggregate percentage and courses list.
"""

from pydantic import BaseModel, Field
from typing import List, Optional

class DetailedSessionRecord(BaseModel):
    date: str
    time: str
    type: str = "L"
    attendance: str = "P"
    teacherName: Optional[str] = None
    blockReason: Optional[str] = "OK"

class AttendanceRecord(BaseModel):
    code: str
    name: Optional[str] = ""
    attended: int = Field(ge=0, default=0)
    total: int = Field(ge=0, default=0)
    delivered: Optional[int] = Field(ge=0, default=0)
    absent: Optional[int] = Field(ge=0, default=0)
    percentage: float = Field(ge=0.0, le=100.0, default=0.0)
    dutyLeave: Optional[int] = 0
    lastAttended: Optional[str] = None
    sessions: Optional[List[DetailedSessionRecord]] = []
    dataQuality: Optional[str] = "valid"

class AttendanceSummary(BaseModel):
    status: Optional[str] = "verified"
    source: Optional[str] = "live-ums-dom"
    studentName: Optional[str] = None
    registrationNumber: Optional[str] = None
    totalCourses: int = Field(ge=0, default=0)
    totalClasses: Optional[int] = Field(ge=0, default=0)
    totalDelivered: Optional[int] = Field(ge=0, default=0)
    totalAttended: int = Field(ge=0, default=0)
    totalAbsent: Optional[int] = Field(ge=0, default=0)
    totalDutyLeave: Optional[int] = 0
    overallPercentage: float = Field(ge=0.0, le=100.0, default=0.0)
    courses: List[AttendanceRecord] = []
    extractedAt: Optional[str] = None
    canBunkClasses: Optional[int] = None
    mustAttendClasses: Optional[int] = None
    fetchedAt: Optional[str] = None
