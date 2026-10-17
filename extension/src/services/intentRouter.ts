/*
 * Intent Router & Cross-Domain Context Coordinator for ONEE.
 *
 * Routes incoming student requests to the appropriate domain agent:
 * - ATTENDANCE (handled by AttendanceAgent / AttendanceParser)
 * - EXAM_DATE_SHEET (handled by ExaminationAgent / ExamDateSheetParser)
 * - SEATING_PLAN (handled by ExaminationAgent / SeatingPlanParser)
 *
 * Cross-Domain Capability:
 * Handles seamless transitions like:
 * "Which subject has lowest attendance?" -> "When is its exam?"
 * by resolving subject codes from previous attendance or conversation history.
 */

import { AgentCapability, AttendanceSummary, ExaminationSummary } from '../shared/types';
import { getLowestAttendanceSubject } from '../shared/attendanceCalculator';
import { findNextExam } from '../shared/examinationCalculator';

export interface RoutedIntent {
  capability: AgentCapability;
  subType?: 'lowest_attendance' | 'next_exam' | 'upcoming_exams' | 'specific_course' | 'venue_room' | 'full_overview' | 'all_exams' | 'sample_paper' | 'timetable_today' | 'timetable_full' | 'faculty_details' | 'exam_clearance';
  targetCourseCode?: string;
  resolvedCourseCode?: string;
  confidence: number;
  reasoning: string;
}

const IDENTITY_KEYWORDS = [
  'who are you',
  'what are you',
  'who r u',
  'what is your name',
  'introduce yourself',
  'what can you do',
  'help me',
  'capabilities',
  'how does onee work',
  'hello',
  'hey',
  'hi',
  'good morning',
  'good afternoon',
  'good evening',
  'thanks',
  'thank you',
  'test voice',
  'test voice assistant',
  'voice test',
  'voice check',
  'sound check',
  'hear nothing',
  'can you speak',
  'test audio'
];

const ATTENDANCE_KEYWORDS = [
  'attendance',
  'bunk',
  'bunk capacity',
  'bunks',
  'bunking',
  'can i bunk',
  'skip',
  'skips',
  'skipping',
  'can i skip',
  'miss',
  'misses',
  'missing',
  'can i miss',
  'duty leave',
  'medical leave',
  'leave',
  'present',
  'absent',
  'attended',
  'delivered',
  'shortage',
  'aggregate',
  'overall',
  'overall attendance',
  'percentage',
  'subject',
  'subjects',
  'lowest',
  'least',
  'minimum',
  'maximum',
  'highest',
  'how many can i',
  'safe skips',
  'safe bunks',
  '75%'
];

const EXAM_KEYWORDS = [
  'exam',
  'examination',
  'exams',
  'date sheet',
  'datesheet',
  'exam schedule',
  'examination schedule',
  'when is my exam',
  'next exam',
  'upcoming exam',
  'mid term',
  'end term',
  'term exam',
  'term exams',
  'atom exam',
  'atom exams',
  'autumn exam',
  'autumn exams',
  'ete',
  'mte',
  'practical exam',
  'theory exam',
  'reporting time',
  'how many exams',
  'total exams',
  'exam count'
];

const SEATING_KEYWORDS = [
  'seating',
  'seat',
  'seating plan',
  'room',
  'hall',
  'venue',
  'block',
  'building',
  'where is my exam',
  'which room'
];

const SAMPLE_PAPER_KEYWORDS = [
  'sample paper',
  'sample question paper',
  'sample question',
  'sample paper for',
  'fetch and open sample paper',
  'fetch sample paper',
  'open sample paper',
  'download sample paper',
  'question paper',
  'model paper',
  'sample exam paper'
];

