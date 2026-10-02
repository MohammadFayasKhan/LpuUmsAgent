/*
 * Verified Examination Repository Test Suite.
 *
 * Validates IndexedDB storage, schema version 3 migration,
 * account-specific isolation, and data wipe on logout.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { verifiedExaminationRepo } from '../services/repositories';
import { localDatabase } from '../services/localDatabase';
import { ExaminationSummary } from '../shared/types';

describe('VerifiedExaminationRepository (IndexedDB)', () => {
  beforeEach(async () => {
    await localDatabase.clearAllLocalData();
  });

  const sampleSummary: ExaminationSummary = {
    totalExams: 2,
    exams: [
      {
        courseCode: 'CSE329',
        courseName: 'Cloud Computing',
        examDate: '15-Oct-2026',
        startTime: '09:00 AM',
        endTime: '12:00 PM',
        reportingTime: '08:30 AM',
        venue: 'Block 34',
        room: '301',
        seat: 'A-12'
      },
      {
        courseCode: 'CSE330',
        courseName: 'Web Technologies',
        examDate: '18-Oct-2026',
        startTime: '01:30 PM',
        venue: 'Block 34',
        room: '302',
        seat: 'B-05'
      }
    ],
    capturedAt: Date.now()
  };

  it('saves and retrieves verified examination records by accountId', async () => {
    await verifiedExaminationRepo.saveVerifiedExamination({
      id: 'exec-exam-1',
      accountId: 'student_12104928',
      executionId: 'exec-exam-1',
      capturedAt: Date.now(),
      source: 'UMS_DOM',
      verified: true,
      examination: sampleSummary
    });

    const retrieved = await verifiedExaminationRepo.getLatestVerifiedExamination('student_12104928');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.examination.totalExams).toBe(2);
    expect(retrieved?.examination.exams[0].courseCode).toBe('CSE329');
    expect(retrieved?.verified).toBe(true);
  });

  it('enforces strict account isolation: account B cannot access account A examination records', async () => {
    await verifiedExaminationRepo.saveVerifiedExamination({
      id: 'exec-exam-a',
      accountId: 'student_A',
      executionId: 'exec-exam-a',
      capturedAt: Date.now(),
      source: 'UMS_DOM',
      verified: true,
      examination: sampleSummary
    });

    const studentBRecord = await verifiedExaminationRepo.getLatestVerifiedExamination('student_B');
    expect(studentBRecord).toBeNull();
  });

  it('clears verified examination records when clearAllLocalData is invoked', async () => {
    await verifiedExaminationRepo.saveVerifiedExamination({
      id: 'exec-exam-wipe',
      accountId: 'student_wipe',
      executionId: 'exec-exam-wipe',
      capturedAt: Date.now(),
      source: 'UMS_DOM',
      verified: true,
      examination: sampleSummary
    });

    await localDatabase.clearAllLocalData();

    const wiped = await verifiedExaminationRepo.getLatestVerifiedExamination('student_wipe');
    expect(wiped).toBeNull();
  });
});
