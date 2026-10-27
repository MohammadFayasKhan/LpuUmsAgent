import { describe, it, expect } from 'vitest';
import { generateElaboratedVoiceSummary } from '../../voice/ElaboratedVoiceSummary';
import { TimetableSummary, AttendanceSummary, ExaminationSummary } from '../../shared/types';

describe('ElaboratedVoiceSummary', () => {
  it('generates a complete, elaborated timetable summary for a specific day', () => {
    const timetable = {
      vid: '12345678',
      homeSection: 'K22EN',
      totalSlots: 3,
      totalCourses: 3,
      totalCredits: 9,
      slots: [
        {
          id: 'slot-1',
          day: 'Monday',
          time: '09:00 - 10:00',
          type: 'Lecture',
          courseCode: 'CSE205',
          courseTitle: 'PRELUDE TO COMPETITIVE CODING',
          room: '34-201',
          rawText: 'Lecture / CSE205 / 34-201'
        },
        {
          id: 'slot-2',
          day: 'Monday',
          time: '10:00 - 11:00',
          type: 'Lecture',
          courseCode: 'INT306',
          courseTitle: 'COMPETITIVE CODING APPROACHES-TECHNIQUES',
          room: '36-402',
          rawText: 'Lecture / INT306 / 36-402'
        },
        {
          id: 'slot-3',
          day: 'Monday',
          time: '01:00 - 03:00',
          type: 'Practical',
          courseCode: 'CSE316',
          courseTitle: 'DESIGN AND ANALYSIS OF ALGORITHMS',
          room: '38-605',
          rawText: 'Practical / CSE316 / 38-605'
        }
      ],
      courses: []
    } as unknown as TimetableSummary;

    const fullMarkdown = `### 📅 Verified Schedule for **Monday**
| Time Slot | Subject Code | Course Title | Room & Block | Faculty & Cabin | Type |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **09:00 - 10:00** | **CSE205** | PRELUDE TO COMPETITIVE CODING | Room 34-201 | Dr. Sharma | Lecture |
| **10:00 - 11:00** | **INT306** | COMPETITIVE CODING APPROACHES-TECHNIQUES | Room 36-402 | Prof. Verma | Lecture |
| **01:00 - 03:00** | **CSE316** | DESIGN AND ANALYSIS OF ALGORITHMS | Room 38-605 | Dr. Singh | Practical |`;

    const summary = generateElaboratedVoiceSummary(fullMarkdown, {
      query: 'What are my classes on Monday?',
      timetable
    });

    // Must be a single cohesive sentence/paragraph
    expect(summary).toBeTruthy();
    expect(summary).not.toContain('|');
    expect(summary).not.toContain('###');
    expect(summary).toContain('3 classes scheduled for Monday');
    expect(summary).toContain('PRELUDE TO COMPETITIVE CODING');
    expect(summary).toContain('COMPETITIVE CODING APPROACHES TECHNIQUES');
    expect(summary).toContain('DESIGN AND ANALYSIS OF ALGORITHMS');
    expect(summary).toContain('Block 34, Room 201');
  });

  it('generates a clean empty day summary when no classes are scheduled', () => {
    const timetable = {
      slots: [],
      courses: []
    } as unknown as TimetableSummary;

    const summary = generateElaboratedVoiceSummary('### 📅 Schedule for **Sunday**\nNo classes scheduled.', {
      query: 'classes on Sunday',
      timetable
    });

    expect(summary).toContain('no classes scheduled on Sunday');
    expect(summary).not.toContain('|');
  });

  it('generates an elaborated attendance summary with lowest course and safe bunks', () => {
    const attendance = {
      overallPercentage: 84.5,
      totalAttended: 120,
      totalClasses: 142,
      totalDelivered: 142,
      totalCourses: 3,
      courses: [
        {
          code: 'CSE205',
          name: 'PRELUDE TO COMPETITIVE CODING',
          percentage: 78.0,
          attended: 28,
          total: 36
        },
        {
          code: 'INT306',
          name: 'COMPETITIVE CODING APPROACHES',
          percentage: 88.0,
          attended: 44,
          total: 50
        },
        {
          code: 'CSE316',
          name: 'DESIGN AND ANALYSIS OF ALGORITHMS',
          percentage: 92.0,
          attended: 48,
          total: 56
        }
      ]
    } as unknown as AttendanceSummary;

    const summary = generateElaboratedVoiceSummary('### ⚠️ Academic Priority Assessment\nDetails...', {
      query: 'What is my lowest attendance and can I bunk?',
      attendance
    });

    expect(summary).toContain('PRELUDE TO COMPETITIVE CODING');
    expect(summary).toContain('78 percent');
    expect(summary).toContain('safe');
    expect(summary).toContain('85 percent');
    expect(summary).not.toContain('|');
  });

  it('keeps a course-specific bank query in the attendance domain even when it contains "classes"', () => {
    const attendance = {
      overallPercentage: 98,
      totalCourses: 2,
      courses: [
        {
          code: 'CSE472',
          name: 'DEEP LEARNING FOR NATURAL LANGUAGE PROCESSING',
          percentage: 100,
          attended: 26,
          total: 28
        },
        {
          code: 'CSE471',
          name: 'DEEP LEARNING FOR COMPUTER VISION',
          percentage: 96,
          attended: 24,
          total: 26
        }
      ]
    } as unknown as AttendanceSummary;
    const timetable = {
      slots: [
        { day: 'Tuesday', time: '09:00 - 10:00', courseCode: 'CSE471', courseTitle: 'DEEP LEARNING FOR COMPUTER VISION' }
      ]
    } as unknown as TimetableSummary;

    const summary = generateElaboratedVoiceSummary('Attendance answer', {
      query: 'How many classes can I bank in CSE 472?',
      attendance,
      timetable
    });

    expect(summary).toContain('CSE472');
    expect(summary).toContain('safely skip 6 classes');
    expect(summary).not.toContain('scheduled for Tuesday');
  });

  it('generates an elaborated examination summary for next upcoming paper', () => {
    const examination = {
      totalExams: 4,
      capturedAt: Date.now(),
      exams: [
        {
          courseCode: 'CSE205',
          courseName: 'PRELUDE TO COMPETITIVE CODING',
          examDate: '14 Oct 2026',
          startTime: '09:00 AM',
          endTime: '12:00 PM',
          room: '34-201',
          seat: 'Seat 14'
        }
      ]
    } as unknown as ExaminationSummary;

    const summary = generateElaboratedVoiceSummary('### 📅 Next Exam Details', {
      query: 'When is my next exam?',
      examination
    });

    expect(summary).toContain('PRELUDE TO COMPETITIVE CODING');
    expect(summary).toMatch(/14 Oct(?:ober)? 2026/);
    expect(summary).toContain('9:00 AM');
    expect(summary).toContain('Block 34, Room 201');
    expect(summary).toContain('4 upcoming exams');
    expect(summary).not.toContain('|');
  });

  it('falls back to a clean coherent paragraph for general conversational text', () => {
    const rawMarkdown = `### Welcome to ONEE
- **Guidance:** I can assist you with your academic schedules, exams, and attendance.
- You have access to real-time verification from your university portal.

> Have a productive semester!`;

    const summary = generateElaboratedVoiceSummary(rawMarkdown, {
      query: 'Hello ONEE'
    });

    expect(summary).not.toContain('###');
    expect(summary).not.toContain('**');
    expect(summary).not.toContain('>');
    expect(summary).toContain('I can assist you with your academic schedules');
  });

  it('generates an elaborated voice response for specific exam seating plan query when seat is awaited', () => {
    const examination = {
      totalExams: 6,
      exams: [
        {
          courseCode: 'INT373',
          courseName: 'AGILE DRIVEN DEVELOPMENT',
          examDate: '14 Oct 2026',
          startTime: '12:30',
          room: '37-707',
          seat: 'Awaited'
        },
        {
          courseCode: 'CSE408',
          courseName: 'DESIGN AND ANALYSIS OF ALGORITHMS',
          examDate: '18 Oct 2026',
          startTime: '12:30',
          room: '34-201',
          seat: 'Awaited'
        }
      ]
    } as unknown as ExaminationSummary;

    const summary = generateElaboratedVoiceSummary('### 📅 Verified Examination Date Sheet (6 Exams)...', {
      query: 'Hey can you check the seat number available with INT 373 exam?',
      examination
    });

    expect(summary).toContain('INT373');
    expect(summary).toMatch(/14 Oct(?:ober)? 2026/);
    expect(summary).toContain('Block 37, Room 707');
    expect(summary).toContain('seat allotment is currently awaited');
    expect(summary).not.toContain('|');
  });

  it('matches specific date and course for seating query like CSE408 seat for 18 Oct exam', () => {
    const examination = {
      totalExams: 6,
      exams: [
        {
          courseCode: 'INT373',
          courseName: 'AGILE DRIVEN DEVELOPMENT',
          examDate: '14 Oct 2026',
          startTime: '12:30',
          room: '37-707',
          seat: 'Awaited'
        },
        {
          courseCode: 'CSE408',
          courseName: 'DESIGN AND ANALYSIS OF ALGORITHMS',
          examDate: '18 Oct 2026',
          startTime: '12:30',
          room: '34-201',
          seat: 'Awaited'
        }
      ]
    } as unknown as ExaminationSummary;

    const summary = generateElaboratedVoiceSummary('### 📅 Verified Examination Date Sheet...', {
      query: 'Check CSE408 seat for 18 Oct exam',
      examination
    });

    expect(summary).toContain('CSE408');
    expect(summary).toMatch(/18 Oct(?:ober)? 2026/);
    expect(summary).toContain('Block 34, Room 201');
    expect(summary).toContain('seat allotment is currently awaited');
  });

  it('generates a clean single paragraph for registered curriculum without table artifacts or trailing colons', () => {
    const timetable = {
      totalCourses: 6,
      totalCredits: 18,
      courses: [
        { courseCode: 'CSE329', courseTitle: 'PRELUDE TO COMPETITIVE CODING', facultyName: 'Raj Karan Singh', facultyCabin: '26-207-WOW1' },
        { courseCode: 'CSE408', courseTitle: 'DESIGN AND ANALYSIS OF ALGORITHMS', facultyName: 'Tejinder Thind', facultyCabin: '34-203-C2' }
      ]
    } as unknown as TimetableSummary;

    const markdown = `### 📚 Registered Courses & Faculty Directory

Here is your official enrolled curriculum (**6 courses**, **18 total credits**) verified from your authenticated UMS portal:

| Course Code | Type | Course Title | L-T-P | Credits | Faculty & Cabin | Last Updated |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **CSE329** | PW | PRELUDE TO COMPETITIVE CODING | 2-0-1 | 3 | Raj Karan Singh (26-207-WOW1) | Mar 9 2026 4:07PM |
| **CSE408** | CR | DESIGN AND ANALYSIS OF ALGORITHMS | 3-0-2 | 4 | Tejinder Thind (34-203-C2) | Dec 2 2025 4:24PM |

> 💡 **Directory Note:** Faculty cabin locations and course credits are verified directly from your official UMS Student Time Table report.`;

    const summary = generateElaboratedVoiceSummary(markdown, {
      query: 'what courses am I enrolled in?',
      timetable
    });

    expect(summary).toContain('registered in 6 courses totaling 18 credits');
    expect(summary).not.toContain('|');
    expect(summary).not.toContain('---');
    expect(summary).not.toContain('Directory Note');
    expect(summary.endsWith('.')).toBe(true);
  });

  it('answers faculty cabin inquiry in a single complete sentence', () => {
    const timetable = {
      courses: [
        { courseCode: 'CSE408', courseTitle: 'DESIGN AND ANALYSIS OF ALGORITHMS', facultyName: 'Dr. Tejinder Thind', facultyCabin: 'Block 34, Cabin C2' }
      ]
    } as unknown as TimetableSummary;

    const summary = generateElaboratedVoiceSummary('Details about CSE408...', {
      query: 'who teaches CSE408 and what is the cabin?',
      timetable
    });

    expect(summary).toContain('CSE408');
    expect(summary).toContain('Dr. Tejinder Thind');
    expect(summary).toContain('Block 34, Cabin C2');
    expect(summary).not.toContain('|');
  });

  /*
   * Regression: Sofia must never read the whole chatbot response aloud. The voice
   * summary is a short, natural spoken answer derived from the canonical reply.
   */
  it('derives a short answer-bearing voice summary from the full canonical attendance reply', () => {
    const attendance = {
      courses: [
        { code: 'CSE329', name: 'PRELUDE TO COMPETITIVE CODING', attended: 17, total: 19, delivered: 19, percentage: 100, dutyLeave: 0 },
        { code: 'CSE330', name: 'COMPETITIVE CODING APPROACHES-TECHNIQUES', attended: 18, total: 19, delivered: 19, percentage: 95, dutyLeave: 0 },
        { code: 'CSE408', name: 'DESIGN AND ANALYSIS OF ALGORITHMS', attended: 28, total: 32, delivered: 32, percentage: 100, dutyLeave: 0 }
      ],
      overallPercentage: 98,
      totalAttended: 63,
      totalDelivered: 70,
      totalCourses: 3,
      status: 'verified',
      source: 'live-ums-dom'
    } as unknown as AttendanceSummary;

    const canonicalReply = `### 🚨 Academic Priority & Lowest Attendance Subject

Sure. Your lowest attendance is **CSE330: COMPETITIVE CODING APPROACHES-TECHNIQUES**, standing at **95%** (18/19 classes attended) with **5 safe skips** remaining. In short, **CSE330** is your lowest-attendance subject right now.

#### 📊 Subject Risk Hierarchy (Lowest to Highest)
| Rank & Code | Course Name | Current % | Attended / Delivered | Buffer (≥75%) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. CSE330** | COMPETITIVE CODING APPROACHES-TECHNIQUES | **95%** | \`18 / 19\` | **5 skips** | 🟢 Safe |
| **2. CSE329** | PRELUDE TO COMPETITIVE CODING | **100%** | \`17 / 19\` | **2 skips** | 🟢 Safe |

#### 🎯 Strategic Recommendation
- **Immediate Focus:** Prioritize attending every class of **CSE330** to protect your buffer.
- **Threshold Safety:** Keep all courses strictly above 75% to prevent exam detention.

> 💡 **Summary & Takeaway:** Your tightest course is CSE330 at 95%. You have 5 safe skips left here.`;

    const summary = generateElaboratedVoiceSummary(canonicalReply, {
      query: 'which subject has the lowest attendance',
      capability: 'attendance',
      attendance
    });

    // Answers the actual question, in the right subject
    expect(summary).toContain('CSE330');
    expect(summary).toContain('95');

    // Spoken form only: no markdown tables, headers, pipes, or footers
    expect(summary).not.toContain('|');
    expect(summary).not.toContain('---');
    expect(summary).not.toContain('Summary & Takeaway');
    expect(summary).not.toContain('#');

    // Concise: clearly shorter than the full canonical chat response
    expect(summary.length).toBeLessThan(canonicalReply.length / 2);
  });
});
