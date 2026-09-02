/*
 * Deterministic Attendance Mathematics Test Suite.
 *
 * Validates core attendance calculations without LLM dependency:
 * - Weighted aggregate percentage from delivered and attended totals.
 * - Bunk allowance formulas: floor((attended - target * total) / target).
 * - Required recovery classes: ceil((target * total - attended) / (1 - target)).
 * - Lowest subject identification and edge cases (0 delivered, 100% attendance).
 */

import { describe, it, expect } from 'vitest';
import {
  calculateOverallAttendance,
  calculateBunkAllowance,
  calculateRequiredClasses,
  getLowestAttendanceSubject,
  evaluateAttendanceHealth,
  validateAttendanceSummary
} from '../shared/attendanceCalculator';
import { AttendanceRecord } from '../shared/types';

describe('attendanceCalculator', () => {
  describe('calculateOverallAttendance', () => {
    it('calculates exact weighted aggregate percentage and totals', () => {
      const courses: AttendanceRecord[] = [
        { code: 'CSE329', name: 'Coding', attended: 7, total: 7, absent: 0, percentage: 100 },
        { code: 'CSE330', name: 'Approaches', attended: 6, total: 7, absent: 1, percentage: 85.71 }
      ];

      const summary = calculateOverallAttendance(courses);
      expect(summary.totalCourses).toBe(2);
      expect(summary.totalAttended).toBe(13);
      expect(summary.totalClasses).toBe(14);
      expect(summary.totalAbsent).toBe(1);
      // (13 / 14) * 100 = 92.857... -> 92.86%
      expect(summary.overallPercentage).toBe(92.86);
    });

    it('handles heavy weighting properly instead of simple average of percentages', () => {
      const courses: AttendanceRecord[] = [
        { code: 'CSE100', name: 'Big Course', attended: 50, total: 50, absent: 0, percentage: 100 },
        { code: 'CSE200', name: 'Small Course', attended: 1, total: 10, absent: 9, percentage: 10 }
      ];

      const summary = calculateOverallAttendance(courses);
      // Total attended = 51, total classes = 60 => 51/60 = 85.00%
      // (Average of 100 and 10 would be 55%, which is wrong)
      expect(summary.overallPercentage).toBe(85.0);
    });

    it('handles empty course list safely', () => {
      const summary = calculateOverallAttendance([]);
      expect(summary.totalCourses).toBe(0);
      expect(summary.totalClasses).toBe(0);
      expect(summary.overallPercentage).toBe(0);
    });
  });

  describe('calculateBunkAllowance', () => {
    it('calculates bunk allowance for 50/53 at 75% target', () => {
      const allowance = calculateBunkAllowance(50, 53, 75);
      expect(allowance).toBe(13);

      // Verify: 50 / (53 + 13) = 50 / 66 = 75.75% >= 75%
      expect((50 / (53 + 13)) * 100).toBeGreaterThanOrEqual(75);
      // Verify: 50 / (53 + 14) = 50 / 67 = 74.62% < 75%
      expect((50 / (53 + 14)) * 100).toBeLessThan(75);
    });

    it('calculates bunk allowance for 6/7 at 75% target', () => {
      const allowance = calculateBunkAllowance(6, 7, 75);
      expect(allowance).toBe(1);
      // 6 / (7 + 1) = 6/8 = 75%
      expect((6 / (7 + 1)) * 100).toBe(75);
    });

    it('returns 0 when already below target', () => {
      expect(calculateBunkAllowance(5, 10, 75)).toBe(0);
      expect(calculateBunkAllowance(70, 100, 75)).toBe(0);
    });

    it('calculates bunk allowance for different target thresholds (80, 85, 90)', () => {
      // 50/53 at 80% => (50 - 0.8 * 53) / 0.8 = (50 - 42.4) / 0.8 = 7.6 / 0.8 = 9
      expect(calculateBunkAllowance(50, 53, 80)).toBe(9);
      expect((50 / (53 + 9)) * 100).toBeGreaterThanOrEqual(80);

      // 50/53 at 85% => (50 - 0.85 * 53) / 0.85 = (50 - 45.05) / 0.85 = 4.95 / 0.85 = 5
      expect(calculateBunkAllowance(50, 53, 85)).toBe(5);

      // 50/53 at 90% => (50 - 0.9 * 53) / 0.9 = (50 - 47.7) / 0.9 = 2.3 / 0.9 = 2
      expect(calculateBunkAllowance(50, 53, 90)).toBe(2);
    });
  });

  describe('calculateRequiredClasses', () => {
    it('calculates required classes to recover to 75% from 5/7 (71.43%)', () => {
      const needed = calculateRequiredClasses(5, 7, 75);
      expect(needed).toBe(1);
      // (5 + 1) / (7 + 1) = 6/8 = 75%
      expect(((5 + needed) / (7 + needed)) * 100).toBeGreaterThanOrEqual(75);
    });

    it('calculates required classes to recover to 75% from 50/70 (71.43%)', () => {
      const needed = calculateRequiredClasses(50, 70, 75);
      expect(needed).toBe(10);
      // (50 + 10) / (70 + 10) = 60/80 = 75%
      expect(((50 + needed) / (70 + needed)) * 100).toBe(75);
      // 9 classes would be 59/79 = 74.68%
      expect(((50 + 9) / (70 + 9)) * 100).toBeLessThan(75);
    });

    it('returns 0 when already at or above target', () => {
      expect(calculateRequiredClasses(8, 10, 75)).toBe(0);
      expect(calculateRequiredClasses(10, 10, 75)).toBe(0);
    });
  });

  describe('getLowestAttendanceSubject', () => {
    it('returns course with lowest percentage', () => {
      const courses: AttendanceRecord[] = [
        { code: 'CSE329', name: 'A', attended: 7, total: 7, absent: 0, percentage: 100 },
        { code: 'CSE330', name: 'B', attended: 6, total: 7, absent: 1, percentage: 85.71 },
        { code: 'INT373', name: 'C', attended: 5, total: 7, absent: 2, percentage: 71.43 }
      ];

      const lowest = getLowestAttendanceSubject(courses);
      expect(lowest?.code).toBe('INT373');
      expect(lowest?.percentage).toBe(71.43);
    });
  });

  describe('evaluateAttendanceHealth', () => {
    it('returns safe status when comfortably above target', () => {
      const health = evaluateAttendanceHealth(90, 100, 75);
      expect(health.status).toBe('safe');
      expect(health.bunkAllowance).toBe(20);
    });

    it('returns danger status when significantly below target', () => {
      const health = evaluateAttendanceHealth(60, 100, 75);
      expect(health.status).toBe('danger');
      expect(health.requiredClasses).toBe(60);
    });
  });

  describe('validateAttendanceSummary', () => {
    it('validates a clean, mathematically sound attendance summary', () => {
      const courses: AttendanceRecord[] = [
        { code: 'CSE329', name: 'Coding', attended: 9, total: 9, absent: 0, percentage: 100 },
        { code: 'CSE330', name: 'Approaches', attended: 7, total: 8, absent: 1, percentage: 87.5 }
      ];
      const summary = calculateOverallAttendance(courses);
      const res = validateAttendanceSummary(summary);
      expect(res.valid).toBe(true);
      expect(res.issues).toHaveLength(0);
    });

    it('catches impossible negative or exceeding numbers', () => {
      const summary = calculateOverallAttendance([
        { code: 'CSE100', name: 'Broken', attended: 15, total: 10, absent: 0, percentage: 150 }
      ]);
      const res = validateAttendanceSummary(summary);
      expect(res.valid).toBe(false);
      expect(res.issues.length).toBeGreaterThan(0);
    });
  });

  describe('6-course verified UMS dataset', () => {
    it('verifies aggregate calculation and identifies CSE330 at 88% as lowest', () => {
      const courses: AttendanceRecord[] = [
        { code: 'CSE329', name: 'PRELUDE TO COMPETITIVE CODING', attended: 9, total: 9, absent: 0, percentage: 100 },
        { code: 'CSE330', name: 'COMPETITIVE CODING APPROACHES', attended: 7, total: 8, absent: 1, percentage: 88 },
        { code: 'CSE408', name: 'DESIGN AND ANALYSIS OF ALGORITHMS', attended: 14, total: 14, absent: 0, percentage: 100 },
        { code: 'CSE471', name: 'DEEP LEARNING FOR COMPUTER VISION', attended: 12, total: 12, absent: 0, percentage: 100 },
        { code: 'CSE472', name: 'DEEP LEARNING FOR NLP', attended: 14, total: 14, absent: 0, percentage: 100 },
        { code: 'INT373', name: 'AGILE DRIVEN DEVELOPMENT', attended: 11, total: 12, absent: 1, percentage: 92 }
      ];

      const summary = calculateOverallAttendance(courses);
      expect(summary.totalCourses).toBe(6);
      expect(summary.totalAttended).toBe(67);
      expect(summary.totalClasses).toBe(69);
      expect(summary.totalAbsent).toBe(2);
      expect(summary.overallPercentage).toBe(97.1);

      const lowest = getLowestAttendanceSubject(courses);
      expect(lowest).not.toBeNull();
      expect(lowest?.code).toBe('CSE330');
      expect(lowest?.percentage).toBe(88);
    });
  });
});
