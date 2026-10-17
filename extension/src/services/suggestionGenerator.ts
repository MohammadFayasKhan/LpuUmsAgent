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
import { getTodayClasses, getTomorrowClasses, getCurrentOrNextClass } from '../shared/timetableCalculator';
import { isValidCourseCode } from '../content/umsAttendanceParser';

export function generateContextualSuggestions(
  attendance: AttendanceSummary | null,
  lastQuery?: string | null,
  examination?: ExaminationSummary | null,
  timetable?: TimetableSummary | null,
  lastResponse?: string | null
): string[] {
  // Phantom gate: suggestions may ONLY be built from subjects whose codes would
  // be accepted from the live UMS attendance DOM. "How many can I miss in ON19?"
  // was produced by letting an unverified subject reach this engine.
  if (attendance && attendance.courses && attendance.courses.length > 0) {
    const verifiedCourses = attendance.courses.filter((c) => isValidCourseCode(c.code));
    if (verifiedCourses.length !== attendance.courses.length) {
      console.warn(
        '[ONEE][Suggestions] Dropped unverified subject codes:',
        attendance.courses.filter((c) => !isValidCourseCode(c.code)).map((c) => c.code)
      );
      attendance = { ...attendance, courses: verifiedCourses };
    }
  }

  const queryLower = (lastQuery || '').toLowerCase();
  const responseLower = (lastResponse || '').toLowerCase();
  const combinedText = `${queryLower} ${responseLower}`.trim();

  const exams = examination?.exams || [];
  const nextExam = exams.length > 0 ? getNextExam(exams) : null;
  const isExamQuery =
    combinedText.includes('exam') ||
    combinedText.includes('date sheet') ||
    combinedText.includes('datesheet') ||
    combinedText.includes('seating') ||
    combinedText.includes('seat') ||
    combinedText.includes('report') ||
    combinedText.includes('paper');

  const isTimetableQuery =
    combinedText.includes('timetable') ||
    combinedText.includes('time table') ||
    combinedText.includes('class') ||
    combinedText.includes('lecture') ||
    combinedText.includes('faculty') ||
    combinedText.includes('cabin') ||
    combinedText.includes('teacher');

  const isLeaveOrTomorrowQuery =
    combinedText.includes('leave') ||
    combinedText.includes('tomorrow') ||
    combinedText.includes('holiday') ||
    combinedText.includes('absent') ||
    combinedText.includes('absence') ||
    combinedText.includes('take off') ||
    combinedText.includes('leave verdict') ||
    combinedText.includes('leave impact');

  // Condition 0: Neither attendance, examination, nor timetable verified yet
  if (
    (!attendance || !attendance.courses || attendance.courses.length === 0) &&
    exams.length === 0 &&
    (!timetable || timetable.slots.length === 0)
  ) {
    if (isLeaveOrTomorrowQuery) {
      return [
        "View tomorrow's class schedule",
        'Extract live attendance from UMS',
        'Calculate safe bunks for my courses',
        'Show my complete timetable'
      ];
    }
    if (isExamQuery) {
      return [
        'Open Date Sheet and seating plan',
        'Extract live examination schedule',
        'When is my next exam?',
        'Show my date sheet'
      ];
    }
    if (isTimetableQuery) {
      return [
        "View today's class schedule",
        'Show all faculty cabins and rooms',
        'Navigate to LMS timetable',
        'Extract live attendance from UMS'
      ];
    }
    if (combinedText.includes('attendance') || combinedText.includes('bunk') || combinedText.includes('skip')) {
      return [
        'Extract live attendance from UMS',
        'Calculate safe bunks for my courses',
        'Check my attendance',
        'Which subject is lowest?'
      ];
    }
    return [
      'Check my attendance',
      'When is my next exam?',
      'Which subject is lowest?',
      'Show my date sheet'
    ];
  }

  // High-Priority Condition: Leave / Tomorrow / Absence Inquiry
  if (isLeaveOrTomorrowQuery) {
    const suggestions: string[] = [];
    const courses = [...(attendance?.courses || [])];
    courses.sort((a, b) => a.percentage - b.percentage);

    // Identify critical course: explicitly in query, in response (e.g. Leave Verdict), or most vulnerable
    let critCourse =
      courses.find((c) => queryLower.includes(c.code.toLowerCase())) ||
      courses.find((c) => responseLower.includes(c.code.toLowerCase())) ||
      courses[0];

    if (timetable && timetable.slots.length > 0) {
      const tomorrowClasses = getTomorrowClasses(timetable);
      if (tomorrowClasses.length > 0) {
        if (critCourse) {
          const isCritTomorrow = tomorrowClasses.some(
            (s) => s.courseCode && s.courseCode.toLowerCase() === critCourse!.code.toLowerCase()
          );
          if (isCritTomorrow) {
            suggestions.push(`Is ${critCourse.code} on tomorrow's schedule?`);
            suggestions.push(`Can I safely skip ${critCourse.code} tomorrow?`);
          } else {
            suggestions.push("What classes do I have tomorrow?");
            suggestions.push(`Can I safely skip ${critCourse.code}?`);
          }
        } else {
          suggestions.push("What classes do I have tomorrow?");
        }
        suggestions.push("Show my timetable for tomorrow");
      } else {
        suggestions.push("What classes do I have tomorrow?");
        suggestions.push("Show my complete timetable");
      }
    } else {
      if (critCourse) {
        suggestions.push(`Is ${critCourse.code} on tomorrow's schedule?`);
        suggestions.push("What classes do I have tomorrow?");
        suggestions.push(`Can I safely skip ${critCourse.code} tomorrow?`);
      } else {
        suggestions.push("What classes do I have tomorrow?");
        suggestions.push("Show my timetable for tomorrow");
      }
    }

    if (critCourse) {
      if (critCourse.percentage < 75) {
        suggestions.push(`How many to reach 75% in ${critCourse.code}?`);
      } else {
        suggestions.push(`How many can I miss in ${critCourse.code}?`);
      }
    }

    suggestions.push("Will taking leave drop my aggregate?");
    suggestions.push("Show my timetable for tomorrow");

    return Array.from(new Set(suggestions.map((s) => s.replace(/—/g, '→')))).slice(0, 4);
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
    const queriedExam = exams.find(
      (e) => queryLower.includes(e.courseCode.toLowerCase()) || responseLower.includes(e.courseCode.toLowerCase())
    );
    const targetExam = queriedExam || nextExam;

    if (targetExam) {
      suggestions.push(`Where is my seat for ${targetExam.courseCode}?`);
      if (targetExam.samplePaper?.available) {
        suggestions.push(`Show the sample paper for ${targetExam.courseCode}`);
        suggestions.push(`Fetch and open sample paper for ${targetExam.courseCode}`);
      }
    }

    if (examWithSamplePaper && (!targetExam || !targetExam.samplePaper?.available)) {
      const label = examWithSamplePaper.examType || examWithSamplePaper.examDate
        ? `${examWithSamplePaper.courseCode} (${examWithSamplePaper.examType || examWithSamplePaper.examDate})`
        : examWithSamplePaper.courseCode;
      suggestions.push(`Show the sample paper for ${label}`);
      suggestions.push(`Fetch and open sample paper for ${label}`);
    }

    if (targetExam) {
      suggestions.push(`When should I report for ${targetExam.courseCode}?`);
    }
    if (targetExam !== nextExam && nextExam) {
      suggestions.push('When is my next exam?');
    } else {
      suggestions.push('What is the next exam?');
    }
    suggestions.push('Show my complete exam schedule');

    return Array.from(new Set(suggestions)).slice(0, 4);
  }

  // Condition 2: Verified examination exists without attendance
  if (exams.length > 0 && (!attendance || !attendance.courses || attendance.courses.length === 0)) {
    const suggestions: string[] = [];
    const queriedExam = exams.find(
      (e) => queryLower.includes(e.courseCode.toLowerCase()) || responseLower.includes(e.courseCode.toLowerCase())
    );
    const targetExam = queriedExam || nextExam;

    if (targetExam) {
      suggestions.push('What is the next exam?');
      suggestions.push(`Where is my seat for ${targetExam.courseCode}?`);
      if (targetExam.samplePaper?.available) {
        suggestions.push(`Show the sample paper for ${targetExam.courseCode}`);
        suggestions.push(`Fetch and open sample paper for ${targetExam.courseCode}`);
      }
    }

    if (examWithSamplePaper && (!targetExam || !targetExam.samplePaper?.available)) {
      const label = examWithSamplePaper.examType || examWithSamplePaper.examDate
        ? `${examWithSamplePaper.courseCode} (${examWithSamplePaper.examType || examWithSamplePaper.examDate})`
        : examWithSamplePaper.courseCode;
      suggestions.push(`Show the sample paper for ${label}`);
      suggestions.push(`Fetch and open sample paper for ${label}`);
    }

    if (targetExam) {
      suggestions.push(`When should I report for ${targetExam.courseCode}?`);
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

  // Sub-condition 3-pre: Student mentioned a specific course in question or assistant mentioned it in response
  const mentionedCourse =
    courses.find((c) => queryLower.includes(c.code.toLowerCase())) ||
    courses.find((c) => responseLower.includes(c.code.toLowerCase()));
  if (mentionedCourse) {
    if (mentionedCourse.percentage < 75) {
      suggestions.push(`How many to reach 75% in ${mentionedCourse.code}?`);
      suggestions.push(`Can I miss any classes in ${mentionedCourse.code}?`);
    } else {
      suggestions.push(`How many can I miss in ${mentionedCourse.code}?`);
      suggestions.push(`Can I skip next lecture of ${mentionedCourse.code}?`);
    }

    if (isExamQuery) {
      const matchingExam = exams.find((e) => e.courseCode.toLowerCase() === mentionedCourse.code.toLowerCase());
      if (matchingExam) {
        suggestions.push(`Where is my seat for ${mentionedCourse.code}?`);
        if (matchingExam.samplePaper?.available) {
          suggestions.push(`Show the sample paper for ${mentionedCourse.code}`);
        }
      } else if (nextExam) {
        suggestions.push(`Where is my seat for ${nextExam.courseCode}?`);
      }
    } else {
      if (secondLowest && secondLowest.code !== mentionedCourse.code) {
        suggestions.push(`How many can I miss in ${secondLowest.code}?`);
      }
      suggestions.push('Which is closest to 75%?');
    }

    if (lowest && lowest.code !== mentionedCourse.code && !suggestions.includes(`Compare ${mentionedCourse.code} with ${lowest.code}`)) {
      suggestions.push(`Compare ${mentionedCourse.code} with ${lowest.code}`);
    }
    return Array.from(new Set(suggestions.map((s) => s.replace(/—/g, '→')))).slice(0, 4);
  }

  // Sub-condition 3a: Student asked about lowest subject
  if (combinedText.includes('lowest') || combinedText.includes('minimum')) {
    if (lowest) {
      suggestions.push(`How many can I miss in ${lowest.code}?`);
      if (lowest.percentage < 75) {
        suggestions.push(`How many to reach 75% in ${lowest.code}?`);
      }
    }
    if (secondLowest) {
      suggestions.push(`Compare ${lowest.code} with ${secondLowest.code}`);
    }
    suggestions.push('Which is closest to 75%?');
    suggestions.push('Show subjects below 80%');
    return Array.from(new Set(suggestions)).slice(0, 4);
  }

  // Sub-condition 3b: Student asked about bunking or skipping
  if (combinedText.includes('bunk') || combinedText.includes('miss') || combinedText.includes('skip')) {
    if (secondLowest) {
      suggestions.push(`Can I miss classes in ${secondLowest.code}?`);
    }
    suggestions.push('Which is closest to 75%?');
    suggestions.push('Show all course percentages');
    if (lowest) {
      suggestions.push(`How many can I miss in ${lowest.code}?`);
    }
    return Array.from(new Set(suggestions)).slice(0, 4);
  }

  const isAttendanceQuery =
    combinedText.includes('attendance') ||
    combinedText.includes('bunk') ||
    combinedText.includes('skip') ||
    combinedText.includes('miss') ||
    combinedText.includes('cut') ||
    combinedText.includes('shortage') ||
    combinedText.includes('75%') ||
    combinedText.includes('percentage') ||
    combinedText.includes('duty leave');

  // Condition 3: Explicit Attendance Query
  if (isAttendanceQuery && attendance && courses.length > 0) {
    if (lowest) {
      suggestions.push(`How many can I miss in ${lowest.code}?`);
      suggestions.push('Which subject is lowest?');
    }
    if (secondLowest) {
      suggestions.push(`Can I miss classes in ${secondLowest.code}?`);
    }
    const atRisk = courses.find((c) => c.percentage < 75);
    if (atRisk) {
      suggestions.push(`How many to reach 75% in ${atRisk.code}?`);
    } else {
      suggestions.push('Which is closest to 75%?');
    }
    suggestions.push('What is my aggregate attendance?');
    suggestions.push('Show all course percentages');
    return Array.from(new Set(suggestions)).slice(0, 4);
  }

  // Condition 4: General balanced standing (no specific domain asked yet)
  if (timetable && timetable.slots.length > 0) {
    const todayClasses = getTodayClasses(timetable);
    if (todayClasses.length > 0) {
      suggestions.push('What classes do I have today?');
    }
  }

  if (lowest) {
    suggestions.push('Which subject is lowest?');
    suggestions.push(`How many can I miss in ${lowest.code}?`);
  }

  if (nextExam) {
    suggestions.push('What is the next exam?');
    suggestions.push(`Where is my seat for ${nextExam.courseCode}?`);
  } else if (exams.length > 0) {
    suggestions.push('Show my complete exam schedule');
  }

  return Array.from(new Set(suggestions)).slice(0, 4);
}
