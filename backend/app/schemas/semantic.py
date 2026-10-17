"""
Pydantic schemas for ONEE Groq Semantic Engine contract.

Defines the structured interaction between the user input, the Groq-powered
semantic reasoning layer, and the deterministic browser agent.
"""

from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

class ConversationState(BaseModel):
    currentIntent: Optional[str] = Field(None, description="Active user intent, e.g. timetable_query, attendance_query")
    currentCapability: Optional[str] = Field(None, description="Active capability: timetable, attendance, examination, sample_papers, seating_plan")
    activeTask: Optional[str] = Field(None, description="Current sub-task: query_classes, calculate_bunks, check_exams, fetch_sample_paper")
    activeEntity: Dict[str, Any] = Field(default_factory=dict, description="Active entities, e.g. {'day': 'Monday', 'courseCode': 'CSE329'}")
    activeDataset: Optional[str] = Field(None, description="Active verified dataset identifier")
    activeResult: Dict[str, Any] = Field(default_factory=dict, description="Summary of latest result, e.g. {'recordCount': 4}")
    referencedRecords: List[Dict[str, Any]] = Field(default_factory=list, description="Specific records actively discussed in conversation")
    currentPage: Optional[str] = Field(None, description="Current UMS page or URL")
    recentUserMessages: List[str] = Field(default_factory=list, description="Recent user queries for reference resolution")
    recentAssistantMessages: List[str] = Field(default_factory=list, description="Recent assistant answers")
    verifiedContext: Dict[str, Any] = Field(default_factory=dict, description="Authoritative verified datasets cached in session")

class SemanticResolutionRequest(BaseModel):
    query: str = Field(..., description="The user query (text or transcribed voice)")
    executionId: Optional[str] = Field(None, description="Unique execution ID for request tracking and race condition prevention")
    currentUrl: Optional[str] = Field(None, description="Current active browser URL")
    currentPageType: Optional[str] = Field(None, description="Semantic page type detected in active tab")
    activeCapability: Optional[str] = Field(None, description="Currently active capability if any")
    history: Optional[List[Dict[str, Any]]] = Field(default_factory=list, description="Recent conversation turns")
    contextSummary: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Summary of existing cached datasets if any")
    conversationState: Optional[ConversationState] = Field(None, description="Structured conversational state for cross-turn follow-ups")

class SemanticResolutionResponse(BaseModel):
    executionId: str = Field(..., description="Execution ID tied to this semantic resolution")
    intent: str = Field(..., description="Resolved user intent, e.g. timetable_query, attendance_query, exam_query")
    domain: str = Field("academic", description="Domain: academic, examination, attendance, conversation")
    capability: str = Field(..., description="Target capability: timetable, attendance, examination, sample_papers, seating_plan, onee_identity, general")
    goal: Optional[str] = Field(None, description="Actionable goal for the browser agent")
    entities: Dict[str, Any] = Field(default_factory=dict, description="Extracted entities like day, courseCode, examType")
    references: List[str] = Field(default_factory=list, description="Resolved references from context/history")
    requiresBrowserAction: bool = Field(..., description="Whether the browser agent must navigate or scrape UMS")
    target: Optional[str] = Field(None, description="Target UMS feature / page")
    action: Optional[str] = Field("read", description="Action to perform: read, download, navigate, respond")
    needsClarification: bool = Field(False, description="True if query is too ambiguous to act upon")
    confidence: float = Field(1.0, description="Confidence score 0.0 - 1.0")
    acknowledgementText: str = Field("", description="Internal telemetry description")
    modelUsed: str = Field("qwen/qwen3.8-27b", description="Model used for resolution")
    conversationState: Optional[ConversationState] = Field(None, description="Updated conversational state")

class VerifiedResponseRequest(BaseModel):
    executionId: str = Field(..., description="Execution ID matching the ongoing request")
    query: str = Field(..., description="Original user prompt")
    intent: str = Field(..., description="Resolved intent")
    capability: str = Field(..., description="Executed capability")
    verifiedResult: Dict[str, Any] = Field(default_factory=dict, description="Authoritative extracted data from UMS DOM")
    history: Optional[List[Dict[str, Any]]] = Field(default_factory=list, description="Conversation history")
    conversationState: Optional[ConversationState] = Field(None, description="Structured conversational state")
    taskOutcome: Optional[str] = Field("success", description="Outcome of the task: success, data_unavailable, failed, cancelled")

class VerifiedResponseResponse(BaseModel):
    executionId: str = Field(..., description="Execution ID")
    reply: str = Field(..., description="Canonical natural response for Chat UI")
    spokenSummary: str = Field("", description="Single sentence summary for fallback voice")
    ttsChunks: List[str] = Field(default_factory=list, description="Exact canonical reply split into <=195 character chunks for Orpheus TTS")
    cardType: str = Field(..., description="Semantic card type to render, e.g. TIMETABLE_RESULT, EXAM_RESULT")
    modelUsed: str = Field("qwen/qwen3.8-27b", description="Model used for response generation")
    conversationState: Optional[ConversationState] = Field(None, description="Updated conversational state for subsequent turns")
