/*
 * Dynamic greeting engine contract tests.
 *
 * Locks the behavior that replaced the old canned "Hey Sophia!" reply:
 *  - classifySocial separates greetings/identity/thanks from real requests,
 *  - timeOfDay buckets are correct at every boundary hour,
 *  - openers rotate instead of repeating,
 *  - buildChatGreeting surfaces live verified context (attendance, exams).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  classifySocial,
  timeOfDay,
  buildChatGreeting,
  sessionGreetingLine
} from '../lib/greeting';

describe('classifySocial', () => {
  it('classifies plain greetings, including ones carrying a name', () => {
    expect(classifySocial('Hey Sophia!')).toBe('greeting');
    expect(classifySocial('hello there')).toBe('greeting');
    expect(classifySocial('hi')).toBe('greeting');
    expect(classifySocial('good morning')).toBe('greeting');
    expect(classifySocial('yo yo')).toBe('greeting');
  });

  it('classifies identity questions', () => {
    expect(classifySocial('who are you')).toBe('identity');
    expect(classifySocial('what can you do')).toBe('identity');
    expect(classifySocial("what's your name")).toBe('identity');
  });

  it('classifies short thanks', () => {
    expect(classifySocial('thanks')).toBe('thanks');
    expect(classifySocial('thank you so much')).toBe('thanks');
    expect(classifySocial('thx')).toBe('thanks');
  });

  it('never swallows a genuine academic request as a greeting', () => {
    expect(classifySocial('what classes do I have today')).toBeNull();
    expect(classifySocial('how is my attendance')).toBeNull();
    expect(classifySocial('show my exam datesheet')).toBeNull();
    expect(classifySocial('thank you for the attendance')).toBeNull();
    expect(classifySocial('hi, bunk my lab tomorrow')).toBeNull();
  });

  it('returns null for empty or non-greeting text', () => {
    expect(classifySocial('')).toBeNull();
    expect(classifySocial('   ')).toBeNull();
    expect(classifySocial('please compute the longest common subsequence')).toBeNull();
  });
});

describe('timeOfDay', () => {
  it('buckets every boundary hour correctly', () => {
    expect(timeOfDay(0)).toBe('lateNight');
    expect(timeOfDay(4)).toBe('lateNight');
    expect(timeOfDay(5)).toBe('morning');
    expect(timeOfDay(11)).toBe('morning');
    expect(timeOfDay(12)).toBe('afternoon');
    expect(timeOfDay(16)).toBe('afternoon');
    expect(timeOfDay(17)).toBe('evening');
    expect(timeOfDay(21)).toBe('evening');
    expect(timeOfDay(22)).toBe('lateNight');
    expect(timeOfDay(23)).toBe('lateNight');
  });
});

describe('buildChatGreeting', () => {
  beforeEach(() => {
    // 09:05 local — morning bucket with a deterministic rotation index.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 9, 9, 5, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('produces a morning opener with the ONEE intro (greeting kind)', () => {
    const { chatMsg, spoken } = buildChatGreeting('greeting');
    expect(chatMsg).toMatch(/^### 👋 (Good morning!|Morning!)/);
    expect(chatMsg).toContain('ONEE');
    expect(chatMsg).toContain('Ready when you are');
    expect(spoken).toContain('Sofia');
  });

  it('surfaces verified attendance context when present', () => {
    const { chatMsg, spoken } = buildChatGreeting('greeting', {
      hasAttendance: true,
      aggregateAttendance: 99.4,
      subjectCount: 8
    });
    expect(chatMsg).toContain('**99%**');
    expect(chatMsg).toContain('**8 subjects**');
    expect(spoken).toContain('99 percent');
    expect(spoken).toContain('8 subjects');
  });

  it('surfaces the next exam when present', () => {
    const { chatMsg, spoken } = buildChatGreeting('greeting', {
      nextExam: { courseCode: 'CSE408', examDate: 'Oct 15, 2026' }
    });
    expect(chatMsg).toContain('**CSE408**');
    expect(chatMsg).toContain('**Oct 15, 2026**');
    expect(spoken).toContain('CSE408');
    expect(spoken).toContain('Oct 15, 2026');
  });

  it('personalizes with the student first name when known', () => {
    const { chatMsg } = buildChatGreeting('greeting', { studentName: 'Sophia Khan' });
    expect(chatMsg).toContain('Sophia');
  });

  it('answers identity questions with the capability list', () => {
    const { chatMsg } = buildChatGreeting('identity');
    expect(chatMsg).toContain('What I can do for you');
    expect(chatMsg).toContain('Class Timetable');
    expect(chatMsg).toContain('Seating Plan');
  });

  it('answers thanks without dumping capabilities', () => {
    const { chatMsg, spoken } = buildChatGreeting('thanks');
    expect(chatMsg).toContain('Always happy to help');
    expect(chatMsg).not.toContain('What I can do for you');
    expect(spoken).toContain("You're welcome");
  });

  it('rotates the opener across minutes so no line repeats back-to-back', () => {
    const first = buildChatGreeting('greeting').chatMsg;
    // One minute later, same day: rotation index shifts.
    vi.setSystemTime(new Date(2026, 9, 9, 9, 6, 0));
    const second = buildChatGreeting('greeting').chatMsg;
    expect(first).not.toBe(second);
  });
});

describe('sessionGreetingLine', () => {
  it('always returns a non-empty time-aware opener', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 9, 9, 2, 30, 0)); // late night
      const line = sessionGreetingLine();
      expect(line.length).toBeGreaterThan(10);
      expect(line).toContain('Sofia');
    } finally {
      vi.useRealTimers();
    }
  });
});
