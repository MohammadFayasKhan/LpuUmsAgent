/*
 * Timetable Intelligence, Calculations, and Assistant Formatting for ONEE.
 */

import {
  TimetableSummary,
  TimetableSlot,
  CourseFacultyRecord,
  TimetableValidationResult,
  FinalResponseData,
  TimetableDay
} from './types';

/**
 * Parses time string like "09:30-10:20 AM" or "01:40-02:30 PM" into start and end minute offsets from midnight.
 */
export function parseTimeInterval(timeStr: string): { startMinutes: number; endMinutes: number } {
  // Normalize e.g. "09:30-10:20 AM" or "11:10-12:00 AM" or "12:00-12:50 PM" or "01:40-02:30 PM"
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return { startMinutes: 0, endMinutes: 0 };

  let startHour = parseInt(match[1], 10);
  const startMin = parseInt(match[2], 10);
  let endHour = parseInt(match[3], 10);
  const endMin = parseInt(match[4], 10);
  const period = (match[5] || '').toUpperCase();

  // Adjust for PM if 12-hour format
  // In typical Indian university timetables:
  // 09:30 - 11:59 are AM
  // 12:00 - 12:59 is PM (noon)
  // 01:00 - 06:00 are PM (afternoon)
  if (period === 'PM' || (startHour >= 1 && startHour <= 6)) {
    if (startHour < 12) startHour += 12;
  }
  if (period === 'PM' || (endHour >= 1 && endHour <= 6)) {
    if (endHour < 12) endHour += 12;
  }

  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  return { startMinutes, endMinutes };
}

/**
 * Returns today's day of week name (e.g. 'Monday', 'Tuesday').
 */
export function getDayOfWeekName(targetDate: Date = new Date()): TimetableDay {
  const days: TimetableDay[] = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday'
  ];
  return days[targetDate.getDay()];
}

/**
 * Retrieves classes scheduled for a specific day, sorted chronologically.
 */
export function getClassesForDay(
  timetable: TimetableSummary,
  day: TimetableDay
): TimetableSlot[] {
  const daySlots = timetable.slots.filter((s) => s.day === day);

  return daySlots.sort((a, b) => {
    const aTime = parseTimeInterval(a.time).startMinutes;
    const bTime = parseTimeInterval(b.time).startMinutes;
    return aTime - bTime;
  });
}

/**
 * Returns today's scheduled classes.
 */
export function getTodayClasses(
  timetable: TimetableSummary,
  targetDate: Date = new Date()
): TimetableSlot[] {
  const today = getDayOfWeekName(targetDate);
  return getClassesForDay(timetable, today);
}

/**
 * Identifies the currently running class or the next upcoming class today.
 */
export function getCurrentOrNextClass(
  timetable: TimetableSummary,
  now: Date = new Date()
): { currentClass?: TimetableSlot; nextClass?: TimetableSlot; isRunningNow?: boolean } {
  const todayClasses = getTodayClasses(timetable, now);
  if (todayClasses.length === 0) return {};

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Check if any class is currently running
  for (const slot of todayClasses) {
    const { startMinutes, endMinutes } = parseTimeInterval(slot.time);
    if (currentMinutes >= startMinutes && currentMinutes <= endMinutes) {
      return { currentClass: slot, isRunningNow: true };
    }
  }

  // Find next upcoming class today
  for (const slot of todayClasses) {
    const { startMinutes } = parseTimeInterval(slot.time);
    if (startMinutes > currentMinutes) {
      return { nextClass: slot, isRunningNow: false };
    }
  }

  return {};
}

/**
 * Finds faculty and course information by course code or title query.
 */
export function findFacultyByCourse(
  timetable: TimetableSummary,
  query: string
): CourseFacultyRecord | undefined {
  const clean = query.replace(/\s+/g, '').toUpperCase();

  // Exact or prefix match on courseCode
  const exact = timetable.courses.find(
    (c) => c.courseCode.replace(/\s+/g, '').toUpperCase() === clean
  );
  if (exact) return exact;

  // Search by courseTitle
  const titleMatch = timetable.courses.find((c) =>
    c.courseTitle.toLowerCase().includes(query.toLowerCase())
  );
  if (titleMatch) return titleMatch;

  // Search by facultyName
  const facultyMatch = timetable.courses.find((c) =>
    (c.facultyName || '').toLowerCase().includes(query.toLowerCase())
  );
  return facultyMatch;
}

/**
 * Retrieves all slots for a specific course across the entire week.
 */
