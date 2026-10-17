/*
 * STT hallucination guard + speech-natural text transform tests.
 *
 * REGRESSION: Whisper, primed by a course-code prompt over noise/silence,
 * returned "PEAS01 PEAS02 PEAS032 PEAS033 PEAS04 PEAS05 PEAS06" for the spoken
 * query "What classes I have today". That transcript must be rejected before it
 * can reach chat or intent resolution, and real conversational queries — even
 * ones containing course codes — must pass through untouched.
 */
import { describe, it, expect } from 'vitest';
import { looksLikeSttHallucination } from '../voice/providers/GroqWhisperProvider';

describe('looksLikeSttHallucination', () => {
  it('rejects the PEAS course-code ghost from the bug report', () => {
    expect(looksLikeSttHallucination('PEAS01 PEAS02 PEAS032 PEAS033 PEAS04 PEAS05 PEAS06')).toBe(true);
    expect(looksLikeSttHallucination('PEAS01 PEAS02 PEAS03')).toBe(true);
    expect(looksLikeSttHallucination('CSE329 CSE408 CSE471 CSE472 CSE330 INT373')).toBe(true);
  });

  it('rejects prompt-vocabulary echo observed over noise in production', () => {
    // Live probe (pure tone over whisper-large-v3 + de-primed prompt):
    expect(looksLikeSttHallucination('UMS attendance examination timetable date sheet')).toBe(true);
  });

  it('rejects other classic Whisper noise hallucinations', () => {
    expect(looksLikeSttHallucination('Thank you for watching.')).toBe(true);
    expect(looksLikeSttHallucination('you')).toBe(true);
    expect(looksLikeSttHallucination('Subtitles by [Music]')).toBe(true);
    expect(looksLikeSttHallucination('')).toBe(true);
  });

  it('rejects long digit/symbol noise runs', () => {
    expect(looksLikeSttHallucination('12 34 56 78 90 12 34 56 78 90 12')).toBe(true);
  });

  it('accepts genuine conversational queries', () => {
    expect(looksLikeSttHallucination('What classes I have today')).toBe(false);
    expect(looksLikeSttHallucination('what classes do i have today?')).toBe(false);
    expect(looksLikeSttHallucination('how is my attendance in CSE329 this semester')).toBe(false);
    expect(looksLikeSttHallucination('check my attendance and examination schedule')).toBe(false);
    expect(looksLikeSttHallucination('open my timetable')).toBe(false);
    expect(looksLikeSttHallucination('where is my next class')).toBe(false);
  });
});
