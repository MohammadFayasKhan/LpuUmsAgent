/*
 * Context-Aware Suggestion Generator for ONEE.
 *
 * Instead of showing static dummy chips, suggestions are derived dynamically
 * from verified attendance records and verified examination date sheets.
 *
 * Features:
 * - Next Exam & Seating context: "Where is my seat for [nextCourse]?", "When should I report for [nextCourse]?", "What is the next exam?"
 * - Sample Question Paper: ONLY suggested when samplePaper.available is genuinely true for that course on UMS.
 * - Attendance standing: Lowest course buffer, bunk calculations, safety margins.
 * - Dynamic course codes: Always uses actual codes from normalized records, never hardcoded.
 */

import { AttendanceSummary, ExaminationSummary, TimetableSummary } from '../shared/types';
import { getNextExam } from '../content/examination/examinationValidator';
import { getTodayClasses, getCurrentOrNextClass } from '../shared/timetableCalculator';

export function generateContextualSuggestions(
  attendance: AttendanceSummary | null,
  lastQuery?: string | null,
  examination?: ExaminationSummary | null,
  timetable?: TimetableSummary | null
): string[] {
  const queryLower = (lastQuery || '').toLowerCase();
  const exams = examination?.exams || [];
  const nextExam = exams.length > 0 ? getNextExam(exams) : null;
  const isExamQuery =
    queryLower.includes('exam') ||
    queryLower.includes('date sheet') ||
    queryLower.includes('datesheet') ||
    queryLower.includes('seating') ||
    queryLower.includes('seat') ||
    queryLower.includes('report') ||
    queryLower.includes('paper');

  const isTimetableQuery =
    queryLower.includes('timetable') ||
    queryLower.includes('time table') ||
    queryLower.includes('class') ||
    queryLower.includes('lecture') ||
    queryLower.includes('faculty') ||
    queryLower.includes('cabin') ||
    queryLower.includes('teacher');

  // Condition 0: Neither attendance, examination, nor timetable verified yet
  if (
    (!attendance || !attendance.courses || attendance.courses.length === 0) &&
    exams.length === 0 &&
    (!timetable || timetable.slots.length === 0)
  ) {
    return [
      'Check my attendance',
      'When is my next exam?',
      'Which subject is lowest?',
      'Show my date sheet'
    ];
  }

  // Condition 0.5: User asking about timetable / faculty or timetable verified
  if (isTimetableQuery && timetable && timetable.slots.length > 0) {
    const todayClasses = getTodayClasses(timetable);
    const currentOrNext = getCurrentOrNextClass(timetable);
    const suggestions: string[] = [];

    const active = currentOrNext.currentClass || currentOrNext.nextClass;
    if (active) {
      if (currentOrNext.isRunningNow) {
        suggestions.push(`What is my next class after ${active.courseCode}?`);
      } else {
        suggestions.push(`Where is my next class (${active.courseCode})?`);
      }
    }

    if (todayClasses.length > 0) {
      suggestions.push('What classes do I have today?');
    }

    if (timetable.courses.length > 0) {
      const firstFac = timetable.courses[0];
      suggestions.push(`Where is the cabin for ${firstFac.courseCode}?`);
      suggestions.push('Show all faculty cabins and rooms');
    }

    suggestions.push('Show my complete timetable');
    return Array.from(new Set(suggestions)).slice(0, 4);
  }

  // Find if any exam has sample paper genuinely available from UMS
  const examWithSamplePaper = exams.find((e) => e.samplePaper?.available === true);

  // Condition 1: User explicitly asking about examination / seating / schedule
  if (isExamQuery && exams.length > 0) {
    const suggestions: string[] = [];
    if (nextExam) {
      suggestions.push(`Where is my seat for ${nextExam.courseCode}?`);
      if (nextExam.samplePaper?.available) {
        suggestions.push(`Show the sample paper for ${nextExam.courseCode}`);
        suggestions.push(`Fetch and open sample paper for ${nextExam.courseCode}`);
      }
    }

    if (examWithSamplePaper && (!nextExam || !nextExam.samplePaper?.available)) {
      const label = examWithSamplePaper.examType || examWithSamplePaper.examDate
        ? `${examWithSamplePaper.courseCode} (${examWithSamplePaper.examType || examWithSamplePaper.examDate})`
        : examWithSamplePaper.courseCode;
      suggestions.push(`Show the sample paper for ${label}`);
      suggestions.push(`Fetch and open sample paper for ${label}`);
    }

    if (nextExam) {
      suggestions.push(`When should I report for ${nextExam.courseCode}?`);
    }
    suggestions.push('What is the next exam?');
    suggestions.push('Show my complete exam schedule');

    return Array.from(new Set(suggestions)).slice(0, 4);
  }

  // Condition 2: Verified examination exists without attendance
  if (exams.length > 0 && (!attendance || !attendance.courses || attendance.courses.length === 0)) {
    const suggestions: string[] = [];
    if (nextExam) {
      suggestions.push('What is the next exam?');
      suggestions.push(`Where is my seat for ${nextExam.courseCode}?`);
      if (nextExam.samplePaper?.available) {
        suggestions.push(`Show the sample paper for ${nextExam.courseCode}`);
        suggestions.push(`Fetch and open sample paper for ${nextExam.courseCode}`);
      }
    }

    if (examWithSamplePaper && (!nextExam || !nextExam.samplePaper?.available)) {
      const label = examWithSamplePaper.examType || examWithSamplePaper.examDate
        ? `${examWithSamplePaper.courseCode} (${examWithSamplePaper.examType || examWithSamplePaper.examDate})`
        : examWithSamplePaper.courseCode;
      suggestions.push(`Show the sample paper for ${label}`);
      suggestions.push(`Fetch and open sample paper for ${label}`);
    }

    if (nextExam) {
      suggestions.push(`When should I report for ${nextExam.courseCode}?`);
    }
    suggestions.push('Show my complete exam schedule');

    return Array.from(new Set(suggestions)).slice(0, 4);
  }

  // Condition 3: Attendance exists
  const courses = [...(attendance?.courses || [])];
  courses.sort((a, b) => a.percentage - b.percentage);

  const lowest = courses[0];
  const secondLowest = courses[1];
  const suggestions: string[] = [];

  // Sub-condition 3a: Student asked about lowest subject
  if (queryLower.includes('lowest') || queryLower.includes('minimum')) {
    if (lowest) {
      suggestions.push(`How many can I miss in ${lowest.code}?`);
      if (exams.length > 0) {
        suggestions.push(`When is the exam for ${lowest.code}?`);
      }
    }
    if (secondLowest) {
      suggestions.push(`Compare ${lowest.code} with ${secondLowest.code}`);
    }
    if (nextExam) {
      suggestions.push(`Where is my seat for ${nextExam.courseCode}?`);
    } else {
      suggestions.push('Show subjects below 90%');
    }
    return Array.from(new Set(suggestions)).slice(0, 4);
  }

  // Sub-condition 3b: Student asked about bunking or skipping
  if (queryLower.includes('bunk') || queryLower.includes('miss') || queryLower.includes('skip')) {
    if (secondLowest) {
      suggestions.push(`Can I miss classes in ${secondLowest.code}?`);
    }
    if (nextExam) {
      suggestions.push(`Where is my seat for ${nextExam.courseCode}?`);
    }
    suggestions.push('Which is closest to 75%?');
    if (exams.length > 0) {
      suggestions.push('Show my complete exam schedule');
    } else {
      suggestions.push('Show all course percentages');
    }
    return Array.from(new Set(suggestions)).slice(0, 4);
  }

  // Default balanced standing: attendance + next exam highlights
  if (lowest) {
    suggestions.push('Which subject is lowest?');
    suggestions.push(`How many can I miss in ${lowest.code}?`);
  }

  if (nextExam) {
    suggestions.push(`Where is my seat for ${nextExam.courseCode}?`);
    suggestions.push('What is the next exam?');
    if (nextExam.samplePaper?.available) {
      suggestions.push(`Fetch and open sample paper for ${nextExam.courseCode}`);
      suggestions.push(`Show the sample paper for ${nextExam.courseCode}`);
    }
  } else if (exams.length > 0) {
    suggestions.push('Show my complete exam schedule');
  }

  if (examWithSamplePaper && (!nextExam || !nextExam.samplePaper?.available)) {
    const label = examWithSamplePaper.examType || examWithSamplePaper.examDate
      ? `${examWithSamplePaper.courseCode} (${examWithSamplePaper.examType || examWithSamplePaper.examDate})`
      : examWithSamplePaper.courseCode;
    suggestions.push(`Fetch and open sample paper for ${label}`);
  }

  const atRisk = courses.find((c) => c.percentage < 75);
  if (atRisk) {
    suggestions.push(`How many to reach 75% in ${atRisk.code}?`);
  } else if (!nextExam) {
    suggestions.push('Which is closest to 75%?');
  }

  return Array.from(new Set(suggestions)).slice(0, 4);
}
