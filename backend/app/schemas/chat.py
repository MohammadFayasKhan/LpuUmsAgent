"""
Chat Request & Message Pydantic Schemas for ONEE Backend.

Defines payloads for the /api/chat endpoint:
- ChatMessage: Individual chat turn (user or assistant).
- AgentActivity: Activity timeline step log.
- ChatRequest: Inbound message accompanied by grounded attendance context.
- ChatResponse: Complete assistant reply with activities and function call records.
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict, Union
from .attendance import AttendanceSummary

class ChatMessage(BaseModel):
    sender: str
    text: str
    timestamp: Optional[Union[str, int, float]] = None

class AgentActivity(BaseModel):
    id: str
    timestamp: str
    title: str
    detail: Optional[str] = None
    status: str = "completed"

class ToolCallRecord(BaseModel):
    toolName: str
    arguments: Dict[str, Any] = {}
    result: Any

class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    attendance: Optional[Union[AttendanceSummary, Dict[str, Any]]] = None
    examination: Optional[Dict[str, Any]] = None
    timetable: Optional[Dict[str, Any]] = None
    history: Optional[List[ChatMessage]] = []

class ChatResponse(BaseModel):
    message: str
    activities: List[AgentActivity] = []
    tool_calls: Optional[List[ToolCallRecord]] = []
    modelUsed: Optional[str] = None
    isFallback: Optional[bool] = False
    suggestions: Optional[List[str]] = []

class SuggestionRequest(BaseModel):
    history: Optional[List[ChatMessage]] = []
    attendance: Optional[Union[AttendanceSummary, Dict[str, Any]]] = None
    examination: Optional[Dict[str, Any]] = None
    timetable: Optional[Dict[str, Any]] = None
    last_user_query: Optional[str] = None
    last_assistant_response: Optional[str] = None

class SuggestionResponse(BaseModel):
    suggestions: List[str] = []
    modelUsed: Optional[str] = None
