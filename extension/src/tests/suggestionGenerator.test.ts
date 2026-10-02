import { describe, it, expect } from 'vitest';
import { generateContextualSuggestions } from '../services/suggestionGenerator';
import { ExaminationSummary, AttendanceSummary, ExaminationRecord } from '../shared/types';

describe('suggestionGenerator', () => {
  const mockAttendance: AttendanceSummary = {
    totalCourses: 3,
    overallPercentage: 81.5,
    totalDelivered: 90,
    totalAttended: 73,
    courses: [
      {
        code: 'INT373',
        name: 'Database Technologies',
        attended: 20,
        delivered: 30,
        total: 30,
        percentage: 66.7,
        dutyLeave: 0
      },
      {
        code: 'CSE408',
        name: 'Software Testing',
        attended: 25,
        delivered: 30,
        total: 30,
        percentage: 83.3,
        dutyLeave: 0
      },
      {
        code: 'CSE471',
        name: 'Cloud Computing',
        attended: 28,
        delivered: 30,
        total: 30,
        percentage: 93.3,
        dutyLeave: 0
      }
    ]
  };

  const mockExam1: ExaminationRecord = {
    courseCode: 'CSE408',
    courseName: 'Software Testing',
    examDate: '06 Oct 2026',
    startTime: '10:00',
    endTime: '11:30',
    reportingTime: '09:30',
    venue: 'Block 34',
    room: '302',
    seat: 'B-14',
    examType: 'End Term',
    samplePaper: {
      available: true,
      href: 'https://ums.lpu.in/sample/CSE408.pdf'
    }
  };

  const mockExam2: ExaminationRecord = {
    courseCode: 'INT373',
    courseName: 'Database Technologies',
    examDate: '08 Oct 2026',
    startTime: '10:00',
    endTime: '11:30',
    reportingTime: '09:30',
    venue: 'Block 34',
    room: '303',
    seat: 'C-08',
    examType: 'End Term',
    samplePaper: {
      available: false
    }
  };

  const mockExamination: ExaminationSummary = {
    exams: [mockExam1, mockExam2],
    totalExams: 2,
    capturedAt: Date.now(),
    verified: true,
    source: 'UMS Examination Date Sheet'
  };

  it('generates dynamic suggestions for next exam and seating when examination is present', () => {
    const suggestions = generateContextualSuggestions(mockAttendance, 'Where is my exam?', mockExamination);
    expect(suggestions).toContain('Where is my seat for CSE408?');
    expect(suggestions).toContain('When should I report for CSE408?');
    expect(suggestions).toContain('Show the sample paper for CSE408');
  });

  it('does NOT suggest sample paper when samplePaper is unavailable or false', () => {
    const examWithoutSample: ExaminationSummary = {
      exams: [mockExam2], // INT373 with samplePaper.available = false
      totalExams: 1,
      capturedAt: Date.now(),
      verified: true,
      source: 'UMS Examination Date Sheet'
    };

    const suggestions = generateContextualSuggestions(null, 'Tell me about exams', examWithoutSample);
    expect(suggestions).toContain('Where is my seat for INT373?');
    expect(suggestions).not.toContain('Show the sample paper for INT373');
    expect(suggestions.some((s) => s.includes('sample paper'))).toBe(false);
  });

  it('works dynamically for different course codes without hardcoding', () => {
    const customExam: ExaminationSummary = {
      exams: [
        {
          courseCode: 'ECE213',
          courseName: 'Signals and Systems',
          examDate: '12 Nov 2026',
          startTime: '14:00',
          reportingTime: '13:30',
          venue: 'Block 38',
          room: '101',
          seat: 'A-01'
        }
      ],
      totalExams: 1,
      capturedAt: Date.now(),
      verified: true,
      source: 'UMS Examination Date Sheet'
    };

    const suggestions = generateContextualSuggestions(null, null, customExam);
    expect(suggestions).toContain('Where is my seat for ECE213?');
    expect(suggestions).toContain('What is the next exam?');
    expect(suggestions.some((s) => s.includes('CSE408'))).toBe(false);
  });

  it('provides fallback defaults when neither attendance nor examination is verified', () => {
    const suggestions = generateContextualSuggestions(null, null, null);
    expect(suggestions).toContain('Check my attendance');
    expect(suggestions).toContain('When is my next exam?');
    expect(suggestions).toContain('Show my date sheet');
  });

  it('suggests "Fetch and open sample paper" sub-action when sample paper is available on exam schedule', () => {
    const suggestions = generateContextualSuggestions(null, 'Check my date sheet', mockExamination);
    expect(suggestions.some((s) => s.includes('Fetch and open sample paper for CSE408') || s.includes('Show the sample paper for CSE408'))).toBe(true);
  });

  it('qualifies sample paper suggestions with exam type when upcoming exam has no paper but later exam does', () => {
    const multiTermExams: ExaminationSummary = {
      exams: [
        {
          courseCode: 'CSE408',
          courseName: 'Software Testing',
          examDate: '06 Oct 2026',
          startTime: '10:00',
          examType: 'Mid Term Regular'
          // no sample paper
        },
        {
          courseCode: 'INT373',
          courseName: 'Database Technologies',
          examDate: '08 Oct 2026',
          startTime: '10:00',
          examType: 'Mid Term Regular'
          // no sample paper
        },
        {
          courseCode: 'CSE408',
          courseName: 'Software Testing',
          examDate: '15 Dec 2026',
          startTime: '09:30',
          examType: 'End Term Regular',
          samplePaper: {
            available: true,
            label: 'Sample Question Paper'
          }
        }
      ],
      totalExams: 3,
      capturedAt: Date.now(),
      verified: true
    };

    const suggestions = generateContextualSuggestions(null, 'When is my exam?', multiTermExams);
    // Should NOT falsely suggest unqualified sample paper for the upcoming 06 Oct exam
    expect(suggestions).not.toContain('Show the sample paper for CSE408');
    expect(suggestions).not.toContain('Fetch and open sample paper for CSE408');
    // Should qualify with the specific term that actually has the paper
    expect(suggestions.some((s) => s.includes('CSE408 (End Term Regular)'))).toBe(true);
  });
});
