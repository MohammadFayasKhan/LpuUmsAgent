/**
 * Semantic Router & Verified Response Client for ONEE.
 *
 * Directs incoming user queries through the Groq-powered Semantic Engine
 * on the backend, generating:
 * 1. Intent, entities, capability, and spoken acknowledgement text.
 * 2. Conversational responses strictly grounded in verified UMS DOM data.
 */

import { getBackendUrl, generateLocalFallbackResponse as localDeterministicEngine } from './api';
import { getNextExam } from '../content/examination/examinationValidator';

export interface ConversationState {
  currentIntent?: string;
  currentCapability?: string;
  activeTask?: string;
  activeEntity?: Record<string, any>;
  activeDataset?: string;
  activeResult?: Record<string, any>;
  referencedRecords?: Array<Record<string, any>>;
  currentPage?: string;
  recentUserMessages?: string[];
  recentAssistantMessages?: string[];
  verifiedContext?: Record<string, any>;
}

export interface SemanticResolutionRequest {
  query: string;
  executionId: string;
  currentUrl?: string;
  currentPageType?: string;
  activeCapability?: string;
  history?: Array<{ role: string; content: string }>;
  contextSummary?: Record<string, any>;
  conversationState?: ConversationState;
}

export interface SemanticResolutionResult {
  executionId: string;
  intent: string;
  goal: string;
  entities: Record<string, any>;
  references: string[];
  capability: 'timetable' | 'examination' | 'attendance' | 'sample_papers' | 'seating_plan' | 'general' | 'onee_identity' | 'conversation';
  action?: string;
  target?: string;
  requiresBrowserAction: boolean;
  needsClarification: boolean;
  confidence: number;
  acknowledgementText: string;
  modelUsed: string;
  conversationState?: ConversationState;
}

export interface VerifiedResponseRequest {
  executionId: string;
  query: string;
  intent: string;
  capability: string;
  verifiedResult: Record<string, any>;
  history?: Array<{ role: string; content: string }>;
  conversationState?: ConversationState;
  taskOutcome?: 'success' | 'data_unavailable' | 'failed' | 'cancelled';
}

export interface VerifiedResponseResult {
  executionId: string;
  reply: string;
  spokenSummary: string;
  ttsChunks: string[];
  cardType: 'TIMETABLE_RESULT' | 'EXAM_RESULT' | 'ATTENDANCE_RESULT' | 'SAMPLE_PAPER_RESULT' | 'SEATING_PLAN_RESULT' | 'GENERAL_RESPONSE';
  modelUsed: string;
  conversationState?: ConversationState;
}

/**
 * Resolves intent, target capability, and instant acknowledgement text via Groq GPT-OSS 120B / 20B.
 */
export async function resolveSemanticIntent(
  req: SemanticResolutionRequest
): Promise<SemanticResolutionResult> {
  const backendUrl = getBackendUrl();

  if (backendUrl) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(`${backendUrl}/api/intent/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        return {
          executionId: req.executionId,
          intent: data.intent || 'general_query',
          goal: data.goal || req.query,
          entities: data.entities || {},
          references: data.references || [],
          capability: data.capability || 'general',
          action: data.action || (data.requiresBrowserAction ? 'read' : 'respond'),
          target: data.target,
          requiresBrowserAction: Boolean(data.requiresBrowserAction),
          needsClarification: Boolean(data.needsClarification),
          confidence: Number(data.confidence || 0.9),
          acknowledgementText: (data.acknowledgementText || '').trim(),
          modelUsed: data.modelUsed || 'groq-cloud',
          conversationState: data.conversationState
        };
      }
    } catch (err) {
      console.warn('[SemanticRouter] Backend intent resolution error, using local fallback:', err);
    }
  }

  // Deterministic local fallback if backend is unreachable
  return fallbackIntentResolution(req);
}

/**
 * Generates a conversational natural response strictly grounded in verified UMS DOM results.
 */
export async function generateVerifiedResponse(
  req: VerifiedResponseRequest
): Promise<VerifiedResponseResult> {
  const backendUrl = getBackendUrl();

  if (backendUrl) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(`${backendUrl}/api/chat/verified-response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        const reply = data.reply || '';
        const ttsChunks: string[] = Array.isArray(data.ttsChunks) && data.ttsChunks.length > 0
          ? data.ttsChunks
          : [data.spokenSummary || reply].filter(Boolean);

        // Canonical chat response must stay complete. The TTS spoken summary is
        // a SEPARATE artifact derived from verified data, not a slice of the chat text.
        const spokenSummary = data.spokenSummary || '';

        return {
          executionId: req.executionId,
          reply,
          spokenSummary,
          ttsChunks,
          cardType: data.cardType || getCardTypeForCapability(req.capability),
          modelUsed: data.modelUsed || 'groq-cloud',
          conversationState: data.conversationState
        };
      }
    } catch (err) {
      console.warn('[SemanticRouter] Backend verified response generation error, using local fallback:', err);
    }
  }

  return fallbackVerifiedResponse(req);
}


function getCardTypeForCapability(cap: string): VerifiedResponseResult['cardType'] {
  switch (cap) {
    case 'timetable': return 'TIMETABLE_RESULT';
    case 'examination': return 'EXAM_RESULT';
    case 'attendance': return 'ATTENDANCE_RESULT';
    case 'sample_papers': return 'SAMPLE_PAPER_RESULT';
    case 'seating_plan': return 'SEATING_PLAN_RESULT';
    default: return 'GENERAL_RESPONSE';
  }
}

