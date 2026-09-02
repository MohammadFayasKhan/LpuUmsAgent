/*
 * Core Domain Types and Models for ONEE.
 *
 * This file contains TypeScript interfaces shared across all extension layers:
 * - ConnectionStatus: Tracks the active state of the student's UMS tab.
 * - AttendanceRecord & AttendanceSummary: Normalized structures for extracted course tables.
 * - AgentAction & AgentState: Computer Use execution state, steps, and telemetry.
 * - ChatMessage: Conversation message model for the local assistant.
 */

export type ConnectionStatus =
  | 'NOT_CONNECTED'
  | 'UMS_DETECTED'
  | 'LOGIN_PAGE'
  | 'HUMAN_VERIFICATION'
  | 'READY'
  | 'READING'
  | 'NO_ATTENDANCE_ON_PAGE'
  | 'ERROR'
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'navigating'
  | 'extracting';

export interface ChatMessage {
  id: string;
  sender?: 'user' | 'assistant' | 'agent' | 'onee';
  role?: 'user' | 'assistant' | 'system';
  text?: string;
  content?: string;
  timestamp: number | string;
  isStreaming?: boolean;
  isError?: boolean;
  action?: AgentAction;
  source?: 'rule-based' | 'model' | 'fallback' | 'agent';
}

export interface DetailedSessionRecord {
  date: string;
  time?: string;
  type?: string;
  attendance?: string;
  status?: 'present' | 'absent' | 'duty_leave' | 'cancelled' | string;
  topic?: string;
  teacher?: string;
  teacherName?: string;
  blockReason?: string;
  [key: string]: any;
}

export interface CourseAttendance {
  code: string;
  name: string;
  attended: number;
  delivered?: number;
  total: number;
  percentage: number;
  absent?: number;
  dutyLeave?: number;
  lastAttended?: string;
  dataQuality?: 'valid' | 'warning' | 'high' | 'medium' | 'low';
  sessions?: DetailedSessionRecord[];
}

export type AttendanceRecord = CourseAttendance;

export interface BunkCalculationResult {
  canBunk?: number;
  mustAttend?: number;
  bunkAllowance?: number;
  requiredClasses?: number;
  currentPercentage?: number;
  targetPercentage?: number;
  status?: string;
}

