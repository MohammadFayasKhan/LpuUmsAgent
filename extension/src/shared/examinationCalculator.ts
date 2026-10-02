/*
 * Deterministic Examination Calculator & Date Sheet Utilities for ONEE.
 *
 * Why this is calculated deterministically instead of by an LLM:
 * When a student asks "When is my next exam?", an LLM reading raw card text can easily
 * pick the first card in the prompt, confuse a mid-term with an end-term, or misread
 * "13 Sep 2026 14:00" against the current system clock.
 *
 * We parse every date, time window, and course code into exact timestamps, sort them
 * chronologically, and evaluate future eligibility against the system clock.
 * If an exam is currently active today, we flag it explicitly rather than silently skipping it.
 */

import { ExamRecord } from './types';

const MONTH_MAP: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11
};

/**
 * Parses an LPU UMS date string (e.g. "13 Sep 2026", "06 Oct 2026", "2026-09-13")
 * combined with a start time string (e.g. "14:00", "09:30", "10:00-11:30")
 * into a valid UTC/local JavaScript Date object.
 */
export function parseExamDateTime(dateStr: string | null | undefined, timeStr: string | null | undefined): Date | null {
  if (!dateStr) return null;

  const cleanDate = dateStr.trim();
  let year: number | null = null;
  let month: number | null = null;
  let day: number | null = null;

  // Pattern 1: "13 Sep 2026" or "6 Oct 2026" or "13-Sep-2026"
  const dmyMatch = cleanDate.match(/^(\d{1,2})[\s\-]+([A-Za-z]{3,9})[\s\-]+(\d{4})/);
  if (dmyMatch) {
    day = parseInt(dmyMatch[1], 10);
    const mStr = dmyMatch[2].slice(0, 3).toLowerCase();
    month = MONTH_MAP[mStr] ?? null;
    year = parseInt(dmyMatch[3], 10);
  } else {
    // Pattern 2: ISO format "YYYY-MM-DD"
    const isoMatch = cleanDate.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (isoMatch) {
      year = parseInt(isoMatch[1], 10);
      month = parseInt(isoMatch[2], 10) - 1;
      day = parseInt(isoMatch[3], 10);
    } else {
      // Pattern 3: "DD-MM-YYYY"
      const numMatch = cleanDate.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
      if (numMatch) {
        day = parseInt(numMatch[1], 10);
        month = parseInt(numMatch[2], 10) - 1;
        year = parseInt(numMatch[3], 10);
      }
    }
  }

  if (year === null || month === null || day === null) {
    const fallback = new Date(cleanDate);
    if (!isNaN(fallback.getTime())) {
      year = fallback.getFullYear();
      month = fallback.getMonth();
      day = fallback.getDate();
    } else {
      return null;
    }
  }

  // Parse hours and minutes from time string (e.g. "14:00-17:00" or "09:30" or "02:00 PM")
  let hours = 9;
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

  const result = new Date(year, month, day, hours, minutes, 0, 0);
  return isNaN(result.getTime()) ? null : result;
}

/**
 * Builds a deterministic composite key for deduplicating examination records.
 * In UMS, the same course (e.g. INT373) can have both a Practical and a Theory exam,
 * or a Mid-Term and an End-Term exam. Hence courseCode alone is NOT a unique identity.
 * We combine: courseCode + examDate + startTime + examType
 */
export function buildExamIdentity(record: Partial<ExamRecord>): string {
  const code = (record.courseCode || '').replace(/\s+/g, '').toUpperCase();
  const date = (record.examDate || '').replace(/\s+/g, '').toLowerCase();
  const time = (record.startTime || '').replace(/\s+/g, '').toLowerCase();
  const type = (record.examType || '').replace(/\s+/g, '').toLowerCase();
  return `${code}_${date}_${time}_${type}`;
}

/**
 * Deduplicates examination records so that multiple observations or scroll passes
 * never insert duplicate cards into the final verified list.
 */
export function deduplicateExams<T extends ExamRecord = ExamRecord>(records: T[]): T[] {
  const seen = new Map<string, T>();

  for (const rec of records) {
    const key = buildExamIdentity(rec) || rec.id || `${rec.courseCode}_${rec.examDate}`;
    if (!seen.has(key)) {
      seen.set(key, rec);
    } else {
      // Merge richer fields (venue, room, seat, samplePaper, instructions)
      const existing = seen.get(key)!;
      seen.set(key, {
        ...existing,
        courseName: existing.courseName || rec.courseName,
        venue: existing.venue || rec.venue,
        building: existing.building || rec.building,
        room: existing.room || rec.room,
        seat: existing.seat || rec.seat,
        instructions: existing.instructions || rec.instructions,
        samplePaper: existing.samplePaper || rec.samplePaper,
        mode: existing.mode || rec.mode,
        status: existing.status || rec.status
      });
    }
  }

  return Array.from(seen.values());
}

