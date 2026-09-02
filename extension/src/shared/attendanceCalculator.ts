/*
 * Deterministic Attendance & Safe-Bunk Calculator.
 *
 * We never let an LLM do attendance arithmetic. Language models often make simple
 * off-by-one errors or hallucinate how many lectures a student can skip.
 *
 * All formulas here are strictly algebraic:
 * 1. Safe Skips (Bunk Allowance):
 *    If attendance >= target (default 75%):
 *    attended / (total + x) >= target
 *    x <= floor((attended - target * total) / target)
 *
 * 2. Required Classes to Recover:
 *    If attendance < target:
 *    (attended + x) / (total + x) >= target
 *    x >= ceil((target * total - attended) / (1 - target))
 *
 * Both the side panel UI cards and the conversational chat engine share these
 * identical functions so numbers are always 100% consistent.
 */

import { AttendanceRecord, AttendanceSummary, BunkCalculationResult } from './types';

/**
 * Calculates aggregate attendance summary across all courses using exact weighted totals.
 * Aggregate percentage = (totalAttended / totalClasses) * 100.
 * If totalClasses is 0 (e.g. only percentages present on dashboard cards),
 * computes average of reported percentages across courses.
 */
export function calculateOverallAttendance(
  courses: AttendanceRecord[],
  studentName?: string,
  registrationNumber?: string
): AttendanceSummary {
  let totalAttended = 0;
  let totalClasses = 0;
  let totalAbsent = 0;
  let sumPercentages = 0;

  for (const course of courses) {
    totalAttended += course.attended;
    totalClasses += course.total;
    totalAbsent += course.absent ?? Math.max(0, course.total - course.attended);
    sumPercentages += course.percentage;
  }

  const overallPercentage =
    totalClasses > 0
      ? Number(((totalAttended / totalClasses) * 100).toFixed(2))
      : courses.length > 0
      ? Number((sumPercentages / courses.length).toFixed(2))
      : 0;

  return {
    status: 'verified',
    source: 'live-ums-dom',
    studentName,
    registrationNumber,
    totalCourses: courses.length,
    totalClasses,
    totalDelivered: totalClasses,
    totalAttended,
    totalAbsent,
    overallPercentage,
    courses,
    extractedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Multi-pass mathematical validator for extracted attendance records.
 * Ensures data integrity across total delivered, attended, absent, and percentages.
 */
export function validateAttendanceSummary(summary: AttendanceSummary): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  if (!summary.courses || summary.courses.length === 0) {
    issues.push('No course records extracted.');
    return { valid: false, issues };
  }

  if (summary.overallPercentage < 0 || summary.overallPercentage > 100) {
    issues.push(`Invalid overall percentage: ${summary.overallPercentage}%`);
  }

  for (const course of summary.courses) {
    if (course.attended < 0 || course.total < 0 || course.percentage < 0) {
      issues.push(`Course ${course.code} contains negative values.`);
    }

    if (course.total > 0 && course.attended > course.total + (course.dutyLeave || 0)) {
      issues.push(`Course ${course.code} attended (${course.attended}) exceeds total delivered (${course.total}).`);
    }

    if (course.total > 0) {
      const effectiveAttended = course.attended + (course.dutyLeave || 0);
      const mathPct = (effectiveAttended / course.total) * 100;
      if (Math.abs(mathPct - course.percentage) > 3.0 && course.percentage > 0) {
        issues.push(`Course ${course.code} percentage mismatch: calculated ${mathPct.toFixed(1)}% vs reported ${course.percentage}%.`);
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

/**
 * Calculates the maximum number of classes a student can skip without dropping below target percentage.
 * Formula: A / (C + x) >= T  =>  x <= (A - T * C) / T = floor((100 * A - T_pct * C) / T_pct)
 */
export function calculateBunkAllowance(
  attended: number,
  total: number,
  targetPercentage: number = 75,
  _reportedPercentage?: number
): number {
  if (total <= 0 || targetPercentage <= 0) {
    return 0;
  }
  const currentPct = (attended / total) * 100;
  if (currentPct < targetPercentage) return 0;

  const target = targetPercentage / 100;
  const maxSkippable = Math.floor((attended - target * total) / target);
  return Math.max(0, maxSkippable);
}

/**
 * Calculates the minimum number of consecutive future classes a student must attend to reach target percentage.
 * Formula: (A + x) / (C + x) >= T  =>  x >= (T * C - A) / (1 - T) = ceil((T_pct * C - 100 * A) / (100 - T_pct))
 */
export function calculateRequiredClasses(
  attended: number,
  total: number,
  targetPercentage: number = 75,
  _reportedPercentage?: number
): number {
  if (total <= 0) {
    return 0;
  }
  if (targetPercentage >= 100) {
    if (attended < total) return Infinity;
    return 0;
  }

  const currentPct = (attended / total) * 100;
  if (currentPct >= targetPercentage) return 0;

  const target = targetPercentage / 100;
  const needed = Math.ceil((target * total - attended) / (1 - target));
  return Math.max(0, needed);
}

/**
 * Evaluates attendance health against a target threshold.
 */
export function evaluateAttendanceHealth(
  attended: number,
  total: number,
  targetPercentage: number = 75,
  reportedPercentage?: number
): BunkCalculationResult {
  const currentPercentage =
    total > 0
      ? Number(((attended / total) * 100).toFixed(2))
      : reportedPercentage ?? 0;
  const bunkAllowance = calculateBunkAllowance(attended, total, targetPercentage, reportedPercentage);
  const requiredClasses = calculateRequiredClasses(
    attended,
    total,
    targetPercentage,
    reportedPercentage
  );

  let status: 'safe' | 'warning' | 'danger' = 'safe';
  if (currentPercentage < targetPercentage) {
    status = currentPercentage < targetPercentage - 5 ? 'danger' : 'warning';
  } else if (currentPercentage < targetPercentage + 3) {
    status = 'warning';
  }

  return {
    targetPercentage,
    currentPercentage,
    bunkAllowance,
    requiredClasses,
    status
  };
}

/**
 * Finds the course with the lowest attendance percentage.
 */
export function getLowestAttendanceSubject(
  courses: AttendanceRecord[]
): AttendanceRecord | null {
  if (!courses || courses.length === 0) return null;
  let lowest = courses[0];
  for (let i = 1; i < courses.length; i++) {
    if (courses[i].percentage < lowest.percentage) {
      lowest = courses[i];
    }
  }
  return lowest;
}
