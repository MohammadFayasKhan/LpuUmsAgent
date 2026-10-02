"""
Computer Use Planner Pydantic Schemas for ONEE Backend.

Defines serialized structures for the autonomous navigation planner:
- PageElementModel: Interactive DOM element descriptor with coordinate bounds.
- AgentActionModel: Atomic browser action (click, type, scroll, wait, extract, done).
- PlanActionRequest: Inbound request containing student goal and current page observation.
- PlanActionResponse: Next suggested action with target element candidate and rationale.
"""

from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field

class BoundingBoxModel(BaseModel):
    x: int
    y: int
    width: int
    height: int

class CoordinateModel(BaseModel):
    x: int
    y: int

class PageElementModel(BaseModel):
    id: str
    tag: str
    role: str
    text: str
    ariaLabel: Optional[str] = None
    placeholder: Optional[str] = None
    href: Optional[str] = None
    visible: bool = True
    enabled: bool = True
    x: int
    y: int
    width: int
    height: int
    centerX: Optional[int] = None
    centerY: Optional[int] = None
    visualDescription: Optional[str] = None

class VisionTargetCandidateModel(BaseModel):
    targetDescription: str
    bbox: Optional[BoundingBoxModel] = None
    confidence: float = 0.9

class ConfidenceBreakdownModel(BaseModel):
    confidence: float
    semanticScore: float
    visualScore: float
    spatialScore: float
    visibilityScore: float
    interactionScore: float

class PageObservationModel(BaseModel):
    url: str
    title: str
    pageType: str
    hasAttendanceTable: bool = False
    hasCampusDriveModal: Optional[bool] = False
    hasExamTable: Optional[bool] = False
    isExamPage: Optional[bool] = False
    isExamContentRendered: Optional[bool] = False
    examRecordsCount: Optional[int] = 0
    elements: List[PageElementModel] = []
    screenshot: Optional[str] = None
    viewportWidth: Optional[int] = None
    viewportHeight: Optional[int] = None
    devicePixelRatio: Optional[float] = 1.0
    summaryText: Optional[str] = None

class AgentActionModel(BaseModel):
    action: Literal[
        "click", "type", "scroll", "select", "hover", "wait", "waitForRender",
        "goBack", "extractAttendance", "extractExamination", "extractSeatingPlan",
        "scrollContainer", "dismissPopup", "openSamplePaper", "finish", "fail"
    ]
    elementId: Optional[str] = None
    targetCoordinates: Optional[CoordinateModel] = None
    text: Optional[str] = None
    direction: Optional[Literal["up", "down"]] = None
    amount: Optional[int] = None
    value: Optional[str] = None
    durationMs: Optional[int] = None
    reason: str = Field(description="Short human-readable rationale for this action")
    expectedOutcome: Optional[str] = Field(default=None, description="Predicate or state expected after executing this action")
    attemptNumber: Optional[int] = Field(default=1, description="Current attempt number")
    maxAttempts: Optional[int] = Field(default=3, description="Maximum retry attempts")
    recoveryStrategy: Optional[str] = Field(default=None, description="Adaptive recovery strategy if previous attempt failed")
    confidenceBreakdown: Optional[ConfidenceBreakdownModel] = None

class PlanActionRequest(BaseModel):
    goal: str
    step: int
    maxSteps: int = 15
    observation: PageObservationModel
    previousActions: List[Dict[str, Any]] = []
    retryContext: Optional[Dict[str, Any]] = None

class PlanActionResponse(BaseModel):
    action: AgentActionModel
    thought: Optional[str] = None
    visionTarget: Optional[VisionTargetCandidateModel] = None
    isGoalComplete: bool = False
    finalAnswer: Optional[str] = None
    modelUsed: Optional[str] = None
    isFallback: Optional[bool] = False
