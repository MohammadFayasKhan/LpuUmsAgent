/*
 * Intent Router & Cross-Domain Anaphoric Resolution Test Suite.
 *
 * Validates domain classification between Attendance and Examination,
 * course extraction, and cross-domain follow-ups.
 */

import { describe, it, expect } from 'vitest';
import { routeUserIntent } from '../services/intentRouter';
import { AttendanceSummary, ExaminationSummary } from '../shared/types';

describe('intentRouter', () => {
  const sampleAttendance: AttendanceSummary = {
    courses: [
      { code: 'CSE329', name: 'Cloud Computing', attended: 10, total: 10, absent: 0, percentage: 100 },
      { code: 'CSE330', name: 'Web Technologies', attended: 6, total: 10, absent: 4, percentage: 60 },
      { code: 'CSE408', name: 'Algorithms', attended: 8, total: 10, absent: 2, percentage: 80 }
    ],
    overallPercentage: 80,
    totalAttended: 24,
    totalDelivered: 30,
    totalCourses: 3,
    status: 'verified',
    source: 'live-ums-dom'
  };

  const sampleExamination: ExaminationSummary = {
    totalExams: 3,
    exams: [
      { courseCode: 'CSE329', examDate: '15-Oct-2026', startTime: '09:00 AM', venue: 'Block 34', room: '301', seat: 'A-1' },
      { courseCode: 'CSE330', examDate: '18-Oct-2026', startTime: '01:30 PM', venue: 'Block 34', room: '302', seat: 'B-2' },
      { courseCode: 'CSE408', examDate: '22-Oct-2026', startTime: '09:00 AM', venue: 'Block 36', room: '105', seat: 'C-3' }
    ],
    capturedAt: Date.now()
  };

  describe('Direct Intent Classification', () => {
    it('classifies next exam queries as EXAM_DATE_SHEET', () => {
      const result = routeUserIntent('When is my next exam?');
      expect(result.capability).toBe('EXAM_DATE_SHEET');
      expect(result.subType).toBe('next_exam');
    });

    it('classifies date sheet requests as EXAM_DATE_SHEET', () => {
      const result = routeUserIntent('Open my date sheet from Important Links');
      expect(result.capability).toBe('EXAM_DATE_SHEET');
      expect(result.subType).toBe('all_exams');
    });

    it('classifies seating plan requests as SEATING_PLAN', () => {
      const result = routeUserIntent('Where is my seat and room for CSE329?');
      expect(result.capability).toBe('SEATING_PLAN');
      expect(result.targetCourseCode).toBe('CSE329');
    });

    it('classifies attendance bunk queries as ATTENDANCE', () => {
      const result = routeUserIntent('Can I bunk CSE329 tomorrow?');
      expect(result.capability).toBe('ATTENDANCE');
      expect(result.targetCourseCode).toBe('CSE329');
    });

    it('classifies lowest attendance queries as ATTENDANCE', () => {
      const result = routeUserIntent('Which subject has my lowest attendance?');
      expect(result.capability).toBe('ATTENDANCE');
      expect(result.subType).toBe('lowest_attendance');
    });
  });

  describe('Cross-Domain Follow-Up Resolution', () => {
    it('resolves lowest attendance course when asked "When is its exam?"', () => {
      const result = routeUserIntent('When is its exam?', {
        latestAttendance: sampleAttendance,
        latestExamination: sampleExamination
      });

      expect(result.capability).toBe('EXAM_DATE_SHEET');
      expect(result.targetCourseCode).toBe('CSE330'); // Lowest attendance is CSE330 (60%)
      expect(result.resolvedCourseCode).toBe('CSE330');
    });

    it('resolves lowest attendance course when asked "Where is my seat for that subject?"', () => {
      const result = routeUserIntent('Where is my seat for that subject?', {
        latestAttendance: sampleAttendance,
        latestExamination: sampleExamination
      });

      expect(result.capability).toBe('SEATING_PLAN');
      expect(result.targetCourseCode).toBe('CSE330');
      expect(result.resolvedCourseCode).toBe('CSE330');
    });

    it('resolves last mentioned subject code from previous turn', () => {
      const result = routeUserIntent('Where is my seat?', {
        lastMentionedCourse: 'CSE408',
        latestExamination: sampleExamination
      });

      expect(result.capability).toBe('SEATING_PLAN');
      expect(result.targetCourseCode).toBe('CSE408');
    });
  });

  describe('Sample Question Paper Intent', () => {
    it('routes "Fetch and open sample paper for CSE408" to SAMPLE_PAPER', () => {
      const result = routeUserIntent('Fetch and open sample paper for CSE408');
      expect(result.capability).toBe('SAMPLE_PAPER');
      expect(result.targetCourseCode).toBe('CSE408');
    });

    it('routes "Open sample paper for INT373" to SAMPLE_PAPER', () => {
      const result = routeUserIntent('Open sample paper for INT373');
      expect(result.capability).toBe('SAMPLE_PAPER');
      expect(result.targetCourseCode).toBe('INT373');
    });

    it('resolves next exam course for "Show sample paper for next exam"', () => {
      const result = routeUserIntent('Show sample paper for next exam', {
        latestExamination: sampleExamination
      });
      expect(result.capability).toBe('SAMPLE_PAPER');
      expect(result.targetCourseCode).toBe('CSE329');
    });
  });

  describe('Timetable & Faculty Directory Intent', () => {
    it('routes "View Time Table" to TIMETABLE capability', () => {
      const result = routeUserIntent('View Time Table');
      expect(result.capability).toBe('TIMETABLE');
      expect(result.subType).toBe('timetable_full');
    });

    it('routes "What classes do I have today?" to TIMETABLE today_classes', () => {
      const result = routeUserIntent('What classes do I have today?');
      expect(result.capability).toBe('TIMETABLE');
      expect(result.subType).toBe('timetable_today');
    });

    it('routes "Where is the faculty cabin for Tejinder Thind in CSE408?" to TIMETABLE faculty_details', () => {
      const result = routeUserIntent('Where is the faculty cabin for Tejinder Thind in CSE408?');
      expect(result.capability).toBe('TIMETABLE');
      expect(result.subType).toBe('faculty_details');
      expect(result.targetCourseCode).toBe('CSE408');
    });

    it('routes "Show my timetable schedule and teacher rooms" to TIMETABLE', () => {
      const result = routeUserIntent('Show my timetable schedule and teacher rooms');
      expect(result.capability).toBe('TIMETABLE');
    });
  });
});
