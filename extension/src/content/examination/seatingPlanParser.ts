/*
 * Deterministic Seating Plan Parser for LPU UMS.
 *
 * Dedicated parser for examination seating allocation interfaces, especially on:
 * https://studentums.lpu.in/dashboard/examination/conduct/seatingplan
 *
 * Extracts:
 * - courseCode
 * - examDate
 * - startTime, endTime, reportingTime
 * - venue, building, room
 * - seat / seat number
 * - examination mode (e.g. Online Exam, Offline)
 */

import { ExamRecord } from '../../shared/types';
import { parseExamDateSheet } from './examDateSheetParser';
import { extractStudentProfile } from '../umsDetector';

export interface SeatingPlanRecord extends ExamRecord {
  hasSeatAllocated: boolean;
}

export interface SeatingPlanSummary {
  seatingPlans: SeatingPlanRecord[];
  totalAllocations: number;
  studentName?: string;
  registrationNumber?: string;
  capturedAt: number;
  verified: boolean;
  source: string;
}

/**
 * Parses seating plan allocations from the live UMS DOM.
 */
export function parseSeatingPlan(doc: Document = document): SeatingPlanSummary | null {
  const profile = extractStudentProfile(doc);
  const examSummary = parseExamDateSheet(doc);

  if (!examSummary || examSummary.exams.length === 0) {
    return null;
  }

  const seatingPlans: SeatingPlanRecord[] = examSummary.exams.map((exam) => {
    const hasSeatAllocated = Boolean(exam.seat || exam.room || exam.venue);
    return {
      ...exam,
      hasSeatAllocated
    };
  });

  return {
    seatingPlans,
    totalAllocations: seatingPlans.length,
    studentName: profile.studentName,
    registrationNumber: profile.registrationNumber,
    capturedAt: Date.now(),
    verified: true,
    source: 'UMS_DOM'
  };
}
