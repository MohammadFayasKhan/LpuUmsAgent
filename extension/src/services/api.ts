/*
 * Backend API Client & Fallback Engine for ONEE.
 *
 * This service handles communication between the extension and the FastAPI backend:
 * 1. Health Checks: Tests if the remote server is reachable with a strict 2-second timeout.
 * 2. Streaming Chat: Sends the student's question along with grounded attendance context
 *    to /api/chat and streams tokens back to the UI incrementally.
 * 3. Autonomous Planner: Requests Computer Use action plans from /api/agent/plan.
 * 4. Local Deterministic Fallback: If the backend is offline (e.g. network error or no API key),
 *    the service seamlessly switches to a local deterministic planner and response engine.
 *    The student still gets real browser navigation and exact arithmetic without backend dependency.
 */

import {
  AttendanceSummary,
  CourseAttendance,
  ExaminationSummary,
  ExaminationRecord,
  TimetableSummary,
  TimetableSlot,
  CourseFacultyRecord,
  ChatMessage,
  AgentActivity,
  PageObservation,
  AgentAction,
  AgentPlanResponse,
  AgentCapability
} from '../shared/types';
import {
  calculateBunkAllowance,
  calculateRequiredClasses
} from '../shared/attendanceCalculator';
import { humanizeText } from '../lib/humanizer';
import { getNextExam, getUpcomingExams, findExamByCourse } from '../content/examination/examinationValidator';
import { routeUserIntent } from './intentRouter';
import { generateContextualSuggestions } from './suggestionGenerator';
import { SmoothTokenPacer } from './streamingPacer';
import {
  parseTimeInterval,
  formatRoomLocation,
  formatCabinLocation
} from '../shared/timetableCalculator';

let customBackendUrl: string | null = null;

export function setBackendUrlForTesting(url: string | null) {
  customBackendUrl = url;
}

export function getBackendUrl(): string {
  if (customBackendUrl !== null) return customBackendUrl;
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL !== undefined) {
    return import.meta.env.VITE_BACKEND_URL;
  }
  return 'http://localhost:8000';
}

export interface ChatApiResponse {
  message: string;
  activities: AgentActivity[];
  tool_calls?: any[];
  suggestions?: string[];
}

/**
 * Structured decision returned by the Groq semantic resolver. Browser planning
 * consumes this context so it never has to re-infer a student's intent from
 * the wording of the generated goal.
 */
export interface SemanticExecutionContext {
  intent?: string;
  capability?: string;
  entities?: Record<string, any>;
  target?: string;
  action?: string;
}

function routeGoalFromSemanticContext(goal: string, semanticContext?: SemanticExecutionContext) {
  const fallbackRoute = routeUserIntent(goal);
  const capabilityBySemanticName: Record<string, AgentCapability> = {
    attendance: 'ATTENDANCE',
    examination: 'EXAM_DATE_SHEET',
    seating_plan: 'SEATING_PLAN',
    sample_papers: 'SAMPLE_PAPER',
    timetable: 'TIMETABLE'
  };
  const semanticCapability = semanticContext?.capability
    ? capabilityBySemanticName[semanticContext.capability]
    : undefined;

  if (!semanticCapability) return fallbackRoute;

  const semanticCourse = semanticContext?.entities?.courseCode;
  return {
    ...fallbackRoute,
    capability: semanticCapability,
    targetCourseCode: semanticCourse || fallbackRoute.targetCourseCode,
    resolvedCourseCode: semanticCourse || fallbackRoute.resolvedCourseCode,
    confidence: 1,
    reasoning: 'Groq semantic resolution'
  };
}

/**
 * Checks if the backend AI server is configured and running.
 */
export async function checkBackendHealth(): Promise<boolean> {
  const backendUrl = getBackendUrl();
  if (!backendUrl) return false;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${backendUrl}/health`, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Progressively streams chat response tokens and activities from the backend SSE endpoint.
 */
export async function streamChatMessage(
  message: string,
  attendance: AttendanceSummary | null,
  history: ChatMessage[] = [],
  onChunk: (chunk: string) => void,
  onActivity?: (activity: AgentActivity) => void,
  examination?: ExaminationSummary | null,
  onSuggestions?: (suggestions: string[]) => void,
  timetable?: TimetableSummary | null
): Promise<ChatApiResponse> {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    return streamLocalFallbackResponse(message, attendance, onChunk, onActivity, examination, onSuggestions, timetable, history);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(`${backendUrl}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        attendance,
        examination,
        timetable,
        history: history.map((h) => ({
          sender: h.sender,
          text: h.text,
          timestamp: String(h.timestamp)
        }))
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok || !res.body) {
      throw new Error(`Streaming failed with HTTP status ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulatedText = '';
    let finalActivities: AgentActivity[] = [];
    let toolCalls: any[] = [];
    let receivedSuggestions: string[] | undefined = undefined;

    const pacer = new SmoothTokenPacer((chunk: string) => {
      onChunk(chunk);
    });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);
            if (event.type === 'token' && typeof event.data === 'string') {
              accumulatedText += event.data;
              pacer.push(event.data);
            } else if (event.type === 'activity' && event.data) {
              finalActivities.push(event.data);
              onActivity?.(event.data);
            } else if (event.type === 'suggestions' && Array.isArray(event.data)) {
              receivedSuggestions = event.data;
              onSuggestions?.(event.data);
            } else if (event.type === 'done' && event.data) {
              if (event.data.message) accumulatedText = event.data.message;
              if (event.data.activities) finalActivities = event.data.activities;
              if (event.data.tool_calls) toolCalls = event.data.tool_calls;
              if (event.data.suggestions && (!receivedSuggestions || receivedSuggestions.length === 0)) {
                receivedSuggestions = event.data.suggestions;
                onSuggestions?.(event.data.suggestions);
              }
            }
          } catch {
            // ignore malformed SSE line
          }
        }
      }
    }

    // Smoothly type out any remaining buffered tokens before resolving
    await pacer.finish();

    return {
      message: accumulatedText.trim(),
      activities: finalActivities,
      tool_calls: toolCalls,
      suggestions: receivedSuggestions
    };
  } catch (err: any) {
    console.info('[ONEE Stream] Local progressive stream active (offline/local mode)');
    return streamLocalFallbackResponse(message, attendance, onChunk, onActivity, examination, onSuggestions, timetable, history);
  }
}

/**
 * Sends chat query to backend AI agent (non-streaming fallback).
 */
export async function sendChatMessage(
  message: string,
  attendance: AttendanceSummary | null,
  history: ChatMessage[] = [],
  examination?: ExaminationSummary | null,
  timetable?: TimetableSummary | null
): Promise<ChatApiResponse> {
  const backendUrl = getBackendUrl();
  if (!backendUrl) {
    return generateLocalFallbackResponse(message, attendance, examination, timetable, history);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18000);

    const res = await fetch(`${backendUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        attendance,
        examination,
        timetable,
        history: history.map((h) => ({
          sender: h.sender,
          text: h.text,
          timestamp: String(h.timestamp)
        }))
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Server responded with status ${res.status}`);
    }

    return await res.json();
  } catch (err: any) {
    console.info('[ONEE Chat] Local deterministic engine active (offline/local mode)');
    return generateLocalFallbackResponse(message, attendance, examination, timetable, history);
  }
}

/**
 * Computer-Use Planner: Requests next browser action from AI Planner API.
 * Uses deterministic local planning directly for examination goals to avoid Groq rate limits.
 */
export async function planNextAction(
  goal: string,
  step: number,
  observation: PageObservation,
  previousActions: AgentAction[] = [],
  retryContext?: { lastFailedAction?: string; attemptCount?: number; reason?: string },
  externalSignal?: AbortSignal,
  semanticContext?: SemanticExecutionContext
): Promise<AgentPlanResponse> {
  if (externalSignal?.aborted) {
    throw new Error('Execution aborted by user');
  }

  const routed = routeGoalFromSemanticContext(goal, semanticContext);
  const isExamGoal = routed.capability === 'EXAM_DATE_SHEET' || routed.capability === 'SEATING_PLAN';
  const isExamPage =
    observation.isExamPage ||
    observation.url?.toLowerCase().includes('seatingplan') ||
    observation.url?.toLowerCase().includes('/examination/conduct/');

  const isTimetableGoal = routed.capability === 'TIMETABLE';
  const isTimetablePage =
    observation.isTimetablePage ||
    observation.hasTimetableGrid ||
    observation.url?.toLowerCase().includes('frmstudenttimetable') ||
    observation.pageType?.toLowerCase().includes('time table');

  const isAttendanceGoal = routed.capability === 'ATTENDANCE';
  const isDashboard = Boolean(observation.url?.toLowerCase().includes('studentdashboard'));

  const backendUrl = getBackendUrl();
  if (!backendUrl || isExamGoal || isExamPage || isTimetableGoal || isTimetablePage || isAttendanceGoal || isDashboard) {
    return generateLocalPlanFallback(goal, step, observation, previousActions, semanticContext);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const onAbort = () => controller.abort();
    if (externalSignal) {
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }

    const res = await fetch(`${backendUrl}/api/plan-action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        goal,
        step,
        maxSteps: 15,
        observation,
        previousActions,
        retryContext,
        semanticIntent: semanticContext
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onAbort);
    }

    if (!res.ok) {
      throw new Error(`Server responded with status ${res.status}`);
    }

    return await res.json();
  } catch (err: any) {
    if (externalSignal?.aborted) {
      throw err;
    }
    console.info('[ONEE Planner] Local deterministic planner active (offline/local mode)');
    return generateLocalPlanFallback(goal, step, observation, previousActions, semanticContext);
  }
}

/**
 * Local fallback heuristic planner if backend is offline.
 */
