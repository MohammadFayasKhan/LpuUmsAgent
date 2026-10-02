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

export interface SamplePaperInfo {
  available: boolean;
  label?: string;
  href?: string;
  elementId?: string;
  examIdentity?: string;
}

export interface ExamRecord {
  id?: string;
  courseCode: string;
  courseName?: string;
  examType?: string;
  examDate: string;
  rawDate?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  reportingTime?: string;
  venue?: string;
  room?: string;
  building?: string;
  seat?: string;
  mode?: string;
  status?: string;
  instructions?: string;
  samplePaper?: SamplePaperInfo;
  sourceElement?: string;
}

export type ExaminationRecord = ExamRecord;

export interface SamplePaperResult {
  success?: boolean;
  error?: string;
  courseCode: string;
  examDate?: string | null;
  examType?: string | null;
  pdfUrl?: string | null;
  paperUrl?: string | null;
  fileName?: string | null;
  actionTaken: 'opened_in_tab' | 'downloaded' | 'preview_ready';
  verified: boolean;
}

export interface ExtractionDiagnostics {
  candidateContainers: string[];
  candidateRecordCount: number;
  successfullyParsedCount: number;
  rejectedCount: number;
  rejectionReasons: Array<{
    candidateIdentifier?: string;
    courseCode?: string;
    reason: string;
    rawSnippet?: string;
  }>;
  discoveryStrategiesUsed: string[];
  pageExpectedCount?: number;
}

export interface ExaminationSummary {
  exams: ExamRecord[];
  totalExams: number;
  studentName?: string;
  registrationNumber?: string;
  studentId?: string;
  capturedAt: number;
  verified?: boolean;
  source?: string;
  pageUrl?: string;
  diagnostics?: ExtractionDiagnostics;
}

export interface ExaminationValidationResult {
  valid: boolean;
  issues: string[];
  verifiedCount: number;
  examsChecked?: number;
}

export type TimetableDay = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

export interface TimetableSlot {
  id?: string;
  day: TimetableDay;
  time: string; // e.g. "09:30-10:20 AM"
  startTime?: string;
  endTime?: string;
  type: 'Lecture' | 'Practical' | 'Tutorial' | 'Project Work' | string;
  group?: string; // e.g. "All", "0", "1"
  courseCode?: string; // e.g. "CSE329"
  courseTitle?: string; // e.g. "PRELUDE TO COMPETITIVE CODING"
  room?: string; // e.g. "38-917"
  block?: string; // e.g. "38"
  roomNumber?: string; // e.g. "917"
  section?: string; // e.g. "K4E0061"
  facultyName?: string;
  facultyCabin?: string;
  rawText: string;
}

export interface CourseFacultyRecord {
  courseCode: string; // e.g. "CSE329"
  courseType?: string; // e.g. "PW", "CR", "EM", "OM", "PE", "TE"
  courseTypeName?: string; // e.g. "Core", "Department Elective"
  courseTitle: string; // e.g. "PRELUDE TO COMPETITIVE CODING"
  lectures: number;
  tutorial: number;
  practical: number;
  credits: number;
  facultyName?: string; // e.g. "Raj Karan Singh"
  facultyCabin?: string; // e.g. "26-207-WOW1"
  facultyBlock?: string; // e.g. "26"
  facultyRoom?: string; // e.g. "207"
  cabinNumber?: string; // e.g. "WOW1"
  lastUpdated?: string; // e.g. "Mar 9 2026 4:07PM"
}

export interface TimetableSummary {
  vid: string; // e.g. "12413692"
  homeSection: string; // e.g. "K3P24WM"
  printedOn?: string;
  slots: TimetableSlot[];
  courses: CourseFacultyRecord[];
  totalSlots: number;
  totalCourses: number;
  totalCredits: number;
  capturedAt: number;
  verified: boolean;
  source: string;
}

export interface TimetableValidationResult {
  valid: boolean;
  issues: string[];
  slotsCount: number;
  coursesCount: number;
}

export type AgentCapability = 'ATTENDANCE' | 'EXAM_DATE_SHEET' | 'SEATING_PLAN' | 'SAMPLE_PAPER' | 'TIMETABLE';

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
  hasCampusDriveModal?: boolean;
  hasExamTable?: boolean;
  isExamPage?: boolean;
  isExamContentRendered?: boolean;
  examRecordsCount?: number;
  isTimetablePage?: boolean;
  hasTimetableGrid?: boolean;
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
  | 'scrollContainer'
  | 'select'
  | 'hover'
  | 'wait'
  | 'waitForRender'
  | 'goBack'
  | 'extractAttendance'
  | 'extractExamination'
  | 'extractSeatingPlan'
  | 'extractTimetable'
  | 'openAcademicsTimetableMenu'
  | 'dismissPopup'
  | 'openSamplePaper'
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
  | 'UMS_PREFLIGHT'
  | 'THINK'
  | 'LOCATE'
  | 'WAIT_FOR_RENDER'
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
  | 'waiting_for_render'
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
  preflightDismissed?: boolean;
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

export type FinalResponseType =
  | 'lowest_attendance'
  | 'full_summary'
  | 'safe_bunk'
  | 'general'
  | 'next_exam'
  | 'exam_date_sheet'
  | 'seating_plan'
  | 'sample_paper'
  | 'timetable';

export interface SuggestedSubAction {
  id: string;
  label: string;
  actionGoal: string;
  courseCode: string;
  examDate?: string;
  examType?: string;
  description?: string;
  badge?: string;
  icon?: string;
}

export interface FinalResponseData {
  status: 'ANALYZING' | 'WAITING_VERIFICATION' | 'READY' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED';
  type: FinalResponseType;
  title: string;
  capability?: AgentCapability;
  subjectCode?: string;
  subjectName?: string;
  percentage?: number;
  attended?: number;
  delivered?: number;
  safeBuffer?: number;
  highlightText?: string;
  explanation?: string;
  samplePaperResult?: SamplePaperResult;
  timetable?: TimetableSummary;
  suggestedSubAction?: SuggestedSubAction;
  suggestedSubActions?: SuggestedSubAction[];
  details?: {
    highestSubjects?: string[];
    lowestSubjects?: string[];
    overallPercentage?: number;
    totalCourses?: number;
    bunkCalculations?: string[];
    exams?: ExamRecord[];
    nextExam?: ExamRecord;
    upcomingExams?: ExamRecord[];
    venue?: string;
    room?: string;
    building?: string;
    seat?: string;
    reportingTime?: string;
    mode?: string;
    totalExams?: number;
    timetable?: TimetableSummary;
    todayClasses?: TimetableSlot[];
    currentOrNextClass?: TimetableSlot;
    homeSection?: string;
    vid?: string;
    courses?: CourseFacultyRecord[];
    selectedDay?: TimetableDay | 'All';
  };
  verification: {
    verified: boolean;
    source: string;
    subjectsChecked?: number;
    examsChecked?: number;
    slotsChecked?: number;
    timestamp: string | number;
    executionStatus: string;
  };
}

export interface AgentState {
  status: AgentLoopStatus;
  capability?: AgentCapability;
  currentGoal?: string;
  currentStep: number;
  maxSteps: number;
  currentAction?: AgentAction;
  executionContext?: ExecutionContext;
  lastObservation?: PageObservation;
  lastGroundingResult?: HybridGroundingResult;
  lastTelemetry?: ActionTelemetry;
  finalResponse?: FinalResponseData;
  examination?: ExaminationSummary;
  timetable?: TimetableSummary;
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