const TIMETABLE_KEYWORDS = [
  'timetable',
  'time table',
  'classes today',
  'today classes',
  'today class',
  'todays class',
  'my classes',
  'next class',
  'current class',
  'which class',
  'which classes',
  'what class',
  'what classes',
  'classes on monday',
  'classes on tuesday',
  'classes on wednesday',
  'classes on thursday',
  'classes on friday',
  'classes on saturday',
  'classes on sunday',
  'classes this week',
  'all classes',
  'all classes this week',
  'matrix of all classes',
  'matrix of classes',
  'detailed matrix',
  'matrix of all classes this week',
  'complete list of classes',
  'list of classes',
  'all my classes',
  'classes in this week',
  'classes that i have',
  'classes that i have in this week',
  'week classes',
  'weekly classes',
  'weekly timetable',
  'weekly schedule',
  'full timetable',
  'full schedule',
  'class matrix',
  'schedule matrix',
  'all periods',
  'all lectures',
  'overview of classes',
  'every day classes',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'class schedule',
  'lecture schedule',
  'where is my class',
  'room for class',
  'faculty',
  'teacher',
  'professor',
  'cabin',
  'faculty cabin',
  'faculty details',
  'who teaches',
  'who is teaching'
];

/**
 * Extracts a course code pattern (e.g. CSE443, INT373, CAP421) from text.
 */
export function extractCourseFromText(text: string): string | null {
  const match = text.match(/\b([A-Za-z]{2,5})\s*(\d{2,4}[A-Za-z]?)\b/i);
  if (!match) return null;
  let pfx = match[1].toUpperCase();
  const num = match[2].toUpperCase();
  if (['PAPER', 'SAMPLE', 'TERM', 'EXAM', 'DATE', 'TIME'].includes(pfx)) {
    return null;
  }
  if (pfx === 'CSC') {
    pfx = 'CSE';
  }
  return `${pfx}${num}`;
}

/**
 * Evaluates the user query, recent messages, and current cached context to determine intent.
 */
/*
 * Deterministic capability firewall.
 *
 * The semantic model resolves intent, but a mis-classification must never let one
 * verified UMS dataset answer another domain's question — that is exactly how an
 * examination date-sheet question previously came back with a timetable answer.
 * Domain words the student actually used always win, evaluated in the same
 * precedence order as the semantic hard rules: sample papers, attendance,
 * seating, examination, timetable.
 */
const SAMPLE_PAPER_DOMAIN_RE = /\b(sample\s*(?:question\s*)?paper|question\s*paper|model\s*paper|previous\s*year)\b/i;
const ATTENDANCE_DOMAIN_RE =
  /\b(attendance|attended|absent|bunk|bunks|bunking|skip|skips|miss|missing|duty\s*leave|shortage|percentage|lowest|highest|worst|eligible|eligibility|clearance|detention|75%)\b/i;
const SEATING_DOMAIN_RE = /\b(seating|seat\s*(?:number|plan|no|allocation)|seat\s+for|exam\s+hall)\b/i;
const EXAM_DOMAIN_RE = /\b(exam|exams|examination|date\s*sheet|datesheet|reporting\s*time|admit\s*card|hall\s*ticket)\b/i;
const TIMETABLE_DOMAIN_RE =
  /\b(timetable|time\s*table|class\s*schedule|scheduled\s*classes|my\s*classes|classes\s*(?:today|tomorrow)|lecture\s*schedule|faculty|cabin)\b/i;

/** Verified-data capabilities that the firewall is allowed to correct. */
export const VERIFIED_DATA_CAPABILITIES = [
  'timetable',
  'examination',
  'attendance',
  'sample_papers',
  'seating_plan',
  'general'
];

export type VerifiedDataDomain =
  | 'attendance'
  | 'examination'
  | 'seating_plan'
  | 'sample_papers'
  | 'timetable';

/**
 * Returns the verified-data domain the student explicitly named, or null when the
 * query does not name one (in that case the semantic resolver's own answer stands).
 */