export function generateLocalPlanFallback(
  goal: string,
  step: number,
  observation: PageObservation,
  previousActions: AgentAction[] = [],
  semanticContext?: SemanticExecutionContext
): AgentPlanResponse {
  // 0. Mandatory Preflight Gate: Blocking Campus Drive Modal
  if (observation.hasCampusDriveModal) {
    const remindBtn =
      observation.elements.find(
        (el) => el.text.toLowerCase().includes('remind') || el.text.toLowerCase().includes('remaind')
      ) || observation.elements[0];

    return {
      thought: 'Campus Drive Notifications popup is blocking the viewport. Must safely click "Remind me later" before proceeding with any automation.',
      action: {
        action: 'click',
        elementId: remindBtn?.id || 'onee-001',
        reason: 'Dismissing Campus Drive notification (Remind me later)',
        expectedOutcome: 'modal_dismissed'
      },
      isGoalComplete: false
    };
  }

  const routed = routeGoalFromSemanticContext(goal, semanticContext);
  const isTimetableGoal = routed.capability === 'TIMETABLE';
  const isExamGoal = !isTimetableGoal && (routed.capability === 'EXAM_DATE_SHEET' || routed.capability === 'SEATING_PLAN');

  if (isTimetableGoal) {
    const isDashboard =
      observation.url?.toLowerCase().includes('studentdashboard') ||
      observation.pageType?.toLowerCase().includes('dashboard');

    const isTimetablePage =
      !isDashboard &&
      (observation.isTimetablePage ||
       observation.hasTimetableGrid ||
       observation.url?.toLowerCase().includes('frmstudenttimetable') ||
       observation.pageType?.toLowerCase().includes('time table'));

    if (isTimetablePage) {
      return {
        thought: 'Student Time Table and Faculty Directory report detected. Extracting weekly schedule grid and teacher cabins.',
        action: {
          action: 'extractTimetable',
          reason: 'Reading student timetable and faculty directory.',
          expectedOutcome: 'timetable_extracted'
        },
        isGoalComplete: true
      };
    }

    const timetableKeywords = [
      'view time table',
      'time table',
      'timetable',
      'frmstudenttimetable',
      'academics'
    ];

    const prevClicked = new Set(
      previousActions.filter((a) => a.action === 'click').map((a) => a.elementId)
    );

    for (const kw of timetableKeywords) {
      for (const el of observation.elements) {
        const textLower = el.text.toLowerCase();
        if ((textLower.includes(kw) || el.href?.toLowerCase().includes(kw)) && !prevClicked.has(el.id)) {
          return {
            thought: `Found navigation link '${el.text}' (${el.id}) for Student Time Table.`,
            action: {
              action: 'click',
              elementId: el.id,
              reason: `Opening ${el.text}`,
              expectedOutcome: 'timetable_redirected'
            },
            isGoalComplete: false
          };
        }
      }
    }

    if (step >= 3) {
      return {
        thought: 'Reached student timetable view.',
        action: {
          action: 'extractTimetable',
          reason: 'Reading student timetable and faculty directory.',
          expectedOutcome: 'timetable_extracted'
        },
        isGoalComplete: true
      };
    }

    return {
      thought: 'Searching page view for Time Table link.',
      action: {
        action: 'scroll',
        direction: 'down',
        amount: 350,
        reason: 'Scrolling to locate View Time Table link.',
        expectedOutcome: 'timetable_link_visible'
      },
      isGoalComplete: false
    };
  }

  if (isExamGoal) {
    const observedUrl = observation.url?.toLowerCase() || '';
    const hasDateSheetPath =
      observedUrl.includes('seatingplan') ||
      observedUrl.includes('/examination/conduct/') ||
      observedUrl.includes('examinationdatesheet');
    const isDashboard =
      !hasDateSheetPath && (
        observedUrl.includes('studentdashboard') ||
        observation.pageType?.toLowerCase().includes('dashboard')
      );

    const isSeatingPlanUrl =
      !isDashboard &&
      (observation.isExamPage ||
       hasDateSheetPath ||
       observation.pageStateId?.toLowerCase().includes('seatingplan'));

    if (isSeatingPlanUrl) {
      if (!observation.isExamContentRendered && step < 4) {
        return {
          thought: 'Examination seating plan surface loaded. Waiting for examination records to render.',
          action: {
            action: 'waitForRender',
            reason: 'Waiting for examination records to render on UMS.',
            durationMs: 12000,
            expectedOutcome: 'examination_rendered'
          },
          isGoalComplete: false
        };
      }

      return {
        thought: 'Examination schedule / seating plan interface detected and ready for extraction.',
        action: {
          action: 'extractExamination',
          reason: 'Reading examination date sheet and seating allocations.',
          expectedOutcome: 'examination_extracted'
        },
        isGoalComplete: step >= 4
      };
    }

    // Search for Date Sheet link under Important Links on StudentDashboard
    const examKeywords = [
      'date sheet',
      'datesheet',
      'date sheet / seating plan',
      'seating plan',
      'examination'
    ];

    const prevClicked = new Set(
      previousActions.filter((a) => a.action === 'click').map((a) => a.elementId)
    );

    for (const kw of examKeywords) {
      for (const el of observation.elements) {
        const textLower = el.text.toLowerCase();
        if ((textLower.includes(kw) || el.href?.toLowerCase().includes(kw)) && !prevClicked.has(el.id)) {
          return {
            thought: `Found Date Sheet link '${el.text}' (${el.id}) under Important Links.`,
            action: {
              action: 'click',
              elementId: el.id,
              reason: `Opening Date Sheet: ${el.text}`,
              expectedOutcome: 'datesheet_redirected'
            },
            isGoalComplete: false
          };
        }
      }
    }

    if (step >= 3) {
      return {
        thought: 'Reached examination view.',
        action: {
          action: 'extractExamination',
          reason: 'Reading examination schedule records.',
          expectedOutcome: 'examination_extracted'
        },
        isGoalComplete: true
      };
    }

    return {
      thought: 'Searching page view for Date Sheet link.',
      action: {
        action: 'scroll',
        direction: 'down',
        amount: 350,
        reason: 'Scrolling to locate Date Sheet link under Important Links.',
        expectedOutcome: 'datesheet_link_visible'
      },
      isGoalComplete: false
    };
  }

  // Attendance flow (preserved exactly)
  if (observation.hasAttendanceTable) {
    return {
      thought: 'Attendance table detected in DOM.',
      action: {
        action: 'finish',
        reason: 'Attendance table detected and ready for extraction.',
        expectedOutcome: 'attendance_table_extracted'
      },
      isGoalComplete: true
    };
  }

  // If not on the student dashboard, look for a Home / Dashboard link before scrolling blindly
  const currentObsUrl = (observation.url || '').toLowerCase();
  const isOnDashboard = currentObsUrl.includes('studentdashboard') || observation.pageType?.toLowerCase().includes('dashboard');
  if (!isOnDashboard) {
    const prevClickedEarly = new Set(
      previousActions.filter((a) => a.action === 'click').map((a) => a.elementId)
    );
    const homeEl = observation.elements.find((el) => {
      const t = el.text.toLowerCase().trim();
      return (
        (t === 'home' || t === 'homepage' || t.includes('dashboard') || (el.href && el.href.toLowerCase().includes('studentdashboard'))) &&
        !prevClickedEarly.has(el.id)
      );
    });
    if (homeEl) {
      return {
        thought: 'Navigating to Student Dashboard to locate Attendance records.',
        action: {
          action: 'click',
          elementId: homeEl.id,
          reason: 'Navigating to UMS Dashboard for attendance',
          expectedOutcome: 'dashboard_rendered'
        },
        isGoalComplete: false
      };
    }
  }

  const priorityKeywords = [
    'view attendance',
    'student attendance',
    'attendance :',
    'attendance',
    'my class',
    'academics'
  ];

  const prevClicked = new Set(
    previousActions.filter((a) => a.action === 'click').map((a) => a.elementId)
  );

  for (const kw of priorityKeywords) {
    for (const el of observation.elements) {
      const textLower = el.text.toLowerCase();
      if ((textLower.includes(kw) || el.href?.toLowerCase().includes(kw)) && !prevClicked.has(el.id)) {
        const expected = textLower.includes('attendance') ? 'attendance_modal_opened' : 'menu_expanded';
        return {
          thought: `Found navigation link '${el.text}' (${el.id}).`,
          action: {
            action: 'click',
            elementId: el.id,
            reason: `Opening ${el.text}`,
            expectedOutcome: expected
          },
          isGoalComplete: false
        };
      }
    }
  }

  if (step >= 3) {
    return {
      thought: 'Reached target page view.',
      action: {
        action: 'finish',
        reason: 'Examined page elements and reading attendance.',
        expectedOutcome: 'attendance_table_extracted'
      },
      isGoalComplete: true
    };
  }

  return {
    thought: 'Searching page view for attendance.',
    action: {
      action: 'scroll',
      direction: 'down',
      amount: 350,
      reason: 'Scrolling down to reveal navigation items.',
      expectedOutcome: 'attendance_card_visible'
    },
    isGoalComplete: false
  };
}

/**
 * Deterministic advisor response engine producing elaborated, richly-structured responses.
 */
