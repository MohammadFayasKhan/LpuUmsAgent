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
  subType?: 'lowest_attendance' | 'next_exam' | 'upcoming_exams' | 'specific_course' | 'venue_room' | 'full_overview' | 'all_exams' | 'sample_paper' | 'timetable_today' | 'timetable_full' | 'faculty_details';
  targetCourseCode?: string;
  resolvedCourseCode?: string;
  confidence: number;
  reasoning: string;
}

const ATTENDANCE_KEYWORDS = [
  'attendance',
  'bunk',
  'duty leave',
  'medical leave',
  'leave',
  'present',
  'absent',
  'classes',
  'attended',
  'delivered',
  'shortage',
  'aggregate',
  '75%'
];

const EXAM_KEYWORDS = [
  'exam',
  'examination',
  'date sheet',
  'datesheet',
  'schedule',
  'when is my exam',
  'next exam',
  'upcoming exam',
  'mid term',
  'end term',
  'ete',
  'mte',
  'practical exam',
  'theory exam',
  'reporting time'
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
  'class schedule',
  'lecture schedule',
  'weekly schedule',
  'what classes',
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
  const match = text.match(/\b([A-Z]{2,5}\s*\d{3,4}[A-Z]?)\b/i);
  return match ? match[1].replace(/\s+/g, '').toUpperCase() : null;
}

/**
 * Evaluates the user query, recent messages, and current cached context to determine intent.
 */
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
    if (context?.latestAttendance?.courses && context.latestAttendance.courses.length > 0) {
      const lowest = getLowestAttendanceSubject(context.latestAttendance.courses);
      if (lowest) return lowest.code;
    }
    if (context?.recentUserQueries) {
      for (const prev of context.recentUserQueries) {
        const found = extractCourseFromText(prev);
        if (found) return found;
      }
    }
    return undefined;
  };

  // 1. Timetable & Faculty Intent
  const hasTimetable = TIMETABLE_KEYWORDS.some((k) => clean.includes(k));
  if (hasTimetable && !clean.includes('exam') && !clean.includes('date sheet') && !clean.includes('datesheet')) {
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

  // 2. Sample Question Paper Intent
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
    capability: 'ATTENDANCE',
    subType: 'full_overview',
    confidence: 0.6,
    reasoning: 'Default route.'
  };
}
