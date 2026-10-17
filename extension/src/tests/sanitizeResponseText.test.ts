import { describe, it, expect } from 'vitest';
import { sanitizeFinalResponseText } from '../lib/sanitizeResponseText';

describe('sanitizeFinalResponseText', () => {
  it('removes standalone undefined and [object Object] artifacts', () => {
    const out = sanitizeFinalResponseText(
      'Your lowest subject is [object Object] with undefined attendance of NaN%.'
    );
    expect(out).not.toContain('undefined');
    expect(out).not.toContain('[object Object]');
    expect(out).not.toMatch(/\bNaN\b/);
  });

  it('never touches verified factual values (codes, percentages, dates)', () => {
    const input =
      'CSE330 is your lowest subject at 95%. CSE329, CSE408, CSE471, CSE472, PEAS01 and PEVS01 are at 100%. Your next exam is INT373 on 8 Oct 2026 at 10:00 in Room 34-201.';
    expect(sanitizeFinalResponseText(input)).toBe(input);
  });

  it('unwraps a whole-message raw JSON reply wrapper', () => {
    const out = sanitizeFinalResponseText(
      '{"reply":"Your CSE330 attendance is 95 percent.","cardType":"ATTENDANCE_RESULT"}'
    );
    expect(out).toBe('Your CSE330 attendance is 95 percent.');
    expect(out).not.toContain('{');
    expect(out).not.toContain('cardType');
  });

  it('drops single-line JSON tool artifacts but keeps prose lines', () => {
    const input = ['Checking now.', '{"tool":"browser_agent","status":"running"}', 'Done.'].join('\n');
    const out = sanitizeFinalResponseText(input);
    expect(out).not.toContain('browser_agent');
    expect(out).toContain('Checking now.');
    expect(out).toContain('Done.');
  });

  it('removes duplicate sentences while preserving order', () => {
    const out = sanitizeFinalResponseText(
      'You are safe in CSE329. You are safe in CSE329. You are safe in CSE408.'
    );
    expect(out).toBe('You are safe in CSE329. You are safe in CSE408.');
  });

  it('strips code fences and collapses broken whitespace', () => {
    const out = sanitizeFinalResponseText('```json\n{"x":1}\n```\n\n\nYour attendance is fine.   ');
    expect(out).toBe('Your attendance is fine.');
  });

  it('preserves markdown structure (lists, blank lines) while deduplicating', () => {
    const input = [
      '### Schedule',
      '',
      '- Busiest day is Monday with 4 sessions.',
      '- Busiest day is Monday with 4 sessions.',
      '- You have 3 practical sessions.'
    ].join('\n');
    const out = sanitizeFinalResponseText(input);
    expect(out).toBe(
      ['### Schedule', '', '- Busiest day is Monday with 4 sessions.', '- You have 3 practical sessions.'].join('\n')
    );
  });

  it('returns empty string for empty/blank input', () => {
    expect(sanitizeFinalResponseText('')).toBe('');
    expect(sanitizeFinalResponseText('   ')).toBe('');
  });
});
