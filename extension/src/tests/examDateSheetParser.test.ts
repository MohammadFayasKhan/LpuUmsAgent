/*
 * Examination Date Sheet & Seating Plan DOM Parser Test Suite.
 *
 * Validates deterministic table extraction, card layouts,
 * seating allocation parsing, and Date Sheet link detection.
 */

import { describe, it, expect } from 'vitest';
import { parseExamDateSheet, findExaminationCardElements } from '../content/examination/examDateSheetParser';
import { parseSeatingPlan } from '../content/examination/seatingPlanParser';
import { isExaminationPage, findDateSheetLinkElement } from '../content/examination/examinationDetector';
import { validateExaminationSummary } from '../content/examination/examinationValidator';

describe('examDateSheetParser & seatingPlanParser', () => {
  describe('Student UMS Seating Plan Table Parsing', () => {
    it('parses standard table rows on studentums.lpu.in', () => {
      const doc = document.implementation.createHTMLDocument('Seating Plan');
      doc.body.innerHTML = `
        <div class="card">
          <div class="card-header">
            <h4>Seating Plan / Date Sheet</h4>
          </div>
          <table class="table table-bordered">
            <thead>
              <tr>
                <th>Course Code</th>
                <th>Course Title</th>
                <th>Date</th>
                <th>Time Slot</th>
                <th>Reporting Time</th>
                <th>Room No</th>
                <th>Seat No</th>
                <th>Venue / Block</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>CSE329</td>
                <td>Cloud Computing</td>
                <td>15-Oct-2026</td>
                <td>09:00 AM - 12:00 PM</td>
                <td>08:30 AM</td>
                <td>301</td>
                <td>A-12</td>
                <td>Block 34</td>
              </tr>
              <tr>
                <td>CSE330</td>
                <td>Web Technologies</td>
                <td>18-Oct-2026</td>
                <td>01:30 PM - 04:30 PM</td>
                <td>01:00 PM</td>
                <td>302</td>
                <td>B-05</td>
                <td>Block 34</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;

      const summary = parseExamDateSheet(doc);
      expect(summary).not.toBeNull();
      expect(summary?.totalExams).toBe(2);

      const exam1 = summary?.exams[0];
      expect(exam1?.courseCode).toBe('CSE329');
      expect(exam1?.courseName).toBe('Cloud Computing');
      expect(exam1?.examDate).toBe('15 Oct 2026');
      expect(exam1?.startTime).toBe('09:00');
      expect(exam1?.endTime).toBe('12:00');
      expect(exam1?.reportingTime).toBe('08:30');
      expect(exam1?.room).toBe('301');
      expect(exam1?.seat).toBe('A-12');
      expect(exam1?.venue).toBe('Block 34');

      const exam2 = summary?.exams[1];
      expect(exam2?.courseCode).toBe('CSE330');
      expect(exam2?.startTime).toBe('13:30');
      expect(exam2?.room).toBe('302');
      expect(exam2?.seat).toBe('B-05');
    });

    it('handles tables where seat or room is not yet assigned', () => {
      const doc = document.implementation.createHTMLDocument('Date Sheet');
      doc.body.innerHTML = `
        <table id="tblDateSheet">
          <thead>
            <tr>
              <th>Course</th>
              <th>Date</th>
              <th>Timing</th>
              <th>Venue</th>
              <th>Room</th>
              <th>Seat</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>INT213</td>
              <td>22-Oct-2026</td>
              <td>10:00 AM - 01:00 PM</td>
              <td>Block 38</td>
              <td>-</td>
              <td>Not Allocated</td>
            </tr>
          </tbody>
        </table>
      `;

      const summary = parseExamDateSheet(doc);
      expect(summary).not.toBeNull();
      expect(summary?.totalExams).toBe(1);

      const exam = summary?.exams[0];
      expect(exam?.courseCode).toBe('INT213');
      expect(exam?.room).toBeUndefined(); // Normalized '-' to undefined
      expect(exam?.seat).toBeUndefined(); // Normalized 'Not Allocated' to undefined
      expect(exam?.venue).toBe('Block 38');
    });
  });

  describe('Card-based Schedule Parsing', () => {
    it('parses card containers when table is rendered as cards', () => {
      const doc = document.implementation.createHTMLDocument('Exam Cards');
      doc.body.innerHTML = `
        <div class="exam-list">
          <div class="exam-card">
            <span class="badge">CSE408</span>
            <div class="exam-date">25-Oct-2026</div>
            <div class="exam-time">09:00 AM - 12:00 PM</div>
            <div class="exam-venue">Block 36, Room 201, Seat C-14</div>
          </div>
        </div>
      `;

      const summary = parseExamDateSheet(doc);
      expect(summary).not.toBeNull();
      expect(summary?.totalExams).toBe(1);
      expect(summary?.exams[0].courseCode).toBe('CSE408');
      expect(summary?.exams[0].examDate).toBe('25 Oct 2026');
      expect(summary?.exams[0].room).toBe('201');
      expect(summary?.exams[0].seat).toBe('C-14');
    });

    it('parses seating plans and detects seat allocation', () => {
      const doc = document.implementation.createHTMLDocument('Seating Plan');
      doc.body.innerHTML = `
        <table>
          <thead>
            <tr><th>Course</th><th>Date</th><th>Room</th><th>Seat</th></tr>
          </thead>
          <tbody>
            <tr><td>CSE408</td><td>25-Oct-2026</td><td>201</td><td>C-14</td></tr>
          </tbody>
        </table>
      `;

      const plan = parseSeatingPlan(doc);
      expect(plan).not.toBeNull();
      expect(plan?.totalAllocations).toBe(1);
      expect(plan?.seatingPlans[0].hasSeatAllocated).toBe(true);
      expect(plan?.seatingPlans[0].seat).toBe('C-14');
    });
  });

  describe('examinationDetector', () => {
    it('detects examination pages by URL and DOM signals', () => {
      const doc = document.implementation.createHTMLDocument('Conduct');
      doc.body.innerHTML = `
        <h3>Examination Conduct - Seating Plan</h3>
        <table><tr><th>Course Code</th><th>Exam Date</th></tr></table>
      `;

      expect(isExaminationPage('https://studentums.lpu.in/dashboard/examination/conduct/seatingplan', doc)).toBe(true);
      expect(isExaminationPage('https://ums.lpu.in/lpuums/ExaminationDateSheet.aspx', doc)).toBe(true);
      expect(isExaminationPage('https://ums.lpu.in/lpuums/StudentDashboard.aspx', doc)).toBe(false);
    });

    it('locates the Date Sheet link element under Important Links', () => {
      const doc = document.implementation.createHTMLDocument('Student Dashboard');
      doc.body.innerHTML = `
        <nav class="navbar">Top Navigation</nav>
        <div class="important-links-section">
          <h5>Important Links</h5>
          <ul>
            <li><a href="/feepayment">Pay Fees</a></li>
            <li><a id="lnkDateSheet" href="https://studentums.lpu.in/dashboard/examination/conduct/seatingplan">Date Sheet</a></li>
            <li><a href="/hostel">Hostel Booking</a></li>
          </ul>
        </div>
      `;

      const found = findDateSheetLinkElement(doc);
      expect(found).not.toBeNull();
      expect(found?.id).toBe('lnkDateSheet');
      expect(found?.textContent?.trim()).toBe('Date Sheet');
    });
  });

  describe('Live Angular SPA Exam Card Parsing & Rendering Readiness', () => {
    it('parses the exact live UMS student seating plan card layout with relative reporting time', () => {
      const doc = document.implementation.createHTMLDocument('Seating Plan');
      doc.body.innerHTML = `
        <div class="examination-container">
          <div class="header-badges">
            <span class="badge">Total Exam: 1</span>
            <span class="badge">Today's Exam: 0</span>
            <span class="badge">Upcoming Exam: 1</span>
            <span class="badge">Not Allowed: 0</span>
          </div>
          <div class="exam-list">
            <div class="exam-card-item" style="padding: 16px; border: 1px solid #ccc;">
              <div class="course-header">
                <h5>CSE443 - Practical End Term Regular</h5>
              </div>
              <div class="schedule-details">
                <p>13 Sep 2026 | 14:00-17:00 [Report 30 minutes before the start of exam as examination entry will close 15 minutes before start of exam]</p>
              </div>
              <div class="links-and-status">
                <a href="https://exam.lpu.in/practical" class="btn-link">Online Exam Link</a>
                <span class="instruction-text">Instruction - Awaited</span>
              </div>
            </div>
          </div>
        </div>
      `;

      const summary = parseExamDateSheet(doc);
      expect(summary).not.toBeNull();
      expect(summary?.totalExams).toBe(1);

      const exam = summary?.exams[0];
      expect(exam?.courseCode).toBe('CSE443');
      expect(exam?.courseName).toBe('Practical End Term Regular');
      expect(exam?.examDate).toBe('13 Sep 2026');
      expect(exam?.startTime).toBe('14:00');
      expect(exam?.endTime).toBe('17:00');
      expect(exam?.reportingTime).toBe('13:30 (30 mins before)');
      expect(exam?.examType).toBe('Practical End Term Regular');
      expect(exam?.mode).toBe('Online Exam');
      expect(exam?.venue).toContain('Online Exam Link');
    });

    it('detects when examination content is rendered vs still loading', async () => {
      const { isExaminationContentRendered, waitForExaminationContent } = await import('../content/examination/examinationDetector');

      // 1. Initial shell with badges only (no records yet)
      const doc = document.implementation.createHTMLDocument('Seating Plan');
      doc.body.innerHTML = `
        <div class="seating-plan-shell">
          <h2>Examination Date Sheet</h2>
          <div class="stats-row">
            <span>Total Exam: 1</span>
          </div>
          <div id="examContainer"></div>
        </div>
      `;

      const initialCheck = isExaminationContentRendered(doc);
      expect(initialCheck.rendered).toBe(false);
      expect(initialCheck.count).toBe(0);

      // 2. Dynamic injection (simulating Angular 4-5s async fetch)
      const container = doc.getElementById('examContainer')!;
      const card = doc.createElement('div');
      card.className = 'exam-item';
      card.innerHTML = `
        <h4>CSE443 - Practical End Term Regular</h4>
        <p>13 Sep 2026 | 14:00-17:00</p>
      `;
      container.appendChild(card);

      const afterRenderCheck = isExaminationContentRendered(doc);
      expect(afterRenderCheck.rendered).toBe(true);
      expect(afterRenderCheck.count).toBe(1);

      // 3. waitForExaminationContent on rendered document
      const waitResult = await waitForExaminationContent(1000, doc);
      expect(waitResult.success).toBe(true);
      expect(waitResult.count).toBe(1);
    });

    it('finds the DOM element corresponding to a target course code', async () => {
      const { findExamElementForCourse } = await import('../content/actionEngine');

      const doc = document.implementation.createHTMLDocument('Seating Plan');
      doc.body.innerHTML = `
        <div class="exam-list">
          <div id="card-cse443" class="exam-leaf-card">
            <h4>CSE443 - Practical End Term Regular</h4>
            <p>13 Sep 2026 | 14:00-17:00</p>
          </div>
          <div id="card-cse330" class="exam-leaf-card">
            <h4>CSE330 - Web Technologies</h4>
            <p>18 Oct 2026 | 09:00-12:00</p>
          </div>
        </div>
      `;

      const element = findExamElementForCourse('CSE443', doc);
      expect(element).not.toBeNull();
      expect(element?.textContent).toContain('CSE443');
    });

    it('plans click on Date Sheet when on StudentDashboard.aspx instead of premature extraction', async () => {
      const { generateLocalPlanFallback } = await import('../services/api');

      const dashboardObservation: any = {
        url: 'https://ums.lpu.in/lpuums/StudentDashboard.aspx',
        title: 'Student Dashboard',
        pageType: 'Student Dashboard',
        isExamPage: false,
        elements: [
          { id: 'onee-001', text: 'ATTENDANCE : 98%', tag: 'a', role: 'button' },
          { id: 'onee-002', text: 'Date Sheet (Important Links)', tag: 'a', role: 'link', href: 'https://studentums.lpu.in/dashboard/examination/conduct/seatingplan' },
          { id: 'onee-003', text: 'My Messages', tag: 'div', role: 'card' }
        ]
      };

      const plan = generateLocalPlanFallback('When is my next exam and where is my seat?', 1, dashboardObservation, []);
      expect(plan.action.action).toBe('click');
      expect(plan.action.elementId).toBe('onee-002');
      expect(plan.isGoalComplete).toBe(false);
    });

    it('validates dates and rejects placeholders like TBD or NIL', async () => {
      const { isValidExamDate, normalizeExamDate } = await import('../content/examination/examDateSheetParser');

      expect(isValidExamDate('13 Sep 2026')).toBe(true);
      expect(isValidExamDate('13-09-2026')).toBe(true);
      expect(isValidExamDate('2026-09-13')).toBe(true);

      expect(isValidExamDate('TBD')).toBe(false);
      expect(isValidExamDate('NIL')).toBe(false);
      expect(isValidExamDate('Pending')).toBe(false);
      expect(isValidExamDate('NOT SCHEDULED')).toBe(false);
      expect(isValidExamDate('')).toBe(false);
      expect(isValidExamDate(undefined)).toBe(false);

      expect(normalizeExamDate('13-Sep-2026')).toBe('13 Sep 2026');
      expect(normalizeExamDate('TBD')).toBe('');
      expect(normalizeExamDate('NIL')).toBe('');
    });

    it('extracts ONLY courses that have an actual scheduled date in the date sheet', async () => {
      const { parseExamDateSheet } = await import('../content/examination/examDateSheetParser');

      const doc = document.implementation.createHTMLDocument('Seating Plan');
      // Simulate seating plan containing 1 scheduled exam (CSE443) and other items without dates
      doc.body.innerHTML = `
        <div class="registration-info">
          <span>Reg No: 12345678</span>
          <span>Name: John Doe</span>
        </div>
        <table class="exam-table">
          <thead>
            <tr>
              <th>Course Code</th>
              <th>Course Name</th>
              <th>Exam Date</th>
              <th>Time</th>
              <th>Room</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>CSE443</td>
              <td>Practical End Term Regular</td>
              <td>13-Sep-2026</td>
              <td>14:00 - 17:00</td>
              <td>Room 34-201</td>
            </tr>
            <tr>
              <td>CSE329</td>
              <td>Theory Course</td>
              <td>TBD</td>
              <td></td>
              <td></td>
            </tr>
            <tr>
              <td>CSE330</td>
              <td>Web Technologies</td>
              <td></td>
              <td></td>
              <td></td>
            </tr>
          </tbody>
        </table>
      `;

      const result = parseExamDateSheet(doc);
      expect(result).not.toBeNull();
      // Must contain ONLY the 1 scheduled exam, NOT all registered courses!
      expect(result?.totalExams).toBe(1);
      expect(result?.exams.length).toBe(1);
      expect(result?.exams[0].courseCode).toBe('CSE443');
      expect(result?.exams[0].examDate).toBe('13 Sep 2026');
    });
  });

  describe('Multi-Exam Card Parsing (7 exams)', () => {
    it('parses all 7 exam cards from an Angular SPA card-based layout', () => {
      const doc = document.implementation.createHTMLDocument('Seating Plan');
      doc.body.innerHTML = `
        <div class="examination-container">
          <div class="header-badges">
            <span class="badge">Total Exam: 7</span>
            <span class="badge">Today's Exam: 1</span>
            <span class="badge">Upcoming Exam: 6</span>
            <span class="badge">Not Allowed: 0</span>
          </div>
          <div class="exam-list">
            <div class="exam-card-item" style="padding: 16px; border: 1px solid #ccc;">
              <div class="course-header"><h5>CSE443 - Practical End Term Regular</h5></div>
              <div class="schedule-details"><p>13 Sep 2026 | 14:00-17:00 [Report 30 minutes before]</p></div>
              <div class="links-and-status"><a href="#" class="btn-link">Online Exam Link</a></div>
            </div>
            <div class="exam-card-item" style="padding: 16px; border: 1px solid #ccc;">
              <div class="course-header"><h5>INT373 - Cloud Computing</h5></div>
              <div class="schedule-details"><p>16 Sep 2026 | 09:00-12:00</p></div>
            </div>
            <div class="exam-card-item" style="padding: 16px; border: 1px solid #ccc;">
              <div class="course-header"><h5>CSE329 - Data Structures</h5></div>
              <div class="schedule-details"><p>18-09-2026 | 14:00-17:00</p></div>
            </div>
            <div class="exam-card-item" style="padding: 16px; border: 1px solid #ccc;">
              <div class="course-header"><h5>ECE249 - Digital Electronics</h5></div>
              <div class="schedule-details"><p>20 Sep 2026 | 09:00-12:00</p></div>
            </div>
            <div class="exam-card-item" style="padding: 16px; border: 1px solid #ccc;">
              <div class="course-header"><h5>MTH166 - Mathematics</h5></div>
              <div class="schedule-details"><p>22-09-2026 | 14:00-17:00</p></div>
            </div>
            <div class="exam-card-item" style="padding: 16px; border: 1px solid #ccc;">
              <div class="course-header"><h5>CAP421 - Web Technologies</h5></div>
              <div class="schedule-details"><p>25 Sep 2026 | 09:00-12:00</p></div>
            </div>
            <div class="exam-card-item" style="padding: 16px; border: 1px solid #ccc;">
              <div class="course-header"><h5>CSE408 - Theory of Computation</h5></div>
              <div class="schedule-details"><p>28 Sep 2026 | 14:00-17:00</p></div>
            </div>
          </div>
        </div>
      `;

      const summary = parseExamDateSheet(doc);
      expect(summary).not.toBeNull();
      expect(summary?.totalExams).toBe(7);
      expect(summary?.exams.length).toBe(7);

      const codes = summary?.exams.map((e) => e.courseCode).sort();
      expect(codes).toEqual(['CAP421', 'CSE329', 'CSE408', 'CSE443', 'ECE249', 'INT373', 'MTH166']);

      // Verify date extraction on varied formats
      const cse443 = summary?.exams.find((e) => e.courseCode === 'CSE443');
      expect(cse443?.examDate).toBe('13 Sep 2026');
      expect(cse443?.startTime).toBe('14:00');

      const cse329 = summary?.exams.find((e) => e.courseCode === 'CSE329');
      expect(cse329?.examDate).toBe('18 Sep 2026'); // Normalized from DD-MM-YYYY

      const mth166 = summary?.exams.find((e) => e.courseCode === 'MTH166');
      expect(mth166?.examDate).toBe('22 Sep 2026'); // Normalized from DD-MM-YYYY
    });
  });

  describe('Live Student UMS 6-Exam Multi-Term Schedule (from user screenshot)', () => {
    it('parses all 6 exams including duplicate course codes (CSE408 x 2, INT373 x 2, CSE471, CSE472)', async () => {
      const { validateExaminationSummary } = await import('../content/examination/examinationValidator');

      const doc = document.implementation.createHTMLDocument('Examination Date Sheet');
      doc.body.innerHTML = `
        <div class="dashboard-body">
          <div class="header-section">
            <h2>Examination Date Sheet</h2>
            <div class="stats-cards">
              <div class="card stat-card"><p>Total Exam</p><h3>6</h3></div>
              <div class="card stat-card"><p>Today's Exam</p><h3>0</h3></div>
              <div class="card stat-card"><p>Upcoming Exam</p><h3>6</h3></div>
              <div class="card stat-card"><p>Not Allowed</p><h3>0</h3></div>
            </div>
          </div>
          <div class="datesheet-content">
            <!-- Exam 1 -->
            <div class="conduct-card" style="border-left: 4px solid orange;">
              <div class="header"><h4>CSE408 -</h4><span class="badge">Upcoming</span></div>
              <div class="schedule">
                <span class="date">06 Oct 2026</span>
                <span class="time">10:00-11:30 [Report 30 minutes before the start of exam as examination entry will close 15 minutes before start of exam]</span>
              </div>
              <div class="details"><span class="status">Awaited</span> <span class="type">Theory Mid Term - All MCQ Objective Type</span> <span class="badge">Regular</span></div>
              <div class="instructions"><span>30 Multiple Choice Questions of 1 Mark each</span></div>
            </div>

            <!-- Exam 2 -->
            <div class="conduct-card" style="border-left: 4px solid orange;">
              <div class="header"><h4>INT373 -</h4><span class="badge">Upcoming</span></div>
              <div class="schedule">
                <span class="date">08 Oct 2026</span>
                <span class="time">10:00-11:30 [Report 30 minutes before the start of exam as examination entry will close 15 minutes before start of exam]</span>
              </div>
              <div class="details"><span class="status">Awaited</span> <span class="type">Theory Mid Term - All Subjective</span> <span class="badge">Regular</span></div>
              <div class="instructions"><span>5 Short Question 2 Marks each, 3 Long Questions 10 Marks each</span></div>
            </div>

            <!-- Exam 3 -->
            <div class="conduct-card" style="border-left: 4px solid orange;">
              <div class="header"><h4>CSE408 -</h4><span class="badge">Upcoming</span></div>
              <div class="schedule">
                <span class="date">15 Dec 2026</span>
                <span class="time">09:30-12:30 [Report 30 minutes before the start of exam as examination entry will close 15 minutes before start of exam]</span>
              </div>
              <div class="details"><span class="status">Awaited</span> <span class="type">Theory End Term - All MCQ Objective Type</span> <span class="badge">Regular</span></div>
              <div class="instructions"><span>60 Multiple Choice Questions of 1 Mark each</span></div>
              <div class="actions"><button class="btn">Sample Question Paper</button></div>
            </div>

            <!-- Exam 4 -->
            <div class="conduct-card" style="border-left: 4px solid orange;">
              <div class="header"><h4>CSE471 -</h4><span class="badge">Upcoming</span></div>
              <div class="schedule">
                <span class="date">17 Dec 2026</span>
                <span class="time">09:30-12:30 [Report 30 minutes before the start of exam as examination entry will close 15 minutes before start of exam]</span>
              </div>
              <div class="details"><span class="status">Awaited</span> <span class="type">Theory End Term - All MCQ Objective Type</span> <span class="badge">Regular</span></div>
              <div class="instructions"><span>60 Multiple Choice Questions of 1 Mark each</span></div>
            </div>

            <!-- Exam 5 -->
            <div class="conduct-card" style="border-left: 4px solid orange;">
              <div class="header"><h4>INT373 -</h4><span class="badge">Upcoming</span></div>
              <div class="schedule">
                <span class="date">19 Dec 2026</span>
                <span class="time">09:30-12:30 [Report 30 minutes before the start of exam as examination entry will close 15 minutes before start of exam]</span>
              </div>
              <div class="details"><span class="status">Awaited</span> <span class="type">Theory End Term - All Subjective</span> <span class="badge">Regular</span></div>
              <div class="instructions"><span>Part A - 10 Questions of 2 marks each Part - B Attempt any 5 out of 6 Questions of 10 marks each</span></div>
              <div class="actions"><button class="btn">Sample Question Paper</button></div>
            </div>

            <!-- Exam 6 -->
            <div class="conduct-card" style="border-left: 4px solid orange;">
              <div class="header"><h4>CSE472 -</h4><span class="badge">Upcoming</span></div>
              <div class="schedule">
                <span class="date">24 Dec 2026</span>
                <span class="time">09:30-12:30 [Report 30 minutes before the start of exam as examination entry will close 15 minutes before start of exam]</span>
              </div>
              <div class="details"><span class="status">Awaited</span> <span class="type">Theory End Term - All MCQ Objective Type</span> <span class="badge">Regular</span></div>
              <div class="instructions"><span>60 Multiple Choice Questions of 1 Mark each</span></div>
            </div>
          </div>
        </div>
      `;

      const summary = parseExamDateSheet(doc);
      expect(summary).not.toBeNull();
      expect(summary?.totalExams).toBe(6);
      expect(summary?.exams.length).toBe(6);

      // Verify all 6 exams exist
      const cse408Exams = summary!.exams.filter((e) => e.courseCode === 'CSE408');
      expect(cse408Exams.length).toBe(2);
      expect(cse408Exams.some((e) => e.examDate === '6 Oct 2026' || e.examDate === '06 Oct 2026')).toBe(true);
      expect(cse408Exams.some((e) => e.examDate === '15 Dec 2026')).toBe(true);

      const int373Exams = summary!.exams.filter((e) => e.courseCode === 'INT373');
      expect(int373Exams.length).toBe(2);
      expect(int373Exams.some((e) => e.examDate === '8 Oct 2026' || e.examDate === '08 Oct 2026')).toBe(true);
      expect(int373Exams.some((e) => e.examDate === '19 Dec 2026')).toBe(true);

      const cse471 = summary!.exams.find((e) => e.courseCode === 'CSE471');
      expect(cse471).toBeDefined();
      expect(cse471?.examDate).toBe('17 Dec 2026');

      const cse472 = summary!.exams.find((e) => e.courseCode === 'CSE472');
      expect(cse472).toBeDefined();
      expect(cse472?.examDate).toBe('24 Dec 2026');

      // Sample papers
      const cse408End = cse408Exams.find((e) => e.examDate === '15 Dec 2026');
      expect(cse408End?.samplePaper?.available).toBe(true);

      const int373End = int373Exams.find((e) => e.examDate === '19 Dec 2026');
      expect(int373End?.samplePaper?.available).toBe(true);

      // Validation passes without any impossible state issues
      const validation = validateExaminationSummary(summary!);
      expect(validation.valid).toBe(true);
      expect(validation.issues).toHaveLength(0);
      expect(validation.verifiedCount).toBe(6);
    });

    it('correctly parses dates when child span elements concatenate without spaces like 06 Oct2026', () => {
      const doc = document.implementation.createHTMLDocument('Seating Plan');
      doc.body.innerHTML = `
        <div class="card">
          <h4>CSE408 -</h4>
          <div class="schedule">
            <span class="date"><span>06 Oct</span><span>2026</span></span>
            <span class="time">10:00-11:30</span>
          </div>
          <div class="details"><span>Theory Mid Term</span></div>
        </div>
      `;

      const summary = parseExamDateSheet(doc);
      expect(summary).not.toBeNull();
      expect(summary?.exams.length).toBe(1);
      expect(summary?.exams[0].courseCode).toBe('CSE408');
      expect(summary?.exams[0].examDate).toBe('6 Oct 2026');
      expect(summary?.exams[0].startTime).toBe('10:00');
      expect(summary?.exams[0].endTime).toBe('11:30');
    });

    it('successfully parses all 6 exams from live UMS structure containing SVG icons and mixed types', () => {
      const doc = document.implementation.createHTMLDocument('Examination Date Sheet');
      doc.body.innerHTML = `
        <div class="conduct-container">
          <div class="row header-stats">
            <div class="stat-box"><span class="title">Total Exam</span><span class="count">6</span></div>
            <div class="stat-box"><span class="title">Today's Exam</span><span class="count">0</span></div>
            <div class="stat-box"><span class="title">Upcoming Exam</span><span class="count">6</span></div>
          </div>
          <div class="exam-list">
            <!-- Exam 1 -->
            <div class="card p-3 mb-3">
              <div class="d-flex justify-content-between">
                <h4>CSE408 - Theory of Computation</h4>
                <span class="badge">Upcoming</span>
              </div>
              <div class="schedule-info">
                <span><svg class="svg-inline--fa fa-calendar"></svg> 06 Oct 2026</span>
                <span><svg class="svg-inline--fa fa-clock"></svg> 10:00-11:30 [Report 30 minutes before the start of exam as examination entry will close 15 minutes before start of exam]</span>
              </div>
              <div class="details-info">
                <span>Awaited</span>
                <span>Theory Mid Term - All MCQ Objective Type</span>
                <span class="badge badge-primary">Regular</span>
              </div>
              <p>30 Multiple Choice Questions of 1 Mark each</p>
              <button class="btn btn-sm btn-outline-primary">Sample Question Paper</button>
            </div>

            <!-- Exam 2 -->
            <div class="card p-3 mb-3">
              <div class="d-flex justify-content-between">
                <h4>INT373 - High Performance Computing</h4>
                <span class="badge">Upcoming</span>
              </div>
              <div class="schedule-info">
                <span><svg class="svg-inline--fa fa-calendar"></svg> 09 Oct 2026</span>
                <span><svg class="svg-inline--fa fa-clock"></svg> 14:00-15:30 [Report 30 minutes before the start of exam]</span>
              </div>
              <div class="details-info">
                <span>Room 34-402, Block 34</span>
                <span>Theory Mid Term - Subjective</span>
                <span class="badge badge-primary">Regular</span>
              </div>
              <p>Subjective Written Examination</p>
            </div>

            <!-- Exam 3 -->
            <div class="card p-3 mb-3">
              <div class="d-flex justify-content-between">
                <h4>CSE443 - Cloud Computing Architecture</h4>
                <span class="badge">Upcoming</span>
              </div>
              <div class="schedule-info">
                <span><svg class="svg-inline--fa fa-calendar"></svg> 13 Oct 2026</span>
                <span><svg class="svg-inline--fa fa-clock"></svg> 10:00-11:30 [Report 30 minutes before the start of exam]</span>
              </div>
              <div class="details-info">
                <span>Awaited</span>
                <span>Theory Mid Term - All MCQ Objective Type</span>
              </div>
            </div>

            <!-- Exam 4 -->
            <div class="card p-3 mb-3">
              <div class="d-flex justify-content-between">
                <h4>CSE320 - Software Engineering Practices</h4>
                <span class="badge">Upcoming</span>
              </div>
              <div class="schedule-info">
                <span><svg class="svg-inline--fa fa-calendar"></svg> 16 Oct 2026</span>
                <span><svg class="svg-inline--fa fa-clock"></svg> 14:00-17:00</span>
              </div>
              <div class="details-info">
                <span>Block 38, Room 204, Seat D-12</span>
                <span>Practical End Term</span>
              </div>
            </div>

            <!-- Exam 5 -->
            <div class="card p-3 mb-3">
              <div class="d-flex justify-content-between">
                <h4>PEA306 - Analytical Skills</h4>
                <span class="badge">Upcoming</span>
              </div>
              <div class="schedule-info">
                <span><svg class="svg-inline--fa fa-calendar"></svg> 20 Oct 2026</span>
                <span><svg class="svg-inline--fa fa-clock"></svg> 09:00-10:30</span>
              </div>
              <div class="details-info">
                <span>Awaited</span>
                <span>Theory Mid Term</span>
              </div>
            </div>

            <!-- Exam 6: Same course code INT373 but practical on different date -->
            <div class="card p-3 mb-3">
              <div class="d-flex justify-content-between">
                <h4>INT373 - High Performance Computing Lab</h4>
                <span class="badge">Upcoming</span>
              </div>
              <div class="schedule-info">
                <span><svg class="svg-inline--fa fa-calendar"></svg> 24 Oct 2026</span>
                <span><svg class="svg-inline--fa fa-clock"></svg> 11:00-13:00</span>
              </div>
              <div class="details-info">
                <span>Block 34, Lab 405</span>
                <span>Practical Mid Term</span>
              </div>
            </div>
          </div>
        </div>
      `;

      const summary = parseExamDateSheet(doc);
      expect(summary).not.toBeNull();
      expect(summary?.exams.length).toBe(6);

      const codes = summary!.exams.map((e) => e.courseCode);
      expect(codes).toEqual(['CSE408', 'INT373', 'CSE443', 'CSE320', 'PEA306', 'INT373']);

      // Verify validation passes for all 6
      const validation = validateExaminationSummary(summary!);
      expect(validation.valid).toBe(true);
      expect(validation.verifiedCount).toBe(6);

      // Verify course title normalization preserved course name
      const cse408 = summary!.exams.find((e) => e.courseCode === 'CSE408');
      expect(cse408?.courseName).toBe('Theory of Computation');
      expect(cse408?.reportingTime).toBe('09:30 (30 mins before)');

      // Verify seating details
      const cse320 = summary!.exams.find((e) => e.courseCode === 'CSE320');
      expect(cse320?.room).toBe('204');
      expect(cse320?.seat).toBe('D-12');

      // Verify sample paper detected on exam 1
      expect(cse408?.samplePaper?.available).toBe(true);
    });

    it('extracts real CSE408 examination card from the exact user screenshot DOM layout', () => {
      const doc = document.implementation.createHTMLDocument('Examination Date Sheet');
      doc.body.innerHTML = `
        <div class="dashboard-page">
          <div class="top-nav">
            <span class="breadcrumb">Home > Examination Date Sheet</span>
            <h3>Examination Date Sheet</h3>
          </div>
          <div class="stats-overview row">
            <div class="stat-card col"><span>Total Exam</span> <strong>6</strong></div>
            <div class="stat-card col"><span>Today's Exam</span> <strong>0</strong></div>
            <div class="stat-card col"><span>Upcoming Exam</span> <strong>6</strong></div>
            <div class="stat-card col"><span>Not Allowed</span> <strong>0</strong></div>
          </div>
          <div class="toolbar-row">
            <input type="text" placeholder="Search" />
            <button class="btn btn-primary"><i class="fa fa-download"></i> Admit Card</button>
          </div>
          <div class="alert alert-warning">
            Note :: In case an Unfair Means Case (UMC) is registered against you, it will lead to permanent cancellation of your scholarship.
          </div>
          <div class="seatingplan-container">
            <div class="card conduct-card mb-4" style="border-left: 4px solid #ffb020; border-radius: 8px;">
              <div class="card-header d-flex justify-content-between align-items-center">
                <h4 class="mb-0">CSE408 -</h4>
                <span class="badge bg-secondary">Upcoming</span>
              </div>
              <div class="card-body">
                <div class="schedule-timing-row border-bottom pb-2 mb-2">
                  <span class="exam-date"><i class="fa fa-calendar"></i> 06 Oct 2026</span>
                  <span class="exam-time ms-3"><i class="fa fa-clock"></i> 10:00-11:30 [Report 30 minutes before the start of exam as examination entry will close 15 minutes before start of exam]</span>
                </div>
                <div class="seating-status-row d-flex align-items-center mb-2">
                  <span class="venue-status me-3"><i class="fa fa-home"></i> Awaited</span>
                  <span class="exam-pattern me-2"><i class="fa fa-certificate"></i> Theory Mid Term - All MCQ Objective Type</span>
                  <span class="badge bg-primary">Regular</span>
                </div>
                <div class="instructions-row text-muted">
                  <i class="fa fa-info-circle"></i> 30 Multiple Choice Questions of 1 Mark each
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      const summary = parseExamDateSheet(doc);
      expect(summary).not.toBeNull();
      expect(summary?.totalExams).toBe(6);
      expect(summary?.exams.length).toBe(1);

      const exam = summary?.exams[0];
      expect(exam?.courseCode).toBe('CSE408');
      expect(exam?.examDate).toBe('6 Oct 2026');
      expect(exam?.startTime).toBe('10:00');
      expect(exam?.endTime).toBe('11:30');
      expect(exam?.reportingTime).toBe('09:30 (30 mins before)');
      expect(exam?.examType).toBe('Theory Mid Term - All MCQ Objective Type');
      expect(exam?.courseName).toBe('Theory Mid Term - All MCQ Objective Type');
      expect(exam?.instructions).toContain('30 Multiple Choice Questions of 1 Mark each');
    });

    it('does not prune outer card when nested child elements match candidate selectors', () => {
      const doc = document.implementation.createHTMLDocument('Exam Date Sheet');
      doc.body.innerHTML = `
        <div class="conduct-list">
          <div class="conduct-card p-3 border-start">
            <h4>INT373 - High Performance Computing</h4>
            <div class="card-body schedule-info border-top">
              <span class="date">08 Oct 2026</span>
              <span class="time">10:00-11:30</span>
              <div class="inner-border border-bottom">
                <span class="room">Room 34-201</span>
              </div>
            </div>
          </div>
        </div>
      `;

      const cards = findExaminationCardElements(doc);
      expect(cards.length).toBe(1);
      expect(cards[0].classList.contains('conduct-card')).toBe(true);
      expect(cards[0].textContent).toContain('INT373');

      const summary = parseExamDateSheet(doc);
      expect(summary).not.toBeNull();
      expect(summary?.exams.length).toBe(1);
      expect(summary?.exams[0].courseCode).toBe('INT373');
      expect(summary?.exams[0].examDate).toBe('8 Oct 2026');
      expect(summary?.exams[0].room).toBe('34-201');
    });
  });
});