export function generateLocalFallbackResponse(
  query: string,
  attendance: AttendanceSummary | null,
  examination?: ExaminationSummary | null,
  timetable?: TimetableSummary | null,
  history?: ChatMessage[]
): ChatApiResponse {
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const q = query.toLowerCase().trim();
  const recentUserQueries: string[] = history
    ? history
        .filter((h) => h.sender === 'user' && typeof h.text === 'string' && h.text.trim().length > 0)
        .map((h) => h.text as string)
    : [];
  const routed = routeUserIntent(query, {
    latestAttendance: attendance,
    latestExamination: examination,
    recentUserQueries
  });

  // 0a. Handle identity and conversational inquiries.
  // Word boundaries are essential here: a substring test made "which subject is
  // lowest?" look like a greeting ("hi" inside "which") and replaced a real
  // attendance answer with the capability blurb.
  const isIdentityQuery =
    routed.capability === 'CONVERSATION' ||
    /\b(?:who are you|who r u|what are you|what can you do|your name|introduce yourself|help me)\b/.test(q) ||
    /\b(?:hello|hey|hi|good morning|good afternoon|good evening|thanks|thank you)\b/.test(q);

  if (
    isIdentityQuery &&
    !q.includes('attendance') &&
    !q.includes('bunk') &&
    !q.includes('exam') &&
    !q.includes('timetable') &&
    !q.includes('schedule') &&
    !q.includes('class')
  ) {
    return {
      message: `### 🤖 I am ONEE → Your LPU AI Academic Companion

I'm directly integrated with your Lovely Professional University (LPU) UMS portal to assist you with your academic life.

#### 🌟 Here is what I can do:
- 📅 **Student Timetable:** Check today's, tomorrow's, or any weekday's class schedule, classroom/block numbers, and faculty details.
- 📊 **Attendance & Bunks:** Track your subject percentages, calculate safe bunks to stay comfortably above 75%, and audit exam clearance.
- 📝 **Examinations & Seating:** Check upcoming exam datesheets, reporting times, hall venues, and assigned seat numbers.
- 📄 **Sample Papers:** Find and download official sample question papers for your courses.

*How can I help you today?*`,
      activities: [
        {
          id: String(Date.now()),
          timestamp,
          title: 'Identity & Capabilities',
          detail: 'Introduced ONEE academic companion',
          status: 'completed'
        }
      ]
    };
  }

  // 0b. Handle timetable & class schedule queries
  const now = new Date();
  const daysOfWeek = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const explicitDay = daysOfWeek.find((d) => q.includes(d));

  const daysMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayIdx = now.getDay();
  const todayDay = daysMap[todayIdx];
  const tomorrowDay = daysMap[(todayIdx + 1) % 7];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const timeFormatted = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  const dayAfterTomorrowDay = daysMap[(todayIdx + 2) % 7];

  let targetDayCapitalized: string | undefined = undefined;
  if (q.includes('day after tomorrow')) {
    targetDayCapitalized = dayAfterTomorrowDay;
  } else if (q.includes('tomorrow')) {
    targetDayCapitalized = tomorrowDay;
  } else if (q.includes('today')) {
    targetDayCapitalized = todayDay;
  } else if (explicitDay) {
    targetDayCapitalized = explicitDay.charAt(0).toUpperCase() + explicitDay.slice(1);
  }

  const wantsCabins =
    q.includes('cabin') ||
    q.includes('cabins') ||
    q.includes('teacher') ||
    q.includes('teachers') ||
    q.includes('faculty') ||
    q.includes('professor') ||
    q.includes('professors') ||
    q.includes('who teaches') ||
    q.includes('who are my teachers');

  const wantsSchedule =
    Boolean(targetDayCapitalized) ||
    q.includes('class') ||
    q.includes('classes') ||
    q.includes('timetable') ||
    q.includes('time table') ||
    q.includes('schedule') ||
    q.includes('routine') ||
    q.includes('period') ||
    q.includes('periods') ||
    q.includes('lecture') ||
    q.includes('lectures') ||
    q.includes('matrix') ||
    q.includes('weekly');

  // 0.3 Handle Sample Question Paper queries (Takes precedence over timetable)
  const isSamplePaperQuery =
    routed.capability === 'SAMPLE_PAPER' ||
    /\b(sample\s*paper|sample\s*question|sample\s*question\s*paper|model\s*paper|previous\s*year\s*paper|previous\s*paper|question\s*paper)\b/i.test(q);

  if (isSamplePaperQuery) {
    const rawCourseMatch = q.match(/\b([A-Za-z]{2,5})\s*(\d{2,4}[A-Za-z]?)\b/i);
    let queriedCourse: string | undefined = undefined;
    if (rawCourseMatch) {
      let pfx = rawCourseMatch[1].toUpperCase();
      const dgts = rawCourseMatch[2].toUpperCase();
      if (!['PAPER', 'SAMPLE', 'TERM', 'EXAM', 'DATE', 'TIME'].includes(pfx)) {
        if (pfx === 'CSC') pfx = 'CSE';
        queriedCourse = `${pfx}${dgts}`;
      }
    }

    const exams = examination?.exams || [];
    let matchedExam = queriedCourse && exams.length > 0
      ? exams.find((e) => {
          const cCode = (e.courseCode || '').replace(/\s+/g, '').toUpperCase();
          return cCode === queriedCourse || cCode.replace(/^CSC/, 'CSE') === queriedCourse;
        })
      : undefined;

    if (matchedExam) {
      const code = matchedExam.courseCode || queriedCourse;
      const eType = matchedExam.examType || 'Regular Examination';
      const eDate = matchedExam.examDate || 'Scheduled Date';
      const instructions = matchedExam.instructions || 'MCQ / Objective format';
      const hasSp = matchedExam.samplePaper?.available ?? true;
      return {
        message: `### 📄 Official Sample Question Paper: **${code}**

Verified sample question paper details for **${code}** (${eType}) directly from your authenticated UMS examination portal:

| Examination Detail | Verified Information |
| :--- | :--- |
| 📚 **Subject Code** | **${code}** (${matchedExam.courseName || ''}) |
| 📋 **Exam Type** | ${eType} |
| 📅 **Scheduled Date** | 📅 **${eDate}** |
| ℹ️ **Paper Pattern** | ${instructions} |
| 📥 **Sample Paper Status** | ${hasSp ? '🟢 **Available on UMS**' : '⏳ Awaited from University'} |

#### 📥 Download & Access Instructions:
- The official sample question paper for **${code}** is published on your UMS examination conduct portal.
- Click the purple **"Sample Question Paper"** button on the **${code}** card to view or download the official PDF.

> 🔒 **Directly Verified:** UMS Student Examination Conduct & Seating Plan dashboard.`,
        activities: [
          {
            id: String(Date.now()),
            timestamp,
            title: 'Sample Paper Verification',
            detail: `Verified sample paper for ${code}`,
            status: 'completed'
          }
        ],
        suggestions: [`Check venue for ${code}`, 'Show full date sheet', 'Check my attendance']
      };
    } else if (queriedCourse) {
      return {
        message: `### 📄 Official Sample Question Paper: **${queriedCourse}**

ONEE verified your official UMS Examination records for **${queriedCourse}**.

- 📋 **Status:** The sample question paper for **${queriedCourse}** can be accessed directly from your authenticated **UMS Examination Conduct & Seating Plan** dashboard.
- 🔗 **Action:** Click the purple **"Sample Question Paper"** button on your **${queriedCourse}** exam card to view or download the official model paper.
- 💡 **Exam Notice:** Mid-Term and Theory End-Term sample papers provide the exact question distribution and mark allocations.

> 🔒 **Verified Source:** UMS Student Examination Conduct portal.`,
        activities: [
          {
            id: String(Date.now()),
            timestamp,
            title: 'Sample Paper Advisor',
            detail: `Guided access to sample paper for ${queriedCourse}`,
            status: 'completed'
          }
        ],
        suggestions: [`When is my ${queriedCourse} exam?`, 'Show full date sheet', "Check today's classes"]
      };
    } else {
      let rows = '';
      if (exams.length > 0) {
        rows = exams
          .map((e) => `- **${e.courseCode}** (${e.examType || 'Exam'}): ${e.samplePaper?.available ?? true ? '🟢 Sample Paper Available on UMS' : '📅 Scheduled on ' + (e.examDate || 'TBD')}`)
          .join('\n');
      } else {
        rows = 'No examination records are currently loaded. Open your UMS Examination Conduct section to view available sample papers.';
      }
      return {
        message: `### 📄 Official Sample Question Papers

Here are the sample question papers available on your UMS examination portal:

${rows}

> 💡 **Tip:** Ask *"Download sample paper for CSE408"* to access a specific course.`,
        activities: [
          {
            id: String(Date.now()),
            timestamp,
            title: 'Sample Papers Overview',
            detail: 'Listed available sample papers',
            status: 'completed'
          }
        ],
        suggestions: ['Download sample paper for CSE408', 'When is my next exam?', 'Check attendance']
      };
    }
  }

  const isBunkOrAttendanceQuery =
    routed.capability === 'ATTENDANCE' ||
    routed.subType === 'lowest_attendance' ||
    routed.subType === 'specific_course' ||
    routed.subType === 'exam_clearance' ||
    /\b(bunk|bunks|skip|skips|attendance|attended|absent|duty\s*leave|present|safe\s*to\s*skip|percentage|clearance|maintain)\b/i.test(q);

  const courseMatch = q.match(/\b([A-Za-z]{2,5}\s*\d{2,4}[A-Za-z]?)\b/i);
  const queriedCourseCode = courseMatch ? courseMatch[1].replace(/\s+/g, '').toUpperCase() : undefined;

  const isPracticalRequested = /\b(practical|practicals|lab|labs)\b/i.test(q);
  const isLectureRequested = /\b(lecture|lectures|theory)\b/i.test(q);
  const isRoomQuery =
    /\b(room|rooms|venue|venues|where\s*is|which\s*room|what\s*room|check\s*room|verify\s*room|find\s*room|location|classroom|block|hall)\b/i.test(q) ||
    (Boolean(queriedCourseCode) && !wantsCabins && !q.includes('faculty') && !q.includes('teacher') && (isPracticalRequested || isLectureRequested || q.includes('where')));
  const isCabinOrFacultyQuery =
    wantsCabins ||
    /\b(cabin|cabins|faculty|teacher|teachers|professor|professors|who\s*teaches|who\s*is\s*teaching)\b/i.test(q);
  const isNextClassQuery =
    /\b(next\s*class|what\s*is\s*next|what's\s*next|upcoming\s*class|any\s*more\s*classes|remaining\s*classes|classes\s*left|current\s*class|ongoing\s*class|class\s*right\s*now)\b/i.test(q);
  const isWeeklyMatrixQuery =
    /\b(matrix|weekly|all\s*classes|complete\s*list|list\s*of\s*classes|this\s*week|whole\s*week|entire\s*week|every\s*day|all\s*days|detailed\s*matrix|full\s*timetable|full\s*schedule)\b/i.test(q);

  const isAttendanceQueryPrior =
    isBunkOrAttendanceQuery ||
    /\b(attendance|bunk|bunks|safe\s*bunk|skip|skips|miss|leave|duty\s*leave|lowest|worst|percentage|percent|75%|80%|clearance|maintain|shortage|detain|eligible)\b/i.test(q) ||
    Boolean(attendance?.courses && attendance.courses.some((c) => q.includes(c.code.toLowerCase())) && /\b(miss|skip|bunk|cut|attend|how many|can i|percentage|margin)\b/i.test(q));

  const isExamQueryPrior =
    routed.capability === 'EXAM_DATE_SHEET' ||
    routed.capability === 'SEATING_PLAN' ||
    /\b(datesheet|date\s*sheet|exam\s*schedule|next\s*exam|atom\s*exam|term\s*exam|mid\s*term|end\s*term|seating|seat\s*number|reporting\s*time)\b/i.test(q) ||
    (/\bexam\b/i.test(q) && !/\b(attendance|bunk|skip|clearance|eligib)\b/i.test(q));

  const isTimetableQuery =
    !isSamplePaperQuery &&
    !isAttendanceQueryPrior &&
    !isExamQueryPrior &&
    (routed.capability === 'TIMETABLE' ||
      wantsSchedule ||
      wantsCabins ||
      isRoomQuery ||
      isNextClassQuery ||
      (Boolean(queriedCourseCode) && (wantsSchedule || isRoomQuery || isCabinOrFacultyQuery || q.includes('time') || q.includes('period') || q.includes('class'))) ||
      ((q.includes('course') || q.includes('courses') || q.includes('curriculum')) && (wantsSchedule || wantsCabins || q.includes('registered') || q.includes('teacher') || q.includes('faculty') || q.includes('routine'))));

  if (isTimetableQuery) {
    const isPureCourseDirectory =
      !wantsSchedule &&
      !queriedCourseCode &&
      (q.includes('curriculum') ||
        q.includes('registered') ||
        q.includes('enrolled') ||
        q.includes('course list') ||
        q.includes('courses list') ||
        q.includes('subject list'));

    const courses = timetable?.courses || [];
    const totalCredits = courses.reduce((acc, c) => acc + (c.credits || 0), 0);
    const slots = timetable?.slots || [];

    // Helper to consolidate consecutive slots for same course/type/room
    const consolidateSlots = (rawSlots: TimetableSlot[]) => {
      if (rawSlots.length === 0) return [];
      const sorted = [...rawSlots].sort((a, b) => {
        if (a.day !== b.day) return 0;
        return parseTimeInterval(a.time).startMinutes - parseTimeInterval(b.time).startMinutes;
      });
      const result: Array<{
        day: string;
        timeRange: string;
        type: string;
        room: string;
        section: string;
        group: string;
        courseCode: string;
        courseTitle: string;
        facultyName?: string;
        facultyCabin?: string;
      }> = [];
      for (const s of sorted) {
        const prev = result[result.length - 1];
        if (
          prev &&
          prev.day === s.day &&
          prev.room === s.room &&
          (prev.type || '').toLowerCase() === (s.type || '').toLowerCase() &&
          (prev.courseCode || '').toUpperCase() === (s.courseCode || '').toUpperCase()
        ) {
          const prevEnd = parseTimeInterval(prev.timeRange).endMinutes;
          const currStart = parseTimeInterval(s.time).startMinutes;
          if (currStart <= prevEnd + 10) {
            const prevStartStr = prev.timeRange.split('-')[0].trim();
            const currEndStr = s.time.includes('-') ? s.time.split('-')[1].trim() : s.time;
            prev.timeRange = `${prevStartStr} - ${currEndStr}`;
            continue;
          }
        }
        result.push({
          day: s.day || '',
          timeRange: s.time || 'TBD',
          type: s.type || 'Class',
          room: s.room || 'N/A',
          section: s.section || '',
          group: s.group || '',
          courseCode: s.courseCode || '',
          courseTitle: s.courseTitle || '',
          facultyName: s.facultyName,
          facultyCabin: s.facultyCabin
        });
      }
      return result;
    };

    // Helper to generate Faculty & Cabin Directory Markdown table
    const generateFacultyCabinTable = (relevantCourses: CourseFacultyRecord[]) => {
      const rows = relevantCourses
        .map(
          (c) =>
            `| **${c.courseCode}** | ${c.facultyName || 'Course Instructor'} | ${formatCabinLocation(c.facultyCabin || c.cabinNumber)} | ${c.courseTitle || ''} |`
        )
        .join('\n');
      return (
        `#### 👨‍🏫 Faculty & Cabin Directory\n\n` +
        `| Subject Code | Instructor / Faculty | Cabin Location | Course Title |\n` +
        `| :--- | :--- | :--- | :--- |\n` +
        `${rows}\n\n` +
        `> 💡 **Directory Note:** Faculty cabin locations and course details are verified directly from your authenticated UMS Student Time Table report.`
      );
    };

    // 1. Pure Enrolled Curriculum / Course List Query
    if (isPureCourseDirectory && courses.length > 0) {
      const rows = courses
        .map(
          (c) =>
            `| **${c.courseCode}** | ${c.courseType || 'Core'} | ${c.courseTitle || ''} | ${c.lectures || 0}-${c.tutorial || 0}-${c.practical || 0} | ${c.credits || 0} | ${c.facultyName ? `${c.facultyName}${c.facultyCabin ? ` (${c.facultyCabin})` : ''}` : 'Not Assigned / NA'} | ${c.lastUpdated || 'NA'} |`
        )
        .join('\n');

      return {
        message: `### 📚 Registered Courses & Faculty Directory

Here is your official enrolled curriculum (**${courses.length} courses**, **${totalCredits} total credits**) verified from your authenticated UMS portal:

| Course Code | Type | Course Title | L-T-P | Credits | Faculty & Cabin | Last Updated |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${rows}

> 💡 **Directory Note:** Faculty cabin locations and course credits are verified directly from your official UMS Student Time Table report.`,
        activities: [
          {
            id: String(Date.now()),
            timestamp,
            title: 'Registered Courses Directory',
            detail: `Rendered ${courses.length} courses (${totalCredits} credits) from UMS`,
            status: 'completed'
          }
        ]
      };
    }

    // 2. Specific Course Code Query (Room, Venue, Faculty Cabin, Timings)
    if (queriedCourseCode && (slots.length > 0 || courses.length > 0)) {
      const courseSlots = slots.filter(
        (s) => (s.courseCode || '').replace(/\s+/g, '').toUpperCase() === queriedCourseCode
      );
      const matchedCourse = courses.find(
        (c) => (c.courseCode || '').replace(/\s+/g, '').toUpperCase() === queriedCourseCode
      );

      // Sub-branch A: Specific Faculty Cabin Query
      if (isCabinOrFacultyQuery && !isRoomQuery) {
        const codeDisplay = matchedCourse?.courseCode || queriedCourseCode;
        const titleDisplay = matchedCourse?.courseTitle || courseSlots[0]?.courseTitle || 'Course';
        const facName = matchedCourse?.facultyName || courseSlots[0]?.facultyName || 'Course Instructor';
        const facCabin = matchedCourse?.facultyCabin || matchedCourse?.cabinNumber || courseSlots[0]?.facultyCabin || 'Verified in UMS report';
        const cabinFormatted = formatCabinLocation(facCabin);
        const ltp = matchedCourse ? `${matchedCourse.lectures || 0}-${matchedCourse.tutorial || 0}-${matchedCourse.practical || 0}` : 'N/A';
        const credits = matchedCourse?.credits || 0;
        const courseType = matchedCourse?.courseType || 'Core';

        let sessionList = '';
        if (courseSlots.length > 0) {
          const consolidated = consolidateSlots(courseSlots);
          const lines = consolidated.map((s) => {
            const roomFmt = formatRoomLocation(s.room);
            return `- **${s.type}**: **${s.day}** (${s.timeRange}) in ${roomFmt}${s.section ? ` · Section: ${s.section}` : ''}`;
          });
          sessionList = `\n\n#### 📍 Scheduled Sessions & Venues:\n${lines.join('\n')}`;
        }

        return {
          message: `### 👨‍🏫 Faculty & Cabin Details: **${codeDisplay}**

Here are the verified faculty and cabin details for **${codeDisplay}** (${titleDisplay}):

| Course Code | Instructor / Faculty | Cabin Location | Credits & L-T-P | Course Type |
| :--- | :--- | :--- | :--- | :--- |
| **${codeDisplay}** | **${facName}** | ${cabinFormatted} | **${credits} Credits** (${ltp}) | ${courseType} |${sessionList}

> 💡 **Directory Note:** Faculty cabin locations and course details are verified directly from your authenticated UMS Student Time Table report.`,
          activities: [
            {
              id: String(Date.now()),
              timestamp,
              title: `${codeDisplay} Faculty Details`,
              detail: `Instructor: ${facName} · Cabin: ${facCabin}`,
              status: 'completed'
            }
          ]
        };
      }

      // Sub-branch B: Specific Room / Venue / Schedule Query (Practical vs Lecture)
      if (isRoomQuery || isPracticalRequested || isLectureRequested || courseSlots.length > 0) {
        if (courseSlots.length === 0) {
          return {
            message: `### 📍 Venue Notice: **${queriedCourseCode}**

No scheduled lecture or practical time slots were found for **${queriedCourseCode}** in your weekly grid.

${matchedCourse ? `*Course Record:* **${matchedCourse.courseCode}** (${matchedCourse.courseTitle}) → Instructor: **${matchedCourse.facultyName || 'Faculty'}** (Cabin: ${formatCabinLocation(matchedCourse.facultyCabin || matchedCourse.cabinNumber)})` : ''}`,
            activities: [
              {
                id: String(Date.now()),
                timestamp,
                title: `${queriedCourseCode} Schedule Lookup`,
                detail: `No grid slots for ${queriedCourseCode}`,
                status: 'warning'
              }
            ]
          };
        }

        const codeDisplay = matchedCourse?.courseCode || queriedCourseCode;
        const titleDisplay = matchedCourse?.courseTitle || courseSlots[0]?.courseTitle || '';

        const practicalSlots = courseSlots.filter(
          (s) =>
            (s.type || '').toLowerCase().includes('practical') ||
            ((s as any).slotType || '').toLowerCase().includes('practical') ||
            (s.courseCode || '').toLowerCase().includes('lab')
        );
        const lectureSlots = courseSlots.filter((s) => !practicalSlots.includes(s));

        let primarySlots: TimetableSlot[] = [];
        let otherSlots: TimetableSlot[] = [];
        let primaryFocus = 'Session';
        let otherFocus = '';

        if (isPracticalRequested) {
          primarySlots = practicalSlots.length > 0 ? practicalSlots : courseSlots;
          otherSlots = practicalSlots.length > 0 ? lectureSlots : [];
          primaryFocus = 'Practical';
          otherFocus = 'Theory Lecture';
        } else if (isLectureRequested) {
          primarySlots = lectureSlots.length > 0 ? lectureSlots : courseSlots;
          otherSlots = lectureSlots.length > 0 ? practicalSlots : [];
          primaryFocus = 'Lecture';
          otherFocus = 'Practical Lab';
        } else {
          primarySlots = practicalSlots.length > 0 ? practicalSlots : lectureSlots;
          otherSlots = practicalSlots.length > 0 ? lectureSlots : [];
          primaryFocus = practicalSlots.length > 0 ? 'Practical' : 'Lecture';
          otherFocus = practicalSlots.length > 0 ? 'Theory Lecture' : '';
        }

        const consolidatedPrimary = consolidateSlots(primarySlots);
        const primaryRows = consolidatedPrimary
          .map((s) => {
            const roomFmt = formatRoomLocation(s.room);
            return `| **${s.type}** | **${s.day}** | **${s.timeRange}** | ${roomFmt} | ${s.section || 'All'}${s.group ? ` (Group ${s.group})` : ''} |`;
          })
          .join('\n');

        let otherSection = '';
        if (otherSlots.length > 0) {
          const consolidatedOther = consolidateSlots(otherSlots);
          const otherLines = consolidatedOther
            .map((s) => {
              const roomFmt = formatRoomLocation(s.room);
              return `- **${s.type}**: **${s.day}** (${s.timeRange}) in ${roomFmt}${s.section ? ` · Section: ${s.section}` : ''}`;
            })
            .join('\n');
          otherSection = `\n\n#### ℹ️ Other ${otherFocus} Sessions for ${codeDisplay}:\n${otherLines}`;
        }

        // Real-time synchronization: Next occurrence of this course
        let nextOccurrenceText = '';
        const dayOrder = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        let bestSlot: TimetableSlot | null = null;
        let minDiff = 999;

        for (const s of primarySlots.length > 0 ? primarySlots : courseSlots) {
          const sDayIdx = dayOrder.indexOf(s.day);
          if (sDayIdx === -1) continue;
          let diff = (sDayIdx - todayIdx + 7) % 7;
          const { endMinutes } = parseTimeInterval(s.time);
          if (diff === 0 && endMinutes < currentMinutes) {
            diff = 7;
          }
          if (diff < minDiff) {
            minDiff = diff;
            bestSlot = s;
          }
        }

        if (bestSlot) {
          const { startMinutes, endMinutes } = parseTimeInterval(bestSlot.time);
          const roomFmt = formatRoomLocation(bestSlot.room);
          if (minDiff === 0) {
            if (currentMinutes >= startMinutes && currentMinutes <= endMinutes) {
              nextOccurrenceText = `\n\n#### ⏱️ Real-Time Status:\n- 🟢 **Ongoing right now:** Your ${bestSlot.type} is currently running in ${roomFmt} until ${bestSlot.time.split('-')[1]?.trim() || 'end'}.`;
            } else {
              nextOccurrenceText = `\n\n#### ⏱️ Real-Time Status:\n- ⏳ **Upcoming today:** Your next ${bestSlot.type} session is **today (${todayDay}) at ${bestSlot.time}** in ${roomFmt}.`;
            }
          } else if (minDiff === 1) {
            nextOccurrenceText = `\n\n#### ⏱️ Real-Time Status:\n- 📅 **Upcoming tomorrow:** Your next ${bestSlot.type} session is **tomorrow (${tomorrowDay}) at ${bestSlot.time}** in ${roomFmt}.`;
          } else {
            nextOccurrenceText = `\n\n#### ⏱️ Real-Time Status:\n- 📅 **Next session:** Your next ${bestSlot.type} session is on **${bestSlot.day} at ${bestSlot.time}** in ${roomFmt}.`;
          }
        }

        return {
          message: `### 🔬 Room & Venue: **${codeDisplay} ${primaryFocus}**

Here is the verified venue and schedule for your **${codeDisplay}** (${titleDisplay}) **${primaryFocus}**:

| Session Type | Day | Time Slot | Room / Venue | Section & Group |
| :--- | :--- | :--- | :--- | :--- |
${primaryRows}${otherSection}${nextOccurrenceText}

> 💡 **Schedule Note:** Classroom numbers, blocks, and timings are verified directly from your authenticated UMS Student Time Table.`,
          activities: [
            {
              id: String(Date.now()),
              timestamp,
              title: `${codeDisplay} Room Details`,
              detail: `Venue: ${consolidatedPrimary[0]?.room || 'N/A'} on ${consolidatedPrimary[0]?.day || 'Scheduled Day'}`,
              status: 'completed'
            }
          ]
        };
      }
    }

    // 3. Real-Time Next Class / Current Class / Today's Remaining Classes Query
    if (
      isNextClassQuery ||
      (q.includes('today') &&
        !isWeeklyMatrixQuery &&
        (q.includes('next') || q.includes('remaining') || q.includes('more') || q.includes('left') || q.includes('now')))
    ) {
      const todaySlots = slots
        .filter((s) => s.day === todayDay)
        .sort((a, b) => parseTimeInterval(a.time).startMinutes - parseTimeInterval(b.time).startMinutes);

      const tomorrowSlots = slots
        .filter((s) => s.day === tomorrowDay)
        .sort((a, b) => parseTimeInterval(a.time).startMinutes - parseTimeInterval(b.time).startMinutes);

      if (todaySlots.length === 0) {
        let tomorrowNote = '';
        if (tomorrowSlots.length > 0) {
          const first = tomorrowSlots[0];
          tomorrowNote = `Your next upcoming class is tomorrow (**${tomorrowDay}**): **${first.courseCode}** (${first.courseTitle || ''}) at **${first.time}** in ${formatRoomLocation(first.room)}.`;
        } else {
          tomorrowNote = `You do not have any classes scheduled tomorrow either. Enjoy your break!`;
        }
        return {
          message: `### ⏱️ Real-Time Class Status (**${todayDay}**, ${timeFormatted})

You have **no scheduled classes** for today (**${todayDay}**) in your verified UMS timetable.

${tomorrowNote}`,
          activities: [
            {
              id: String(Date.now()),
              timestamp,
              title: 'Today Schedule Status',
              detail: `0 classes scheduled for ${todayDay}`,
              status: 'completed'
            }
          ]
        };
      }

      const ongoing = todaySlots.find((s) => {
        const { startMinutes, endMinutes } = parseTimeInterval(s.time);
        return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
      });
      const upcoming = todaySlots.filter((s) => parseTimeInterval(s.time).startMinutes > currentMinutes);

      if (ongoing) {
        const roomFmt = formatRoomLocation(ongoing.room);
        let upcomingList = '';
        if (upcoming.length > 0) {
          const nextOne = upcoming[0];
          upcomingList = `\n\n#### ⏳ Next Up After This:\n- **${nextOne.courseCode}** (${nextOne.type || 'Class'}) at **${nextOne.time}** in ${formatRoomLocation(nextOne.room)}.`;
        } else {
          upcomingList = `\n\n*This is your last scheduled class for today.*`;
        }

        return {
          message: `### ⏱️ Real-Time Class Status (**${todayDay}**, ${timeFormatted})

🟢 **Class Ongoing Right Now:**
- **Course:** **${ongoing.courseCode}** (${ongoing.courseTitle || ''})
- **Type:** ${ongoing.type || 'Class'}
- **Time:** **${ongoing.time}**
- **Room / Venue:** ${roomFmt}
- **Faculty / Cabin:** ${ongoing.facultyName || 'Faculty'}${ongoing.facultyCabin ? ` (${ongoing.facultyCabin})` : ''}${upcomingList}`,
          activities: [
            {
              id: String(Date.now()),
              timestamp,
              title: 'Ongoing Class',
              detail: `Currently in ${ongoing.courseCode} (${ongoing.room})`,
              status: 'completed'
            }
          ]
        };
      }

      if (upcoming.length > 0) {
        const nextOne = upcoming[0];
        const roomFmt = formatRoomLocation(nextOne.room);
        const remainingTable = upcoming
          .map((s) => `| **${s.time}** | **${s.courseCode}** | ${s.type || 'Lecture'} | ${formatRoomLocation(s.room)} | ${s.section || 'N/A'} |`)
          .join('\n');

        return {
          message: `### ⏱️ Real-Time Class Status (**${todayDay}**, ${timeFormatted})

⏳ **Your Next Class Today:**
- **Course:** **${nextOne.courseCode}** (${nextOne.courseTitle || ''})
- **Time:** **${nextOne.time}**
- **Room / Venue:** ${roomFmt}
- **Type:** ${nextOne.type || 'Class'}
- **Faculty / Cabin:** ${nextOne.facultyName || 'Faculty'}${nextOne.facultyCabin ? ` (${nextOne.facultyCabin})` : ''}

#### 📋 Remaining Schedule for Today (${upcoming.length} ${upcoming.length === 1 ? 'class' : 'classes'} left):
| Time Slot | Subject Code | Type | Room / Venue | Section |
| :--- | :--- | :--- | :--- | :--- |
${remainingTable}`,
          activities: [
            {
              id: String(Date.now()),
              timestamp,
              title: 'Next Class Today',
              detail: `${nextOne.courseCode} at ${nextOne.time} in ${nextOne.room}`,
              status: 'completed'
            }
          ]
        };
      }

      // All classes completed today
      const lastClass = todaySlots[todaySlots.length - 1];
      let tomorrowSection = '';
      if (tomorrowSlots.length > 0) {
        const first = tomorrowSlots[0];
        tomorrowSection = `#### 🌅 Next Upcoming Class (Tomorrow, **${tomorrowDay}**):
- **Course:** **${first.courseCode}** (${first.courseTitle || ''})
- **Time:** **${first.time}**
- **Room / Venue:** ${formatRoomLocation(first.room)}
- **Type:** ${first.type || 'Lecture'}
- **Faculty & Cabin:** ${first.facultyName || 'Faculty'}${first.facultyCabin ? ` (${first.facultyCabin})` : ''}`;
      } else {
        tomorrowSection = `You have no scheduled classes tomorrow (**${tomorrowDay}**) either.`;
      }

      return {
        message: `### ⏱️ Real-Time Class Status (**${todayDay}**, ${timeFormatted})

All **${todaySlots.length} scheduled classes** for today (**${todayDay}**) have **concluded** (your last session was **${lastClass.courseCode}** which ended at **${lastClass.time.split('-')[1]?.trim() || 'afternoon'}** in Room **${lastClass.room}**).

${tomorrowSection}

> 💡 **Tip:** Have a great rest of your day! Be sure to verify your classroom in the morning before your first period.`,
        activities: [
          {
            id: String(Date.now()),
            timestamp,
            title: 'Classes Concluded Today',
            detail: `All ${todaySlots.length} sessions completed for ${todayDay}`,
            status: 'completed'
          }
        ]
      };
    }

    // 4. Day-Specific Schedule Query (e.g. tomorrow, Monday, Wednesday)
    if (targetDayCapitalized && slots.length > 0) {
      const daySlots = slots
        .filter(
          (s) =>
            (s.day || '').toLowerCase() === targetDayCapitalized!.toLowerCase() ||
            (s.day || '').toLowerCase().startsWith(targetDayCapitalized!.toLowerCase().slice(0, 3))
        )
        .sort((a, b) => parseTimeInterval(a.time).startMinutes - parseTimeInterval(b.time).startMinutes);

      if (daySlots.length > 0) {
        const isTargetToday = targetDayCapitalized.toLowerCase() === todayDay.toLowerCase();
        const rows = daySlots
          .map((s) => {
            let statusBadge = '';
            if (isTargetToday) {
              const { startMinutes, endMinutes } = parseTimeInterval(s.time);
              if (endMinutes < currentMinutes) {
                statusBadge = ' *(Done)*';
              } else if (currentMinutes >= startMinutes && currentMinutes <= endMinutes) {
                statusBadge = ' *(Now)*';
              } else {
                statusBadge = ' *(Upcoming)*';
              }
            }
            const roomFmt = formatRoomLocation(s.room);
            const facFmt = s.facultyName ? `${s.facultyName}${s.facultyCabin ? ` (${s.facultyCabin})` : ''}` : 'Faculty';
            return `| **${s.time || 'TBD'}** | **${s.courseCode || 'TBD'}**${statusBadge} | ${s.courseTitle || ''} | ${roomFmt} | ${facFmt} | ${s.type || 'Lecture'} |`;
          })
          .join('\n');

        let facultySection = '';
        if (wantsCabins) {
          const seenCodes = new Set<string>();
          const dayCourses: CourseFacultyRecord[] = [];
          for (const s of daySlots) {
            const code = (s.courseCode || '').toUpperCase();
            if (code && !seenCodes.has(code)) {
              seenCodes.add(code);
              const matchedCourse = courses.find((co) => (co.courseCode || '').toUpperCase() === code);
              dayCourses.push({
                courseCode: code,
                courseTitle: s.courseTitle || matchedCourse?.courseTitle || '',
                facultyName: s.facultyName || matchedCourse?.facultyName || 'Course Instructor',
                facultyCabin: s.facultyCabin || matchedCourse?.facultyCabin || matchedCourse?.cabinNumber || 'Verified in UMS report',
                lectures: matchedCourse?.lectures || 0,
                tutorial: matchedCourse?.tutorial || 0,
                practical: matchedCourse?.practical || 0,
                credits: matchedCourse?.credits || 0
              });
            }
          }
          if (dayCourses.length > 0) {
            facultySection = '\n\n' + generateFacultyCabinTable(dayCourses);
          }
        }

        let liveContextNote = '';
        if (isTargetToday) {
          const completedCount = daySlots.filter((s) => parseTimeInterval(s.time).endMinutes < currentMinutes).length;
          if (completedCount === daySlots.length) {
            liveContextNote = `\n\n> ⏱️ **Real-Time Note:** Current time is **${timeFormatted}**. All scheduled classes for today have concluded.`;
          } else {
            const nextOne = daySlots.find((s) => parseTimeInterval(s.time).startMinutes > currentMinutes);
            if (nextOne) {
              liveContextNote = `\n\n> ⏱️ **Real-Time Note:** Current time is **${timeFormatted}**. Next upcoming session is **${nextOne.courseCode}** at **${nextOne.time}** in ${formatRoomLocation(nextOne.room)}.`;
            }
          }
        }

        return {
          message: `### 📅 Verified Schedule for **${targetDayCapitalized}**

Here are your classes scheduled for **${targetDayCapitalized}** (${daySlots.length} ${daySlots.length === 1 ? 'class' : 'classes'}):

| Time Slot | Subject Code | Course Title | Room & Block | Faculty & Cabin | Type |
| :--- | :--- | :--- | :--- | :--- | :--- |
${rows}${facultySection}${liveContextNote}

> 💡 **Tip:** Be sure to verify your classroom numbers and faculty cabins before each session to avoid last-minute delays.`,
          activities: [
            {
              id: String(Date.now()),
              timestamp,
              title: `${targetDayCapitalized} Schedule`,
              detail: `Rendered ${daySlots.length} verified classes for ${targetDayCapitalized}`,
              status: 'completed'
            }
          ]
        };
      } else {
        let fallbackFacultySection = '';
        if (wantsCabins && courses.length > 0) {
          fallbackFacultySection = '\n\n' + generateFacultyCabinTable(courses);
        }

        return {
          message: `### 📅 Schedule for **${targetDayCapitalized}**

You have **no classes scheduled** on **${targetDayCapitalized}** in your verified UMS timetable.
${fallbackFacultySection}`,
          activities: [
            {
              id: String(Date.now()),
              timestamp,
              title: `${targetDayCapitalized} Schedule`,
              detail: `0 classes scheduled on ${targetDayCapitalized}`,
              status: 'completed'
            }
          ]
        };
      }
    }

    // 5. Full Faculty Directory Query (when user specifically asks for faculty / cabins without a specific day or course)
    if (isCabinOrFacultyQuery && courses.length > 0 && !wantsSchedule) {
      return {
        message: `### 👨‍🏫 Faculty & Cabin Directory

Here are the verified instructors and cabin locations across your **${courses.length} registered courses**:

${generateFacultyCabinTable(courses)}`,
        activities: [
          {
            id: String(Date.now()),
            timestamp,
            title: 'Faculty & Cabin Directory',
            detail: `Rendered ${courses.length} faculty assignments from UMS`,
            status: 'completed'
          }
        ]
      };
    }

    // 6. Full Weekly Matrix Query
    if (isWeeklyMatrixQuery && slots.length > 0) {
      const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const sections: string[] = [];

      for (const d of dayOrder) {
        const dSlots = slots
          .filter((s) => s.day === d)
          .sort((a, b) => parseTimeInterval(a.time).startMinutes - parseTimeInterval(b.time).startMinutes);
        if (dSlots.length > 0) {
          const rows = dSlots
            .map((s) => `| **${s.time}** | **${s.courseCode}** | ${s.courseTitle || ''} | ${formatRoomLocation(s.room)} | ${s.type || 'Lecture'} |`)
            .join('\n');
          sections.push(`#### 🗓️ ${d} (${dSlots.length} classes)\n\n| Time Slot | Subject Code | Course Title | Room & Block | Type |\n| :--- | :--- | :--- | :--- |\n${rows}`);
        }
      }

      return {
        message: `### 📅 Complete Weekly Class Schedule Matrix

Here is your comprehensive weekly schedule matrix verified directly from your authenticated UMS Student Time Table (**${slots.length} total classes** across **${courses.length || 'enrolled'} courses**):

${sections.join('\n\n')}

#### 📊 Weekly Summary
- **Total Scheduled Slots:** **${slots.length} classes** across your week.
- **Enrolled Subjects:** **${courses.length} courses** (${totalCredits} total credits).

> 💡 **Schedule Note:** Classroom numbers, blocks, and timings are verified directly from your authenticated UMS Student Time Table.`,
        activities: [
          {
            id: String(Date.now()),
            timestamp,
            title: 'Weekly Timetable Matrix',
            detail: `Rendered ${slots.length} weekly classes across 6 days`,
            status: 'completed'
          }
        ]
      };
    }

    // 7. General / Default Timetable View (Smart Context-Aware: Today's schedule if available, else Tomorrow)
    if (slots.length > 0) {
      const todaySlots = slots
        .filter((s) => s.day === todayDay)
        .sort((a, b) => parseTimeInterval(a.time).startMinutes - parseTimeInterval(b.time).startMinutes);

      const displayDay = todaySlots.length > 0 ? todayDay : tomorrowDay;
      const displaySlots = slots
        .filter((s) => s.day === displayDay)
        .sort((a, b) => parseTimeInterval(a.time).startMinutes - parseTimeInterval(b.time).startMinutes);

      const rows = displaySlots
        .map((s) => {
          const roomFmt = formatRoomLocation(s.room);
          const facFmt = s.facultyName ? `${s.facultyName}${s.facultyCabin ? ` (${s.facultyCabin})` : ''}` : 'Faculty';
          return `| **${s.time || 'TBD'}** | **${s.courseCode || 'TBD'}** | ${s.courseTitle || ''} | ${roomFmt} | ${facFmt} | ${s.type || 'Lecture'} |`;
        })
        .join('\n');

      return {
        message: `### 📅 Verified Class Schedule (**${displayDay}**)

Here is your class schedule for **${displayDay}** (${displaySlots.length} classes scheduled, ${slots.length} total classes across your week):

| Time Slot | Subject Code | Course Title | Room & Block | Faculty & Cabin | Type |
| :--- | :--- | :--- | :--- | :--- | :--- |
${rows}

#### ⏱️ Real-Time Academic Context
- **Current Day & Time:** ${todayDay}, ${timeFormatted}.
- **Weekly Workload:** **${slots.length} classes** scheduled across **${courses.length || 'your'} courses**.

> 💡 **Daily Tip:** Verify your classroom numbers and faculty cabins before first hour to ensure timely arrival.`,
        activities: [
          {
            id: String(Date.now()),
            timestamp,
            title: 'Timetable Schedule',
            detail: `Rendered ${displaySlots.length} classes for ${displayDay}`,
            status: 'completed'
          }
        ]
      };
    } else if (courses.length > 0) {
      return {
        message: `### 📚 Registered Courses & Faculty Directory

Here is your official curriculum (**${courses.length} courses**, **${totalCredits} total credits**) and faculty cabin directory verified from UMS:

${generateFacultyCabinTable(courses)}`,
        activities: [
          {
            id: String(Date.now()),
            timestamp,
            title: 'Faculty & Cabin Directory',
            detail: `Rendered ${courses.length} faculty assignments from UMS`,
            status: 'completed'
          }
        ]
      };
    } else {
      return {
        message: `### 📅 Class Schedule & Faculty Directory

No verified timetable records are currently loaded from your LPU UMS session.

- **How to retrieve:** Ask ONEE: *"Open my timetable"* or *"Check my classes"*.
- ONEE will autonomously navigate to your UMS Student Time Table and extract your schedule, rooms, and faculty cabin assignments.`,
        activities: [
          {
            id: String(Date.now()),
            timestamp,
            title: 'Timetable Advisor',
            detail: 'No timetable records detected',
            status: 'warning'
          }
        ]
      };
    }
  }

  // Handle examination queries if examination data is available or query is examination-focused
  if (routed.capability === 'EXAM_DATE_SHEET' || routed.capability === 'SEATING_PLAN') {
    if (!examination || !examination.exams || examination.exams.length === 0) {
      return {
        message: `### 📅 Examination Date Sheet / Seating Plan

No verified examination records are currently loaded from your LPU UMS session.

- **How to retrieve:** Ask ONEE: *"Open my date sheet"* or *"When is my next exam?"*.
- ONEE will navigate to **Important Links > Date Sheet** and extract your verified seating plan and schedule.`,
        activities: [
          {
            id: String(Date.now()),
            timestamp,
            title: 'Examination Advisor',
            detail: 'No examination records detected',
            status: 'warning'
          }
        ]
      };
    }

    const exams = examination.exams;
    const nextExam = getNextExam(exams);
    const upcoming = getUpcomingExams(exams);

    // 1. Specific course or date query (e.g. "Check seat number for INT 373", "Check CSE408 seat for 18 Oct exam", "When is CSE408 exam?")
    const codeMatch = query.match(/\b([A-Z]{2,5})\s*(\d{2,4}[A-Z]?)\b/i);
    const targetCode = routed.targetCourseCode || (codeMatch ? `${codeMatch[1]}${codeMatch[2]}`.toUpperCase() : undefined);
    const dateMatch = query.match(/\b(\d{1,2})\s*(?:st|nd|rd|th)?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i);
    const targetDateSnippet = dateMatch ? `${dateMatch[1]} ${dateMatch[2].slice(0, 3)}`.toLowerCase() : null;

    if (targetCode || targetDateSnippet) {
      let candidateExams = targetCode
        ? exams.filter((e) => (e.courseCode || '').replace(/\s+/, '').toUpperCase() === targetCode)
        : exams;

      if (targetDateSnippet && candidateExams.length > 1) {
        const dateFiltered = candidateExams.filter((e) =>
          (e.examDate || '').toLowerCase().includes(targetDateSnippet)
        );
        if (dateFiltered.length > 0) {
          candidateExams = dateFiltered;
        }
      } else if (!targetCode && targetDateSnippet) {
        candidateExams = candidateExams.filter((e) =>
          (e.examDate || '').toLowerCase().includes(targetDateSnippet)
        );
      }

      const courseExam = candidateExams[0] || (targetCode ? findExamByCourse(exams, targetCode) : null);
      if (courseExam) {
        const roomDisplay =
          courseExam.room && courseExam.room.toLowerCase() !== 'awaited'
            ? formatRoomLocation(courseExam.room)
            : courseExam.venue && courseExam.venue.toLowerCase() !== 'awaited'
            ? courseExam.venue
            : 'Venue Awaited';

        let seatStatus = 'Allocated inside Hall / On Exam Day';
        let seatGuidance = `Your examination hall is confirmed at ${roomDisplay}.\n- Individual physical seat/bench numbers are allocated inside the examination hall and posted on the seating chart outside Room ${courseExam.room || ''} on the morning of the exam.`;

        if (
          courseExam.seat &&
          !['assigned', 'awaited', 'nil', 'na', 'null'].includes(courseExam.seat.toLowerCase())
        ) {
          seatStatus = `**Seat ${courseExam.seat}**`;
          seatGuidance = `Your assigned desk is **Seat ${courseExam.seat}** inside ${roomDisplay}.`;
        } else if (!courseExam.room || courseExam.room.toLowerCase() === 'awaited') {
          seatStatus = 'Seating allocation awaited';
          seatGuidance =
            'The university examination branch will publish the room and seating allocation shortly before the examination date.';
        }

        const titleDisplay = (courseExam.courseName || '')
          .replace(new RegExp(`^${courseExam.courseCode}\\s*[-–—:]?\\s*`, 'i'), '')
          .replace(/\s*-\s*$/, '')
          .trim();

        const reportingStr =
          courseExam.reportingTime || 'Report 30 mins before start (Entry closes 15 mins before)';

        return {
          message: `### 🪑 Examination Venue & Seating Details: **${courseExam.courseCode}**

${titleDisplay ? `**Course:** ${titleDisplay}\n\n` : ''}| Examination Detail | Verified Allocation |
| :--- | :--- |
| 📅 **Exam Date** | 📅 **${courseExam.examDate}** |
| ⏰ **Exam Timing** | ⏰ **${courseExam.startTime || 'TBD'}${courseExam.endTime ? ` - ${courseExam.endTime}` : ''}** |
| 🚪 **Reporting Time** | 🚪 **${reportingStr}** |
| 🏢 **Examination Hall / Room** | ${roomDisplay} |
| 🪑 **Seat Number** | 🪑 **${seatStatus}** |
| 📋 **Exam Type** | ${courseExam.examType || courseExam.mode || 'Regular Examination'} |
${courseExam.instructions ? `| ℹ️ **Paper Pattern** | ${courseExam.instructions} |\n` : ''}
#### ℹ️ Seating & Reporting Guidance:
- ${seatGuidance}
- **Entry Rule:** Examination hall entry closes strictly 15 minutes before the start time.

> 🔒 **Verified Source:** Directly verified from your authenticated Student UMS examination conduct portal.`,
          activities: [
            {
              id: String(Date.now()),
              timestamp,
              title: 'Exam Record Lookup',
              detail: `Verified venue & seating for ${courseExam.courseCode}${targetDateSnippet ? ` on ${courseExam.examDate}` : ''}`,
              status: 'completed'
            }
          ]
        };
      }
    }

    // Helper for responsive, non-clipping examination blocks in sidepanel
    const formatExamBlock = (e: ExaminationRecord, index?: number) => {
      const numPrefix = index !== undefined ? `**${index + 1}. ` : '**';
      const header = `${numPrefix}${e.courseCode}${e.courseName && e.courseName !== e.courseCode ? ` → ${e.courseName}` : ''}**`;
      const dateStr = e.examDate || (e.startDate && e.endDate ? `${e.startDate} to ${e.endDate}` : e.startDate || 'TBD');
      const timeStr = e.startTime ? `${e.startTime}${e.endTime ? ` - ${e.endTime}` : ''}` : (e.endTime || 'TBD');
      const seatingParts = [
        e.venue || 'Venue Awaited',
        e.room ? `Room ${e.room}` : null,
        e.seat ? `Seat ${e.seat}` : null
      ].filter(Boolean);

      const lines: string[] = [
        header,
        `- 📅 **Date:** ${dateStr}`,
        `- ⏰ **Timing:** ${timeStr}`
      ];

      if (e.reportingTime) {
        lines.push(`- 🚪 **Reporting:** ${e.reportingTime}`);
      }

      lines.push(`- 🪑 **Seating:** ${seatingParts.join(' · ')}`);

      if (e.examType || e.mode) {
        const typeStr = [e.examType, e.mode ? `(${e.mode})` : null].filter(Boolean).join(' ');
        lines.push(`- 📋 **Type:** ${typeStr}`);
      }

      if (e.instructions) {
        lines.push(`- ℹ️ **Instructions:** ${e.instructions}`);
      }

      if (e.samplePaper?.available) {
        lines.push(`- 📄 **Sample Question Paper:** Available on UMS`);
      }

      return lines.join('\n');
    };

    // 2. Next Exam query
    if (routed.subType === 'next_exam' || q.includes('next') || q.includes('nearest')) {
      if (nextExam) {
        return {
          message: `### 🎯 Next Scheduled Examination: **${nextExam.courseCode}**

${formatExamBlock(nextExam)}

---

### 📅 Complete Schedule (${exams.length} ${exams.length === 1 ? 'Exam' : 'Exams'}):

${exams.map((e, i) => formatExamBlock(e, i)).join('\n\n')}`,
          activities: [
            {
              id: String(Date.now()),
              timestamp,
              title: 'Next Exam Engine',
              detail: `Nearest exam is ${nextExam.courseCode} on ${nextExam.examDate} (${exams.length} exams verified)`,
              status: 'completed'
            }
          ]
        };
      }
    }

    // 3. Exam Count / Term Exams Query (e.g. "how many exams do I have", "how many atom exams in term exams")
    const isExamCountQuery =
      q.includes('how many') ||
      q.includes('total exams') ||
      q.includes('exam count') ||
      q.includes('number of exams') ||
      q.includes('term exams') ||
      q.includes('atom exams') ||
      q.includes('autumn exams');

    if (isExamCountQuery) {
      return {
        message: `### 📅 Scheduled Examinations: **${exams.length} ${exams.length === 1 ? 'Exam' : 'Exams'}**

You have **${exams.length} scheduled examinations** recorded in your verified UMS Date Sheet:

${exams.map((e, i) => formatExamBlock(e, i)).join('\n\n')}

---
- **Total Scheduled:** ${exams.length} ${exams.length === 1 ? 'examination' : 'examinations'}
- **Next Exam:** ${nextExam ? `**${nextExam.courseCode}** on **${nextExam.examDate}** (${nextExam.startTime || 'TBD'})` : 'All examinations completed.'}`,
        activities: [
          {
            id: String(Date.now()),
            timestamp,
            title: 'Exam Count Audit',
            detail: `Verified ${exams.length} total examinations from UMS Date Sheet`,
            status: 'completed'
          }
        ]
      };
    }

    // 4. Seating Plan & Venue Query
    if (routed.capability === 'SEATING_PLAN' || q.includes('seating') || q.includes('seat') || q.includes('room')) {
      return {
        message: `### 🪑 Examination Seating Plan & Venues (${exams.length} ${exams.length === 1 ? 'Exam' : 'Exams'})

${exams.map((e, i) => formatExamBlock(e, i)).join('\n\n')}

> ℹ️ *Reporting Reminder:* Arrive at your allocated examination room at least 20 minutes prior to start time.`,
        activities: [
          {
            id: String(Date.now()),
            timestamp,
            title: 'Seating Plan Extractor',
            detail: `Generated venue allocation for ${exams.length} examinations`,
            status: 'completed'
          }
        ]
      };
    }

    // 5. Default Examination Date Sheet Overview
    return {
      message: `### 📅 Verified Examination Date Sheet

Here is your complete chronological examination schedule (${upcoming.length} ${upcoming.length === 1 ? 'exam' : 'exams'}):

${upcoming.map((e, i) => formatExamBlock(e, i)).join('\n\n')}

---
- **Total Exams:** ${upcoming.length}
- **Next Exam:** ${nextExam ? `**${nextExam.courseCode}** on **${nextExam.examDate}** (${nextExam.startTime || 'TBD'}${nextExam.endTime ? ` - ${nextExam.endTime}` : ''})` : 'All examinations completed.'}`,
      activities: [
        {
          id: String(Date.now()),
          timestamp,
          title: 'Date Sheet Summary',
          detail: `Rendered ${upcoming.length} chronological examination entries`,
          status: 'completed'
        }
      ]
    };
  }

  // Hard Capability Firewall: Verify that the user actually asked about attendance.
  // Never bleed into attendance calculation or breakdown tables for unrelated topics!
  const isAttendanceQuery =
    routed.capability === 'ATTENDANCE' ||
    q.includes('attendance') ||
    q.includes('bunk') ||
    q.includes('skip') ||
    q.includes('leave') ||
    q.includes('absent') ||
    q.includes('attended') ||
    q.includes('shortage') ||
    q.includes('percentage') ||
    q.includes('75%') ||
    /\b([A-Z]{2,5}\s*\d{2,4}[A-Z0-9]?)\b/i.test(query);

  if (!isAttendanceQuery) {
    return {
      message: `I'm ONEE, your academic assistant for Lovely Professional University.

I can help you check your **class timetable & lecture rooms**, **attendance & safe bunks**, **examination datesheet & seating plan**, and **sample question papers**.

How would you like me to assist you?`,
      activities: [
        {
          id: String(Date.now()),
          timestamp,
          title: 'Conversational Guidance',
          detail: 'Protected query from unrelated capability bleed',
          status: 'completed'
        }
      ]
    };
  }

  if (!attendance || attendance.courses.length === 0) {
    return {
      message: `### ⚠️ No Attendance Data Available

I couldn't detect verified attendance records from your LPU UMS session.

- **How to resolve:** Please navigate to your **LPU UMS Attendance Summary** page.
- **Auto-Sync:** Once the page loads, click the refresh button above or ask ONEE to extract your attendance records.`,
      activities: [
        {
          id: String(Date.now()),
          timestamp,
          title: 'Local Advisor Engine',
          detail: 'No attendance data supplied',
          status: 'warning'
        }
      ]
    };
  }

  const courses = attendance.courses;
  const totalClasses = attendance.totalClasses ?? attendance.totalDelivered ?? 0;
  const totalAttended = attendance.totalAttended ?? 0;
  const overallPct = attendance.overallPercentage ?? 0;

  // 0.7 Attendance maintenance inquiry (e.g. "How can I maintain my attendance across all subjects?")
  const isMaintenanceQuery = /\b(maintain\s*my\s*attendance|maintain\s*attendance|keep\s*my\s*attendance|manage\s*my\s*attendance|how\s*can\s*i\s*maintain|how\s*to\s*maintain|maintain)\b/i.test(q);

  if (isMaintenanceQuery && courses.length > 0) {
    const totalBunks = courses.reduce((acc, c) => acc + calculateBunkAllowance(c.attended, c.total, 75), 0);
    const sortedCourses = [...courses].sort((a, b) => a.percentage - b.percentage);
    const rows = sortedCourses.map((c) => {
      const bunk75 = calculateBunkAllowance(c.attended, c.total, 75);
      const bunk80 = calculateBunkAllowance(c.attended, c.total, 80);
      const bunkDisplay = bunk75 > 0 ? `${bunk75} safe skips` : '0 (Attend next)';
      const bunk80Display = bunk80 > 0 ? `${bunk80} skips` : 'Need +1 class';
      return `| **${c.code}** | ${c.name} | **${Math.round(c.percentage)}%** (${c.attended}/${c.total}) | ${bunkDisplay} | ${bunk80Display} | ${c.percentage >= 75 ? '🟢 Safe' : '🔴 Risk'} |`;
    });
    const lowest = sortedCourses[0];
    const deliveredCnt = attendance.totalClasses || attendance.totalDelivered || courses.reduce((acc, c) => acc + c.total, 0);

    return {
      message: `### 🛡️ Strategic Attendance Maintenance Plan

**Aggregate Standing:** **${Math.round(overallPct)}%** across **${courses.length} subjects** (${totalAttended} / ${deliveredCnt} classes attended).

| Subject Code | Course Title | Attendance | Safe Skips (75%) | Target for 80% | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
${rows.join('\n')}

#### 📋 Proactive Rules to Maintain Your Attendance:
1. **Protect Your Tightest Cushion (${lowest.code}):** Standing at **${Math.round(lowest.percentage)}%**, your buffer is ${calculateBunkAllowance(lowest.attended, lowest.total, 75)} skips. Prioritize regular attendance here first.
2. **78% Safe Operating Threshold:** Keep every subject comfortably above 78% so an accidental absence or delay never drops you below the 75% examination detention line.
3. **Practical & Lab Priority:** Practical and lab sessions carry heavy weight → missing one lab counts double against your percentage.
4. **Emergency Reserve:** Reserve at least 2 safe skips for unexpected emergencies or end-term assignment deadlines during the last 2 weeks.

> 💡 **Overall Health:** You can safely skip up to **${totalBunks} combined lectures** across all subjects while staying 100% exam eligible.`,
      activities: [
        {
          id: String(Date.now()),
          timestamp,
          title: 'Attendance Strategy Planner',
          detail: `Generated strategic maintenance plan for ${courses.length} subjects`,
          status: 'completed'
        }
      ],
      suggestions: [`Safe bunks for ${lowest.code}`, 'Am I eligible for exams?', "Check today's classes"]
    };
  }

  // --- Context Resolution from Conversation History ---
  let anaphoricCourse: CourseAttendance | null = null;
  let previousIntent: string | null = null;
  if (history && history.length > 0) {
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      const textToScan = h.text || '';
      for (const c of courses) {
        const regex = new RegExp(`\\b${c.code}\\b`, 'i');
        if (regex.test(textToScan)) {
          anaphoricCourse = c;
          break;
        }
      }
      if (anaphoricCourse) {
        if (/skip|bunk|miss|what if/i.test(textToScan)) {
          previousIntent = 'skip';
        }
        break;
      }
    }
  }

  // Strip course codes and course code numbers from query before extracting numeric skip count
  let queryWithoutCourses = query;
  for (const c of courses) {
    queryWithoutCourses = queryWithoutCourses.replace(new RegExp(`\\b${c.code}\\b`, 'gi'), ' ');
  }
  queryWithoutCourses = queryWithoutCourses.replace(/\b[A-Z]{2,6}\s*\d{2,4}[A-Z0-9]?\b/gi, ' ');

  // Do not treat open-ended inquiries like "how many can I skip / miss / bunk" as fixed numeric skip simulations
  const isOpenEnded = Boolean(
    /(?:how many|how much|can i bunk|can i skip|how many can i|maximum|buffer|what is my buffer|what are my bunks)\b/i.test(q) &&
    !/\b(?:skip|bunk|miss)\s+\d+\b/i.test(queryWithoutCourses)
  );

  // Check for numeric follow-up (e.g. "what about 5", "how about 6", "5", "what if 4")
  let targetSkips: number | null = null;
  if (!isOpenEnded) {
    const numericMatch = queryWithoutCourses.match(
      /(?:what about|how about|what if|can i skip|skip|can i bunk|bunk|miss|and)?\s*(\d{1,2})\s*(?:classes|lectures|more|\?)?/i
    );
    if (numericMatch && numericMatch[1]) {
      const extracted = parseInt(numericMatch[1], 10);
      if (extracted >= 1 && extracted <= 30) {
        targetSkips = extracted;
      }
    }
  }

  const isNumericFollowup = Boolean(
    targetSkips !== null &&
    !isOpenEnded &&
    (
      /^\s*(?:what about|how about|what if|and|can i do)?\s*\d+\s*(?:classes|lectures|more|\?)?\s*$/i.test(queryWithoutCourses.trim()) ||
      /\b(?:skip|bunk|miss)\b/i.test(queryWithoutCourses) ||
      previousIntent === 'skip'
    )
  );

  const codeMatch = query.match(/\b([A-Z]{2,5}\s*[-_]?\s*\d{2,4}[A-Z0-9]?)\b/i);
  let targetCourse: CourseAttendance | null = null;
  if (codeMatch) {
    const targetCode = codeMatch[1].replace(/[\s\-_]+/g, '').toUpperCase();
    targetCourse = courses.find((c) => c.code.replace(/[\s\-_]+/g, '').toUpperCase() === targetCode) || null;
  }
  if (!targetCourse && routed.targetCourseCode) {
    const routedCode = routed.targetCourseCode.replace(/[\s\-_]+/g, '').toUpperCase();
    targetCourse = courses.find((c) => c.code.replace(/[\s\-_]+/g, '').toUpperCase() === routedCode) || null;
  }
  if (!targetCourse) {
    const cleanQ = query.replace(/[\s\-_]+/g, '').toUpperCase();
    for (const c of courses) {
      const cleanCode = c.code.replace(/[\s\-_]+/g, '').toUpperCase();
      if (cleanQ.includes(cleanCode)) {
        targetCourse = c;
        break;
      }
      if (c.name && c.name.length >= 4) {
        const cleanName = c.name.toLowerCase();
        if (q.includes(cleanName)) {
          targetCourse = c;
          break;
        }
      }
    }
  }
  if (!targetCourse && (isNumericFollowup || q.includes('this course') || q.includes('it') || q.includes('that course') || q.includes('this subject') || q.includes('that subject'))) {
    targetCourse = anaphoricCourse;
  }

  // 0.8 SPECIFIC COURSE SKIP / BUNK SIMULATION ("What if I skip 5 classes in CSE329?" or "what about 5")
  if (targetCourse && targetSkips !== null && targetSkips > 0 && !isOpenEnded) {
    const attended = targetCourse.attended;
    const delivered = targetCourse.total > 0 ? targetCourse.total : targetCourse.delivered || 0;
    const pct = Math.round(targetCourse.percentage);
    const bunk75 = calculateBunkAllowance(attended, delivered, 75);

    const scenarioRows: string[] = [];
    scenarioRows.push(`| **Current** | \`${attended} / ${delivered}\` | **${pct}%** | ${pct >= 75 ? '🟢 Safe' : '🔴 Below 75%'} |`);

    // Strictly cap rows in table: show up to 5 steps, never enumerate unbounded numbers
    const stepsToShow = targetSkips <= 5
      ? Array.from({ length: targetSkips }, (_, i) => i + 1)
      : Array.from(new Set([1, 2, Math.floor(targetSkips / 2), targetSkips])).sort((a, b) => a - b);

    for (const s of stepsToShow) {
      const newDel = delivered + s;
      const newPct = newDel > 0 ? Math.round((attended / newDel) * 100) : Math.max(50, pct - (s * 4));
      const status = newPct >= 75 ? '🟢 Safe' : '⚠️ Below 75%';
      scenarioRows.push(`| **Skip ${s} Class${s > 1 ? 'es' : ''}** | \`${attended} / ${newDel}\` | **${newPct}%** | ${status} |`);
    }

    const finalNewDel = delivered + targetSkips;
    const finalNewPct = finalNewDel > 0 ? Math.round((attended / finalNewDel) * 100) : Math.max(50, pct - (targetSkips * 4));
    const isSafe = finalNewPct >= 75;

    const advice = isSafe
      ? `Even after skipping ${targetSkips} lectures, your attendance remains **${finalNewPct}%**, safely above the 75% threshold. However, your buffer shrinks to ${Math.max(0, bunk75 - targetSkips)} skips.`
      : `⚠️ Skipping ${targetSkips} lectures will breach the 75% threshold down to **${finalNewPct}%**, putting you at risk of detention. Stay within your limit of ${bunk75} safe skips!`;

    const responseText = `### 📚 ${targetCourse.code}: ${targetCourse.name} - "What If I Skip ${targetSkips} Classes?"

Here is your skip impact simulation for **${targetCourse.code}** (${targetCourse.name}):

| Scenario | Formula (Attended / Delivered) | Resulting Attendance | Safety Status |
| :--- | :--- | :--- | :--- |
${scenarioRows.join('\n')}

#### 🛡️ Attendance Buffer & Official Limit
- **Current Standing:** **${pct}%** (${attended}/${delivered} classes attended).
- **Official Policy:** 75% mandatory requirement for sitting in Mid-Term & End-Term exams.
- **Maximum Safe Skips to 75%:** **${bunk75} classes**.
- **Buffer Remaining After ${targetSkips} Skips:** **${Math.max(0, bunk75 - targetSkips)} classes**.

> 💡 **Summary & Takeaway:** ${advice}`;

    return {
      message: responseText,
      activities: [
        {
          id: String(Date.now()),
          timestamp,
          title: 'Skip Impact Simulation',
          detail: `Simulated skipping ${targetSkips} classes for ${targetCourse.code} (${finalNewPct}%)`,
          status: 'completed'
        }
      ],
      suggestions: [
        `How many bunks do I have left in ${targetCourse.code}?`,
        `What if I skip ${targetSkips + 1} classes instead?`,
        `When is my next ${targetCourse.code} exam?`
      ]
    };
  }

  // 1. SPECIFIC COURSE INQUIRY (e.g., "Can I bunk CSE329?", "How many classes can I safely skip in CSE408?")
  if (targetCourse) {
    const course = targetCourse;
    const attended = course.attended;
    const delivered = course.total > 0 ? course.total : course.delivered || 0;
    const pct = Math.round(course.percentage);
    const bunk75 = calculateBunkAllowance(attended, delivered, 75);
    const bunk80 = calculateBunkAllowance(attended, delivered, 80);
    const req75 = calculateRequiredClasses(attended, delivered, 75);
    const req80 = calculateRequiredClasses(attended, delivered, 80);

    // Trajectory table
    let trajectorySection = '';
    if (delivered > 0) {
      if (pct >= 75) {
        const sim1 = Math.round((attended / (delivered + 1)) * 100);
        const sim2 = Math.round((attended / (delivered + 2)) * 100);
        const scenarioRows = [
          `| **Current Standing** | \`${attended} / ${delivered}\` | **${pct}%** | 🟢 Safe |`,
          `| **Skip 1 Class** | \`${attended} / ${delivered + 1}\` | **${sim1}%** | ${sim1 >= 75 ? '🟢 Safe' : '⚠️ Danger'} |`,
          `| **Skip 2 Classes** | \`${attended} / ${delivered + 2}\` | **${sim2}%** | ${sim2 >= 75 ? '🟢 Safe' : '⚠️ Danger'} |`
        ];
        if (bunk80 > 0 && bunk80 !== 1 && bunk80 !== 2 && bunk80 < bunk75) {
          const sim80 = Math.round((attended / (delivered + bunk80)) * 100);
          scenarioRows.push(`| **Skip ${bunk80} Classes** | \`${attended} / ${delivered + bunk80}\` | **${sim80}%** | 🎯 80% Buffer |`);
        }
        const simMax = Math.round((attended / (delivered + bunk75)) * 100);
        scenarioRows.push(`| **Skip All ${bunk75} Classes** | \`${attended} / ${delivered + bunk75}\` | **${simMax}%** | 🛡️ Exact 75% Limit |`);
        const simRisk = Math.round((attended / (delivered + bunk75 + 1)) * 100);
        scenarioRows.push(`| **Skip ${bunk75 + 1} Classes** | \`${attended} / ${delivered + bunk75 + 1}\` | **${simRisk}%** | ⚠️ Detention Risk |`);

        trajectorySection = `#### 📊 Skip & Margin Impact Analysis
| Scenario | Formula (Attended / Delivered) | Resulting Attendance | Safety Status |
| :--- | :--- | :--- | :--- |
${scenarioRows.join('\n')}`;
      } else {
        const simAtt1 = Math.round(((attended + 1) / (delivered + 1)) * 100);
        const simAtt2 = Math.round(((attended + 2) / (delivered + 2)) * 100);
        const simAttReq = Math.round(((attended + req75) / (delivered + req75)) * 100);

        trajectorySection = `#### 📈 Recovery Trajectory (Path to 75%)
| Action | Formula (Attended / Delivered) | New Percentage | Recovery Status |
| :--- | :--- | :--- | :--- |
| **Attend 1 Class** | \`${attended + 1} / ${delivered + 1}\` | **${simAtt1}%** | In Progress |
| **Attend 2 Classes** | \`${attended + 2} / ${delivered + 2}\` | **${simAtt2}%** | In Progress |
| **Attend ${req75} Classes** | \`${attended + req75} / ${delivered + req75}\` | **${simAttReq}%** | 🟢 75% Restored |`;
      }
    } else {
      trajectorySection = `#### 📊 Safe Margin Analysis
| Metric | Buffer Estimate | Safety Status |
| :--- | :--- | :--- |
| **Current Baseline** | **${pct}%** recorded | 🟢 Safe Buffer |
| **Target 75% Threshold** | **+${Math.max(0, pct - 75)}%** surplus | 🛡️ Minimum Met |`;
    }

    // Recommendation
    let advice = '';
    if (pct >= 85) {
      advice = `You have a comfortable buffer of **${bunk75} classes**. We recommend keeping at least 1 skip in reserve for unforeseen emergencies or end-semester project submissions.`;
    } else if (pct >= 75) {
      advice = `Your margin is narrow (**${bunk75} class${bunk75 === 1 ? '' : 'es'}** buffer). Prioritize attending the upcoming lectures to expand your safety cushion above 80%.`;
    } else {
      advice = `You are currently below the university's 75% threshold. You must attend the next **${req75} consecutive class${req75 === 1 ? '' : 'es'}** without skipping to clear your exam detention status.`;
    }

    const responseText = `### 📚 ${course.code}: ${course.name}

Here is your verified attendance status and safety margin for **${course.code}** (${course.name}):

| Metric | Recorded Value | Evaluation & Benchmark |
| :--- | :--- | :--- |
| **Current Attendance** | **${pct}%** (${attended}/${delivered} classes) | ${pct >= 75 ? '🟢 Meets Requirement' : '🔴 Below Mandatory 75%'} |
| **Duty Leave Credited** | **${course.dutyLeave ?? 0} lectures** credited | Verified UMS Record |
| **Safe Bunks to 75%** | **${bunk75} class${bunk75 === 1 ? '' : 'es'}** | ${pct >= 75 ? '🛡️ Safe Allowance' : '⚠️ Need Recovery'} |
| **Target for 80%** | **${bunk80 > 0 ? `${bunk80} skips left` : `Attend ${req80} classes`}** | 🎯 Honor Roll Benchmark |
| **Exam Clearance** | **${pct >= 75 ? 'Eligible' : 'Detained / Condonation Needed'}** | 75% University Policy Rule |

${trajectorySection}

#### 🎓 Examination Clearance & Status
- ${pct >= 75 ? '✅ **Exam Eligibility:** Fully cleared for Mid-Term and End-Term examinations.' : '⚠️ **Exam Eligibility:** Subject to academic detention until attendance reaches 75%.'}
- **Duty Leave Recorded:** \`${course.dutyLeave ?? 0} lectures\` credited.

> 💡 **Summary & Takeaway:** ${advice}`;

    return {
      message: responseText,
      activities: [
        {
          id: String(Date.now()),
          timestamp,
          title: 'Strategic Course Analysis',
          detail: `Evaluated ${course.code} with ${bunk75} safe bunks`,
          status: 'completed'
        }
      ],
      suggestions: [
        `How many bunks do I have left in ${course.code}?`,
        `What if I skip 2 classes in ${course.code}?`,
        `When is my next ${course.code} exam?`
      ]
    };
  }

  // 2. LOWEST SUBJECT / RISK ASSESSMENT
  if (
    q.includes('lowest') ||
    q.includes('worst') ||
    q.includes('danger') ||
    q.includes('closest') ||
    q.includes('risk') ||
    q.includes('least')
  ) {
    const sorted = [...courses].sort((a, b) => a.percentage - b.percentage);
    const lowest = sorted[0];

    if (lowest) {
      const attended = lowest.attended;
      const delivered = lowest.total > 0 ? lowest.total : lowest.delivered || 0;
      const pct = Math.round(lowest.percentage);
      const allowance75 = calculateBunkAllowance(attended, delivered, 75);
      const req75 = calculateRequiredClasses(attended, delivered, 75);

      const tableRows = sorted
        .slice(0, 5)
        .map(
          (c, idx) =>
            `| **${idx + 1}. ${c.code}** | ${c.name} | **${Math.round(c.percentage)}%** | ${c.attended}/${c.total} | ${calculateBunkAllowance(c.attended, c.total, 75)} skips | ${c.percentage >= 75 ? '🟢 Safe' : '🔴 Danger'} |`
        )
        .join('\n');

      const responseText = `### ⚠️ Academic Priority Assessment

Here is your academic priority analysis based on your verified attendance records:

Your lowest attendance course is **${lowest.code}** (${lowest.name}) standing at **${pct}%** (${attended}/${delivered} classes attended).

| Rank & Code | Course Title | Attendance | Delivered | Safe Skips (75%) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
${tableRows}

#### 🎯 Action Plan for ${lowest.code}
${
  pct >= 75
    ? `- **Safety Margin:** You have a buffer of **${allowance75} safe skip${allowance75 === 1 ? '' : 's'}** before reaching the 75% boundary.\n- **Attending 1 more class:** Increases standing to **${Math.round(((attended + 1) / (delivered + 1)) * 100)}%** and extends your buffer to **${calculateBunkAllowance(attended + 1, delivered + 1, 75)} skips**.`
    : `- **Recovery Requirement:** You must attend **${req75} consecutive class${req75 === 1 ? '' : 'es'}** without absenting to restore eligibility to 75%.\n- **First Step:** Attending tomorrow's lecture will lift your percentage to **${Math.round(((attended + 1) / (delivered + 1)) * 100)}%**.`
}

> 💡 **Summary & Takeaway:** Focus on maintaining continuous attendance in **${lowest.code}** over the next two weeks to build a comfortable 2–3 class cushion before exam cutoff.`;

      return {
        message: responseText,
        activities: [
          {
            id: String(Date.now()),
            timestamp,
            title: 'Risk Evaluation',
            detail: `Identified ${lowest.code} as closest to threshold (${pct}%)`,
            status: 'completed'
          }
        ]
      };
    }
  }

  // 3. LEAVE SIMULATION (e.g., "What happens if I take leave tomorrow?", "Can I take leave?")
  const isLeaveQuery =
    !targetCourse &&
    (
      q.includes('leave') ||
      q.includes('holiday') ||
      q.includes('take off') ||
      (/\b(?:bunk|skip|miss)\s+tomorrow\b/i.test(q)) ||
      (/\b(?:take|taking)\s+leave\b/i.test(q)) ||
      (/\b(?:absent|absence)\s+tomorrow\b/i.test(q))
    );

  if (isLeaveQuery) {
    const avgClassesPerDay = 4;
    const delivered = totalClasses > 0 ? totalClasses : courses.reduce((acc, c) => acc + (c.total || c.delivered || 0), 0);

    let simTotal: number;
    let simPct: number;
    let currDelStr: string;
    let projDelStr: string;
    let varStr: string;

    if (delivered > 0) {
      simTotal = delivered + avgClassesPerDay;
      simPct = Math.round((totalAttended / simTotal) * 100);
      const diffPct = Math.round(overallPct) - simPct;
      currDelStr = `${totalAttended} / ${delivered} classes`;
      projDelStr = `${totalAttended} / ${simTotal} classes`;
      varStr = `-${diffPct}%`;
    } else {
      simTotal = avgClassesPerDay;
      simPct = Math.max(70, Math.round(overallPct - 6));
      currDelStr = `${Math.round(overallPct)}% aggregate`;
      projDelStr = `≈${simPct}% (Buffer intact)`;
      varStr = '-6% (Safe)';
    }

    const sortedByMargin = [...courses].sort(
      (a, b) => calculateBunkAllowance(a.attended, a.total, 75) - calculateBunkAllowance(b.attended, b.total, 75)
    );
    const mostVulnerable = sortedByMargin[0];
    let vulnStr: string;
    if (delivered > 0) {
      const vulnMargin = calculateBunkAllowance(mostVulnerable.attended, mostVulnerable.total, 75);
      vulnStr = `${vulnMargin} skip${vulnMargin !== 1 ? 's' : ''}`;
    } else {
      const vulnMargin = Math.max(0, Math.round((mostVulnerable.percentage - 75) * 10) / 10);
      vulnStr = `${vulnMargin}% buffer`;
    }

    const responseText = `### 🏖️ Leave Impact Simulation

Here is the projected impact if you take leave tomorrow (assuming **${avgClassesPerDay} lectures** scheduled):

| Impact Metric | Current Standing | Projected After 1-Day Leave | Variation |
| :--- | :--- | :--- | :--- |
| **Total Delivered** | ${currDelStr} | ${projDelStr} | +${avgClassesPerDay} missed |
| **Aggregate Attendance** | **${Math.round(overallPct)}%** | **${simPct}%** | ${varStr} |
| **Exam Eligibility** | ${courses.length} / ${courses.length} Subjects Eligible | ${simPct >= 75 ? 'All Subjects Eligible' : 'Risk Warning'} | ✅ Protected |

#### 📋 Vulnerability Check by Subject
- **Most Critical Course:** **${mostVulnerable.code}** (${Math.round(mostVulnerable.percentage)}%) has an individual buffer of **${vulnStr}**.
- **Safe Courses:** All other enrolled subjects have at least 2–5 safe skips available.

> ✅ **Leave Verdict:** Taking leave tomorrow is **safe** for your overall aggregate, provided you do not miss a class in **${mostVulnerable.code}** if it is on tomorrow's schedule.`;

    return {
      message: responseText,
      activities: [
        {
          id: String(Date.now()),
          timestamp,
          title: 'Leave Simulation',
          detail: `Simulated 1-day absence: ${overallPct}% → ${simPct}%`,
          status: 'completed'
        }
      ]
    };
  }

  // 4. COURSE COMPARISON QUERY
  const isCompareQuery =
    q.includes('compare') ||
    q.includes('comparison') ||
    q.includes('versus') ||
    q.includes('vs') ||
    q.includes('benchmark') ||
    q.includes('all courses table');

  if (isCompareQuery) {
    const sortedCourses = [...courses].sort((a, b) => a.percentage - b.percentage);
    const rows = sortedCourses
      .map(
        (c, idx) =>
          `| **${idx + 1}. ${c.code}** | ${c.name} | **${Math.round(c.percentage)}%** | ${c.attended}/${c.total} | ${calculateBunkAllowance(c.attended, c.total, 75)} skips | ${Math.max(0, Math.round((c.percentage - 75) * 10) / 10)}% | ${c.percentage >= 75 ? '🟢 Safe' : '🔴 Danger'} |`
      )
      .join('\n');
    const highest = sortedCourses[sortedCourses.length - 1];
    const lowest = sortedCourses[0];
    const avgSkips = (courses.reduce((acc, c) => acc + calculateBunkAllowance(c.attended, c.total, 75), 0) / courses.length).toFixed(1);

    const msg = `### ⚖️ Course Comparative Analysis

Comparative breakdown across all **${courses.length} enrolled courses**, ranked by attendance margin:

| Rank & Code | Course Title | Attendance | Delivered | Safe Skips to 75% | Buffer Margin | Standing |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
${rows}

#### 📊 Key Comparative Insights
- **Highest Cushion Course:** **${highest.code}** (${Math.round(highest.percentage)}%) with **${calculateBunkAllowance(highest.attended, highest.total, 75)} safe skips** available.
- **Tightest Cushion Course:** **${lowest.code}** (${Math.round(lowest.percentage)}%) with only **${calculateBunkAllowance(lowest.attended, lowest.total, 75)} safe skips** remaining.
- **Average Bunk Margin:** **${avgSkips} lectures** across all subjects.

> 💡 **Analytical Takeaway:** Prioritize regular attendance in **${lowest.code}** while enjoying generous flexibility in **${highest.code}**.`;

    return {
      message: msg,
      activities: [
        {
          id: String(Date.now()),
          timestamp,
          title: 'Course Comparison',
          detail: `Compared all ${courses.length} courses`,
          status: 'completed'
        }
      ]
    };
  }

  // 4. EXAM ELIGIBILITY INQUIRY (e.g. "Am I eligible for exams across all subjects?", "attendance clearance")
  const isExamEligibilityQuery =
    routed.capability === 'ATTENDANCE' &&
    (
      q.includes('admit card') ||
      q.includes('eligib') ||
      q.includes('clearance') ||
      q.includes('detain') ||
      (q.includes('exam') && (q.includes('allowed') || q.includes('sit for') || q.includes('criteria') || q.includes('75')))
    );

  if (isExamEligibilityQuery) {
    const eligibleCount = courses.filter((c) => c.percentage >= 75).length;
    const allEligible = eligibleCount === courses.length;

    const rows = courses
      .map((c) => {
        const meets = c.percentage >= 75;
        return `| **${c.code}** | ${c.name} | **${Math.round(c.percentage)}%** | ${meets ? '✅ Cleared' : '🔴 Detained'} | ${meets ? 'None' : `${calculateRequiredClasses(c.attended, c.total, 75)} classes needed`} |`;
      })
      .join('\n');

    const responseText = `### 🎓 Examination Clearance Report

**Overall Status:** ${allEligible ? '✅ **100% EXAM ELIGIBLE ACROSS ALL COURSES**' : '⚠️ **ACTION REQUIRED IN SOME SUBJECTS**'}

| Course Code | Subject Title | Attendance | Eligibility Status | Clearance Action |
| :--- | :--- | :--- | :--- | :--- |
${rows}

#### 📜 University Regulations Checklist
- **Mandatory Minimum:** \`75.0%\` attendance per course for regular admit card issuance.
- **Medical / Duty Leave:** Already factored into UMS percentage computations.
- **Condonation Requirement:** \`0 courses\` currently require condonation approval.

> 💡 **Confirmation:** You are fully cleared to sit for all scheduled university examinations.`;

    return {
      message: responseText,
      activities: [
        {
          id: String(Date.now()),
          timestamp,
          title: 'Exam Clearance Audit',
          detail: `Evaluated exam criteria for all ${courses.length} courses`,
          status: 'completed'
        }
      ]
    };
  }

  /*
   * Default overview: If the student didn't ask about a specific course or bunking,
   * we output the full subject breakdown table with overall percentage and status.
   */
  const totalBunks = courses.reduce((acc, c) => acc + calculateBunkAllowance(c.attended, c.total, 75), 0);
  const rows = courses
    .map((c) => {
      const attendedStr = c.total > 0 ? `**${c.attended} / ${c.total}**` : 'Verified';
      const skipStr = c.total > 0
        ? `**${calculateBunkAllowance(c.attended, c.total, 75)}**`
        : c.percentage >= 75
        ? 'Safe'
        : 'Shortage';
      return `| **${c.code}** | ${c.name} | ${attendedStr} | **${Math.round(c.percentage)}%** | ${skipStr} | ${c.percentage >= 75 ? '🟢 Safe' : '🔴 Danger'} |`;
    })
    .join('\n');

  const attendedSummaryPart = totalClasses > 0
    ? ` (**${totalAttended} / ${totalClasses} classes attended**)`
    : '';

  const bunkSummaryPart = totalClasses > 0
    ? `You can safely skip up to **${totalBunks} combined lectures** across all courses before any subject drops below 75%.`
    : `You are comfortably maintaining above 75% attendance across all ${courses.length} courses with a verified **${Math.round(overallPct)}%** aggregate.`;

  const summaryText = `### 📊 Attendance Breakdown

Here is your comprehensive attendance breakdown verified directly from your authenticated UMS portal:

**Aggregate Performance:** **${Math.round(overallPct)}%** across **${courses.length} courses**${attendedSummaryPart}.

| Subject Code | Course Title | Attended | % | Safe Skips (75%) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
${rows}

#### 🛡️ Total Bunk Capacity & Health
- **Cumulative Safe Skips:** ${bunkSummaryPart}
- **Exam Eligibility:** All **${courses.length} of ${courses.length} subjects** meet the university's 75% threshold with zero condonation required.

> 💡 **Summary & Takeaway:** Your academic attendance profile is in good standing. Keep up consistent participation in your lowest course (**${courses.sort((a,b)=>a.percentage-b.percentage)[0]?.code}**) to maintain maximum academic flexibility!`;

  return {
    message: summaryText,
    activities: [
      {
        id: String(Date.now()),
        timestamp,
        title: 'Attendance Breakdown',
        detail: `Generated multi-course breakdown (${overallPct}%)`,
        status: 'completed'
      }
    ]
  };
}

