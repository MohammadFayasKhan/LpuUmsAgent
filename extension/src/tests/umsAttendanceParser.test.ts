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
import { parseUmsAttendance } from '../content/umsAttendanceParser';
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
});
