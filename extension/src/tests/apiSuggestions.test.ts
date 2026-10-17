import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchLlmSuggestions, streamChatMessage, setBackendUrlForTesting, generateLocalFallbackResponse } from '../services/api';
import { AttendanceSummary, ChatMessage } from '../shared/types';

describe('API Dynamic LLM Suggestions', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    setBackendUrlForTesting('http://localhost:8000');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setBackendUrlForTesting(null);
  });

  const mockAttendance: AttendanceSummary = {
    totalCourses: 2,
    overallPercentage: 85.0,
    totalDelivered: 40,
    totalAttended: 34,
    courses: [
      {
        code: 'CSE320',
        name: 'Operating Systems',
        attended: 17,
        delivered: 20,
        total: 20,
        percentage: 85.0,
        dutyLeave: 0
      },
      {
        code: 'INT108',
        name: 'Python',
        attended: 14,
        delivered: 20,
        total: 20,
        percentage: 70.0,
        dutyLeave: 0
      }
    ]
  };

  it('fetches dynamic suggestions from backend endpoint when available', async () => {
    const mockLlmSuggestions = [
      'Can I skip CSE320 today?',
      'How many to reach 75% in INT108?',
      'Show safe bunk allowance'
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        suggestions: mockLlmSuggestions,
        modelUsed: 'qwen/qwen3.8-27b'
      })
    }) as any;

    const result = await fetchLlmSuggestions({
      attendance: mockAttendance,
      lastQuery: 'Can I miss any classes?'
    });

    expect(result).toEqual(mockLlmSuggestions);
  });

  it('falls back to grounded contextual suggestions if backend fetch fails', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network offline')) as any;

    const result = await fetchLlmSuggestions({
      attendance: mockAttendance,
      lastQuery: 'Can I miss any classes?'
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    // Should ground in INT108 (lowest at 70%)
    expect(result.some((s) => s.includes('INT108') || s.includes('CSE320') || s.includes('75%'))).toBe(true);
  });

  it('emits suggestions through streamChatMessage when SSE suggestions event arrives', async () => {
    const encoder = new TextEncoder();
    const sseChunks = [
      'data: {"type":"token","data":"Hello "}\n\n',
      'data: {"type":"token","data":"student"}\n\n',
      'data: {"type":"suggestions","data":["Where is my next class?","Check safe skips in CSE320"]}\n\n',
      'data: {"type":"done","data":{"message":"Hello student","activities":[],"suggestions":["Where is my next class?","Check safe skips in CSE320"]}}\n\n'
    ];

    let chunkIndex = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (chunkIndex < sseChunks.length) {
          controller.enqueue(encoder.encode(sseChunks[chunkIndex++]));
        } else {
          controller.close();
        }
      }
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: stream
    }) as any;

    const onSuggestions = vi.fn();
    const response = await streamChatMessage(
      'Hello',
      mockAttendance,
      [],
      () => {},
      undefined,
      undefined,
      onSuggestions
    );

    expect(onSuggestions).toHaveBeenCalledWith([
      'Where is my next class?',
      'Check safe skips in CSE320'
    ]);
    expect(response.suggestions).toEqual([
      'Where is my next class?',
      'Check safe skips in CSE320'
    ]);
  });

  it('generates local fallback skip simulation table with history context for "what about 5"', () => {
    const history: ChatMessage[] = [
      { id: '1', sender: 'user', text: 'what if i skip 4 classes in cse320?', timestamp: Date.now() },
      { id: '2', sender: 'assistant', text: 'CSE320 skip trajectory...', timestamp: Date.now() }
    ];

    const result = generateLocalFallbackResponse('what about 5', mockAttendance, null, null, history);
    expect(result.message).toContain('CSE320');
    expect(result.message).toContain('What If I Skip 5 Classes?');
    expect(result.message).toContain('| **Current** | `17 / 20` | **85%** | 🟢 Safe |');
    expect(result.message).toContain('| **Skip 5 Classes** | `17 / 25` | **68%** | ⚠️ Below 75% |');
    expect(result.suggestions).toBeDefined();
    expect(result.suggestions?.some((s) => s.includes('CSE320'))).toBe(true);
  });

  /*
   * Regression: an entity-specific attendance question must be answered from the
   * verified per-subject records — never with the aggregate percentage.
   */
  it('answers "which subject has the lowest attendance" from the verified subject records', () => {
    const result = generateLocalFallbackResponse(
      'can you tell me which subject has the lowest attendance',
      mockAttendance,
      null,
      null,
      []
    );

    // INT108 is the lowest verified subject at 70%
    expect(result.message).toContain('INT108');
    expect(result.message).toContain('70%');
    expect(result.message).not.toMatch(/^Your (current )?verified overall attendance is/i);
  });

  it('answers "Which subject is lowest?" with the lowest verified subject', () => {
    const result = generateLocalFallbackResponse('Which subject is lowest?', mockAttendance, null, null, []);
    expect(result.message).toContain('INT108');
  });

  it('resolves "How many can I miss in CSE320?" to that specific subject, not the aggregate', () => {
    const result = generateLocalFallbackResponse(
      'How many can I miss in CSE320?',
      mockAttendance,
      null,
      null,
      []
    );

    expect(result.message).toContain('CSE320');
    expect(result.message).toMatch(/Safe (Bunks|Skips)/i);
    expect(result.message).not.toMatch(/^Your (current )?verified overall attendance is/i);
  });

  it('does NOT treat course codes like CSE320 as skip count numbers and caps simulation rows', () => {
    const result = generateLocalFallbackResponse('How many can I miss in CSE320?', mockAttendance, null, null, []);
    expect(result.message).not.toContain('What If I Skip 320 Classes?');
    const skipRows = (result.message.match(/\|\s*\*\*Skip/g) || []).length;
    expect(skipRows).toBeLessThanOrEqual(6);
  });

  it('generates scheduled examination count and does NOT hijack to Examination Clearance Report for "atom exams"', () => {
    const mockExamination = {
      totalExams: 3,
      exams: [
        { courseCode: 'CSE320', examDate: '15-Oct-2026', startTime: '09:00 AM', venue: 'Block 34', room: '301', seat: 'A-1' },
        { courseCode: 'INT108', examDate: '18-Oct-2026', startTime: '01:30 PM', venue: 'Block 34', room: '302', seat: 'B-2' },
        { courseCode: 'MTH401', examDate: '22-Oct-2026', startTime: '09:00 AM', venue: 'Block 36', room: '105', seat: 'C-3' }
      ],
      capturedAt: Date.now()
    };

    const result = generateLocalFallbackResponse(
      'can you tell me how many atom exams do I have in term exams',
      mockAttendance,
      mockExamination,
      null,
      []
    );

    expect(result.message).toContain('### 📅 Scheduled Examinations: **3 Exams**');
    expect(result.message).toContain('You have **3 scheduled examinations** recorded in your verified UMS Date Sheet:');
    expect(result.message).not.toContain('Examination Clearance Report');
  });

  it('generates Examination Clearance Report ONLY for explicit attendance eligibility queries', () => {
    const result = generateLocalFallbackResponse(
      'Am I eligible for exams based on attendance?',
      mockAttendance,
      null,
      null,
      []
    );

    expect(result.message).toContain('### 🎓 Examination Clearance Report');
    expect(result.message).toContain('University Regulations Checklist');
  });

  it('generates tomorrow timetable with classes and faculty cabin directory when both are requested', () => {
    const daysMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayIdx = new Date().getDay();
    const tomorrowDay = daysMap[(todayIdx + 1) % 7];

    const mockTimetable: any = {
      vid: '12413692',
      homeSection: 'K3P24WM',
      slots: [
        {
          id: 'slot-1',
          day: tomorrowDay,
          time: '09:30-10:20 AM',
          type: 'Lecture',
          group: 'All',
          courseCode: 'CSE329',
          courseTitle: 'Prelude to Competitive Coding',
          room: '38-917',
          facultyName: 'Raj Karan Singh',
          facultyCabin: '26-207-WOW1'
        },
        {
          id: 'slot-2',
          day: tomorrowDay,
          time: '10:20-11:10 AM',
          type: 'Lecture',
          group: 'All',
          courseCode: 'CSE408',
          courseTitle: 'Advanced Design Patterns',
          room: '37-711',
          facultyName: 'Abhishek Tiwari',
          facultyCabin: '33-205-CH16'
        }
      ],
      courses: [
        {
          courseCode: 'CSE329',
          courseTitle: 'Prelude to Competitive Coding',
          lectures: 2,
          tutorial: 0,
          practical: 1,
          credits: 3,
          facultyName: 'Raj Karan Singh',
          facultyCabin: '26-207-WOW1'
        },
        {
          courseCode: 'CSE408',
          courseTitle: 'Advanced Design Patterns',
          lectures: 3,
          tutorial: 0,
          practical: 0,
          credits: 3,
          facultyName: 'Abhishek Tiwari',
          facultyCabin: '33-205-CH16'
        }
      ]
    };

    const result = generateLocalFallbackResponse(
      'What is my timetable for tomorrow and which cabins are my teachers in?',
      null,
      null,
      mockTimetable,
      []
    );

    // Verify tomorrow's schedule is rendered
    expect(result.message).toContain(`### 📅 Verified Schedule for **${tomorrowDay}**`);
    expect(result.message).toContain('09:30-10:20 AM');
    expect(result.message).toContain('CSE329');
    expect(result.message).toContain('CSE408');

    // Verify faculty cabin directory is rendered
    expect(result.message).toContain('Faculty & Cabin Directory');
    expect(result.message).toContain('Raj Karan Singh');
    expect(result.message).toContain('26-207-WOW1');
    expect(result.message).toContain('Abhishek Tiwari');
    expect(result.message).toContain('33-205-CH16');
  });
});