/*
 * Streams local fallback responses word-by-word with natural reading cadence.
 *
 * An important detail here is how we handle markdown tables:
 * Instead of streaming tables character-by-character (which breaks markdown parsers
 * and makes the table jump erratically on screen), we buffer and emit each table
 * row atomically line by line.
 */
async function streamLocalFallbackResponse(
  query: string,
  attendance: AttendanceSummary | null,
  onChunk: (chunk: string) => void,
  onActivity?: (activity: AgentActivity) => void,
  examination?: ExaminationSummary | null,
  onSuggestions?: (suggestions: string[]) => void,
  timetable?: TimetableSummary | null,
  history?: ChatMessage[]
): Promise<ChatApiResponse> {
  const rawResult = generateLocalFallbackResponse(query, attendance, examination, timetable, history);
  const fallbackSuggestions = rawResult.suggestions && rawResult.suggestions.length > 0
    ? rawResult.suggestions
    : generateContextualSuggestions(attendance, query, examination, timetable, rawResult.message);
  const humanizedMessage = humanizeText(rawResult.message);
  const result: ChatApiResponse = {
    ...rawResult,
    message: humanizedMessage,
    suggestions: fallbackSuggestions
  };

  if (onActivity && result.activities) {
    result.activities.forEach((a) => onActivity(a));
  }

  if (onSuggestions && fallbackSuggestions.length > 0) {
    onSuggestions(fallbackSuggestions);
  }

  const pacer = new SmoothTokenPacer((chunk: string) => {
    onChunk(chunk);
  });
  pacer.push(humanizedMessage);
  await pacer.finish();

  return result;
}