export function detectExplicitCapabilityDomain(query: string): VerifiedDataDomain | null {
  const q = query || '';
  if (SAMPLE_PAPER_DOMAIN_RE.test(q)) return 'sample_papers';
  if (ATTENDANCE_DOMAIN_RE.test(q)) return 'attendance';
  if (SEATING_DOMAIN_RE.test(q)) return 'seating_plan';
  if (EXAM_DOMAIN_RE.test(q)) return 'examination';
  if (TIMETABLE_DOMAIN_RE.test(q)) return 'timetable';
  return null;
}

/**
 * Corrects a resolved capability when the student's own words name a different
 * verified-data domain. Returns the resolved capability unchanged when there is
 * nothing to correct (or the resolution is a non-data capability such as identity).
 */
export function enforceCapabilityDomain(resolvedCapability: string, query: string): string {
  const resolved = resolvedCapability || 'general';
  const explicit = detectExplicitCapabilityDomain(query);
  if (!explicit || explicit === resolved) return resolved;
  if (!VERIFIED_DATA_CAPABILITIES.includes(resolved)) return resolved;
  return explicit;
}

/** Natural browser goal text for a corrected capability. */
export function goalForCapabilityDomain(capability: string, query: string): string {
  switch (capability) {
    case 'attendance':
      return 'Check attendance records and safe bunk allowance';
    case 'examination':
      return 'Open the UMS examination date sheet and verify the exam schedule';
    case 'seating_plan':
      return 'Open the UMS seating plan and verify exam venues and seat numbers';
    case 'sample_papers':
      return 'Find the official sample question paper on UMS';
    case 'timetable':
      return 'Check the UMS student timetable';
    default:
      return query;
  }
}

