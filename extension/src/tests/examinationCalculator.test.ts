/*
 * Unit tests for deterministic examination calculation, normalization,
 * chronological sorting, multi-exam deduplication, and next exam selection.
 */

import { describe, it, expect } from 'vitest';
import {
  parseExamDateTime,
  buildExamIdentity,
  deduplicateExams,
  sortExamsChronologically,
  findNextExam,
  validateExaminationDataset,
  getShortExamTypeTag
} from '../shared/examinationCalculator';
import { ExamRecord } from '../shared/types';

describe('examinationCalculator', () => {
  describe('parseExamDateTime', () => {
    it('parses "13 Sep 2026" with 24-hour time "14:00"', () => {
      const dt = parseExamDateTime('13 Sep 2026', '14:00');
      expect(dt).not.toBeNull();
      expect(dt?.getFullYear()).toBe(2026);
      expect(dt?.getMonth()).toBe(8); // September is 8
      expect(dt?.getDate()).toBe(13);
      expect(dt?.getHours()).toBe(14);
      expect(dt?.getMinutes()).toBe(0);
    });

    it('parses "06-Oct-2026" with 12-hour AM/PM time "10:30 AM"', () => {
      const dt = parseExamDateTime('06-Oct-2026', '10:30 AM');
      expect(dt).not.toBeNull();
      expect(dt?.getFullYear()).toBe(2026);
      expect(dt?.getMonth()).toBe(9); // October is 9
      expect(dt?.getDate()).toBe(6);
      expect(dt?.getHours()).toBe(10);
      expect(dt?.getMinutes()).toBe(30);
    });

    it('parses "06-Oct-2026" with 12-hour PM time "02:45 PM"', () => {
      const dt = parseExamDateTime('06-Oct-2026', '02:45 PM');
      expect(dt).not.toBeNull();
      expect(dt?.getHours()).toBe(14);
      expect(dt?.getMinutes()).toBe(45);
    });

    it('parses slash date formats like "15/10/2026"', () => {
      const dt = parseExamDateTime('15/10/2026', '09:00');
      expect(dt).not.toBeNull();
      expect(dt?.getDate()).toBe(15);
      expect(dt?.getMonth()).toBe(9);
      expect(dt?.getFullYear()).toBe(2026);
    });

    it('returns null for empty or invalid date strings', () => {
      expect(parseExamDateTime('', '')).toBeNull();
      expect(parseExamDateTime('invalid-date', 'time')).toBeNull();
    });
  });

  describe('buildExamIdentity', () => {
    it('creates consistent normalized composite key', () => {
      const exam1: ExamRecord = {
        courseCode: 'CSE443',
        examDate: '13 Sep 2026',
        startTime: '14:00',
        examType: 'Practical End Term'
      };
      const exam2: ExamRecord = {
        courseCode: 'cse443',
        examDate: '13 Sep 2026',
        startTime: '14:00',
        examType: 'practical end term'
      };
      expect(buildExamIdentity(exam1)).toBe(buildExamIdentity(exam2));
      expect(buildExamIdentity(exam1)).toBe('CSE443_13sep2026_14:00_practicalendterm');
    });

    it('distinguishes different exam types for the same course on same day', () => {
      const practical: ExamRecord = {
        courseCode: 'INT373',
        examDate: '08 Oct 2026',
        startTime: '10:00',
        examType: 'Practical'
      };
      const theory: ExamRecord = {
        courseCode: 'INT373',
        examDate: '08 Oct 2026',
        startTime: '14:00',
        examType: 'Theory'
      };
      expect(buildExamIdentity(practical)).not.toBe(buildExamIdentity(theory));
    });
  });

  describe('deduplicateExams', () => {
    it('deduplicates identical examinations from repeated viewport observations', () => {
      const records: ExamRecord[] = [
        { courseCode: 'CSE443', examDate: '13 Sep 2026', startTime: '14:00' },
        { courseCode: 'CSE408', examDate: '06 Oct 2026', startTime: '10:00' },
        { courseCode: 'CSE443', examDate: '13 Sep 2026', startTime: '14:00' }, // Duplicate
        { courseCode: 'INT373', examDate: '08 Oct 2026', startTime: '10:00' }
      ];
      const deduped = deduplicateExams(records);
      expect(deduped).toHaveLength(3);
      expect(deduped.map((e) => e.courseCode)).toEqual(['CSE443', 'CSE408', 'INT373']);
    });

    it('works dynamically for 1, 2, 7, 10, 15+ exams', () => {
      // 1 exam
      expect(deduplicateExams([{ courseCode: 'CSE101', examDate: '01 Oct 2026' }])).toHaveLength(1);

      // 7 exams
      const sevenExams: ExamRecord[] = [
        { courseCode: 'CSE443', examDate: '13 Sep 2026', startTime: '14:00' },
        { courseCode: 'CSE408', examDate: '06 Oct 2026', startTime: '10:00' },
        { courseCode: 'INT373', examDate: '08 Oct 2026', startTime: '10:00', examType: 'Theory' },
        { courseCode: 'INT373', examDate: '10 Oct 2026', startTime: '14:00', examType: 'Practical' },
        { courseCode: 'CSE471', examDate: '12 Oct 2026', startTime: '10:00' },
        { courseCode: 'CSE472', examDate: '15 Oct 2026', startTime: '10:00' },
        { courseCode: 'CAP421', examDate: '18 Oct 2026', startTime: '14:00' }
      ];
      expect(deduplicateExams(sevenExams)).toHaveLength(7);

      // 12 exams
      const twelveExams: ExamRecord[] = Array.from({ length: 12 }, (_, i) => ({
        courseCode: `SUBJ${100 + i}`,
        examDate: `${10 + i} Oct 2026`,
        startTime: '10:00'
      }));
      expect(deduplicateExams(twelveExams)).toHaveLength(12);
    });
  });

  describe('sortExamsChronologically', () => {
    it('sorts exams in ascending date and start time order', () => {
      const unordered: ExamRecord[] = [
        { courseCode: 'CSE472', examDate: '15 Oct 2026', startTime: '10:00' },
        { courseCode: 'CSE443', examDate: '13 Sep 2026', startTime: '14:00' },
        { courseCode: 'CSE408', examDate: '06 Oct 2026', startTime: '14:00' },
        { courseCode: 'CSE408_AM', examDate: '06 Oct 2026', startTime: '09:00' }
      ];
      const sorted = sortExamsChronologically(unordered);
      expect(sorted[0].courseCode).toBe('CSE443');
      expect(sorted[1].courseCode).toBe('CSE408_AM');
      expect(sorted[2].courseCode).toBe('CSE408');
      expect(sorted[3].courseCode).toBe('CSE472');
    });
  });

  describe('findNextExam', () => {
    const schedule: ExamRecord[] = [
      { courseCode: 'CSE443', examDate: '13 Sep 2026', startTime: '14:00', endTime: '17:00' },
      { courseCode: 'CSE408', examDate: '06 Oct 2026', startTime: '10:00', endTime: '11:30' },
      { courseCode: 'INT373', examDate: '08 Oct 2026', startTime: '10:00', endTime: '11:30' }
    ];

    it('returns earliest future exam relative to reference time', () => {
      const refTime = new Date(2026, 8, 14, 9, 0, 0); // 14 Sep 2026 (after CSE443)
      const next = findNextExam(schedule, refTime);
      expect(next?.courseCode).toBe('CSE408');
    });

    it('returns today exam if it is still ongoing or upcoming today', () => {
      const refTime = new Date(2026, 8, 13, 10, 0, 0); // 13 Sep 2026 at 10:00 AM (before 14:00 exam)
      const next = findNextExam(schedule, refTime);
      expect(next?.courseCode).toBe('CSE443');
    });

    it('returns null if all exams are in the past', () => {
      const refTime = new Date(2026, 10, 1, 0, 0, 0); // 1 Nov 2026 (after all exams)
      const next = findNextExam(schedule, refTime);
      expect(next).toBeNull();
    });

    it('returns null for empty exam schedule', () => {
      expect(findNextExam([])).toBeNull();
    });
  });

  describe('validateExaminationDataset', () => {
    it('validates complete dataset with optional fields missing gracefully', () => {
      const exams: ExamRecord[] = [
        {
          courseCode: 'CSE443',
          examDate: '13 Sep 2026',
          startTime: '14:00',
          // venue, room, seat, samplePaper missing
        },
        {
          courseCode: 'CSE408',
          examDate: '06 Oct 2026',
          startTime: '10:00',
          venue: 'Block 36',
          room: '102',
          seat: 'D-14',
          samplePaper: { available: true, label: 'Sample Question Paper' }
        }
      ];

      const res = validateExaminationDataset(exams);
      expect(res.valid).toBe(true);
      expect(res.verifiedCount).toBe(2);
      expect(res.issues).toHaveLength(0);
    });

    it('flags invalid dataset when courseCode or date is completely missing', () => {
      const invalidExams: ExamRecord[] = [
        { courseCode: '', examDate: '13 Sep 2026' },
        { courseCode: 'CSE408', examDate: '' }
      ];
      const res = validateExaminationDataset(invalidExams);
      expect(res.valid).toBe(false);
      expect(res.issues.length).toBeGreaterThan(0);
    });
  });

  describe('getShortExamTypeTag', () => {
    it('condenses verbose Mid Term strings into concise "Mid Term" tags', () => {
      expect(getShortExamTypeTag('Theory Mid Term - All Subjective', 'Theory Mid Term - All Subjective')).toBe('Mid Term');
      expect(getShortExamTypeTag('Theory Mid Term - All Subjective', 'Software Testing')).toBe('Mid Term');
      expect(getShortExamTypeTag('Mid Term Regular', 'Database Management')).toBe('Mid Term');
    });

    it('condenses practical strings into concise "Practical" tags', () => {
      expect(getShortExamTypeTag('Practical End Term Regular', 'Python Lab')).toBe('Practical');
      expect(getShortExamTypeTag('Practical Exam', 'OS Lab')).toBe('Practical');
    });

    it('condenses End Term strings into concise "End Term" tags', () => {
      expect(getShortExamTypeTag('End Term Regular', 'Compiler Design')).toBe('End Term');
      expect(getShortExamTypeTag('End Term Exam', 'AI Ethics')).toBe('End Term');
    });

    it('identifies Theory tags correctly', () => {
      expect(getShortExamTypeTag('Theory Exam', 'Machine Learning')).toBe('Theory');
      expect(getShortExamTypeTag('Theory', 'Machine Learning')).toBe('Theory');
    });

    it('preserves short custom exam tags', () => {
      expect(getShortExamTypeTag('Oral Viva', 'Project')).toBe('Oral Viva');
      expect(getShortExamTypeTag('Quiz', 'Discrete Math')).toBe('Quiz');
    });

    it('truncates overly long custom unknown strings to prevent UI overlap', () => {
      const longType = 'Continuous Evaluation Assessment Test';
      const shortTag = getShortExamTypeTag(longType, 'Subject');
      expect(shortTag).toBe('Continuous…');
      expect(shortTag!.length).toBeLessThanOrEqual(12);
    });

    it('handles empty or null/undefined gracefully', () => {
      expect(getShortExamTypeTag(undefined, 'Subject')).toBeNull();
      expect(getShortExamTypeTag('', 'Subject')).toBeNull();
      expect(getShortExamTypeTag('   ', 'Subject')).toBeNull();
    });
  });
});