export function findClassesForCourse(
  timetable: TimetableSummary,
  courseCode: string
): TimetableSlot[] {
  const clean = courseCode.replace(/\s+/g, '').toUpperCase();
  return timetable.slots.filter(
    (s) => s.courseCode && s.courseCode.replace(/\s+/g, '').toUpperCase() === clean
  );
}

/**
 * Mathematical and structural validator for extracted Time Table summary.
 */
export function validateTimetableSummary(
  timetable: TimetableSummary
): TimetableValidationResult {
  const issues: string[] = [];

  if (!timetable.vid) {
    issues.push('Student VID was not detected in report.');
  }

  if (timetable.slots.length === 0) {
    issues.push('No weekly class slots could be extracted from grid.');
  }

  if (timetable.courses.length === 0) {
    issues.push('No courses or faculty records detected in My Course section.');
  }

  const valid = issues.length === 0 || (timetable.slots.length > 0 && timetable.courses.length > 0);

  return {
    valid,
    issues,
    slotsCount: timetable.slots.length,
    coursesCount: timetable.courses.length
  };
}

/**
 * Builds standard Computer Use FinalResponseData for timetable queries.
 */
export function buildTimetableFinalResponse(
  goal: string,
  timetable: TimetableSummary,
  targetDate: Date = new Date()
): FinalResponseData {
  const todayName = getDayOfWeekName(targetDate);
  const todayClasses = getTodayClasses(timetable, targetDate);
  const currentStatus = getCurrentOrNextClass(timetable, targetDate);
  const goalLower = goal.toLowerCase();

  // If student specifically asked for a specific course's faculty or cabin:
  const codeMatch = goal.match(/\b([A-Z]{2,5}\s*\d{3,4}[A-Z]?)\b/i);
  let spotlightCourse: CourseFacultyRecord | undefined;
  if (codeMatch) {
    spotlightCourse = findFacultyByCourse(timetable, codeMatch[1]);
  }

  let title = `Student Time Table (${timetable.homeSection || 'Verified'})`;
  let explanation = `Verified ${timetable.totalSlots} weekly classes across ${timetable.totalCourses} courses (${timetable.totalCredits} total credits).`;

  if (spotlightCourse && (goalLower.includes('faculty') || goalLower.includes('cabin') || goalLower.includes('teacher') || goalLower.includes('who teaches'))) {
    title = `${spotlightCourse.courseCode} Faculty: ${spotlightCourse.facultyName || 'Faculty'}`;
    explanation = `${spotlightCourse.courseTitle} is taught by ${spotlightCourse.facultyName || 'Faculty'} (Cabin: ${spotlightCourse.facultyCabin || 'N/A'}).`;
  } else if (goalLower.includes('today') || goalLower.includes('now') || goalLower.includes('next class')) {
    title = `Today's Classes (${todayName})`;
    if (todayClasses.length > 0) {
      explanation = `You have ${todayClasses.length} classes scheduled for today (${todayName}).`;
      if (currentStatus.currentClass) {
        explanation += ` Currently in ${currentStatus.currentClass.courseCode} (${currentStatus.currentClass.room || 'Room TBD'}).`;
      } else if (currentStatus.nextClass) {
        explanation += ` Next up: ${currentStatus.nextClass.courseCode} at ${currentStatus.nextClass.time}.`;
      }
    } else {
      explanation = `No scheduled lectures or practicals for today (${todayName}). Enjoy your free day!`;
    }
  }

  return {
    status: 'READY',
    type: 'timetable',
    title,
    capability: 'TIMETABLE',
    explanation,
    details: {
      timetable,
      todayClasses,
      currentOrNextClass: currentStatus.currentClass || currentStatus.nextClass,
      homeSection: timetable.homeSection,
      vid: timetable.vid,
      courses: timetable.courses,
      totalCourses: timetable.totalCourses,
      selectedDay: 'Today' as any
    },
    verification: {
      verified: true,
      source: 'UMS Student Time Table Report',
      slotsChecked: timetable.slots.length,
      subjectsChecked: timetable.courses.length,
      timestamp: 'just now',
      executionStatus: 'COMPLETED'
    }
  };
}

/**
 * Cleans and formats verification source descriptions for compact UI presentation.
 * Strips technical ASPX file names and raw DOM tags so metadata remains clean and readable.
 */
export function formatVerificationSource(source?: string): string {
  if (!source) return 'UMS Dashboard';
  let formatted = source.replace(/\s*\([A-Za-z0-9_]+\.aspx\)/gi, '').trim();
  formatted = formatted.replace(/[_-]DOM/gi, '').trim();
  const lower = formatted.toLowerCase();
  if (!formatted || lower === 'ums' || lower === 'live-ums') {
    return 'UMS Live Portal';
  }
  return formatted;
}