export function routeUserIntent(
  query: string,
  context?: {
    latestAttendance?: AttendanceSummary | null;
    latestExamination?: ExaminationSummary | null;
    recentUserQueries?: string[];
    lastMentionedCourse?: string;
  }
): RoutedIntent {
  const clean = query.trim().toLowerCase();
  const explicitCourse = extractCourseFromText(clean);

  // Helper to resolve anaphoric course references from context
  const resolveAnaphoricCourse = (): string | undefined => {
    if (context?.lastMentionedCourse) {
      return context.lastMentionedCourse.replace(/\s+/g, '').toUpperCase();
    }
    if (context?.recentUserQueries) {
      for (const prev of context.recentUserQueries) {
        const found = extractCourseFromText(prev);
        if (found) return found;
      }
    }
    if (context?.latestAttendance?.courses && context.latestAttendance.courses.length > 0) {
      const lowest = getLowestAttendanceSubject(context.latestAttendance.courses);
      if (lowest) return lowest.code;
    }
    return undefined;
  };

  // 0. Identity & Conversational Intent
  const hasIdentity = IDENTITY_KEYWORDS.some((k) => {
    if (k.length <= 4) {
      return new RegExp(`\\b${k}\\b`, 'i').test(clean);
    }
    return clean.includes(k);
  });
  if (
    hasIdentity &&
    !clean.includes('attendance') &&
    !clean.includes('bunk') &&
    !clean.includes('exam') &&
    !clean.includes('timetable') &&
    !clean.includes('schedule') &&
    !clean.includes('class') &&
    !clean.includes('faculty') &&
    !clean.includes('cabin') &&
    !clean.includes('paper')
  ) {
    return {
      capability: 'CONVERSATION',
      subType: 'full_overview',
      confidence: 0.99,
      reasoning: 'User asked about ONEE identity or general greeting.'
    };
  }

  // 1. Sample Question Paper Intent (Checked before Timetable so sample paper queries are never hijacked)
  const hasSamplePaper = SAMPLE_PAPER_KEYWORDS.some((k) => clean.includes(k));
  if (hasSamplePaper) {
    let targetCourse: string | undefined = explicitCourse || undefined;
    if (!targetCourse && (clean.includes('next') || clean.includes('upcoming') || clean.includes('first'))) {
      if (context?.latestExamination?.exams && context.latestExamination.exams.length > 0) {
        const nextExam = findNextExam(context.latestExamination.exams);
        if (nextExam) targetCourse = nextExam.courseCode;
      }
    }
    if (!targetCourse) {
      targetCourse = resolveAnaphoricCourse() || undefined;
    }
    return {
      capability: 'SAMPLE_PAPER',
      subType: 'sample_paper',
      targetCourseCode: targetCourse,
      resolvedCourseCode: targetCourse,
      confidence: 0.98,
      reasoning: `Matches sample question paper keywords${targetCourse ? ` for ${targetCourse}` : ''}.`
    };
  }

  // 2. Timetable & Faculty Intent
  const isPreviousTimetable = Boolean(
    context?.recentUserQueries?.some((prev) => {
      const p = prev.toLowerCase();
      return (
        p.includes('timetable') ||
        p.includes('time table') ||
        p.includes('class') ||
        p.includes('lecture') ||
        p.includes('period') ||
        p.includes('faculty') ||
        p.includes('cabin') ||
        ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].some((d) => p.includes(d))
      );
    })
  );

  const daysOfWeek = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const mentionedDay = daysOfWeek.find((d) => clean.includes(d));
  const isWeeklyMatrix = /all classes|matrix|weekly|complete list|list of classes|this week|whole week|entire week|every day|all days|detailed matrix|classes that i have|classes in this week/i.test(clean);

  // Anaphoric timetable continuity (e.g. "And what about Saturday?", "What about Wednesday?", "Give me detailed matrix of all classes this week")
  if (
    (isPreviousTimetable || clean.includes('timetable') || clean.includes('time table') || clean.includes('class') || isWeeklyMatrix) &&
    !clean.includes('exam') &&
    !clean.includes('attendance') &&
    !clean.includes('bunk') &&
    !clean.includes('date sheet') &&
    !clean.includes('datesheet') &&
    !clean.includes('paper')
  ) {
    if (mentionedDay) {
      return {
        capability: 'TIMETABLE',
        subType: 'timetable_today',
        targetCourseCode: explicitCourse || resolveAnaphoricCourse() || undefined,
        resolvedCourseCode: explicitCourse || resolveAnaphoricCourse() || undefined,
        confidence: 0.98,
        reasoning: `Resolved timetable day inquiry to ${mentionedDay.charAt(0).toUpperCase() + mentionedDay.slice(1)}.`
      };
    }
    if (isWeeklyMatrix) {
      return {
        capability: 'TIMETABLE',
        subType: 'timetable_full',
        confidence: 0.98,
        reasoning: 'Resolved query to complete weekly class schedule matrix.'
      };
    }
    if (/practical|lab|room|which one|timing|when|where|who teaches|faculty|cabin/i.test(clean)) {
      const isFaculty = /faculty|teacher|cabin|who teaches|who is teaching/i.test(clean);
      return {
        capability: 'TIMETABLE',
        subType: isFaculty ? 'faculty_details' : 'timetable_today',
        targetCourseCode: explicitCourse || resolveAnaphoricCourse() || undefined,
        resolvedCourseCode: explicitCourse || resolveAnaphoricCourse() || undefined,
        confidence: 0.96,
        reasoning: 'Resolved conversational follow-up for current timetable session details.'
      };
    }
  }

  const hasTimetable = TIMETABLE_KEYWORDS.some((k) => clean.includes(k));
  if (hasTimetable && !clean.includes('exam') && !clean.includes('date sheet') && !clean.includes('datesheet') && !clean.includes('paper')) {
    const isFaculty = clean.includes('faculty') || clean.includes('teacher') || clean.includes('cabin') || clean.includes('who teaches') || clean.includes('who is teaching');
    const isToday = clean.includes('today') || clean.includes('now') || clean.includes('next class') || clean.includes('current class');

    return {
      capability: 'TIMETABLE',
      subType: isFaculty ? 'faculty_details' : isToday ? 'timetable_today' : 'timetable_full',
      targetCourseCode: explicitCourse || resolveAnaphoricCourse() || undefined,
      resolvedCourseCode: explicitCourse || resolveAnaphoricCourse() || undefined,
      confidence: 0.96,
      reasoning: `Matches student timetable and faculty query keywords${explicitCourse ? ` for ${explicitCourse}` : ''}.`
    };
  }

  // 1b. Cross-Domain Anaphoric Resolution (Check before broad keywords)
  const isAnaphoricSeating =
    (clean.includes('seat') || clean.includes('room')) &&
    (clean.includes('that subject') ||
      clean.includes('that course') ||
      clean.includes('its') ||
      clean.includes('for that') ||
      clean.includes('for it') ||
      (!explicitCourse && !!context?.lastMentionedCourse));

  if (isAnaphoricSeating) {
    const resolved = resolveAnaphoricCourse();
    return {
      capability: 'SEATING_PLAN',
      subType: 'specific_course',
      targetCourseCode: resolved,
      resolvedCourseCode: resolved,
      confidence: 0.95,
      reasoning: `Resolved cross-domain follow-up to seating plan for subject ${resolved || 'from context'}.`
    };
  }

  const isAnaphoricExam =
    (clean.includes('its exam') ||
      clean.includes('that exam') ||
      clean.includes('exam for that') ||
      clean.includes('exam for it') ||
      (clean.includes('exam') && (clean.includes('its') || clean.includes('that subject') || clean.includes('that course')))) &&
    !clean.includes('attendance');

  if (isAnaphoricExam) {
    const resolved = resolveAnaphoricCourse();
    return {
      capability: 'EXAM_DATE_SHEET',
      subType: 'specific_course',
      targetCourseCode: resolved,
      resolvedCourseCode: resolved,
      confidence: 0.95,
      reasoning: `Resolved cross-domain follow-up to exam for subject ${resolved || 'from context'}.`
    };
  }

  // 2. Check for Seating Plan intent
  const hasSeatingKeywords = SEATING_KEYWORDS.some((k) => clean.includes(k));
  if (hasSeatingKeywords) {
    return {
      capability: 'SEATING_PLAN',
      subType: explicitCourse ? 'specific_course' : 'venue_room',
      targetCourseCode: explicitCourse || undefined,
      resolvedCourseCode: explicitCourse || undefined,
      confidence: 0.95,
      reasoning: 'Matches examination seating plan keywords (seat, room, venue, block).'
    };
  }

  // 2b. Check for Attendance-Based Exam Eligibility & Clearance Intent
  const isExamEligibilityQuery =
    (clean.includes('eligible') ||
      clean.includes('eligibility') ||
      clean.includes('clearance') ||
      clean.includes('admit card') ||
      clean.includes('detain') ||
      (clean.includes('exam') && (clean.includes('attendance') || clean.includes('criteria') || clean.includes('allowed to sit')))) &&
    !clean.includes('when') &&
    !clean.includes('where') &&
    !clean.includes('date sheet') &&
    !clean.includes('datesheet') &&
    !clean.includes('seat') &&
    !clean.includes('room');

  if (isExamEligibilityQuery) {
    return {
      capability: 'ATTENDANCE',
      subType: 'exam_clearance',
      targetCourseCode: explicitCourse || undefined,
      resolvedCourseCode: explicitCourse || undefined,
      confidence: 0.96,
      reasoning: 'Matches attendance-based examination eligibility criteria.'
    };
  }

  // 3. Check for Exam Date Sheet intent
  const hasExamKeywords = EXAM_KEYWORDS.some((k) => clean.includes(k));
  if (hasExamKeywords) {
    if (clean.includes('next exam') || clean.includes('nearest exam')) {
      return {
        capability: 'EXAM_DATE_SHEET',
        subType: 'next_exam',
        confidence: 0.98,
        reasoning: 'User explicitly inquired about their next exam date.'
      };
    }
    if (
      clean.includes('how many') ||
      clean.includes('total exams') ||
      clean.includes('exam count') ||
      clean.includes('number of exams') ||
      clean.includes('term exams') ||
      clean.includes('atom exams') ||
      clean.includes('autumn exams')
    ) {
      return {
        capability: 'EXAM_DATE_SHEET',
        subType: 'all_exams',
        confidence: 0.98,
        reasoning: 'User inquired about total number of scheduled examinations.'
      };
    }
    if (clean.includes('date sheet') || clean.includes('datesheet') || clean.includes('all exams')) {
      return {
        capability: 'EXAM_DATE_SHEET',
        subType: 'all_exams',
        confidence: 0.96,
        reasoning: 'User requested date sheet.'
      };
    }
    if (clean.includes('upcoming') || clean.includes('full')) {
      return {
        capability: 'EXAM_DATE_SHEET',
        subType: 'upcoming_exams',
        confidence: 0.95,
        reasoning: 'User inquired about upcoming examination schedule.'
      };
    }

    return {
      capability: 'EXAM_DATE_SHEET',
      subType: explicitCourse ? 'specific_course' : 'full_overview',
      targetCourseCode: explicitCourse || undefined,
      resolvedCourseCode: explicitCourse || undefined,
      confidence: 0.92,
      reasoning: 'Matches examination date sheet keywords.'
    };
  }

  // 4. Check for Attendance intent
  const hasAttendanceKeywords = ATTENDANCE_KEYWORDS.some((k) => clean.includes(k));
  if (hasAttendanceKeywords) {
    const isLowest = clean.includes('lowest') || clean.includes('least') || clean.includes('minimum');
    return {
      capability: 'ATTENDANCE',
      subType: isLowest ? 'lowest_attendance' : explicitCourse ? 'specific_course' : 'full_overview',
      targetCourseCode: explicitCourse || undefined,
      confidence: 0.95,
      reasoning: 'Matches student attendance query keywords.'
    };
  }

  // 4b. Check for numeric or conversational follow-up (e.g. "what about 5", "how about 6", "can i skip 4")
  const numMatch = clean.match(/(?:what about|how about|what if|can i skip|skip|can i bunk|bunk|miss|and)?\s*(\d+)\s*(?:classes|lectures|more)?/i);
  const targetSkips = numMatch && numMatch[1] ? parseInt(numMatch[1], 10) : undefined;
  const isNumericFollowup =
    targetSkips !== undefined &&
    targetSkips > 0 &&
    (/^\s*(?:what about|how about|what if|and|can i do)?\s*\d+\s*(?:classes|lectures|more|\?)?\s*$/i.test(clean) ||
      clean.includes('skip') ||
      clean.includes('bunk'));

  const anaphoric = resolveAnaphoricCourse();
  if (isNumericFollowup && (explicitCourse || anaphoric)) {
    const courseCode = explicitCourse || anaphoric;
    return {
      capability: 'ATTENDANCE',
      subType: 'specific_course',
      targetCourseCode: courseCode,
      resolvedCourseCode: courseCode,
      confidence: 0.95,
      reasoning: `Numeric follow-up resolved to ${courseCode} (${targetSkips} skips).`
    };
  }

  // 5. Default fallback based on presence of course code or general phrasing
  if (explicitCourse) {
    // If we have verified examination and no attendance, prioritize exam; otherwise attendance
    if (context?.latestExamination && !context?.latestAttendance) {
      return {
        capability: 'EXAM_DATE_SHEET',
        subType: 'specific_course',
        targetCourseCode: explicitCourse,
        confidence: 0.7,
        reasoning: 'Course code detected with cached examination data.'
      };
    }
    return {
      capability: 'ATTENDANCE',
      subType: 'specific_course',
      targetCourseCode: explicitCourse,
      confidence: 0.7,
      reasoning: 'Course code detected with default attendance preference.'
    };
  }

  return {
    capability: 'CONVERSATION',
    subType: 'full_overview',
    confidence: 0.6,
    reasoning: 'Default conversational route.'
  };
}