function fallbackIntentResolution(req: SemanticResolutionRequest): SemanticResolutionResult {
  const q = req.query.toLowerCase();
  const cs = req.conversationState;

  // Keep navigation structured when Groq is temporarily unavailable. This is
  // deliberately an offline fallback; normal requests are resolved by Groq.
  if (/\b(?:take|bring|go|navigate|open|return|head)\s+(?:me\s+)?(?:back\s+)?(?:to\s+)?(?:(?:the|my)\s+)?(?:home\s*page|homepage|home|student\s+dashboard|dashboard)\b/i.test(q)) {
    return {
      executionId: req.executionId,
      intent: 'dashboard_navigation',
      goal: 'Navigate to the UMS student dashboard',
      entities: { destination: 'student_dashboard' },
      references: [],
      capability: 'general',
      action: 'navigate',
      target: 'student_dashboard',
      requiresBrowserAction: false,
      needsClarification: false,
      confidence: 1,
      acknowledgementText: '',
      modelUsed: 'local-deterministic-fallback',
      conversationState: {
        ...cs,
        currentCapability: 'general',
        currentIntent: 'dashboard_navigation',
        activeTask: 'navigate_dashboard'
      }
    };
  }

  if (/\b(?:test\s+(?:the\s+)?voice(?:\s+assistant)?|voice\s+test|hear\s+nothing|can(?:\s*')?t\s+hear|sound\s+check|audio\s+test|check\s+voice|voice\s+check|test\s+speech|speak\s+to\s+me)\b/i.test(q)) {
    return {
      executionId: req.executionId,
      intent: 'voice_diagnostic',
      goal: 'Confirm ONEE voice playback',
      entities: { interaction: 'voice_diagnostic' },
      references: [],
      capability: 'conversation',
      action: 'respond',
      requiresBrowserAction: false,
      needsClarification: false,
      confidence: 1,
      acknowledgementText: '',
      modelUsed: 'local-deterministic-fallback',
      conversationState: {
        ...cs,
        currentCapability: 'conversation',
        currentIntent: 'voice_diagnostic',
        activeTask: 'voice_diagnostic'
      }
    };
  }

  // 0. Identity & Greetings
  if (/who are you|what is your name|introduce yourself|tell me about yourself|what can you do|what are you|who r u/i.test(q)) {
    return {
      executionId: req.executionId,
      intent: 'identity_query',
      goal: 'Explain ONEE identity and capabilities',
      entities: {},
      references: [],
      capability: 'onee_identity',
      action: 'respond',
      requiresBrowserAction: false,
      needsClarification: false,
      confidence: 0.99,
      acknowledgementText: "Hey, I'm ONEE, your LPU AI academic companion.",
      modelUsed: 'local-deterministic-fallback',
      conversationState: {
        currentCapability: 'onee_identity',
        currentIntent: 'identity_query'
      }
    };
  }

  const isWeeklyMatrixQuery = /all classes|matrix|weekly|complete list|list of classes|this week|whole week|entire week|every day|all days|detailed matrix|classes that i have|classes in this week|full timetable/i.test(q);

  // 1. Attendance & Bunk Allowance (Evaluated FIRST so "Can I safely skip CSE330 tomorrow?" or "bunk" is never captured by timetable days)
  const isAttendanceQuery =
    /attendance|bunk|skip|skipping|miss\s+class|miss|can\s+i\s+skip|safely\s+skip|can\s+i\s+bunk|duty\s+leave|75%|how\s+many\s+can\s+i|maintain|how\s+to\s+maintain|how\s+can\s+i\s+maintain|lowest|least|minimum|maximum|highest|shortage|aggregate|overall|percentage|subject|subjects/i.test(q) &&
    !/datesheet|date\s+sheet|exam\s+schedule/i.test(q);

  const isNumericFollowup =
    cs?.currentCapability === 'attendance' &&
    (/(what\s+about|how\s+about|can\s+i\s+do|can\s+i\s+skip|and)?\s*\d+\s*\??$/i.test(q) ||
     /^\s*\d+\s*$/i.test(q));

  if (isNumericFollowup || isAttendanceQuery) {
    const numMatch = q.match(/\b(\d+)\b/);
    const targetBunks = numMatch ? parseInt(numMatch[1], 10) : undefined;
    const courseMatch = q.match(/\b([a-z]{2,5}\s*\d{2,4}[a-z]?)\b/i);
    const courseCode = courseMatch
      ? courseMatch[1].replace(/\s+/g, '').toUpperCase()
      : cs?.activeEntity?.courseCode;
    const hasCachedAtt = Boolean(
      req.contextSummary?.hasAttendance ||
      (req.conversationState?.verifiedContext && req.conversationState.verifiedContext.hasAttendance)
    );

    return {
      executionId: req.executionId,
      intent: 'attendance_query',
      goal: courseCode
        ? `Check attendance records and safe bunks for ${courseCode}`
        : 'Check attendance records and bunk allowance',
      entities: {
        ...(cs?.activeEntity || {}),
        ...(courseCode ? { courseCode } : {}),
        ...(targetBunks !== undefined ? { targetBunks } : {})
      },
      references: cs?.currentCapability === 'attendance' ? ['previous attendance query'] : [],
      capability: 'attendance',
      action: hasCachedAtt ? 'respond' : 'read',
      requiresBrowserAction: !hasCachedAtt,
      needsClarification: false,
      confidence: 0.95,
      acknowledgementText: isNumericFollowup
        ? 'Calculating that attendance projection.'
        : courseCode
        ? `Checking attendance and safe bunks for ${courseCode}.`
        : 'Checking your attendance records.',
      modelUsed: 'local-deterministic-fallback',
      conversationState: {
        ...cs,
        currentCapability: 'attendance',
        currentIntent: 'attendance_query',
        activeEntity: {
          ...(cs?.activeEntity || {}),
          ...(courseCode ? { courseCode } : {}),
          ...(targetBunks !== undefined ? { targetBunks } : {})
        }
      }
    };
  }

  // Examination / seating questions must never be answered from the timetable
  // dataset, even while a timetable conversation happens to be active.
  const mentionsExamDomain =
    /\b(exam|exams|examination|date\s*sheet|datesheet|seating|seat\s*(?:number|plan|no)|reporting\s*time|admit\s*card|hall\s*ticket)\b/i.test(q);

  // 2. Conversational Continuity & Follow-ups within active timetable capability
  if (cs?.currentCapability === 'timetable' && !mentionsExamDomain) {
    if (isWeeklyMatrixQuery) {
      return {
        executionId: req.executionId,
        intent: 'timetable_query',
        goal: 'Check complete weekly timetable matrix',
        entities: { view: 'weekly_matrix', day: 'all' },
        references: ['previous timetable query'],
        capability: 'timetable',
        requiresBrowserAction: false,
        needsClarification: false,
        confidence: 0.98,
        acknowledgementText: 'Preparing your full weekly class matrix.',
        modelUsed: 'local-deterministic-fallback',
        conversationState: {
          ...cs,
          activeEntity: { view: 'weekly_matrix', day: 'all' }
        }
      };
    }

    const daysMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayIdx = new Date().getDay();
    const tomorrowDay = daysMap[(todayIdx + 1) % 7];
    const todayDay = daysMap[todayIdx] === 'Sunday' ? 'Monday' : daysMap[todayIdx];

    let matchedDayName: string | undefined;
    if (/day after tomorrow/i.test(q)) {
      matchedDayName = daysMap[(todayIdx + 2) % 7];
    } else if (/tomorrow/i.test(q)) {
      matchedDayName = tomorrowDay;
    } else if (/today/i.test(q)) {
      matchedDayName = todayDay;
    } else {
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const matched = days.find(d => q.includes(d));
      if (matched) {
        matchedDayName = matched.charAt(0).toUpperCase() + matched.slice(1);
      }
    }

    if (matchedDayName) {
      const day = matchedDayName;
      const hasCachedTimetable = Boolean(
        req.contextSummary?.hasTimetable ||
        (req.conversationState?.verifiedContext && req.conversationState.verifiedContext.hasTimetable)
      );
      return {
        executionId: req.executionId,
        intent: 'timetable_query',
        goal: `Check timetable for ${day}`,
        entities: { day, view: 'daily_schedule' },
        references: ['previous timetable query'],
        capability: 'timetable',
        action: hasCachedTimetable ? 'respond' : 'read',
        requiresBrowserAction: !hasCachedTimetable,
        needsClarification: false,
        confidence: 0.95,
        acknowledgementText: `Checking your ${day} class schedule.`,
        modelUsed: 'local-deterministic-fallback',
        conversationState: {
          ...cs,
          activeEntity: { day, view: 'daily_schedule' }
        }
      };
    }

    if (/practical|lab|room|which one|timing|when|where|who teaches|faculty|cabin/i.test(q)) {
      return {
        executionId: req.executionId,
        intent: 'timetable_query',
        goal: req.query,
        entities: cs.activeEntity || {},
        references: ['current timetable query'],
        capability: 'timetable',
        requiresBrowserAction: false,
        needsClarification: false,
        confidence: 0.95,
        acknowledgementText: 'Checking that in your schedule.',
        modelUsed: 'local-deterministic-fallback',
        conversationState: cs
      };
    }
  }

  // 2. Sample Papers (Evaluated ahead of Timetable so sample paper queries are never hijacked)
  if (/sample\s*(?:question\s*)?paper|sample\s*question|question\s*paper|previous\s*year|model\s*paper/i.test(q)) {
    const courseMatch = q.match(/\b([A-Za-z]{2,5})\s*(\d{2,4}[A-Za-z]?)\b/i);
    let courseCode: string | undefined = undefined;
    if (courseMatch) {
      let pfx = courseMatch[1].toUpperCase();
      const num = courseMatch[2].toUpperCase();
      if (!['PAPER', 'SAMPLE', 'TERM', 'EXAM', 'DATE', 'TIME'].includes(pfx)) {
        if (pfx === 'CSC') pfx = 'CSE';
        courseCode = `${pfx}${num}`;
      }
    }
    return {
      executionId: req.executionId,
      intent: 'sample_paper_query',
      goal: `Discover or download sample paper${courseCode ? ' for ' + courseCode : ''}`,
      entities: courseCode ? { courseCode } : {},
      references: [],
      capability: 'sample_papers',
      action: 'read',
      requiresBrowserAction: true,
      needsClarification: false,
      confidence: 0.98,
      acknowledgementText: `Searching for official sample question paper${courseCode ? ' for ' + courseCode : ''}.`,
      modelUsed: 'local-deterministic-fallback',
      conversationState: {
        currentCapability: 'sample_papers',
        currentIntent: 'sample_paper_query',
        activeEntity: courseCode ? { courseCode } : {}
      }
    };
  }

  // 3. Timetable, Courses & Faculty Directory
  const isTimetableQuery =
    !isAttendanceQuery &&
    !/sample\s*(?:question\s*)?paper|question\s*paper|model\s*paper/i.test(q) &&
    !/datesheet|date\s*sheet|atom\s*exam|term\s*exam/i.test(q) &&
    (isWeeklyMatrixQuery ||
      /timetable|time table|schedule|routine|period|periods|class\s+on|classes\s+on|my classes|classes today|today classes|tomorrow classes|classes tomorrow|which class|what class|lecture|lectures|who teaches|faculty|teacher|teachers|professor|professors|cabin|cabins/i.test(q) ||
      ((/courses|enrolled courses|registered courses|curriculum/i.test(q)) && !/attendance|bunk|skip|maintain|exam/i.test(q)) ||
      ((/monday|tuesday|wednesday|thursday|friday|saturday|sunday/i.test(q)) && !/exam|attendance|bunk/i.test(q)));

  if (isTimetableQuery) {
    const daysMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayIdx = new Date().getDay();
    const tomorrowDay = daysMap[(todayIdx + 1) % 7];
    const todayDay = daysMap[todayIdx] === 'Sunday' ? 'Monday' : daysMap[todayIdx];

    let day: string | undefined;
    if (isWeeklyMatrixQuery) {
      day = 'all';
    } else if (/day after tomorrow/i.test(q)) {
      day = daysMap[(todayIdx + 2) % 7];
    } else if (/tomorrow/i.test(q)) {
      day = tomorrowDay;
    } else if (/today/i.test(q)) {
      day = todayDay;
    } else {
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const matchedDay = days.find(d => q.includes(d));
      if (matchedDay) {
        day = matchedDay.charAt(0).toUpperCase() + matchedDay.slice(1);
      }
    }

    const isCourseOrFacultyQ = /course|courses|subject|subjects|curriculum|who teaches|faculty|teacher|teachers|professor|professors|cabin|cabins/i.test(q);
    const hasCachedTt = Boolean(
      req.contextSummary?.hasTimetable ||
      (req.conversationState?.verifiedContext && req.conversationState.verifiedContext.hasTimetable)
    );

    return {
      executionId: req.executionId,
      intent: 'timetable_query',
      goal: isCourseOrFacultyQ
        ? 'Check registered courses and faculty directory'
        : isWeeklyMatrixQuery
        ? 'Check complete weekly timetable matrix'
        : `Check timetable${day ? ' for ' + day : ''}`,
      entities: isWeeklyMatrixQuery ? { view: 'weekly_matrix', day: 'all' } : (day ? { day, view: 'daily_schedule' } : {}),
      references: [],
      capability: 'timetable',
      action: hasCachedTt ? 'respond' : 'read',
      requiresBrowserAction: !hasCachedTt,
      needsClarification: false,
      confidence: 0.95,
      acknowledgementText: isCourseOrFacultyQ
        ? 'Checking your registered courses and faculty directory.'
        : isWeeklyMatrixQuery
        ? 'Preparing your weekly class matrix.'
        : `Checking your ${day ? day + ' ' : ''}class schedule.`,
      modelUsed: 'local-deterministic-fallback',
      conversationState: {
        currentCapability: 'timetable',
        currentIntent: 'timetable_query',
        activeEntity: isWeeklyMatrixQuery ? { view: 'weekly_matrix', day: 'all' } : (day ? { day, view: 'daily_schedule' } : {})
      }
    };
  }

  // 4. Examination
  if (/exam|datesheet|date\s+sheet|atom\s+exam|term\s+exam|mid\s*term|end\s*term/i.test(q)) {
    const hasCachedExam = Boolean(
      req.contextSummary?.hasExamination ||
      (req.conversationState?.verifiedContext && req.conversationState.verifiedContext.hasExamination)
    );
    return {
      executionId: req.executionId,
      intent: 'examination_query',
      goal: 'Check upcoming examination schedule',
      entities: { examType: q.includes('atom') ? 'atom' : (q.includes('term') ? 'term' : 'all') },
      references: [],
      capability: 'examination',
      action: hasCachedExam ? 'respond' : 'read',
      requiresBrowserAction: !hasCachedExam,
      needsClarification: false,
      confidence: 0.85,
      acknowledgementText: 'Looking up your examination schedule.',
      modelUsed: 'local-deterministic-fallback',
      conversationState: {
        currentCapability: 'examination',
        currentIntent: 'examination_query'
      }
    };
  }

  return {
    executionId: req.executionId,
    intent: 'general_query',
    goal: req.query,
    entities: {},
    references: [],
    capability: 'general',
    requiresBrowserAction: false,
    needsClarification: false,
    confidence: 0.7,
    acknowledgementText: 'I am on it.',
    modelUsed: 'local-deterministic-fallback'
  };
}

function fallbackSplitForTts(text: string, maxChars: number = 195): string[] {
  // Strip markdown formatting for speech
  const clean = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/#+\s*/g, '')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/[*_]{1,3}/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\|/g, ', ')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[[a-zA-Z0-9_\s\-]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return [];

  const sentences = clean.split(/(?<=[.?!])\s+/);
  const chunks: string[] = [];
  let cur = '';

  for (const s of sentences) {
    if (!s) continue;
    if (cur) {
      if ((cur + ' ' + s).length <= maxChars) {
        cur += ' ' + s;
        continue;
      } else {
        chunks.push(cur);
        cur = '';
      }
    }
    if (s.length <= maxChars) {
      cur = s;
    } else {
      // Split on clauses
      const parts = s.split(/(?<=[,;:\-])\s+/);
      for (const p of parts) {
        if (!p) continue;
        if (cur) {
          if ((cur + ' ' + p).length <= maxChars) {
            cur += ' ' + p;
            continue;
          } else {
            chunks.push(cur);
            cur = '';
          }
        }
        if (p.length <= maxChars) {
          cur = p;
        } else {
          chunks.push(p.slice(0, maxChars));
        }
      }
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

function fallbackVerifiedResponse(req: VerifiedResponseRequest): VerifiedResponseResult {
  const cardType = getCardTypeForCapability(req.capability);
  const data = req.verifiedResult || {};
  const outcome = req.taskOutcome || 'success';
  const qLower = (req.query || '').toLowerCase();

  const isIdentity = /who are you|what can you do|introduce yourself|tell me about yourself|what are you/i.test(qLower);
  const isCasual = /^(hello|hi|hey|good morning|good evening|how are you|thank you|thanks)\b/i.test(qLower.trim());

  if (isIdentity || isCasual || req.capability === 'onee_identity' || req.capability === 'conversation') {
    const reply = `Hello! I am **ONEE** → your intelligent, aesthetic, and dedicated AI companion at Lovely Professional University (LPU). 🎓✨

I'm directly integrated with your authenticated UMS portal to assist you with:
- 📅 **Student Timetable:** View your daily class schedule, classroom/block numbers, and faculty details.
- 📊 **Attendance & Bunks:** Track your subject percentages, calculate safe skip limits to stay above 75%, and audit exam clearance.
- 📝 **Examinations & Seating:** Check upcoming exam datesheets, reporting timings, and exact hall/seat numbers.
- 📄 **Sample Papers:** Find and download official sample question papers.

How can I assist your academics today?`;
    const spokenSummary = `Hey, I'm ONEE, your LPU AI academic companion! How can I assist your academics today?`;
    return {
      executionId: req.executionId,
      reply,
      spokenSummary,
      ttsChunks: [spokenSummary],
      cardType: 'GENERAL_RESPONSE',
      modelUsed: 'local-deterministic-fallback',
      conversationState: req.conversationState
    };
  }

  let reply = '';
  let spokenSummary = '';

  if (outcome === 'failed' || outcome === 'cancelled') {
    reply = `I wasn't able to complete the verification on UMS. Please ensure you are logged into your UMS account and try again.`;
  } else if (outcome === 'data_unavailable' || Object.keys(data).length === 0) {
    if (req.capability === 'sample_papers') {
      reply = `I checked the examination information available through UMS, but I couldn't find a verified sample-paper link for that course. I don't want to claim that one exists when I can't verify it.`;
    } else if (req.capability === 'timetable') {
      reply = `I checked your active UMS session, but no timetable records were available. Please ensure your Student Time Table report is open on UMS, or ask me: 'Open my timetable'.`;
    } else if (req.capability === 'examination') {
      reply = `I checked your UMS examination records, but no scheduled exams or date sheet entries were found.`;
    } else if (req.capability === 'attendance') {
      reply = `I checked your UMS student portal, but no attendance records were available on this page.`;
    } else {
      reply = `I checked UMS, but the requested records were not available in a form I could verify.`;
    }
  } else if (req.capability === 'timetable') {
    const qLower = (req.query || '').toLowerCase();
    const allSlots: any[] = Array.isArray(data.slots) ? data.slots : [];
    const byDay = data.byDay || {};
    const courses = data.courses || [];

    const isWeekly =
      Boolean(data.isWeekly) ||
      data.day === 'Weekly Matrix' ||
      data.day === 'all' ||
      req.conversationState?.activeEntity?.view === 'weekly_matrix' ||
      /all classes|matrix|weekly|complete list|list of classes|this week|whole week|entire week|every day|all days|detailed matrix|classes that i have|classes in this week|full timetable/i.test(qLower);

    if (isWeekly && (allSlots.length > 0 || Object.keys(byDay).length > 0)) {
      const dayOrder = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const sections: string[] = [];
      let busiestDay = '';
      let maxClasses = 0;

      for (const d of dayOrder) {
        let dClasses: any[] = [];
        if (byDay[d] && Array.isArray(byDay[d])) {
          dClasses = byDay[d];
        } else if (allSlots.length > 0) {
          dClasses = allSlots.filter((s: any) => (s.day || '').toLowerCase() === d.toLowerCase());
        }

        if (dClasses.length > maxClasses) {
          maxClasses = dClasses.length;
          busiestDay = d;
        }

        if (dClasses.length > 0) {
          const rows = dClasses.map((c: any) =>
            `| **${c.time || 'TBD'}** | **${c.courseCode || 'TBD'}** | ${c.type || c.slotType || 'Lecture'} | ${c.room || 'N/A'} | ${c.section || 'N/A'} |`
          ).join('\n');
          sections.push(
            `#### 🗓️ ${d} (${dClasses.length} class${dClasses.length > 1 ? 'es' : ''})\n\n` +
            `| Time Slot | Subject Code | Type | Room / Venue | Section |\n` +
            `| :--- | :--- | :--- | :--- | :--- |\n` +
            `${rows}`
          );
        }
      }

      const totalPracticals = allSlots.filter((s: any) =>
        /practical|lab/i.test(s.type || s.slotType || s.courseCode || '')
      ).length;
      const uniqueBlocks = Array.from(new Set(
        allSlots
          .map((s: any) => String(s.room || '').split('-')[0].trim())
          .filter((b: string) => b && !isNaN(Number(b)))
      )).sort();
      const blockDesc = uniqueBlocks.length > 0 ? `Block ${uniqueBlocks.join(', Block ')}` : 'designated campus classrooms';

      const matrixContent = sections.join('\n\n');
      const totalCount = allSlots.length > 0 ? allSlots.length : Object.values(byDay).reduce((acc: number, arr: any) => acc + (Array.isArray(arr) ? arr.length : 0), 0);
      const uniqueCourses = courses.length > 0 ? courses.length : new Set(allSlots.map((s: any) => s.courseCode).filter(Boolean)).size;

      reply =
        `### 📅 Complete Weekly Class Schedule Matrix\n\n` +
        `Here is your comprehensive weekly schedule matrix verified directly from your authenticated UMS Student Time Table (**${totalCount} total classes** across **${uniqueCourses || 'enrolled'} courses**):\n\n` +
        `${matrixContent}\n\n` +
        `#### 📊 Weekly Academic Insights\n` +
        `- **Busiest Day:** ${busiestDay || 'Monday'} with ${maxClasses} sessions scheduled.\n` +
        `- **Practical & Lab Work:** ${totalPracticals} practical sessions scheduled across your week.\n` +
        `- **Classroom Blocks:** Primary lectures and labs are held in ${blockDesc}.\n` +
        `- **Total Weekly Commitment:** ${totalCount} periods scheduled across your week.\n\n` +
        `> 💡 **Schedule Note:** Classroom numbers and timings are verified directly from your authenticated UMS Student Time Table.`;
      spokenSummary = `Here is your complete weekly class matrix with ${totalCount} total classes scheduled from Monday to Saturday across your courses.`;
    } else {
      // 1. Resolve requested day dynamically
      let day = data.day;
      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const daysMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const todayIdx = new Date().getDay();
      const tomorrowDay = daysMap[(todayIdx + 1) % 7];
      const todayDay = daysMap[todayIdx] === 'Sunday' ? 'Monday' : daysMap[todayIdx];

      if (qLower.includes('day after tomorrow') || (day && String(day).toLowerCase() === 'day after tomorrow')) {
        day = daysMap[(todayIdx + 2) % 7];
      } else if (qLower.includes('tomorrow') || (day && String(day).toLowerCase() === 'tomorrow')) {
        day = tomorrowDay;
      } else if (qLower.includes('today') || (day && String(day).toLowerCase() === 'today')) {
        day = todayDay;
      } else {
        for (const d of days) {
          if (qLower.includes(d)) {
            day = d.charAt(0).toUpperCase() + d.slice(1);
            break;
          }
        }
      }

      if (!day || day === 'all' || day === 'Weekly Matrix') {
        if (req.conversationState?.activeEntity?.day && req.conversationState.activeEntity.day !== 'all' && req.conversationState.activeEntity.day !== 'Weekly Matrix') {
          day = req.conversationState.activeEntity.day;
        } else {
          day = todayDay;
        }
      }

      // 2. Resolve classes for that day
      let classes: any[] = data.classes || [];
      if (classes.length === 0 || data.isWeekly) {
        if (byDay && byDay[day] && Array.isArray(byDay[day])) {
          classes = byDay[day];
        } else if (allSlots.length > 0) {
          classes = allSlots.filter((s: any) => (s.day || '').toLowerCase() === day.toLowerCase());
        }
      }

      // 3. Handle specific follow-ups (courses, practical, room, faculty, cabins)
      const courseMatch = qLower.match(/\b([a-z]{2,5}\s*\d{2,4}[a-z]?)\b/i);
      const queriedCourse = courseMatch ? courseMatch[1].toUpperCase() : null;

      // Word boundaries matter here: a substring match made "syllabus" look like
      // a practical/lab request and hijacked exam questions with a lab answer.
      const isPracticalQ = /\b(practical|practicals|lab|labs)\b|which one is practical/i.test(qLower);
      const isRoomQ = /which room|what room|room number|where is/i.test(qLower);
      const isFacultyQ = /who teaches|faculty|cabin|cabins|teacher|teachers|professor/i.test(qLower);
      const isScheduleQ = /timetable|time table|schedule|routine|class|classes|period|periods|lecture|lectures|tomorrow|today/i.test(qLower);
      const isCoursesQ = /courses|course list|subjects|subject list|curriculum|enrolled courses|registered courses|what courses|what subjects|my courses/i.test(qLower);
      const isFacultyDirectoryQ =
        /faculty directory|all teachers|all faculty|who are my teachers|who are my faculty|professors list|teacher list/i.test(qLower) ||
        (isFacultyQ && !isScheduleQ && (!classes.length || /all|every|overall|whole|list/i.test(qLower)));
      const isFacultyOnly = isFacultyQ && !isScheduleQ;

      // Extract faculty & cabin details for relevant courses
      const coursesList: any[] = Array.isArray(data.courses) ? data.courses : [];
      const seenCodes = new Set<string>();
      const facRows: string[] = [];

      for (const c of classes) {
        const code = (c.courseCode || '').toUpperCase();
        if (code && !seenCodes.has(code)) {
          seenCodes.add(code);
          const matchedCourse = coursesList.find((co: any) => (co.courseCode || '').toUpperCase() === code);
          const facName = c.facultyName || matchedCourse?.facultyName || 'Course Instructor';
          const cabin = c.facultyCabin || matchedCourse?.facultyCabin || matchedCourse?.cabinNumber || 'Verified in UMS report';
          facRows.push(`| **${code}** | ${facName} | ${cabin} |`);
        }
      }

      if ((isCoursesQ || isFacultyDirectoryQ) && coursesList.length > 0) {
        const totalCredits = coursesList.reduce((acc: number, c: any) => acc + (parseInt(c.credits, 10) || 0), 0);
        const rows = coursesList.map((c: any) => {
          const ltp = `${c.lectures ?? 0}-${c.tutorial ?? 0}-${c.practical ?? 0}`;
          const fac = c.facultyName ? `${c.facultyName}${c.facultyCabin ? ` (${c.facultyCabin})` : ''}` : 'Not Assigned / NA';
          return `| **${c.courseCode}** | ${c.courseType || 'Core'} | ${c.courseTitle || ''} | ${ltp} | ${c.credits ?? 0} | ${fac} | ${c.lastUpdated || 'NA'} |`;
        }).join('\n');

        reply =
          `### 📚 Registered Courses & Faculty Directory\n\n` +
          `Here is your official enrolled curriculum (**${coursesList.length} courses**, **${totalCredits} total credits**) verified from your authenticated UMS portal:\n\n` +
          `| Course Code | Type | Course Title | L-T-P | Credits | Faculty & Cabin | Last Updated |\n` +
          `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n` +
          `${rows}\n\n` +
          `> 💡 **Directory Note:** Faculty cabin locations and course credits are verified directly from your official UMS Student Time Table report.`;
        spokenSummary = `You are registered in ${coursesList.length} courses totaling ${totalCredits} credits for this semester.`;
      } else if (isFacultyQ && queriedCourse && coursesList.length > 0) {
        const matchedCourse = coursesList.find((co: any) => (co.courseCode || '').toUpperCase() === queriedCourse);
        if (matchedCourse) {
          const ltp = `${matchedCourse.lectures ?? 0}-${matchedCourse.tutorial ?? 0}-${matchedCourse.practical ?? 0}`;
          const facName = matchedCourse.facultyName || 'Course Instructor';
          const facCabin = matchedCourse.facultyCabin || matchedCourse.cabinNumber || 'Verified in UMS report';
          reply =
            `### 👨‍🏫 Course Faculty: **${queriedCourse}**\n\n` +
            `**${queriedCourse}** (${matchedCourse.courseTitle}) is taught by **${facName}** (Cabin: **${facCabin}**):\n\n` +
            `| Detail | Information |\n` +
            `| :--- | :--- |\n` +
            `| **Course Code** | **${queriedCourse}** |\n` +
            `| **Course Title** | ${matchedCourse.courseTitle} |\n` +
            `| **Course Type** | ${matchedCourse.courseType || 'Core'} |\n` +
            `| **Credits & L-T-P** | **${matchedCourse.credits ?? 0} Credits** (L-T-P: ${ltp}) |\n` +
            `| **Faculty / Instructor** | **${facName}** |\n` +
            `| **Cabin Location** | **${facCabin}** |\n\n` +
            `> 💡 **Directory Note:** Faculty assignments and cabin locations are verified directly from your authenticated UMS Student Time Table report.`;
          spokenSummary = `${queriedCourse} is taught by ${facName}, cabin location ${facCabin}.`;
        }
      } else if (isPracticalQ && classes.length > 0) {
        const practicals = classes.filter((c: any) =>
          /practical|lab/i.test(c.type || c.slotType || c.courseTitle || c.courseCode || '')
        );
        if (practicals.length > 0) {
          const pRows = practicals.map((p: any) =>
            `| **${p.time || 'TBD'}** | **${p.courseCode || 'Practical'}** | Practical | ${p.room || 'N/A'} | ${p.section || 'N/A'} |`
          ).join('\n');
          reply =
            `### 🔬 Practical Labs for **${day}**\n\n` +
            `You have **${practicals.length} practical session${practicals.length > 1 ? 's' : ''}** scheduled on **${day}**:\n\n` +
            `| Time Slot | Subject Code | Type | Room / Venue | Section |\n` +
            `| :--- | :--- | :--- | :--- | :--- |\n` +
            `${pRows}\n\n` +
            `> 💡 **Schedule Note:** Classroom numbers and timings are verified directly from your authenticated UMS Student Time Table.`;
          spokenSummary = `You have ${practicals.length} practical session${practicals.length > 1 ? 's' : ''} on ${day} in Room ${practicals[0]?.room || 'N/A'}.`;
        } else {
          reply = `### 🔬 Practical Labs for **${day}**\n\nYou do not have any practical classes scheduled on **${day}**; all scheduled sessions are theory lectures.`;
          spokenSummary = `You do not have any practical classes scheduled on ${day}.`;
        }
      } else if (isRoomQ && classes.length > 0) {
        const courseMatch = qLower.match(/\b([a-z]{2,4}\d{3,4})\b/i);
        const queriedCourse = courseMatch ? courseMatch[1].toUpperCase() : null;
        let targetSlot: any = null;
        let targetDay: string = day;

        if (queriedCourse) {
          const matchInClasses = classes.find(
            (c: any) => (c.courseCode || c.course_code || '').toUpperCase() === queriedCourse
          );
          if (matchInClasses) {
            targetSlot = matchInClasses;
            targetDay = day;
          } else {
            const matchInSlots = allSlots.find(
              (s: any) => (s.courseCode || s.course_code || '').toUpperCase() === queriedCourse
            );
            if (matchInSlots) {
              targetSlot = matchInSlots;
              targetDay = matchInSlots.day || day;
            }
          }
        }

        if (queriedCourse && targetSlot) {
          reply =
            `### 📍 Next Class Location: **${queriedCourse}**\n\n` +
            `Your next **${queriedCourse}** session is scheduled on **${targetDay}**:\n\n` +
            `| Detail | Information |\n` +
            `| :--- | :--- |\n` +
            `| **Course Code** | **${queriedCourse}** |\n` +
            `| **Type** | ${targetSlot.type || targetSlot.slotType || 'Class'} |\n` +
            `| **Time** | **${targetSlot.time || targetSlot.timing || 'TBD'}** |\n` +
            `| **Room / Venue** | **${targetSlot.room || 'N/A'}** |\n` +
            `| **Section** | ${targetSlot.section || 'N/A'} |\n\n` +
            `> 💡 **Schedule Note:** Classroom numbers and timings are verified directly from your authenticated UMS Student Time Table.`;
          spokenSummary = `Your next ${queriedCourse} class is scheduled at ${targetSlot.time || targetSlot.timing || 'scheduled time'} in Room ${targetSlot.room || 'confirmed room'}.`;
        } else {
          const rRows = classes.map((c: any) =>
            `| **${c.time || 'TBD'}** | **${c.courseCode || 'Class'}** | ${c.type || c.slotType || 'Lecture'} | **${c.room || 'N/A'}** | ${c.section || 'N/A'} |`
          ).join('\n');
          reply =
            `### 📍 Classroom Assignments for **${day}**\n\n` +
            `Here are the confirmed room locations for your **${day}** classes:\n\n` +
            `| Time Slot | Subject Code | Type | Room / Venue | Section |\n` +
            `| :--- | :--- | :--- | :--- | :--- |\n` +
            `${rRows}\n\n` +
            `> 💡 **Schedule Note:** Classroom numbers are verified directly from your authenticated UMS Student Time Table.`;
          spokenSummary = `Here are the classroom assignments for your ${day} classes.`;
        }
      } else if (isFacultyOnly && classes.length > 0) {
        if (facRows.length > 0) {
          reply =
            `### 👨‍🏫 Faculty & Cabin Directory for **${day}**\n\n` +
            `Here are the instructors and cabin locations for your **${day}** classes:\n\n` +
            `| Subject Code | Instructor / Faculty | Cabin Location |\n` +
            `| :--- | :--- | :--- |\n` +
            facRows.join('\n') + '\n\n' +
            `> 💡 **Directory Note:** Faculty assignments and cabin locations are verified directly from your authenticated UMS Student Time Table report.`;
          spokenSummary = `Here are the faculty details and cabin locations for your ${day} classes.`;
        } else {
          reply = `Faculty details for **${day}**'s classes are verified in your full UMS timetable report.`;
          spokenSummary = `Faculty details for ${day} can be verified in your UMS timetable report.`;
        }
      } else if (classes.length > 0) {
        const rows = classes.map((c: any) =>
          `| **${c.time || 'TBD'}** | **${c.courseCode || 'TBD'}** | ${c.type || c.slotType || 'Lecture'} | ${c.room || 'N/A'} | ${c.section || 'N/A'} |`
        ).join('\n');
        const practicals = classes.filter((c: any) =>
          /practical|lab/i.test(c.type || c.slotType || c.courseCode || '')
        );
        const lectures = classes.filter((c: any) => !practicals.includes(c));
        const rooms = Array.from(new Set(classes.map((c: any) => String(c.room || '').trim()).filter(Boolean)));
        const roomDesc = rooms.length > 0 ? `Classes are scheduled in ${rooms.join(', ')}.` : 'Classroom venues are confirmed.';

        let facultySection = '';
        if (isFacultyQ && facRows.length > 0) {
          facultySection =
            `\n\n#### 👨‍🏫 Faculty & Cabin Directory\n` +
            `| Subject Code | Instructor / Faculty | Cabin Location |\n` +
            `| :--- | :--- | :--- |\n` +
            facRows.join('\n');
        }

        reply =
          `### 🗓️ ${day}'s Class Schedule\n\n` +
          `You have **${classes.length} class${classes.length > 1 ? 'es' : ''}** scheduled for **${day}**:\n\n` +
          `| Time Slot | Subject Code | Type | Room / Venue | Section |\n` +
          `| :--- | :--- | :--- | :--- | :--- |\n` +
          `${rows}\n\n` +
          `#### 🔍 Schedule Insights & Daily Flow\n` +
          `- **Daily Workload:** ${classes.length} total sessions (${lectures.length} Lectures, ${practicals.length} Practicals/Labs).\n` +
          `- **Venues & Classroom Flow:** ${roomDesc}` +
          facultySection + '\n\n' +
          `> 💡 **Schedule Note:** Classroom numbers and timings are verified directly from your authenticated UMS Student Time Table.`;

        const firstTime = (classes[0]?.time || '').split('-')[0]?.trim();
        const firstRoom = classes[0]?.room || 'assigned room';
        spokenSummary = `You have ${classes.length} classes scheduled on ${day}${firstTime ? `, starting at ${firstTime} in ${firstRoom}` : ''}.${isFacultyQ ? ' Faculty cabin assignments are included below.' : ''}`;
      } else if (coursesList.length > 0 && !isScheduleQ) {
        const totalCredits = coursesList.reduce((acc: number, c: any) => acc + (parseInt(c.credits, 10) || 0), 0);
        const rows = coursesList.map((c: any) => {
          const ltp = `${c.lectures ?? 0}-${c.tutorial ?? 0}-${c.practical ?? 0}`;
          const fac = c.facultyName ? `${c.facultyName}${c.facultyCabin ? ` (${c.facultyCabin})` : ''}` : 'Not Assigned / NA';
          return `| **${c.courseCode}** | ${c.courseType || 'Core'} | ${c.courseTitle || ''} | ${ltp} | ${c.credits ?? 0} | ${fac} | ${c.lastUpdated || 'NA'} |`;
        }).join('\n');

        reply =
          `### 📚 Registered Courses & Faculty Directory\n\n` +
          `Here is your official enrolled curriculum (**${coursesList.length} courses**, **${totalCredits} total credits**) verified from your authenticated UMS portal:\n\n` +
          `| Course Code | Type | Course Title | L-T-P | Credits | Faculty & Cabin | Last Updated |\n` +
          `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n` +
          `${rows}\n\n` +
          `> 💡 **Directory Note:** Faculty cabin locations and course credits are verified directly from your official UMS Student Time Table report.`;
        spokenSummary = `You are registered in ${coursesList.length} courses totaling ${totalCredits} credits for this semester.`;
      } else {
        const extraNote = coursesList.length > 0 ? `\n\n> ℹ️ **Enrolled Curriculum:** You are enrolled in **${coursesList.length} registered courses** for this semester.` : '';
        reply = `### 🗓️ ${day}'s Class Schedule\n\nYou have **no classes scheduled** on **${day}** according to your verified UMS timetable.${extraNote}`;
        spokenSummary = `You have no classes scheduled on ${day} according to your timetable.`;
      }
    }
  } else if (req.capability === 'examination') {
    const exams: any[] = Array.isArray(data.exams)
      ? data.exams
      : Array.isArray(data.courses)
      ? data.courses
      : [];
    const total = exams.length;
    if (total === 0) {
      reply = `I checked your UMS examination records, but no scheduled exams or date sheet entries were found.`;
      spokenSummary = reply;
    } else {
      // Date-sheet answers must expose EVERY verified record, never exams[0].
      let nextExam: any = null;
      try {
        nextExam = getNextExam(exams);
      } catch {
        nextExam = null;
      }
      const rows = exams
        .map(
          (e: any, i: number) =>
            `| **${i + 1}** | **${e.courseCode || 'TBD'}** | ${e.examDate || 'TBD'} | ${
              e.startTime || 'TBD'
            }${e.endTime ? ` - ${e.endTime}` : ''} | ${e.venue || e.room || 'TBD'} | ${e.seat || 'TBD'} |`
        )
        .join('\n');
      reply =
        `### 📝 Examination Date Sheet → ${total} exam${total === 1 ? '' : 's'} found\n\n` +
        (nextExam
          ? `Your next exam is **${nextExam.courseCode}** on **${nextExam.examDate}**${
              nextExam.startTime ? ` at **${nextExam.startTime}**` : ''
            }.\n\n`
          : '') +
        `| # | Course | Date | Time | Venue | Seat |\n` +
        `| :--- | :--- | :--- | :--- | :--- | :--- |\n` +
        `${rows}\n\n` +
        `> 💡 All ${total} records above were extracted and validated from your authenticated UMS date sheet.`;
      spokenSummary =
        (nextExam
          ? `Your next exam is ${nextExam.courseCode} on ${nextExam.examDate}${
              nextExam.startTime ? ` at ${nextExam.startTime}` : ''
            }. `
          : '') + `You have ${total} scheduled examination${total === 1 ? '' : 's'} in total.`;
    }
  } else if (req.capability === 'attendance') {
    // Delegate to the full deterministic attendance response engine (api.ts)
    // which handles: course-specific queries, lowest subject, bunk calculations,
    // exam clearance, aggregate overview, and elaborated structured responses.
    const attData: any = data;
    const historyMapped = req.history?.map((h: any) => ({ id: '', sender: (h.role === 'user' ? 'user' : 'onee') as 'user' | 'onee', text: h.content, timestamp: '' }));
    const localResult = localDeterministicEngine(
      req.query,
      attData && attData.courses ? attData : null,
      undefined,
      undefined,
      historyMapped
    );
    reply = localResult.message;
    spokenSummary = reply;
  } else {
    // For unrecognized capabilities, try the full deterministic engine
    const historyMapped = req.history?.map((h: any) => ({ id: '', sender: (h.role === 'user' ? 'user' : 'onee') as 'user' | 'onee', text: h.content, timestamp: '' }));
    const localResult = localDeterministicEngine(
      req.query,
      data && data.courses ? data as any : null,
      data && data.exams ? data as any : null,
      data && data.slots ? data as any : null,
      historyMapped
    );
    reply = localResult.message;
    spokenSummary = reply;
  }

  const ttsChunks = fallbackSplitForTts(spokenSummary || reply, 195);
  spokenSummary = spokenSummary || (ttsChunks.length > 0 ? ttsChunks.join(' ') : reply);

  const updatedConversationState: ConversationState = {
    ...(req.conversationState || {}),
    currentCapability: req.capability,
    currentIntent: req.intent,
    activeEntity: req.capability === 'timetable'
      ? (data.isWeekly || data.day === 'Weekly Matrix' || data.day === 'all'
          ? { view: 'weekly_matrix', day: 'all' }
          : { view: 'daily_schedule', day: data.day || 'Monday' })
      : req.conversationState?.activeEntity
  };

  return {
    executionId: req.executionId,
    reply,
    spokenSummary,
    ttsChunks,
    cardType,
    modelUsed: 'local-deterministic-fallback',
    conversationState: updatedConversationState
  };
}
