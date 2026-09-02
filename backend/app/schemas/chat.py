"""
Chat Request & Message Pydantic Schemas for ONEE Backend.

Defines payloads for the /api/chat endpoint:
- ChatMessage: Individual chat turn (user or assistant).
- AgentActivity: Activity timeline step log.
- ChatRequest: Inbound message accompanied by grounded attendance context.
- ChatResponse: Complete assistant reply with activities and function call records.
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Any, Dict
from .attendance import AttendanceSummary

class ChatMessage(BaseModel):
    sender: str
    text: str
    timestamp: Optional[str] = None

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
    attendance: Optional[AttendanceSummary] = None
    history: Optional[List[ChatMessage]] = []

class ChatResponse(BaseModel):
    message: str
    activities: List[AgentActivity] = []
    tool_calls: Optional[List[ToolCallRecord]] = []
    modelUsed: Optional[str] = None
    isFallback: Optional[bool] = False
