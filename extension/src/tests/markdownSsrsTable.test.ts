import { describe, it, expect } from 'vitest';
import { formatConcatenatedSsrsTable } from '../components/common/MarkdownRenderer';

describe('formatConcatenatedSsrsTable', () => {
  const userScreenshotText =
    'Course CodeTypeCourse TitleLecturesTutorialPracticalCreditsFacul ( Block - Room. No - Cabin No ) CSE329PWPRELUDE TO COMPETITIVE CODING2013Raj Karan Singh ( 26-207-WOW1 ) Last Updated :: Mar 9 2026 4:07PMCSE330PWCOMPETITIVE CODING APPROACHES-TECHNIQUES2013Deepak Kumar ( 27-209-CH13 ) Last Updated :: A 26 2026 3:43PMCSE408CRDESIGN AND ANALYSIS OF ALGORITHMS3024Tejinder Thind ( 34-203-C2 ) Last Updated :: Dec 2 2025 4:24PMCSE443TESEMINAR ON SUMMER TRAINING0063 Last Updated :: NACSE471EMDEEP LEARNING FOR COMPUTER VISION2023Abhishek Tiwari ( 33-205-CH16 ) Last Updated :: Jun 18 2026 4:36PMCSE472EMDEEP LEARNING FOR NATURAL LANGUAGE PROCESSING2023Anzar Hussain Lone ( 3 205-CH8 ) Last Updated :: Aug 19 2026 4:26PMINT373OM AGILE DRIVEN DEVELOPMENT AND PROJECT MANAGEMENT2023Shairy ( 27-203-CH11 Last Updated :: Aug 7 2026 11:05AMPEAS01PEANALYTICAL - I1000Navneet Kumar Singh ( 38-509-CH7 Last Updated :: Aug 19 2026 10:09AMPEVS01PEVERBAL - I1000Mohammad Arif Baba ( 33-216-CH1 ) Last Updated :: Sep 14 2026 1:42PM';

  it('transforms raw concatenated SSRS table text from user screenshot into structured markdown table', () => {
    const formatted = formatConcatenatedSsrsTable(userScreenshotText);

    expect(formatted).toContain('### 📚 Registered Courses & Faculty Directory');
    expect(formatted).toContain('| Course Code | Type | Course Title | L-T-P | Credits | Faculty & Cabin | Last Updated |');
    expect(formatted).toContain('| :--- | :--- | :--- | :--- | :--- | :--- | :--- |');

    // Verify all 9 courses from screenshot are parsed with correct metadata
    expect(formatted).toContain('| **CSE329** | PW | PRELUDE TO COMPETITIVE CODING | 2-0-1 | 3 | Raj Karan Singh (26-207-WOW1) | Mar 9 2026 4:07PM |');
    expect(formatted).toContain('| **CSE330** | PW | COMPETITIVE CODING APPROACHES-TECHNIQUES | 2-0-1 | 3 | Deepak Kumar (27-209-CH13) |');
    expect(formatted).toContain('| **CSE408** | CR | DESIGN AND ANALYSIS OF ALGORITHMS | 3-0-2 | 4 | Tejinder Thind (34-203-C2) |');
    expect(formatted).toContain('| **CSE443** | TE | SEMINAR ON SUMMER TRAINING | 0-0-6 | 3 | Not Assigned / NA | NA |');
    expect(formatted).toContain('| **CSE471** | EM | DEEP LEARNING FOR COMPUTER VISION | 2-0-2 | 3 | Abhishek Tiwari (33-205-CH16) |');
    expect(formatted).toContain('| **CSE472** | EM | DEEP LEARNING FOR NATURAL LANGUAGE PROCESSING | 2-0-2 | 3 | Anzar Hussain Lone (3 205-CH8) |');
    expect(formatted).toContain('| **INT373** | OM | AGILE DRIVEN DEVELOPMENT AND PROJECT MANAGEMENT | 2-0-2 | 3 | Shairy (27-203-CH11) |');
    expect(formatted).toContain('| **PEAS01** | PE | ANALYTICAL - I | 1-0-0 | 0 | Navneet Kumar Singh (38-509-CH7) |');
    expect(formatted).toContain('| **PEVS01** | PE | VERBAL - I | 1-0-0 | 0 | Mohammad Arif Baba (33-216-CH1) | Sep 14 2026 1:42PM |');

    // Total credits = 3 + 3 + 4 + 3 + 3 + 3 + 3 + 0 + 0 = 22
    expect(formatted).toContain('**9 courses**');
    expect(formatted).toContain('**22 total credits**');
  });

  it('passes normal markdown text through unmodified', () => {
    const normal = '### 🗓️ Monday Class Schedule\n\n| Time | Course |\n| :--- | :--- |\n| 09:00 | CSE329 |';
    expect(formatConcatenatedSsrsTable(normal)).toBe(normal);
  });

  it('handles empty or non-string inputs safely', () => {
    expect(formatConcatenatedSsrsTable('')).toBe('');
    expect(formatConcatenatedSsrsTable(null as any)).toBe(null);
  });
});
