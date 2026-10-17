/*
 * Intent Router & Cross-Domain Anaphoric Resolution Test Suite.
 *
 * Validates domain classification between Attendance and Examination,
 * course extraction, and cross-domain follow-ups.
 */

import { describe, it, expect } from 'vitest';
import {
  routeUserIntent,
  enforceCapabilityDomain,
  detectExplicitCapabilityDomain
} from '../services/intentRouter';
import { AttendanceSummary, ExaminationSummary } from '../shared/types';

describe('intentRouter', () => {
  const sampleAttendance: AttendanceSummary = {
    courses: [
      { code: 'CSE329', name: 'Cloud Computing', attended: 10, total: 10, absent: 0, percentage: 100 },
      { code: 'CSE330', name: 'Web Technologies', attended: 6, total: 10, absent: 4, percentage: 60 },
      { code: 'CSE408', name: 'Algorithms', attended: 8, total: 10, absent: 2, percentage: 80 }
    ],
    overallPercentage: 80,
    totalAttended: 24,
    totalDelivered: 30,
    totalCourses: 3,
    status: 'verified',
    source: 'live-ums-dom'
  };

  const sampleExamination: ExaminationSummary = {
    totalExams: 3,
    exams: [
      { courseCode: 'CSE329', examDate: '15-Oct-2029', startTime: '09:00 AM', venue: 'Block 34', room: '301', seat: 'A-1' },
      { courseCode: 'CSE330', examDate: '18-Oct-2029', startTime: '01:30 PM', venue: 'Block 34', room: '302', seat: 'B-2' },
      { courseCode: 'CSE408', examDate: '22-Oct-2029', startTime: '09:00 AM', venue: 'Block 36', room: '105', seat: 'C-3' }
    ],
    capturedAt: Date.now()
  };

  describe('Direct Intent Classification', () => {
    it('classifies next exam queries as EXAM_DATE_SHEET', () => {
      const result = routeUserIntent('When is my next exam?');
      expect(result.capability).toBe('EXAM_DATE_SHEET');
      expect(result.subType).toBe('next_exam');
    });

    it('classifies date sheet requests as EXAM_DATE_SHEET', () => {
      const result = routeUserIntent('Open my date sheet from Important Links');
      expect(result.capability).toBe('EXAM_DATE_SHEET');
      expect(result.subType).toBe('all_exams');
    });

    it('classifies "how many atom exams do I have in term exams" as EXAM_DATE_SHEET all_exams', () => {
      const result = routeUserIntent('can you tell me how many atom exams do I have in term exams');
      expect(result.capability).toBe('EXAM_DATE_SHEET');
      expect(result.subType).toBe('all_exams');
    });

    it('classifies "how many term exams do I have" as EXAM_DATE_SHEET all_exams', () => {
      const result = routeUserIntent('how many term exams do I have');
      expect(result.capability).toBe('EXAM_DATE_SHEET');
      expect(result.subType).toBe('all_exams');
    });

    it('classifies seating plan requests as SEATING_PLAN', () => {
      const result = routeUserIntent('Where is my seat and room for CSE329?');
      expect(result.capability).toBe('SEATING_PLAN');
      expect(result.targetCourseCode).toBe('CSE329');
    });

    it('classifies attendance bunk queries as ATTENDANCE', () => {
      const result = routeUserIntent('Can I bunk CSE329 tomorrow?');
      expect(result.capability).toBe('ATTENDANCE');
      expect(result.targetCourseCode).toBe('CSE329');
    });

    it('classifies lowest attendance queries as ATTENDANCE', () => {
      const result = routeUserIntent('Which subject has my lowest attendance?');
      expect(result.capability).toBe('ATTENDANCE');
      expect(result.subType).toBe('lowest_attendance');
    });
  });

  describe('Cross-Domain Follow-Up Resolution', () => {
    it('resolves lowest attendance course when asked "When is its exam?"', () => {
      const result = routeUserIntent('When is its exam?', {
        latestAttendance: sampleAttendance,
        latestExamination: sampleExamination
      });

      expect(result.capability).toBe('EXAM_DATE_SHEET');
      expect(result.targetCourseCode).toBe('CSE330'); // Lowest attendance is CSE330 (60%)
      expect(result.resolvedCourseCode).toBe('CSE330');
    });

    it('resolves lowest attendance course when asked "Where is my seat for that subject?"', () => {
      const result = routeUserIntent('Where is my seat for that subject?', {
        latestAttendance: sampleAttendance,
        latestExamination: sampleExamination
      });

      expect(result.capability).toBe('SEATING_PLAN');
      expect(result.targetCourseCode).toBe('CSE330');
      expect(result.resolvedCourseCode).toBe('CSE330');
    });

    it('resolves last mentioned subject code from previous turn', () => {
      const result = routeUserIntent('Where is my seat?', {
        lastMentionedCourse: 'CSE408',
        latestExamination: sampleExamination
      });

      expect(result.capability).toBe('SEATING_PLAN');
      expect(result.targetCourseCode).toBe('CSE408');
    });
  });

  describe('Sample Question Paper Intent', () => {
    it('routes "Fetch and open sample paper for CSE408" to SAMPLE_PAPER', () => {
      const result = routeUserIntent('Fetch and open sample paper for CSE408');
      expect(result.capability).toBe('SAMPLE_PAPER');
      expect(result.targetCourseCode).toBe('CSE408');
    });

    it('routes "Open sample paper for INT373" to SAMPLE_PAPER', () => {
      const result = routeUserIntent('Open sample paper for INT373');
      expect(result.capability).toBe('SAMPLE_PAPER');
      expect(result.targetCourseCode).toBe('INT373');
    });

    it('resolves next exam course for "Show sample paper for next exam"', () => {
      const result = routeUserIntent('Show sample paper for next exam', {
        latestExamination: sampleExamination
      });
      expect(result.capability).toBe('SAMPLE_PAPER');
      expect(result.targetCourseCode).toBe('CSE329');
    });
  });

  describe('Timetable & Faculty Directory Intent', () => {
    it('routes "View Time Table" to TIMETABLE capability', () => {
      const result = routeUserIntent('View Time Table');
      expect(result.capability).toBe('TIMETABLE');
      expect(result.subType).toBe('timetable_full');
    });

    it('routes "What classes do I have today?" to TIMETABLE today_classes', () => {
      const result = routeUserIntent('What classes do I have today?');
      expect(result.capability).toBe('TIMETABLE');
      expect(result.subType).toBe('timetable_today');
    });

    it('routes "Where is the faculty cabin for Tejinder Thind in CSE408?" to TIMETABLE faculty_details', () => {
      const result = routeUserIntent('Where is the faculty cabin for Tejinder Thind in CSE408?');
      expect(result.capability).toBe('TIMETABLE');
      expect(result.subType).toBe('faculty_details');
      expect(result.targetCourseCode).toBe('CSE408');
    });

    it('routes "Show my timetable schedule and teacher rooms" to TIMETABLE', () => {
      const result = routeUserIntent('Show my timetable schedule and teacher rooms');
      expect(result.capability).toBe('TIMETABLE');
    });
  });

  describe('Conversational Continuity & Numeric Follow-ups', () => {
    it('resolves "what about 5" to previous course CSE329 from recent user queries', () => {
      const result = routeUserIntent('what about 5', {
        latestAttendance: sampleAttendance,
        recentUserQueries: ['what if i skip 4 classes in cse329?']
      });
      expect(result.capability).toBe('ATTENDANCE');
      expect(result.subType).toBe('specific_course');
      expect(result.targetCourseCode).toBe('CSE329');
    });

    it('resolves "what about 6?" to CSE408 when CSE408 was in previous query', () => {
      const result = routeUserIntent('what about 6?', {
        latestAttendance: sampleAttendance,
        recentUserQueries: ['can i bunk cse408?']
      });
      expect(result.capability).toBe('ATTENDANCE');
      expect(result.subType).toBe('specific_course');
      expect(result.targetCourseCode).toBe('CSE408');
    });

    it('resolves explicit course switch "what about CSE408?" correctly', () => {
      const result = routeUserIntent('what about CSE408?', {
        latestAttendance: sampleAttendance,
        recentUserQueries: ['can i bunk cse329?']
      });
      expect(result.capability).toBe('ATTENDANCE');
      expect(result.targetCourseCode).toBe('CSE408');
    });

    it('resolves "Can you tell me detailed or give me detailed matrix of all classes this week?" to TIMETABLE timetable_full', () => {
      const result = routeUserIntent('Can you tell me detailed or give me detailed matrix of all classes this week?', {
        recentUserQueries: ['what is my schedule on monday']
      });
      expect(result.capability).toBe('TIMETABLE');
      expect(result.subType).toBe('timetable_full');
    });

    it('resolves "Can you provide me a complete list of classes that I have in this week?" to TIMETABLE timetable_full', () => {
      const result = routeUserIntent('Can you provide me a complete list of classes that I have in this week?');
      expect(result.capability).toBe('TIMETABLE');
      expect(result.subType).toBe('timetable_full');
    });

    it('resolves "And what about Saturday?" in timetable context to TIMETABLE timetable_today', () => {
      const result = routeUserIntent('And what about Saturday?', {
        recentUserQueries: ['tell me my tuesday timetable']
      });
      expect(result.capability).toBe('TIMETABLE');
      expect(result.subType).toBe('timetable_today');
    });
  });

  /*
   * Regression coverage for the cross-domain misfire where an examination
   * date-sheet question was answered from the timetable dataset.
   */
  describe('Capability domain firewall', () => {
    it('detects the domain the student explicitly named', () => {
      expect(detectExplicitCapabilityDomain('Show my complete examination date sheet with reporting times')).toBe(
        'examination'
      );
      expect(detectExplicitCapabilityDomain('which subject has the lowest attendance')).toBe('attendance');
      expect(detectExplicitCapabilityDomain('How many can I miss in CSE330?')).toBe('attendance');
      expect(detectExplicitCapabilityDomain('show my timetable for tomorrow')).toBe('timetable');
      expect(detectExplicitCapabilityDomain('where is my seat for CSE408')).toBe('seating_plan');
      expect(detectExplicitCapabilityDomain('find the sample paper for CSE330')).toBe('sample_papers');
      expect(detectExplicitCapabilityDomain('thanks')).toBe(null);
    });

    it('corrects a timetable resolution for an examination date-sheet question', () => {
      const corrected = enforceCapabilityDomain(
        'timetable',
        'Show my complete examination date sheet with reporting times and syllabus overview.'
      );
      expect(corrected).toBe('examination');
    });

    it('corrects an examination resolution for an attendance question', () => {
      expect(enforceCapabilityDomain('examination', 'How many can I miss in CSE330?')).toBe('attendance');
    });

    it('keeps attendance clearances classified as attendance even when exams are mentioned', () => {
      expect(enforceCapabilityDomain('examination', 'am I eligible for exams?')).toBe('attendance');
    });

    it('never overrides identity or conversational resolutions', () => {
      expect(enforceCapabilityDomain('onee_identity', 'who are you')).toBe('onee_identity');
      expect(enforceCapabilityDomain('conversation', 'hello')).toBe('conversation');
    });

    it('leaves an already-correct resolution untouched', () => {
      expect(enforceCapabilityDomain('timetable', 'show my timetable for tomorrow')).toBe('timetable');
      expect(enforceCapabilityDomain('general', 'what is the capital of India')).toBe('general');
    });
  });
});

