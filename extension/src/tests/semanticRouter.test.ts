import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolveSemanticIntent, generateVerifiedResponse } from '../services/semanticRouter';
import { setBackendUrlForTesting } from '../services/api';

describe('semanticRouter', () => {
  beforeAll(() => {
    setBackendUrlForTesting('');
  });

  afterAll(() => {
    setBackendUrlForTesting(null);
  });

  describe('Intent Resolution Fallback', () => {
    it('keeps a homepage request as a structured dashboard navigation intent', async () => {
      const res = await resolveSemanticIntent({
        query: 'can you head back to homepage',
        executionId: 'test-exec-dashboard'
      });

      expect(res.intent).toBe('dashboard_navigation');
      expect(res.target).toBe('student_dashboard');
      expect(res.action).toBe('navigate');
      expect(res.entities.destination).toBe('student_dashboard');
      expect(res.requiresBrowserAction).toBe(false);
    });

    it('classifies a voice check structurally instead of treating it as a greeting', async () => {
      const res = await resolveSemanticIntent({
        query: 'I cannot hear ONEE, can you test the voice?',
        executionId: 'test-exec-voice-diagnostic'
      });

      expect(res.intent).toBe('voice_diagnostic');
      expect(res.capability).toBe('conversation');
      expect(res.action).toBe('respond');
      expect(res.requiresBrowserAction).toBe(false);
    });

    it('resolves detailed weekly matrix query to timetable', async () => {
      const res = await resolveSemanticIntent({
        query: 'Can you tell me detailed or give me detailed matrix of all classes this week?',
        executionId: 'test-exec-1',
        conversationState: {
          currentCapability: 'timetable',
          currentIntent: 'timetable_query'
        }
      });

      expect(res.capability).toBe('timetable');
      expect(res.intent).toBe('timetable_query');
      expect(res.entities.view).toBe('weekly_matrix');
    });

    it('resolves complete list of classes query to timetable', async () => {
      const res = await resolveSemanticIntent({
        query: 'Can you provide me a complete list of classes that I have in this week?',
        executionId: 'test-exec-2'
      });

      expect(res.capability).toBe('timetable');
      expect(res.intent).toBe('timetable_query');
      expect(res.entities.view).toBe('weekly_matrix');
    });

    it('resolves day switch "And what about Saturday?" within timetable conversation context', async () => {
      const res = await resolveSemanticIntent({
        query: 'And what about Saturday?',
        executionId: 'test-exec-3',
        conversationState: {
          currentCapability: 'timetable',
          currentIntent: 'timetable_query',
          activeEntity: { day: 'Tuesday' }
        }
      });

      expect(res.capability).toBe('timetable');
      expect(res.intent).toBe('timetable_query');
      expect(res.entities.day).toBe('Saturday');
    });

    /*
     * Regression: an examination date-sheet question must never be answered from
     * the timetable dataset just because a timetable conversation is still active.
     */
    it('does not let an active timetable conversation hijack an examination date-sheet question', async () => {
      const res = await resolveSemanticIntent({
        query: 'Show my complete examination date sheet with reporting times and syllabus overview.',
        executionId: 'test-exec-exam-guard',
        conversationState: {
          currentCapability: 'timetable',
          currentIntent: 'timetable_query',
          activeEntity: { day: 'Tuesday' }
        }
      });

      expect(res.capability).toBe('examination');
      expect(res.intent).toBe('examination_query');
    });
  });

  describe('Verified Response Formatting & Aesthetics', () => {
    const sampleSlots = [
      { day: 'Monday', time: '10:20-11:10 AM', courseCode: 'CSE472', type: 'Lecture', room: '33-301', section: 'K2EM001' },
      { day: 'Monday', time: '11:10-12:00 AM', courseCode: 'CSE472', type: 'Lecture', room: '33-301', section: 'K2EM001' },
      { day: 'Monday', time: '12:00-12:50 PM', courseCode: 'CSE329', type: 'Practical', room: '38-917', section: 'K4E0061' },
      { day: 'Saturday', time: '09:30-10:20 AM', courseCode: 'PEAS01', type: 'Lecture', room: '33-507', section: 'S9R026' },
      { day: 'Saturday', time: '10:20-11:10 AM', courseCode: 'PEVS01', type: 'Lecture', room: '33-507', section: 'S9R026' },
      { day: 'Saturday', time: '11:10-12:00 AM', courseCode: 'PROJECT', type: 'Practical', room: '37-708', section: 'K3E0061' }
    ];

    it('formats single day timetable with aesthetic markdown table and daily flow insights', async () => {
      const res = await generateVerifiedResponse({
        executionId: 'test-exec-4',
        query: 'And what about Saturday?',
        intent: 'timetable_query',
        capability: 'timetable',
        verifiedResult: {
          day: 'Saturday',
          slots: sampleSlots,
          classes: sampleSlots.filter(s => s.day === 'Saturday')
        }
      });

      expect(res.reply).toContain("### 🗓️ Saturday's Class Schedule");
      expect(res.reply).toContain('| Time Slot | Subject Code | Type | Room / Venue | Section |');
      expect(res.reply).toContain('PEAS01');
      expect(res.reply).toContain('S9R026');
      expect(res.reply).toContain('#### 🔍 Schedule Insights & Daily Flow');
      expect(res.reply).toContain('> 💡 **Schedule Note:**');
      expect(res.spokenSummary.toLowerCase()).toContain('saturday');
      // Voice TTS spokenSummary must not contain markdown pipes or raw table syntax
      expect(res.spokenSummary).not.toContain('|');
    });

    it('formats complete weekly matrix with dedicated weekday sections and academic insights', async () => {
      const res = await generateVerifiedResponse({
        executionId: 'test-exec-5',
        query: 'Can you tell me detailed or give me detailed matrix of all classes this week?',
        intent: 'timetable_query',
        capability: 'timetable',
        verifiedResult: {
          isWeekly: true,
          day: 'Weekly Matrix',
          slots: sampleSlots
        }
      });

      expect(res.reply).toContain('### 📅 Complete Weekly Class Schedule Matrix');
      expect(res.reply).toContain('#### 🗓️ Monday');
      expect(res.reply).toContain('#### 🗓️ Saturday');
      expect(res.reply).toContain('| Time Slot | Subject Code | Type | Room / Venue | Section |');
      expect(res.reply).toContain('#### 📊 Weekly Academic Insights');
      expect(res.reply).toContain('- **Busiest Day:**');
      expect(res.reply).toContain('- **Practical & Lab Work:**');
      expect(res.reply).toContain('- **Total Weekly Commitment:** 6 periods scheduled');
      expect(res.spokenSummary).toContain('Here is your complete weekly class matrix with 6 total classes scheduled');
    });

    it('formats single day timetable with faculty and cabin directory when requested', async () => {
      const res = await generateVerifiedResponse({
        executionId: 'test-exec-cabins',
        query: 'What is my timetable for tomorrow and which cabins are my teachers in?',
        intent: 'timetable_query',
        capability: 'timetable',
        verifiedResult: {
          day: 'Monday',
          slots: sampleSlots,
          classes: [
            {
              day: 'Monday',
              time: '10:20-11:10 AM',
              courseCode: 'CSE472',
              type: 'Lecture',
              room: '33-301',
              section: 'K2EM001',
              facultyName: 'Dr. Harpreet Kaur',
              facultyCabin: '33-204-H1'
            },
            {
              day: 'Monday',
              time: '12:00-12:50 PM',
              courseCode: 'CSE329',
              type: 'Practical',
              room: '38-917',
              section: 'K4E0061',
              facultyName: 'Raj Karan Singh',
              facultyCabin: '26-207-WOW1'
            }
          ],
          courses: [
            { courseCode: 'CSE472', facultyName: 'Dr. Harpreet Kaur', facultyCabin: '33-204-H1' },
            { courseCode: 'CSE329', facultyName: 'Raj Karan Singh', facultyCabin: '26-207-WOW1' }
          ]
        }
      });

      const daysMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const expectedDay = daysMap[(new Date().getDay() + 1) % 7];

      expect(res.reply).toContain(`### 🗓️ ${expectedDay}'s Class Schedule`);
      expect(res.reply).toContain('| Time Slot | Subject Code | Type | Room / Venue | Section |');
      expect(res.reply).toContain('#### 👨‍🏫 Faculty & Cabin Directory');
      expect(res.reply).toContain('| Subject Code | Instructor / Faculty | Cabin Location |');
      expect(res.reply).toContain('| **CSE472** | Dr. Harpreet Kaur | 33-204-H1 |');
      expect(res.reply).toContain('| **CSE329** | Raj Karan Singh | 26-207-WOW1 |');
      expect(res.reply).toContain('#### 🔍 Schedule Insights & Daily Flow');
      expect(res.reply).toContain('> 💡 **Schedule Note:**');
    });

    /*
     * Regression: "syllabus" used to match a bare /lab/ test and turned ordinary
     * schedule questions into a false "Practical Labs" answer.
     */
    it('never treats the word "syllabus" as a practical/lab class request', async () => {
      const res = await generateVerifiedResponse({
        executionId: 'test-exec-syllabus',
        query: 'Show me my class schedule for Monday along with the syllabus overview',
        intent: 'timetable_query',
        capability: 'timetable',
        verifiedResult: {
          day: 'Monday',
          slots: sampleSlots,
          classes: sampleSlots.filter((s) => s.day === 'Monday')
        }
      });

      expect(res.reply).not.toContain('Practical Labs for');
      expect(res.reply).toContain("### 🗓️ Monday's Class Schedule");
    });

    it('handles data unavailable truthfully without crashing or hallucinating', async () => {
      const res = await generateVerifiedResponse({
        executionId: 'test-exec-6',
        query: 'Can you tell me detailed matrix of all classes this week?',
        intent: 'timetable_query',
        capability: 'timetable',
        verifiedResult: {},
        taskOutcome: 'data_unavailable'
      });

      expect(res.reply).toContain('no timetable records were available');
      expect(res.reply).not.toContain('undefined');
    });
  });
});