/**
 * Sorts examination records chronologically from earliest to latest.
 */
export function sortExamsChronologically<T extends ExamRecord = ExamRecord>(records: T[]): T[] {
  return [...records].sort((a, b) => {
    const dateA = parseExamDateTime(a.examDate, a.startTime);
    const dateB = parseExamDateTime(b.examDate, b.startTime);

    if (dateA && dateB) {
      return dateA.getTime() - dateB.getTime();
    }
    if (dateA) return -1;
    if (dateB) return 1;
    return a.courseCode.localeCompare(b.courseCode);
  });
}

/**
 * Deterministically determines the next upcoming exam for the student.
 *
 * Logic:
 * 1. Evaluate all records with valid dates against referenceDate (default: now).
 * 2. If an exam is scheduled for today and end-time has not passed, that is the primary next exam.
 * 3. Otherwise, pick the earliest future exam chronologically.
 * 4. If all exams in the date sheet are in the past, return null.
 */
export function findNextExam<T extends ExamRecord = ExamRecord>(
  records: T[],
  referenceDate: Date = new Date()
): T | null {
  if (!records || records.length === 0) return null;

  const sorted = sortExamsChronologically(records);
  const now = referenceDate.getTime();

  for (const exam of sorted) {
    const examStart = parseExamDateTime(exam.examDate, exam.startTime);
    const examEnd = parseExamDateTime(exam.examDate, exam.endTime || exam.startTime);

    if (examEnd && examEnd.getTime() >= now) {
      return exam;
    }
    if (examStart && examStart.getTime() >= now) {
      return exam;
    }
    if (exam.status?.toLowerCase() === 'today') {
      return exam;
    }
  }

  // If all parsed dates appear in past or couldn't be parsed, fallback to first upcoming status
  const upcoming = sorted.find((e) => e.status?.toLowerCase() === 'upcoming');
  return upcoming || null;
}

/**
 * Validates the parsed examination dataset before marking it verified.
 * Ensures course codes match LPU standards and records are structurally intact.
 */
export function validateExaminationDataset<T extends ExamRecord = ExamRecord>(records: T[]): {
  valid: boolean;
  validRecords: T[];
  verifiedCount: number;
  issues: string[];
} {
  const issues: string[] = [];
  const validRecords: T[] = [];

  if (!records || records.length === 0) {
    return {
      valid: false,
      validRecords: [],
      verifiedCount: 0,
      issues: ['No examination records found on page.']
    };
  }

  for (const rec of records) {
    if (!rec.courseCode || rec.courseCode.trim().length < 3) {
      issues.push(`Invalid course code in record: ${JSON.stringify(rec)}`);
      continue;
    }

    if (!rec.examDate || rec.examDate.trim().length === 0) {
      issues.push(`Missing exam date for ${rec.courseCode}`);
      continue;
    }

    validRecords.push(rec);
  }

  return {
    valid: issues.length === 0 && validRecords.length > 0,
    validRecords,
    verifiedCount: validRecords.length,
    issues
  };
}

/**
 * Condenses verbose or redundant exam types (e.g. "Theory Mid Term - All Subjective",
 * "Practical End Term Regular", "Mid Term Regular") into concise pill tags
 * like "Theory", "Mid Term", "Practical", or "End Term".
 * Prevents horizontal layout overflow and redundant duplication when courseName
 * already displays the full text.
 */
export function getShortExamTypeTag(examType?: string, courseName?: string): string | null {
  if (!examType) return null;
  const t = examType.trim();
  if (!t) return null;
  const lower = t.toLowerCase();

  // If the examType is identical to the courseName, avoid repeating the whole sentence
  if (courseName && t.toLowerCase() === courseName.trim().toLowerCase()) {
    if (lower.includes('practical')) return 'Practical';
    if (lower.includes('mid term') || lower.includes('midterm') || lower.includes('mid-term')) return 'Mid Term';
    if (lower.includes('end term') || lower.includes('endterm') || lower.includes('end-term')) return 'End Term';
    if (lower.includes('theory')) return 'Theory';
    return null;
  }

  // Common keywords prioritized
  if (lower.includes('practical')) return 'Practical';
  if (lower.includes('mid term') || lower.includes('midterm') || lower.includes('mid-term')) return 'Mid Term';
  if (lower.includes('end term') || lower.includes('endterm') || lower.includes('end-term')) return 'End Term';
  if (lower.includes('theory')) return 'Theory';

  // Fallback for short custom exam types (e.g. "Viva", "Quiz", "Oral")
  if (t.length > 12) {
    return t.slice(0, 10) + '…';
  }
  return t;
}