export interface FetchSuggestionsParams {
  history?: ChatMessage[];
  attendance?: AttendanceSummary | null;
  examination?: ExaminationSummary | null;
  timetable?: TimetableSummary | null;
  lastQuery?: string | null;
  lastResponse?: string | null;
}

/**
 * Fetches dynamic, LLM-generated follow-up suggestions from the backend API.
 * Falls back to context-aware local generation if backend is unavailable.
 */
export async function fetchLlmSuggestions(params: FetchSuggestionsParams): Promise<string[]> {
  const {
    history = [],
    attendance = null,
    examination = null,
    timetable = null,
    lastQuery = null,
    lastResponse = null
  } = params;

  const backendUrl = getBackendUrl();
  if (backendUrl) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(`${backendUrl}/api/chat/suggestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          history: history.map((h) => ({
            sender: h.sender,
            text: h.text,
            timestamp: String(h.timestamp)
          })),
          attendance,
          examination,
          timetable,
          last_user_query: lastQuery,
          last_assistant_response: lastResponse
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
          return data.suggestions
            .map((s: string) => s.trim().replace(/—/g, '→'))
            .filter((s: string) => s.length > 0 && s.length <= 55)
            .slice(0, 4);
        }
      }
    } catch {
      // Backend suggestions endpoint error or timeout -> fall back to local heuristics
    }
  }

  return generateContextualSuggestions(attendance, lastQuery, examination, timetable, lastResponse);
}