export interface AttendanceSummary {
  courses: CourseAttendance[];
  overallPercentage: number;
  totalAttended: number;
  totalDelivered: number;
  totalCourses: number;
  totalClasses?: number;
  totalAbsent?: number;
  canBunkClasses?: number;
  mustAttendClasses?: number;
  studentName?: string;
  registrationNumber?: string;
  status?: string;
  source?: string;
  extractedAt?: string | number;
  fetchedAt?: string | number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageElement {
  id: string;
  tag: string;
  role?: string;
  text: string;
  ariaLabel?: string;
  placeholder?: string;
  href?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  visible: boolean;
  enabled: boolean;
  clickable?: boolean;
  visualDescription?: string;
  semanticCategory?: 'navigation' | 'button' | 'table' | 'input' | 'tab' | 'modal' | 'unknown';
}

export interface VisionTargetCandidate {
  bbox?: BoundingBox;
  targetDescription: string;
  confidence: number;
  visualFeatures?: string[];
  intentLabel?: string;
}

export interface ConfidenceBreakdown {
  confidence: number;
  semanticScore: number;
  visualScore: number;
  spatialScore: number;
  visibilityScore: number;
  interactionScore: number;
}

export interface GroundedCandidate {
  element: PageElement;
  confidence: number;
  breakdown: ConfidenceBreakdown;
  matchReason: string;
}

export interface GroundedTarget {
  elementId: string;
  selector?: string;
  role?: string;
  accessibleName?: string;
  text?: string;
  boundingRect: BoundingBox;
  center: { x: number; y: number };
  pageStateId: string;
  confidence: number;
  source: 'DOM' | 'VISION' | 'ACCESSIBILITY' | 'HYBRID';
  timestamp: number;
}

export interface HybridGroundingResult {
  bestCandidate?: GroundedCandidate;
  allCandidates: GroundedCandidate[];
  strategyUsed: 'dom_high_confidence' | 'vision_dom_fusion' | 'heuristic_fallback';
  isConfident: boolean;
}

export interface PageObservation {
  url: string;
  title: string;
  pageType: string;
  isLoginPage?: boolean;
  isAuthenticated?: boolean;
  umsSessionId?: string;
  studentName?: string;
  hasAttendanceTable: boolean;
  elements: PageElement[];
  screenshot?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  devicePixelRatio?: number;
  summaryText?: string;
  pageStateId?: string;
}

export type AgentActionType =
  | 'click'
  | 'type'
  | 'scroll'
  | 'select'
  | 'hover'
  | 'wait'
  | 'goBack'
  | 'extractAttendance'
  | 'finish'
  | 'fail';

export interface AgentAction {
  action: AgentActionType;
  elementId?: string;
  targetCoordinates?: { x: number; y: number };
  groundedTarget?: GroundedTarget;
  text?: string;
  direction?: 'up' | 'down';
  amount?: number;
  value?: string;
  durationMs?: number;
  reason: string;
  expectedOutcome?: string;
  attemptNumber?: number;
  maxAttempts?: number;
  recoveryStrategy?: string;
  verificationStatus?: 'pending' | 'verified' | 'failed' | 'retrying';
  confidenceBreakdown?: ConfidenceBreakdown;
  goal?: string;
}

export interface AgentPlanResponse {
  action: AgentAction;
  thought?: string;
  visionTarget?: VisionTargetCandidate;
  isGoalComplete?: boolean;
  finalAnswer?: string;
  modelUsed?: string;
  isFallback?: boolean;
}

export type AgentStage =
  | 'OBSERVE'
  | 'THINK'
  | 'LOCATE'
  | 'VERIFY'
  | 'MOVE'
  | 'ACT'
  | 'EXTRACT'
  | 'VALIDATE'
  | 'DONE';

export type AgentLoopStatus =
  | 'idle'
  | 'observing'
  | 'thinking'
  | 'planning'
  | 'locating'
  | 'grounding'
  | 'verifying_target'
  | 'moving'
  | 'settling'
  | 'executing'
  | 'acting'
  | 'waiting_for_page'
  | 'reobserving'
  | 'verifying'
  | 'verifying_result'
  | 'extracting'
  | 'validating'
  | 'responding'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'paused'
  | 'error';

export interface ExecutionContext {
  taskId: string;
  executionId: string;
  pageStateId: string;
  startTime: number;
}

export interface ActionTelemetry {
  actionId: string;
  taskId: string;
  pageStateId: string;
  targetId?: string;
  targetConfidence?: number;
  targetSource?: string;
  movementDuration?: number;
  movementDistance?: number;
  attemptNumber: number;
  verificationResult: 'PASS' | 'FAIL' | 'PENDING';
  failureReason?: string;
  recoveryStrategy?: string;
  timestamp: number;
}

export interface AgentActivity {
  id: string;
  step?: number;
  stage?: AgentStage;
  title: string;
  detail?: string;
  status: 'completed' | 'in_progress' | 'pending' | 'warning' | 'error';
  timestamp: number | string;
}

export type FinalResponseType = 'lowest_attendance' | 'full_summary' | 'safe_bunk' | 'general';

export interface FinalResponseData {
  status: 'ANALYZING' | 'WAITING_VERIFICATION' | 'READY';
  type: FinalResponseType;
  title: string;
  subjectCode?: string;
  subjectName?: string;
  percentage?: number;
  attended?: number;
  delivered?: number;
  safeBuffer?: number;
  highlightText?: string;
  explanation?: string;
  details?: {
    highestSubjects?: string[];
    lowestSubjects?: string[];
    overallPercentage?: number;
    totalCourses?: number;
    bunkCalculations?: string[];
  };
  verification: {
    verified: boolean;
    source: string;
    subjectsChecked: number;
    timestamp: string | number;
    executionStatus: string;
  };
}

export interface AgentState {
  status: AgentLoopStatus;
  currentGoal?: string;
  currentStep: number;
  maxSteps: number;
  currentAction?: AgentAction;
  executionContext?: ExecutionContext;
  lastObservation?: PageObservation;
  lastGroundingResult?: HybridGroundingResult;
  lastTelemetry?: ActionTelemetry;
  finalResponse?: FinalResponseData;
  debugMode?: boolean;
  motionMode?: 'natural' | 'fast';
  activities: AgentActivity[];
  finalResult?: string;
  errorMessage?: string;
  activeModel?: string;
  isFallbackModel?: boolean;
  retryContext?: {
    lastFailedAction?: string;
    attemptCount?: number;
    reason?: string;
  };
}
