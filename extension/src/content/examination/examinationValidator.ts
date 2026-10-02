/*
 * Examination Validator & Deterministic Schedule Engine for LPU UMS.
 *
 * Implements strict, mathematical and temporal validation of extracted exam schedules:
 * 1. Schema integrity: Check for malformed dates, impossible times, duplicate entries.
 * 2. Deterministic Next Exam Calculation: Parses exam timestamps, compares against
 *    now (current local time), and selects the nearest future exam.
 * 3. Chronological Upcoming Exams Ordering: Sorts exams by date and start time.
 * 4. Course-specific Query Lookup: Matches exact or partial course codes.
 */

import { ExamRecord, ExaminationSummary, ExaminationValidationResult } from '../../shared/types';

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
};

/**
 * Converts a normalized exam date string (e.g. "13 Sep 2026") and optional time (e.g. "14:00")
 * into a JavaScript Date object for accurate chronological comparison.
 */
export function parseExamDateTime(examDateStr: string, timeStr?: string): Date | null {
  if (!examDateStr) return null;

  let day = 0;
  let month = 0;
  let year = 0;

  // Format: "15-Oct-2026", "15 Oct 2026", "15-October-2026"
  const textMatch = examDateStr.match(/(\d{1,2})[\s\-]+([A-Za-z]{3,9})[\s\-]+(\d{4})/);
  if (textMatch) {
    day = parseInt(textMatch[1], 10);
    const mStr = textMatch[2].slice(0, 3).toLowerCase();
    month = MONTH_MAP[mStr] ?? 0;
    year = parseInt(textMatch[3], 10);
  } else {
    // Format: "13-09-2026" or "13/09/2026"
    const numMatch = examDateStr.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (numMatch) {
      day = parseInt(numMatch[1], 10);
      month = parseInt(numMatch[2], 10) - 1;
      year = parseInt(numMatch[3], 10);
    } else {
      // Format: "2026-09-13"
      const isoMatch = examDateStr.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
      if (isoMatch) {
        year = parseInt(isoMatch[1], 10);
        month = parseInt(isoMatch[2], 10) - 1;
        day = parseInt(isoMatch[3], 10);
      } else {
        return null;
      }
    }
  }

  let hours = 9; // Default morning slot if not specified
  let minutes = 0;

  if (timeStr) {
    const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?/);
    if (timeMatch) {
      hours = parseInt(timeMatch[1], 10);
      minutes = parseInt(timeMatch[2], 10);
      const meridian = timeMatch[3]?.toUpperCase();
      if (meridian === 'PM' && hours < 12) {
        hours += 12;
      } else if (meridian === 'AM' && hours === 12) {
        hours = 0;
      }
    }
  }

  return new Date(year, month, day, hours, minutes, 0, 0);
}

/**
 * Validates the full examination summary before accepting and persisting.
 */
