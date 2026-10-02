/*
 * Examination Validator & Deterministic Scheduler Test Suite.
 *
 * Validates deterministic scheduling, next exam calculation,
 * same-day start time ordering, temporal validation, and course lookups.
 */

import { describe, it, expect } from 'vitest';
import {
  validateExaminationSummary,
  getNextExam,
  getUpcomingExams,
  findExamByCourse,
  parseExamDateTime
} from '../content/examination/examinationValidator';
import { ExamRecord, ExaminationSummary } from '../shared/types';

describe('examinationValidator', () => {
  const sampleExams: ExamRecord[] = [
    {
      courseCode: 'CSE329',
      courseName: 'Cloud Computing',
      examDate: '15-Oct-2026',
      startTime: '09:00 AM',
      endTime: '12:00 PM',
      reportingTime: '08:30 AM',
      venue: 'Block 34',
      room: '301',
      seat: 'A-12',
      mode: 'Pen and Paper'
    },
    {
      courseCode: 'CSE330',
      courseName: 'Web Technologies',
      examDate: '15-Oct-2026',
      startTime: '01:30 PM',
      endTime: '04:30 PM',
      reportingTime: '01:00 PM',
      venue: 'Block 34',
      room: '302',
      seat: 'B-05',
      mode: 'Online'
    },
    {
      courseCode: 'CSE408',
      courseName: 'Design and Analysis of Algorithms',
      examDate: '20-Oct-2026',
      startTime: '09:00 AM',
      endTime: '12:00 PM',
      reportingTime: '08:30 AM',
      venue: 'Block 36',
      room: '105',
      seat: 'C-22'
    },
    {
      courseCode: 'INT213',
      courseName: 'Python Programming',
      examDate: '10-Oct-2026',
      startTime: '10:00 AM',
      endTime: '01:00 PM'
    }
  ];

  describe('validateExaminationSummary', () => {
    it('passes for a valid complete examination summary', () => {
      const summary: ExaminationSummary = {
        studentId: '12104928',
        totalExams: 4,
        exams: sampleExams,
        capturedAt: Date.now()
      };

      const result = validateExaminationSummary(summary);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.examsChecked).toBe(4);
    });

    it('fails when exam list is empty', () => {
      const summary: ExaminationSummary = {
        totalExams: 0,
        exams: [],
        capturedAt: Date.now()
      };

      const result = validateExaminationSummary(summary);
      expect(result.valid).toBe(false);
      expect(result.issues).toContain('No examinations parsed');
    });

    it('fails when totalExams does not match exams.length', () => {
      const summary: ExaminationSummary = {
        totalExams: 10,
        exams: sampleExams,
        capturedAt: Date.now()
      };

      const result = validateExaminationSummary(summary);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('Mismatch'))).toBe(true);
    });

    it('detects duplicate exams for the same course code', () => {
      const duplicates: ExamRecord[] = [
        sampleExams[0],
        { ...sampleExams[0], room: '999' }
      ];

      const summary: ExaminationSummary = {
        totalExams: 2,
        exams: duplicates,
        capturedAt: Date.now()
      };

      const result = validateExaminationSummary(summary);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('Duplicate exam record'))).toBe(true);
    });

    it('detects invalid date formats', () => {
      const badDate: ExamRecord[] = [
        {
          courseCode: 'BAD101',
          examDate: 'Not-A-Date',
          startTime: '09:00 AM'
        }
      ];

      const summary: ExaminationSummary = {
        totalExams: 1,
        exams: badDate,
        capturedAt: Date.now()
      };

      const result = validateExaminationSummary(summary);
      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.includes('Unparseable exam date'))).toBe(true);
    });
  });

  describe('parseExamDateTime', () => {
    it('parses standard DD-Mon-YYYY format', () => {
      const dt = parseExamDateTime('15-Oct-2026', '09:00 AM');
      expect(dt).not.toBeNull();
      expect(dt?.getFullYear()).toBe(2026);
      expect(dt?.getMonth()).toBe(9); // October is month index 9
      expect(dt?.getDate()).toBe(15);
      expect(dt?.getHours()).toBe(9);
      expect(dt?.getMinutes()).toBe(0);
    });

    it('parses PM hours correctly', () => {
      const dt = parseExamDateTime('15-Oct-2026', '01:30 PM');
      expect(dt).not.toBeNull();
      expect(dt?.getHours()).toBe(13);
      expect(dt?.getMinutes()).toBe(30);
    });

    it('parses 12:00 PM (noon) and 12:00 AM (midnight) correctly', () => {
      const noon = parseExamDateTime('15-Oct-2026', '12:00 PM');
      expect(noon?.getHours()).toBe(12);

      const midnight = parseExamDateTime('15-Oct-2026', '12:00 AM');
      expect(midnight?.getHours()).toBe(0);
    });

    it('parses ISO YYYY-MM-DD and DD/MM/YYYY formats', () => {
      const iso = parseExamDateTime('2026-10-15', '14:00');
      expect(iso?.getFullYear()).toBe(2026);
      expect(iso?.getMonth()).toBe(9);
      expect(iso?.getDate()).toBe(15);

      const slash = parseExamDateTime('15/10/2026', '09:00 AM');
      expect(slash?.getDate()).toBe(15);
    });
  });

  describe('getNextExam (Deterministic Nearest Examination)', () => {
    it('determines the earliest future exam relative to reference date', () => {
      // Reference: October 12, 2026 at 08:00 AM
      const reference = new Date(2026, 9, 12, 8, 0, 0);
      const next = getNextExam(sampleExams, reference);

      expect(next).not.toBeNull();
      expect(next?.courseCode).toBe('CSE329'); // 15-Oct 09:00 AM comes before 15-Oct 01:30 PM and 20-Oct
    });

    it('breaks same-day ties deterministically by start time', () => {
      // Reference: October 15, 2026 at 10:00 AM (after CSE329 09:00 AM has passed)
      const reference = new Date(2026, 9, 15, 10, 0, 0);
      const next = getNextExam(sampleExams, reference);

      expect(next).not.toBeNull();
      expect(next?.courseCode).toBe('CSE330'); // 01:30 PM on same day
    });

    it('moves to the next date once all same-day exams are completed', () => {
      // Reference: October 15, 2026 at 05:00 PM
      const reference = new Date(2026, 9, 15, 17, 0, 0);
      const next = getNextExam(sampleExams, reference);

      expect(next).not.toBeNull();
      expect(next?.courseCode).toBe('CSE408'); // 20-Oct-2026
    });

    it('returns null if all examinations are in the past', () => {
      // Reference: November 1, 2026
      const reference = new Date(2026, 10, 1);
      const next = getNextExam(sampleExams, reference);

      expect(next).toBeNull();
    });
  });

  describe('getUpcomingExams', () => {
    it('returns exams sorted chronologically into the future', () => {
      const reference = new Date(2026, 9, 1, 0, 0, 0);
      const upcoming = getUpcomingExams(sampleExams, reference);

      expect(upcoming).toHaveLength(4);
      expect(upcoming[0].courseCode).toBe('INT213'); // 10-Oct
      expect(upcoming[1].courseCode).toBe('CSE329'); // 15-Oct 09:00 AM
      expect(upcoming[2].courseCode).toBe('CSE330'); // 15-Oct 01:30 PM
      expect(upcoming[3].courseCode).toBe('CSE408'); // 20-Oct
    });
  });

  describe('findExamByCourse', () => {
    it('locates course code case-insensitively', () => {
      const found = findExamByCourse(sampleExams, 'cse329');
      expect(found).toBeDefined();
      expect(found?.courseCode).toBe('CSE329');
      expect(found?.venue).toBe('Block 34');
    });

    it('locates course code with internal spaces', () => {
      const found = findExamByCourse(sampleExams, 'CSE 408');
      expect(found).toBeDefined();
      expect(found?.courseCode).toBe('CSE408');
    });

    it('returns undefined if course is not in the date sheet', () => {
      const found = findExamByCourse(sampleExams, 'MTH101');
      expect(found).toBeUndefined();
    });
  });
});
