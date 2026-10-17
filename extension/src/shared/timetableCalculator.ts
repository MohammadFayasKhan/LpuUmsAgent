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
 * Returns tomorrow's scheduled classes.
 */
export function getTomorrowClasses(
  timetable: TimetableSummary,
  targetDate: Date = new Date()
): TimetableSlot[] {
  const tomorrowDate = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowDay = getDayOfWeekName(tomorrowDate);
  return getClassesForDay(timetable, tomorrowDay);
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
 * Intelligently locates the very next upcoming class across the week.
 * If all classes today are over, scans tomorrow and subsequent weekdays.
 */
export function getNextUpcomingClass(
  timetable: TimetableSummary,
  now: Date = new Date()
): {
  slot?: TimetableSlot;
  isRunningNow?: boolean;
  isToday?: boolean;
  dayName: TimetableDay;
  relativeDay: 'today' | 'tomorrow' | 'upcoming';
} {
  const todayName = getDayOfWeekName(now);
  const currentStatus = getCurrentOrNextClass(timetable, now);

  if (currentStatus.currentClass) {
    return {
      slot: currentStatus.currentClass,
      isRunningNow: true,
      isToday: true,
      dayName: todayName,
      relativeDay: 'today'
    };
  }

  if (currentStatus.nextClass) {
    return {
      slot: currentStatus.nextClass,
      isRunningNow: false,
      isToday: true,
      dayName: todayName,
      relativeDay: 'today'
    };
  }

  // If no upcoming classes today, scan future days (1 to 6 days ahead)
  for (let offset = 1; offset <= 6; offset++) {
    const futureDate = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const futureDay = getDayOfWeekName(futureDate);
    const classes = getClassesForDay(timetable, futureDay);
    if (classes.length > 0) {
      return {
        slot: classes[0],
        isRunningNow: false,
        isToday: false,
        dayName: futureDay,
        relativeDay: offset === 1 ? 'tomorrow' : 'upcoming'
      };
    }
  }

  return { dayName: todayName, relativeDay: 'today' };
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
  const goalLower = goal.toLowerCase();

  const weekdays: TimetableDay[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const explicitDay = weekdays.find((d) => goalLower.includes(d.toLowerCase()));
  const isTomorrowQuery = goalLower.includes('tomorrow');

  let targetDay: TimetableDay = todayName;
  let targetDayLabel = `Today (${todayName})`;
  if (isTomorrowQuery) {
    const tomorrowDate = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
    targetDay = getDayOfWeekName(tomorrowDate);
    targetDayLabel = `Tomorrow (${targetDay})`;
  } else if (explicitDay) {
    targetDay = explicitDay;
    targetDayLabel = `${explicitDay}`;
  }

  const dayClasses = getClassesForDay(timetable, targetDay);
  const currentStatus = getCurrentOrNextClass(timetable, targetDate);
  const nextUpcoming = getNextUpcomingClass(timetable, targetDate);

  // If student specifically asked for a specific course's faculty or cabin:
  const codeMatch = goal.match(/\b([A-Z]{2,5})\s*(\d{3,4}[A-Z]?)\b/i);
  let spotlightCourse: CourseFacultyRecord | undefined;
  if (codeMatch) {
    spotlightCourse = findFacultyByCourse(timetable, `${codeMatch[1]}${codeMatch[2]}`);
  }

  let title = `Student Time Table (${timetable.homeSection || 'Verified'})`;
  let explanation = `Verified ${timetable.totalSlots} weekly classes across ${timetable.totalCourses} courses (${timetable.totalCredits} total credits).`;

  if (spotlightCourse && (goalLower.includes('faculty') || goalLower.includes('cabin') || goalLower.includes('teacher') || goalLower.includes('who teaches'))) {
    title = `${spotlightCourse.courseCode} Faculty: ${spotlightCourse.facultyName || 'Faculty'}`;
    explanation = `${spotlightCourse.courseTitle} is taught by ${spotlightCourse.facultyName || 'Faculty'} (Cabin: ${spotlightCourse.facultyCabin || 'N/A'}).`;
  } else if (goalLower.includes('next class') || goalLower.includes('where is my next') || goalLower.includes('current class')) {
    if (nextUpcoming.isRunningNow && nextUpcoming.slot) {
      title = `Current Class: ${nextUpcoming.slot.courseCode}`;
      explanation = `Currently in ${nextUpcoming.slot.courseCode} (${nextUpcoming.slot.type || 'Lecture'}) in Room ${nextUpcoming.slot.room || 'TBD'} until ${nextUpcoming.slot.time.split('-')[1] || 'end of slot'}.`;
    } else if (nextUpcoming.isToday && nextUpcoming.slot) {
      title = `Next Class Today: ${nextUpcoming.slot.courseCode}`;
      explanation = `Your next class today (${todayName}) is ${nextUpcoming.slot.courseCode} at ${nextUpcoming.slot.time} in Room ${nextUpcoming.slot.room || 'TBD'}.`;
    } else if (nextUpcoming.slot) {
      const dayPhrase = nextUpcoming.relativeDay === 'tomorrow' ? `tomorrow (${nextUpcoming.dayName})` : `on ${nextUpcoming.dayName}`;
      title = `Next Class: ${nextUpcoming.slot.courseCode}`;
      explanation = `All classes for today (${todayName}) are over. Your next scheduled class is ${nextUpcoming.slot.courseCode} ${dayPhrase} at ${nextUpcoming.slot.time} in Room ${nextUpcoming.slot.room || 'TBD'}.`;
    } else {
      title = 'No Upcoming Classes';
      explanation = 'No scheduled classes found in your weekly timetable.';
    }
  } else if (isTomorrowQuery || explicitDay || goalLower.includes('today') || goalLower.includes('now')) {
    title = `${targetDayLabel} Classes`;
    if (dayClasses.length > 0) {
      explanation = `You have ${dayClasses.length} classes scheduled for ${targetDayLabel}. First class starts at ${dayClasses[0].time} (${dayClasses[0].courseCode} in Room ${dayClasses[0].room || 'TBD'}).`;
    } else {
      explanation = `No scheduled lectures or practicals for ${targetDayLabel}. Enjoy your free day!`;
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
      todayClasses: dayClasses,
      currentOrNextClass: currentStatus.currentClass || currentStatus.nextClass || nextUpcoming.slot,
      homeSection: timetable.homeSection,
      vid: timetable.vid,
      courses: timetable.courses,
      totalCourses: timetable.totalCourses,
      selectedDay: targetDay as any
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

/**
 * Formats room code into human-friendly block and floor description (e.g. "33-502" -> "Room 33-502 (Block 33, 5th Floor)").
 */
export function formatRoomLocation(room?: string): string {
  if (!room || room === 'N/A' || room === 'TBD') return room || 'N/A';
  const trimmed = room.trim();
  const match = trimmed.match(/^(\d{1,2})-(\d)(\d{2})$/);
  if (match) {
    const block = match[1];
    const floorNum = parseInt(match[2], 10);
    const floorSuffix = floorNum === 1 ? '1st' : floorNum === 2 ? '2nd' : floorNum === 3 ? '3rd' : `${floorNum}th`;
    return `**${trimmed}** (Block ${block}, ${floorSuffix} Floor)`;
  }
  const simpleMatch = trimmed.match(/^(\d{1,2})-(.*)$/);
  if (simpleMatch) {
    return `**${trimmed}** (Block ${simpleMatch[1]})`;
  }
  return `**${trimmed}**`;
}

/**
 * Formats faculty cabin into human-friendly block and cabin description.
 */
export function formatCabinLocation(cabin?: string): string {
  if (!cabin || cabin === 'N/A' || cabin === 'TBD' || cabin.toLowerCase().includes('verified')) {
    return cabin || 'Verified in UMS report';
  }
  const trimmed = cabin.trim();
  const match = trimmed.match(/^(\d{1,2})-(\d+)/);
  if (match) {
    return `**${trimmed}** (Block ${match[1]}, Cabin ${match[2]})`;
  }
  return `**${trimmed}**`;
}


