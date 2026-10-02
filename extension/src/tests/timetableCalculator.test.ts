/*
 * Timetable & Faculty Calculator Unit Tests.
 *
 * Tests:
 * 1. Time interval parsing (e.g. "09:30-10:20 AM", "12:00-12:50 PM", "01:40-02:30 PM").
 * 2. Day-of-week class filtering.
 * 3. Active / next class deterministic calculation.
 * 4. Faculty cabin and room lookup.
 * 5. Timetable summary validation.
 * 6. Final response synthesis.
 */

import { describe, it, expect } from 'vitest';
import {
  parseTimeInterval,
  getClassesForDay,
  getCurrentOrNextClass,
  findFacultyByCourse,
  findClassesForCourse,
  validateTimetableSummary,
  buildTimetableFinalResponse,
  formatVerificationSource
} from '../shared/timetableCalculator';
import { TimetableSummary } from '../shared/types';

describe('timetableCalculator', () => {
  const mockTimetable: TimetableSummary = {
    capturedAt: 1774000000000,
    vid: '12413692',
    homeSection: 'K3P24WM',
    slots: [
      {
        id: 'slot-1',
        day: 'Monday',
        time: '10:20-11:10 AM',
        type: 'Lecture',
        group: 'All',
        courseCode: 'CSE472',
        courseTitle: 'Deep Learning for NLP',
        room: '33-301',
        section: 'K2EM001',
        facultyName: 'Anzar Hussain Lone',
        facultyCabin: '33-205-CH8',
        rawText: 'Lecture / G:All C:CSE472 / R: 33-301 / S:K2EM001'
      },
      {
        id: 'slot-2',
        day: 'Monday',
        time: '12:00-12:50 PM',
        type: 'Practical',
        group: '0',
        courseCode: 'CSE329',
        courseTitle: 'Prelude to Competitive Coding',
        room: '38-917',
        section: 'K4E0061',
        facultyName: 'Raj Karan Singh',
        facultyCabin: '26-207-WOW1',
        rawText: 'Practical / G:0 C:CSE329 / R: 38-917 / S:K4E0061'
      },
      {
        id: 'slot-3',
        day: 'Tuesday',
        time: '09:30-10:20 AM',
        type: 'Lecture',
        group: 'All',
        courseCode: 'CSE329',
        courseTitle: 'Prelude to Competitive Coding',
        room: '38-917',
        section: 'K4E0061',
        facultyName: 'Raj Karan Singh',
        facultyCabin: '26-207-WOW1',
        rawText: 'Lecture / G:All C:CSE329 / R: 38-917 / S:K4E0061'
      },
      {
        id: 'slot-4',
        day: 'Tuesday',
        time: '01:40-02:30 PM',
        type: 'Lecture',
        group: 'All',
        courseCode: 'CSE408',
        courseTitle: 'Design and Analysis of Algorithms',
        room: '34-808',
        section: 'K3P24WM',
        facultyName: 'Tejinder Thind',
        facultyCabin: '34-203-C2',
        rawText: 'Lecture / G:All C:CSE408 / R: 34-808 / S:K3P24WM'
      }
    ],
    courses: [
      {
        courseCode: 'CSE329',
        courseType: 'PW',
        courseTitle: 'Prelude to Competitive Coding',
        lectures: 2,
        tutorial: 0,
        practical: 1,
        credits: 3,
        facultyName: 'Raj Karan Singh',
        facultyCabin: '26-207-WOW1'
      },
      {
        courseCode: 'CSE408',
        courseType: 'CR',
        courseTitle: 'Design and Analysis of Algorithms',
        lectures: 3,
        tutorial: 0,
        practical: 2,
        credits: 4,
        facultyName: 'Tejinder Thind',
        facultyCabin: '34-203-C2'
      },
      {
        courseCode: 'CSE472',
        courseType: 'EM',
        courseTitle: 'Deep Learning for NLP',
        lectures: 2,
        tutorial: 0,
        practical: 2,
        credits: 3,
        facultyName: 'Anzar Hussain Lone',
        facultyCabin: '33-205-CH8'
      }
    ],
    totalSlots: 4,
    totalCourses: 3,
    totalCredits: 10,
    verified: true,
    source: 'UMS'
  };

  describe('parseTimeInterval', () => {
    it('parses morning interval correctly', () => {
      const res = parseTimeInterval('09:30-10:20 AM');
      expect(res.startMinutes).toBe(9 * 60 + 30);
      expect(res.endMinutes).toBe(10 * 60 + 20);
    });

    it('parses afternoon interval correctly', () => {
      const res = parseTimeInterval('01:40-02:30 PM');
      expect(res.startMinutes).toBe(13 * 60 + 40);
      expect(res.endMinutes).toBe(14 * 60 + 30);
    });

    it('parses noon transition interval correctly', () => {
      const res = parseTimeInterval('11:10-12:00 AM');
      expect(res.startMinutes).toBe(11 * 60 + 10);
      expect(res.endMinutes).toBe(12 * 60);
    });
  });

  describe('getClassesForDay', () => {
    it('returns classes for Monday in chronological order', () => {
      const mondayClasses = getClassesForDay(mockTimetable, 'Monday');
      expect(mondayClasses.length).toBe(2);
      expect(mondayClasses[0].courseCode).toBe('CSE472');
      expect(mondayClasses[1].courseCode).toBe('CSE329');
    });

    it('returns empty array for Sunday', () => {
      expect(getClassesForDay(mockTimetable, 'Sunday')).toEqual([]);
    });
  });

  describe('getCurrentOrNextClass', () => {
    it('detects running class during lecture slot', () => {
      // Mock Monday at 10:35 AM (635 mins from midnight)
      // Monday 10:20-11:10 AM is CSE472
      const mockMondayDate = new Date(2026, 8, 21, 10, 35, 0); // Monday Sep 21 2026 10:35 AM
      const res = getCurrentOrNextClass(mockTimetable, mockMondayDate);

      expect(res.isRunningNow).toBe(true);
      expect(res.currentClass).toBeDefined();
      expect(res.currentClass?.courseCode).toBe('CSE472');
      expect(res.currentClass?.room).toBe('33-301');
    });

    it('detects next upcoming class before it starts', () => {
      // Mock Monday at 09:00 AM (before 10:20 AM class)
      const mockMondayDate = new Date(2026, 8, 21, 9, 0, 0);
      const res = getCurrentOrNextClass(mockTimetable, mockMondayDate);

      expect(res.isRunningNow).toBe(false);
      expect(res.nextClass).toBeDefined();
      expect(res.nextClass?.courseCode).toBe('CSE472');
    });

    it('returns empty object if all classes for the day have finished', () => {
      // Mock Monday at 05:00 PM (after last 12:50 PM class)
      const mockMondayDate = new Date(2026, 8, 21, 17, 0, 0);
      const res = getCurrentOrNextClass(mockTimetable, mockMondayDate);

      expect(res.currentClass).toBeUndefined();
      expect(res.nextClass).toBeUndefined();
    });
  });

  describe('findFacultyByCourse', () => {
    it('locates faculty and cabin by course code', () => {
      const fac = findFacultyByCourse(mockTimetable, 'CSE408');
      expect(fac).toBeDefined();
      expect(fac?.facultyName).toBe('Tejinder Thind');
      expect(fac?.facultyCabin).toBe('34-203-C2');
      expect(fac?.credits).toBe(4);
    });

    it('returns undefined for unknown course code', () => {
      expect(findFacultyByCourse(mockTimetable, 'UNKNOWN123')).toBeUndefined();
    });
  });

  describe('findClassesForCourse', () => {
    it('returns all weekly slots for a specific course', () => {
      const slots = findClassesForCourse(mockTimetable, 'CSE329');
      expect(slots.length).toBe(2);
      expect(slots[0].day).toBe('Monday');
      expect(slots[1].day).toBe('Tuesday');
    });
  });

  describe('validateTimetableSummary', () => {
    it('validates a properly parsed timetable summary', () => {
      const validation = validateTimetableSummary(mockTimetable);
      expect(validation.valid).toBe(true);
      expect(validation.slotsCount).toBe(4);
      expect(validation.coursesCount).toBe(3);
    });

    it('flags invalid summary if slots is empty', () => {
      const emptyTimetable: TimetableSummary = {
        ...mockTimetable,
        slots: []
      };
      const validation = validateTimetableSummary(emptyTimetable);
      expect(validation.valid).toBe(false);
      expect(validation.issues).toContain('No weekly class slots could be extracted from grid.');
    });
  });

  describe('buildTimetableFinalResponse', () => {
    it('synthesizes unified final response for timetable request', () => {
      const response = buildTimetableFinalResponse(
        'View Time Table and faculty cabins',
        mockTimetable
      );

      expect(response.type).toBe('timetable');
      expect(response.capability).toBe('TIMETABLE');
      expect(response.details?.timetable).toBeDefined();
      expect(response.details?.timetable?.homeSection).toBe('K3P24WM');
      expect(response.details?.timetable?.courses.length).toBe(3);
      expect(response.verification.verified).toBe(true);
      expect(response.explanation).toContain('4 weekly classes');
    });
  });

  describe('formatVerificationSource', () => {
    it('strips .aspx script names from verbose report source strings', () => {
      const formatted = formatVerificationSource('UMS Student Time Table Report (frmStudentTimeTable.aspx)');
      expect(formatted).toBe('UMS Student Time Table Report');
      expect(formatted).not.toContain('aspx');
    });

    it('strips _DOM and -dom flags from raw telemetry sources', () => {
      expect(formatVerificationSource('UMS_DOM')).toBe('UMS Live Portal');
      expect(formatVerificationSource('live-ums-dom')).toBe('UMS Live Portal');
    });

    it('preserves clean human-readable source titles', () => {
      expect(formatVerificationSource('UMS Examination Date Sheet & Seating Plan')).toBe('UMS Examination Date Sheet & Seating Plan');
      expect(formatVerificationSource('UMS Student Dashboard')).toBe('UMS Student Dashboard');
    });

    it('defaults gracefully when source is empty or missing', () => {
      expect(formatVerificationSource(undefined)).toBe('UMS Dashboard');
      expect(formatVerificationSource('')).toBe('UMS Dashboard');
    });
  });
});