export function validateExaminationSummary(summary: ExaminationSummary): ExaminationValidationResult {
  const issues: string[] = [];

  if (!summary.exams || summary.exams.length === 0) {
    return {
      valid: false,
      issues: ['No examinations parsed'],
      verifiedCount: 0
    };
  }

  const pageExpectedCount = summary.totalExams || 0;

  // Impossible state assertion: If UMS portal reports multiple exams (e.g. Total Exam 7),
  // but only 1 record was collected, this is an incomplete collection and must NOT be marked verified!
  if (summary.exams.length === 1 && pageExpectedCount > 1) {
    issues.push(
      `Impossible state: page indicates ${pageExpectedCount} total exams but only 1 exam record was collected (${summary.exams[0]?.courseCode || 'single record'}). Incomplete dataset rejected.`
    );
  }

  if (summary.totalExams !== undefined && summary.totalExams !== summary.exams.length) {
    issues.push(`Mismatch between totalExams (${summary.totalExams}) and exams.length (${summary.exams.length})`);
  }

  const seenKeys = new Set<string>();
  let validCount = 0;

  for (let i = 0; i < summary.exams.length; i++) {
    const exam = summary.exams[i];

    // 1. Course code check
    if (!exam.courseCode || !/^[A-Z]{2,5}\d{3,4}[A-Z]?$/i.test(exam.courseCode.trim())) {
      issues.push(`Exam at index ${i} has invalid course code: '${exam.courseCode}'`);
      continue;
    }

    // Duplicate check by composite key (courseCode + examDate + startTime + examType)
    // A course can have both Theory and Practical or Mid-Term and End-Term on different dates/times
    const normKey = `${exam.courseCode.toUpperCase()}_${exam.examDate}_${(exam.startTime || '').trim()}_${(exam.examType || '').trim()}`;
    if (seenKeys.has(normKey)) {
      issues.push(`Duplicate exam record for course: ${exam.courseCode} on ${exam.examDate}`);
      continue;
    }
    seenKeys.add(normKey);

    // 2. Date check
    if (!exam.examDate) {
      issues.push(`Exam ${exam.courseCode} has missing exam date.`);
      continue;
    }

    const parsedDate = parseExamDateTime(exam.examDate, exam.startTime);
    if (!parsedDate || isNaN(parsedDate.getTime())) {
      issues.push(`Unparseable exam date: '${exam.examDate}' for course ${exam.courseCode}`);
      continue;
    }

    // 3. Impossible time check (start time >= end time)
    if (exam.startTime && exam.endTime) {
      const dtStart = parseExamDateTime(exam.examDate, exam.startTime);
      const dtEnd = parseExamDateTime(exam.examDate, exam.endTime);
      if (dtStart && dtEnd && dtStart.getTime() >= dtEnd.getTime()) {
        issues.push(`Exam ${exam.courseCode} has impossible times: ${exam.startTime} to ${exam.endTime}`);
      }
    }

    validCount++;
  }

  return {
    valid: validCount > 0 && issues.length === 0,
    issues,
    verifiedCount: validCount,
    examsChecked: validCount
  };
}

/**
 * Diagnostic helper to detect data anomalies between extracted dataset and page metadata.
 */
export function getExaminationDatasetDiagnostics(summary?: ExaminationSummary | null): {
  verifiedExamCount: number;
  pageExpectedCount: number;
  hasImpossibleState: boolean;
} {
  const verifiedExamCount = summary?.exams?.length || 0;
  const pageExpectedCount = summary?.totalExams || 0;
  const hasImpossibleState = verifiedExamCount === 1 && pageExpectedCount > 1;
  return { verifiedExamCount, pageExpectedCount, hasImpossibleState };
}

/**
 * Deterministically finds the nearest future examination relative to referenceDate (default now).
 * If multiple exams occur on the same date, sorts by start time.
 * If all exams are in the past, returns null.
 */
export function getNextExam(exams: ExamRecord[], referenceDate: Date = new Date()): ExamRecord | null {
  if (!exams || exams.length === 0) return null;

  const refTime = referenceDate.getTime();

  // Filter exams that are strictly in the future (>= refTime)
  const futureExams = exams
    .map((exam) => ({
      exam,
      dt: parseExamDateTime(exam.examDate, exam.startTime)
    }))
    .filter((item): item is { exam: ExamRecord; dt: Date } => item.dt !== null && item.dt.getTime() >= refTime);

  if (futureExams.length > 0) {
    futureExams.sort((a, b) => a.dt.getTime() - b.dt.getTime());
    return futureExams[0].exam;
  }

  return null;
}

/**
 * Returns chronologically sorted list of all upcoming exams from referenceDate.
 */
export function getUpcomingExams(exams: ExamRecord[], referenceDate: Date = new Date()): ExamRecord[] {
  if (!exams || exams.length === 0) return [];

  const refTime = referenceDate.getTime();

  const parsed = exams
    .map((exam) => ({
      exam,
      dt: parseExamDateTime(exam.examDate, exam.startTime)
    }))
    .filter((item): item is { exam: ExamRecord; dt: Date } => item.dt !== null);

  const future = parsed.filter((item) => item.dt.getTime() >= refTime);
  future.sort((a, b) => a.dt.getTime() - b.dt.getTime());
  return future.map((item) => item.exam);
}

/**
 * Finds examination record for a specific course code (e.g. "CSE443").
 */
export function findExamByCourse(exams: ExamRecord[], courseCodeQuery: string): ExamRecord | undefined {
  if (!exams || !courseCodeQuery) return undefined;
  const cleanQuery = courseCodeQuery.toUpperCase().replace(/\s+/g, '');

  return (
    exams.find((e) => e.courseCode.toUpperCase().replace(/\s+/g, '') === cleanQuery) ||
    exams.find((e) => cleanQuery.includes(e.courseCode.toUpperCase().replace(/\s+/g, '')))
  );
}
