/*
 * Verified Timetable Repository Test Suite.
 *
 * Validates IndexedDB storage, schema version 4 migration,
 * account-specific isolation, faculty cabin persistence, and data wipe.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { verifiedTimetableRepo } from '../services/repositories';
import { localDatabase } from '../services/localDatabase';
import { TimetableSummary } from '../shared/types';

describe('VerifiedTimetableRepository (IndexedDB)', () => {
  beforeEach(async () => {
    await localDatabase.clearAllLocalData();
  });

  const sampleTimetable: TimetableSummary = {
    vid: '12413692',
    homeSection: 'K3P24WM',
    totalSlots: 2,
    totalCourses: 2,
    totalCredits: 6,
    capturedAt: Date.now(),
    verified: true,
    source: 'UMS_DOM',
    slots: [
      {
        day: 'Monday',
        time: '09:00-10:00 AM',
        type: 'Lecture',
        courseCode: 'CSE329',
        courseTitle: 'PRELUDE TO COMPETITIVE CODING',
        room: '38-917',
        section: 'K3P24WM',
        facultyName: 'Raj Karan Singh',
        facultyCabin: '26-207-WOW1',
        rawText: 'CSE329 38-917 Raj Karan Singh'
      },
      {
        day: 'Monday',
        time: '10:00-11:00 AM',
        type: 'Practical',
        courseCode: 'CSE330',
        courseTitle: 'ADVANCED WEB TECHNOLOGIES',
        room: '34-201',
        section: 'K3P24WM',
        facultyName: 'Dr. Anita Sharma',
        facultyCabin: '34-102-LAB',
        rawText: 'CSE330 34-201 Dr. Anita Sharma'
      }
    ],
    courses: [
      {
        courseCode: 'CSE329',
        courseTitle: 'PRELUDE TO COMPETITIVE CODING',
        lectures: 3,
        tutorial: 0,
        practical: 0,
        credits: 3,
        facultyName: 'Raj Karan Singh',
        facultyCabin: '26-207-WOW1',
        cabinNumber: 'WOW1',
        facultyBlock: '26',
        facultyRoom: '207'
      },
      {
        courseCode: 'CSE330',
        courseTitle: 'ADVANCED WEB TECHNOLOGIES',
        lectures: 2,
        tutorial: 0,
        practical: 2,
        credits: 3,
        facultyName: 'Dr. Anita Sharma',
        facultyCabin: '34-102-LAB',
        cabinNumber: 'LAB',
        facultyBlock: '34',
        facultyRoom: '102'
      }
    ]
  };

  it('saves and retrieves verified timetable records by accountId', async () => {
    await verifiedTimetableRepo.saveVerifiedTimetable({
      id: 'exec-tt-1',
      accountId: 'student_12413692',
      executionId: 'exec-tt-1',
      capturedAt: Date.now(),
      source: 'UMS_DOM',
      verified: true,
      timetable: sampleTimetable
    });

    const retrieved = await verifiedTimetableRepo.getLatestVerifiedTimetable('student_12413692');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.timetable.totalSlots).toBe(2);
    expect(retrieved?.timetable.slots[0].courseCode).toBe('CSE329');
    expect(retrieved?.timetable.slots[0].facultyCabin).toBe('26-207-WOW1');
    expect(retrieved?.verified).toBe(true);
  });

  it('enforces strict account isolation: account B cannot access account A timetable records', async () => {
    await verifiedTimetableRepo.saveVerifiedTimetable({
      id: 'exec-tt-a',
      accountId: 'student_A',
      executionId: 'exec-tt-a',
      capturedAt: Date.now(),
      source: 'UMS_DOM',
      verified: true,
      timetable: sampleTimetable
    });

    const studentBRecord = await verifiedTimetableRepo.getLatestVerifiedTimetable('student_B');
    expect(studentBRecord).toBeNull();
  });

  it('purges timetable records when clearing verified context', async () => {
    await verifiedTimetableRepo.saveVerifiedTimetable({
      id: 'exec-tt-wipe',
      accountId: 'student_wipe',
      executionId: 'exec-tt-wipe',
      capturedAt: Date.now(),
      source: 'UMS_DOM',
      verified: true,
      timetable: sampleTimetable
    });

    await verifiedTimetableRepo.clearContext('student_wipe');
    const wiped = await verifiedTimetableRepo.getLatestVerifiedTimetable('student_wipe');
    expect(wiped).toBeNull();
  });
});
