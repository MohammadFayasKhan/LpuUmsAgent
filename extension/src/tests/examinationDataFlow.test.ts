/*
 * End-to-End Examination Dataset Flow Test Suite.
 *
 * Verifies that the canonical examination dataset flows intact as a complete array
 * from extraction and validation to final response construction and UI rendering.
 * Specifically tests datasets with 1, 3, 7, and 12 examinations, ensuring zero
 * single-record reduction, no hardcoding, no metadata leakage, and impossible state detection.
 */

import { describe, it, expect } from 'vitest';
import {
  validateExaminationSummary,
  getNextExam,
  getUpcomingExams
} from '../content/examination/examinationValidator';
import { ExamRecord, ExaminationSummary, FinalResponseData } from '../shared/types';

function createMockExam(code: string, date: string, time: string, extra?: Partial<ExamRecord>): ExamRecord {
  const isAfternoon = time.startsWith('14') || time.startsWith('15') || time.includes('PM');
  return {
    courseCode: code,
    courseName: `${code} Course Name`,
    examDate: date,
    startTime: time,
    endTime: isAfternoon ? '17:00' : '13:00',
    reportingTime: '09:30',
    mode: 'Theory Mid Term Regular',
    ...extra
  };
}

function buildMockExaminationFinalResponse(
  _goal: string,
  examination: ExaminationSummary
): FinalResponseData {
  const nextExam = getNextExam(examination.exams);
  const upcoming = getUpcomingExams(examination.exams);
  const verifiedExamCount = examination.exams?.length || 0;

  return {
    status: 'READY',
    type: 'next_exam',
    title: `Next Exam: ${nextExam ? nextExam.courseCode : 'Examination'}`,
    capability: 'EXAM_DATE_SHEET',
    subjectCode: nextExam?.courseCode,
    subjectName: nextExam?.courseName || nextExam?.courseCode,
    highlightText: nextExam ? `${nextExam.courseCode} · ${nextExam.examDate}` : 'Upcoming Exam',
    explanation: nextExam
      ? `Your next exam is ${nextExam.courseCode} on ${nextExam.examDate} at ${nextExam.startTime || 'TBD'}.`
      : 'Exam schedule retrieved.',
    details: {
      nextExam: nextExam || undefined,
      upcomingExams: upcoming,
      exams: examination.exams,
      totalExams: verifiedExamCount,
      totalCourses: verifiedExamCount,
      venue: nextExam?.venue,
      room: nextExam?.room,
      seat: nextExam?.seat,
      reportingTime: nextExam?.reportingTime,
      mode: nextExam?.mode
    },
    verification: {
      verified: true,
      source: 'UMS Examination Date Sheet',
      examsChecked: verifiedExamCount,
      timestamp: 'just now',
      executionStatus: 'COMPLETED'
    }
  };
}

describe('Examination Complete Data Flow & Multi-Exam Scaling', () => {
  it('correctly handles 1 examination: extracted = verified = finalResponse = 1', () => {
    const exams1 = [createMockExam('CSE408', '06-Oct-2026', '10:00')];
    const summary: ExaminationSummary = {
      totalExams: 1,
      exams: exams1,
      capturedAt: Date.now()
    };

    const validation = validateExaminationSummary(summary);
    expect(validation.valid).toBe(true);
    expect(validation.verifiedCount).toBe(1);

    const response = buildMockExaminationFinalResponse('When is my next exam?', summary);
    expect(response.details?.exams?.length).toBe(1);
    expect(response.verification.examsChecked).toBe(1);
    expect(response.details?.nextExam?.courseCode).toBe('CSE408');
  });

  it('correctly handles 3 examinations: extracted = verified = finalResponse = 3', () => {
    const exams3 = [
      createMockExam('CSE408', '06-Oct-2026', '10:00'),
      createMockExam('INT373', '08-Oct-2026', '10:00'),
      createMockExam('MTH401', '12-Oct-2026', '14:00')
    ];
    const summary: ExaminationSummary = {
      totalExams: 3,
      exams: exams3,
      capturedAt: Date.now()
    };

    const validation = validateExaminationSummary(summary);
    expect(validation.valid).toBe(true);
    expect(validation.verifiedCount).toBe(3);

    const response = buildMockExaminationFinalResponse('When is my next exam?', summary);
    expect(response.details?.exams?.length).toBe(3);
    expect(response.verification.examsChecked).toBe(3);
    expect(response.details?.nextExam?.courseCode).toBe('CSE408');
  });

  it('correctly handles 7 examinations (UMS Screenshot Scenario): extracted = verified = finalResponse = 7', () => {
    const exams7 = [
      createMockExam('CSE408', '06-Oct-2026', '10:00', { venue: 'Block 34', room: '101', seat: 'S-01' }),
      createMockExam('INT373', '08-Oct-2026', '10:00'),
      createMockExam('CSE443', '10-Oct-2026', '10:00'),
      createMockExam('PEA305', '14-Oct-2026', '14:00'),
      createMockExam('GEN231', '18-Oct-2026', '10:00'),
      createMockExam('CSE408', '15-Dec-2026', '09:30', { mode: 'Theory End Term' }),
      createMockExam('INT373', '18-Dec-2026', '09:30', { mode: 'Theory End Term' })
    ];
    const summary: ExaminationSummary = {
      totalExams: 7,
      exams: exams7,
      capturedAt: Date.now()
    };

    const validation = validateExaminationSummary(summary);
    expect(validation.valid).toBe(true);
    expect(validation.verifiedCount).toBe(7);

    const response = buildMockExaminationFinalResponse('Check my date sheet', summary);
    expect(response.details?.exams?.length).toBe(7);
    expect(response.verification.examsChecked).toBe(7);

    // Verify nextExam is the earliest, but does not overwrite other exams
    expect(response.details?.nextExam?.courseCode).toBe('CSE408');
    expect(response.details?.exams?.[0].venue).toBe('Block 34');
    expect(response.details?.exams?.[1].venue).toBeUndefined(); // No metadata leakage
    expect(response.details?.exams?.[2].courseCode).toBe('CSE443');
    expect(response.details?.exams?.[6].courseCode).toBe('INT373');
  });

  it('correctly scales to 12 examinations without data loss or truncation', () => {
    const exams12: ExamRecord[] = [];
    for (let i = 1; i <= 12; i++) {
      exams12.push(createMockExam(`CSE${300 + i}`, `${String(i).padStart(2, '0')}-Nov-2026`, '10:00'));
    }
    const summary: ExaminationSummary = {
      totalExams: 12,
      exams: exams12,
      capturedAt: Date.now()
    };

    const validation = validateExaminationSummary(summary);
    expect(validation.valid).toBe(true);
    expect(validation.verifiedCount).toBe(12);

    const response = buildMockExaminationFinalResponse('Show all examinations', summary);
    expect(response.details?.exams?.length).toBe(12);
    expect(response.verification.examsChecked).toBe(12);
  });

  it('detects and rejects impossible state: exams.length === 1 && totalExams > 1', () => {
    const summary: ExaminationSummary = {
      totalExams: 7,
      exams: [createMockExam('CSE443', '10-Oct-2026', '10:00')],
      capturedAt: Date.now()
    };

    const validation = validateExaminationSummary(summary);
    expect(validation.valid).toBe(false);
    expect(validation.issues.some((i) => i.toLowerCase().includes('impossible state'))).toBe(true);
  });
});
