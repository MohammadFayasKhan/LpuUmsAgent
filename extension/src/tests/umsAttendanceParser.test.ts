/*
 * UMS Attendance Parser Test Suite.
 *
 * Validates deterministic table extraction against real HTML fixtures:
 * - Real dashboard attendance card (6 courses, exact counts, aggregate percentages).
 * - Full Attendance Summary modal table.
 * - Discrepancy detection between stated percentages and attended/delivered ratios.
 * - Malformed / unexpected HTML resilience without thrown exceptions.
 */

import { describe, it, expect } from 'vitest';
import { parseUmsAttendance, isValidCourseCode } from '../content/umsAttendanceParser';
import fs from 'fs';
import path from 'path';

function loadFixture(filename: string): Document {
  const filePath = path.resolve(__dirname, 'fixtures', filename);
  const html = fs.readFileSync(filePath, 'utf-8');
  const doc = document.implementation.createHTMLDocument('Fixture');
  doc.documentElement.innerHTML = html;
  return doc;
}

describe('umsAttendanceParser', () => {
  it('parses real 6 subjects from dashboard card fixture with exact counts', () => {
    const doc = loadFixture('umsDashboard.html');
    const summary = parseUmsAttendance(doc);

    expect(summary).not.toBeNull();
    if (!summary) return;

    expect(summary.totalCourses).toBe(6);
    expect(summary.studentName).toBe('Fayas Khan');
    expect(summary.registrationNumber).toBe('12104928');

    // Verify individual subjects
    const cse329 = summary.courses.find((c) => c.code === 'CSE329');
    expect(cse329).toBeDefined();
    expect(cse329?.attended).toBe(7);
    expect(cse329?.total).toBe(7);
    expect(cse329?.absent).toBe(0);
    expect(cse329?.percentage).toBe(100);

    const cse330 = summary.courses.find((c) => c.code === 'CSE330');
    expect(cse330).toBeDefined();
    expect(cse330?.attended).toBe(6);
    expect(cse330?.total).toBe(7);
    expect(cse330?.absent).toBe(1);
    expect(cse330?.percentage).toBe(85.71);

    const cse408 = summary.courses.find((c) => c.code === 'CSE408');
    expect(cse408?.attended).toBe(12);
    expect(cse408?.total).toBe(12);
    expect(cse408?.percentage).toBe(100);

    const cse471 = summary.courses.find((c) => c.code === 'CSE471');
    expect(cse471?.attended).toBe(14);
    expect(cse471?.total).toBe(14);
    expect(cse471?.percentage).toBe(100);

    const cse472 = summary.courses.find((c) => c.code === 'CSE472');
    expect(cse472?.attended).toBe(8);
    expect(cse472?.total).toBe(10);
    expect(cse472?.percentage).toBe(80);

    const int373 = summary.courses.find((c) => c.code === 'INT373');
    expect(int373?.attended).toBe(5);
    expect(int373?.total).toBe(7);
    expect(int373?.percentage).toBe(71.43);

    // Totals: (7+6+12+14+8+5) / (7+7+12+14+10+7) = 52 / 57 = 91.23%
    expect(summary.totalAttended).toBe(52);
    expect(summary.totalClasses).toBe(57);
    expect(summary.totalAbsent).toBe(5);
    expect(summary.overallPercentage).toBe(91.23);
  });

  it('parses attendance table view from HTML table fixture', () => {
    const doc = loadFixture('umsAttendanceTable.html');
    const summary = parseUmsAttendance(doc);

    expect(summary).not.toBeNull();
    if (!summary) return;

    expect(summary.totalCourses).toBe(4);
    expect(summary.courses.map((c) => c.code)).toEqual([
      'CSE329',
      'CSE330',
      'CSE408',
      'CSE471'
    ]);
  });

  it('flags dataQuality warning when UMS reports a conflicting percentage', () => {
    const doc = loadFixture('umsMalformed.html');
    const summary = parseUmsAttendance(doc);

    expect(summary).not.toBeNull();
    if (!summary) return;

    expect(summary.courses[0].code).toBe('CSE999');
    expect(summary.courses[0].dataQuality).toBe('warning');
  });

  it('parses real LPU UMS StudentDashboard.aspx My Courses section', () => {
    const doc = loadFixture('umsRealDashboard.html');
    const summary = parseUmsAttendance(doc);

    expect(summary).not.toBeNull();
    if (!summary) return;

    expect(summary.totalCourses).toBe(2);
    expect(summary.studentName).toBe('Fayas Khan');
    expect(summary.registrationNumber).toBe('12104928');

    const cse329 = summary.courses.find((c) => c.code === 'CSE329');
    expect(cse329).toBeDefined();
    expect(cse329?.percentage).toBe(100);
    expect(cse329?.name).toBe('PRELUDE TO COMPETITIVE CODING');

    const cse330 = summary.courses.find((c) => c.code === 'CSE330');
    expect(cse330).toBeDefined();
    expect(cse330?.percentage).toBe(88);
    expect(cse330?.name).toBe('COMPETITIVE CODING APPROACHES-TECHNIQUES');

    // Overall attendance from ATTENDANCE : 98%
    expect(summary.overallPercentage).toBe(98);
  });

  it('parses real LPU UMS Student Attendance modal dialog table', () => {
    const doc = loadFixture('umsModalTable.html');
    const summary = parseUmsAttendance(doc);

    expect(summary).not.toBeNull();
    if (!summary) return;

    expect(summary.totalCourses).toBe(6);

    const cse329 = summary.courses.find((c) => c.code === 'CSE329');
    expect(cse329).toBeDefined();
    expect(cse329?.name).toBe('PRELUDE TO COMPETITIVE CODING');
    expect(cse329?.total).toBe(9);
    expect(cse329?.attended).toBe(9);
    expect(cse329?.percentage).toBe(100);

    const cse330 = summary.courses.find((c) => c.code === 'CSE330');
    expect(cse330).toBeDefined();
    expect(cse330?.name).toBe('COMPETITIVE CODING APPROACHES-TECHNIQUES');
    expect(cse330?.total).toBe(8);
    expect(cse330?.attended).toBe(7);
    expect(cse330?.percentage).toBe(88);

    const cse408 = summary.courses.find((c) => c.code === 'CSE408');
    expect(cse408?.name).toBe('DESIGN AND ANALYSIS OF ALGORITHMS');
    expect(cse408?.total).toBe(14);
    expect(cse408?.attended).toBe(14);
    expect(cse408?.percentage).toBe(100);

    const cse471 = summary.courses.find((c) => c.code === 'CSE471');
    expect(cse471?.name).toBe('DEEP LEARNING FOR COMPUTER VISION');
    expect(cse471?.total).toBe(12);
    expect(cse471?.attended).toBe(12);
    expect(cse471?.percentage).toBe(100);

    const cse472 = summary.courses.find((c) => c.code === 'CSE472');
    expect(cse472?.name).toBe('DEEP LEARNING FOR NATURAL LANGUAGE PROCESSING');
    expect(cse472?.total).toBe(14);
    expect(cse472?.attended).toBe(14);
    expect(cse472?.percentage).toBe(100);

    const int373 = summary.courses.find((c) => c.code === 'INT373');
    expect(int373?.name).toBe('AGILE DRIVEN DEVELOPMENT AND PROJECT MANAGEMENT');
    expect(int373?.total).toBe(12);
    expect(int373?.attended).toBe(11);
    expect(int373?.percentage).toBe(92);

    expect(summary.totalClasses).toBe(69);
    expect(summary.totalAttended).toBe(67);
    expect(summary.totalAbsent).toBe(2);
    expect(summary.overallPercentage).toBe(98);
  });

  it('returns null when DOM contains no attendance elements', () => {
    const doc = document.implementation.createHTMLDocument('Blank');
    doc.body.innerHTML = `<div>Welcome to Home Page</div>`;
    const summary = parseUmsAttendance(doc);
    expect(summary).toBeNull();
  });

  /*
   * REGRESSION (account-switch stale cache): the live StudentDashboard.aspx
   * renders "My Courses" with INLINE styles — no .card/.panel/.row ancestors.
   * The container finder fell back to the heading's immediate parent (a strip
   * with no ATTENDANCE badge), the dashboard parse returned null, the scan
   * reported NO_ATTENDANCE_ON_PAGE, and the side panel kept re-hydrating a
   * STALE cached snapshot of whichever UMS account was signed in before —
   * until the attendance modal was opened manually.
   */
  it('parses My Courses rendered with inline styles (no card/panel/row classes)', () => {
    const doc = document.implementation.createHTMLDocument('InlineDashboard');
    doc.body.innerHTML = `
      <div id="layout-content" style="padding: 12px;">
        <div style="border: 1px solid #eee; border-radius: 12px;">
          <div style="display: flex; justify-content: space-between;">
            <span style="background: #f60; color: #fff; border-radius: 6px;">My Courses</span>
          </div>
          <div style="margin-top: 10px;">
            <div style="display: flex; align-items: center;">
              <span style="font-size: 13px;">100%</span>
              <div>
                <div>CSE329 : PRELUDE TO COMPETITIVE CODING</div>
                <div>Term : 26271</div>
                <div>Roll No : RK4E0061B44 / Group 2</div>
              </div>
            </div>
            <div style="display: flex; align-items: center;">
              <span style="font-size: 13px;">95%</span>
              <div>
                <div>CSE330 : COMPETITIVE CODING APPROACHES-TECHNIQUES</div>
                <div>Term : 26271</div>
              </div>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span>CGPA : 9.66</span>
            <span>ATTENDANCE : 99%</span>
          </div>
        </div>
      </div>
    `;

    const summary = parseUmsAttendance(doc);
    expect(summary).not.toBeNull();
    if (!summary) return;

    expect(summary.courses.map((c) => c.code)).toEqual(['CSE329', 'CSE330']);
    expect(summary.courses.find((c) => c.code === 'CSE329')?.percentage).toBe(100);
    expect(summary.courses.find((c) => c.code === 'CSE330')?.percentage).toBe(95);
    // Aggregate badge from the footer, not a subject row
    expect(summary.overallPercentage).toBe(99);
  });

  it('rejects announcement, notice, and event cards like RS249 and returns null', () => {
    const doc = document.implementation.createHTMLDocument('Dashboard');
    doc.body.innerHTML = `
      <div class="card">
        <h3>RS249</h3>
        <p>Announcements - Room Cleaning Scheduled</p>
      </div>
      <div class="card">
        <h3>Happening Events</h3>
        <p>Smart India Hackathon in Room 26-305</p>
      </div>
    `;
    const summary = parseUmsAttendance(doc);
    expect(summary).toBeNull();
  });

  /*
   * REGRESSION: the 2026-10-08 screenshots showed ONEE's Subjects card listing
   * ON19, TERM2026 and PARTY2026 (notification text parsed as courses) while the
   * real UMS attendance modal contains only CSE329, CSE330, CSE408, CSE471,
   * CSE472, INT373, PEAS01 and PEVS01.
   */
  describe('phantom subject regression gate (ON19 / TERM2026 / PARTY2026)', () => {
    it('rejects notification-shaped codes and accepts real LPU course codes', () => {
      // Phantom codes seen in the regression screenshots
      expect(isValidCourseCode('ON19')).toBe(false);
      expect(isValidCourseCode('TERM2026')).toBe(false);
      expect(isValidCourseCode('PARTY2026')).toBe(false);
      expect(isValidCourseCode('TERM 2026')).toBe(false);
      // Real subjects from the visible UMS attendance modal
      for (const code of ['CSE329', 'CSE330', 'CSE408', 'CSE471', 'CSE472', 'INT373', 'PEAS01', 'PEVS01']) {
        expect(isValidCourseCode(code)).toBe(true);
      }
    });

    it('extracts ONLY real attendance rows from a dashboard polluted with notification text', () => {
      const doc = document.implementation.createHTMLDocument('Dashboard');
      doc.body.innerHTML = `
        <div class="card">
          <h3>My Courses</h3>
          <div>ATTENDANCE : 99%</div>
          <div>TERM2026 : Result for TERM2026 has been displayed in your UMS. 4/8/2026</div>
          <div>ON19 : Holiday on 19 September 2026 have been declared</div>
          <div>PARTY2026 : LPU Welcomes New Vertos with Talent, Energy and Celebration</div>
          <div>CSE330 : COMPETITIVE CODING APPROACHES - TECHNIQUES 95% 19/21 Last updated 4/8/2026</div>
        </div>
      `;

      const summary = parseUmsAttendance(doc);
      expect(summary).not.toBeNull();
      if (!summary) return;

      // Only the real course row may enter the verified dataset
      expect(summary.courses.map((c) => c.code)).toEqual(['CSE330']);
      expect(summary.courses.some((c) => c.code === 'ON19')).toBe(false);
      expect(summary.courses.some((c) => c.code === 'TERM2026')).toBe(false);
      expect(summary.courses.some((c) => c.code === 'PARTY2026')).toBe(false);

      const cse330 = summary.courses[0];
      expect(cse330.name).toContain('COMPETITIVE CODING');
      expect(cse330.percentage).toBe(95);
      // The "4/8/2026" date fragment must NEVER be read as an attended/total fraction
      expect(cse330.attended).toBe(19);
      expect(cse330.total).toBe(21);
      // Aggregate badge stored separately, never as a subject
      expect(summary.overallPercentage).toBe(99);
    });

    it('stamps every parsed record with ums-attendance-dom provenance', () => {
      const doc = document.implementation.createHTMLDocument('Dashboard');
      doc.body.innerHTML = `
        <div class="card">
          <h3>My Courses</h3>
          <div>ATTENDANCE : 99%</div>
          <div>CSE330 : COMPETITIVE CODING 95% 19/21</div>
        </div>
      `;
      const summary = parseUmsAttendance(doc);
      expect(summary).not.toBeNull();
      for (const course of summary?.courses || []) {
        expect(course.source).toBe('ums-attendance-dom');
      }
    });
  });
});
