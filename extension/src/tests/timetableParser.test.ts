/*
 * Timetable & Faculty Directory Parser Unit Tests.
 *
 * Tests:
 * 1. Cell text parsing (Lecture/Practical, course code, room, group, section).
 * 2. Faculty cell parsing (faculty name, cabin, last updated).
 * 3. Complete timetable DOM parsing matching UMS frmStudentTimeTable.aspx.
 * 4. Cross-referencing timetable slots with faculty cabins.
 * 5. Edge cases: empty schedule, missing cabins, malformed cells.
 */

import { describe, it, expect } from 'vitest';
import {
  parseClassCellText,
  parseFacultyCell,
  parseStudentTimeTable,
  detectTimetablePage,
  findTimetableLinkElement,
  findAcademicsMenuElement,
  findLmsMenuElement
} from '../content/timetable/timetableParser';

describe('timetableParser', () => {
  describe('parseClassCellText', () => {
    it('parses standard lecture cell with course code, room, and section', () => {
      const text = 'Lecture / G:All C:CSE329 / R: 38-917 / S:K4E0061';
      const slots = parseClassCellText(text, 'Tuesday', '09:30-10:20 AM');

      expect(slots.length).toBe(1);
      const slot = slots[0];
      expect(slot.type).toBe('Lecture');
      expect(slot.group).toBe('All');
      expect(slot.courseCode).toBe('CSE329');
      expect(slot.room).toBe('38-917');
      expect(slot.section).toBe('K4E0061');
      expect(slot.day).toBe('Tuesday');
      expect(slot.time).toBe('09:30-10:20 AM');
    });

    it('parses practical cell with group 0 and room', () => {
      const text = 'Practical / G:0 C:CSE472 / R: 33-502 / S:K2EM001';
      const slots = parseClassCellText(text, 'Wednesday', '10:20-11:10 AM');

      expect(slots.length).toBe(1);
      const slot = slots[0];
      expect(slot.type).toBe('Practical');
      expect(slot.group).toBe('0');
      expect(slot.courseCode).toBe('CSE472');
      expect(slot.room).toBe('33-502');
      expect(slot.section).toBe('K2EM001');
    });

    it('parses project work placeholder text', () => {
      const text = 'Project Work/ Other Weekly Activities. Check Schedule Below';
      const slots = parseClassCellText(text, 'Saturday', '11:10-12:00 AM');

      expect(slots.length).toBe(1);
      const slot = slots[0];
      expect(slot.type).toBe('Project Work');
      expect(slot.courseCode).toBe('PROJECT');
      expect(slot.courseTitle).toBe('Project Work / Weekly Activities');
    });

    it('returns empty array for empty or non-class cell', () => {
      expect(parseClassCellText('', 'Monday', '09:30-10:20 AM')).toEqual([]);
      expect(parseClassCellText('-', 'Monday', '09:30-10:20 AM')).toEqual([]);
      expect(parseClassCellText('N/A', 'Monday', '09:30-10:20 AM')).toEqual([]);
    });
  });

  describe('parseFacultyCell', () => {
    it('extracts faculty name, cabin, and updated timestamp', () => {
      const text = 'Tejinder Thind ( 34-203-C2 ) Last Updated :: Dec 20 2025 4:24PM';
      const res = parseFacultyCell(text);

      expect(res.facultyName).toBe('Tejinder Thind');
      expect(res.facultyCabin).toBe('34-203-C2');
      expect(res.lastUpdated).toContain('Dec 20 2025');
    });

    it('handles faculty with complex cabin code (e.g. WOW1 or CH16)', () => {
      const res1 = parseFacultyCell('Raj Karan Singh ( 26-207-WOW1 ) Last Updated :: Mar 9 2026 4:07PM');
      expect(res1.facultyName).toBe('Raj Karan Singh');
      expect(res1.facultyCabin).toBe('26-207-WOW1');

      const res2 = parseFacultyCell('Abhishek Tiwari ( 33-205-CH16 ) Last Updated :: Jun 18 2026 4:36PM');
      expect(res2.facultyName).toBe('Abhishek Tiwari');
      expect(res2.facultyCabin).toBe('33-205-CH16');
    });

    it('handles cell with no assigned faculty (e.g. Seminar or NA)', () => {
      const res = parseFacultyCell('Last Updated :: NA');
      expect(res.facultyName).toBe('Not Assigned');
      expect(res.facultyCabin).toBe('N/A');
    });
  });

  describe('parseStudentTimeTable (Full DOM)', () => {
    function createUmsTimetableDocument(): Document {
      const doc = document.implementation.createHTMLDocument('Student Time Table');
      doc.body.innerHTML = `
        <span id="lblTitle">Student Time Table</span>
        <div id="pnlHeader">
          <span>Time Table for VID :</span>
          <span>12413692</span>
          <span>Home Section :</span>
          <span>K3P24WM</span>
        </div>

        <!-- Weekly Schedule Grid -->
        <table id="tblTimeTable" border="1">
          <thead>
            <tr>
              <th>Timing</th>
              <th>Monday</th>
              <th>Tuesday</th>
              <th>Wednesday</th>
              <th>Thursday</th>
              <th>Friday</th>
              <th>Saturday</th>
              <th>Sunday</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>09:30-10:20 AM</td>
              <td></td>
              <td>Lecture / G:All C:CSE329 / R: 38-917 / S:K4E0061</td>
              <td></td>
              <td></td>
              <td>Lecture / G:All C:CSE408 / R: 37-711 / S:K3P24WM</td>
              <td>Lecture / G:All C:PEAS01 / R: 33-507 / S:9R026</td>
              <td></td>
            </tr>
            <tr>
              <td>10:20-11:10 AM</td>
              <td>Lecture / G:All C:CSE472 / R: 33-301 / S:K2EM001</td>
              <td>Lecture / G:All C:CSE329 / R: 38-917 / S:K4E0061</td>
              <td>Practical / G:0 C:CSE472 / R: 33-502 / S:K2EM001</td>
              <td>Lecture / G:All C:CSE471 / R: 33-307 / S:K2EM001</td>
              <td>Practical / G:0 C:CSE471 / R: 33-410 / S:K2EM001</td>
              <td>Lecture / G:All C:PEVS01 / R: 33-507 / S:9R026</td>
              <td></td>
            </tr>
            <tr>
              <td>11:10-12:00 AM</td>
              <td>Lecture / G:All C:CSE472 / R: 33-301 / S:K2EM001</td>
              <td>Lecture / G:All C:CSE330 / R: 27-101 / S:K3E0061</td>
              <td>Practical / G:0 C:CSE472 / R: 33-502 / S:K2EM001</td>
              <td>Lecture / G:All C:CSE471 / R: 33-307 / S:K2EM001</td>
              <td>Practical / G:0 C:CSE471 / R: 33-410 / S:K2EM001</td>
              <td>Project Work/ Other Weekly Activities. Check Schedule Below</td>
              <td></td>
            </tr>
            <tr>
              <td>12:00-12:50 PM</td>
              <td>Practical / G:0 C:CSE329 / R: 38-917 / S:K4E0061</td>
              <td>Lecture / G:All C:INT373 / R: 37-906 / S:K3O2403</td>
              <td>Practical / G:0 C:INT373 / R: 37-904 / S:K3O2403</td>
              <td>Practical / G:0 C:INT373 / R: 37-909 / S:K3O2403</td>
              <td>Lecture / G:All C:INT373 / R: 37-902 / S:K3O2403</td>
              <td>Project Work/ Other Weekly Activities. Check Schedule Below</td>
              <td></td>
            </tr>
          </tbody>
        </table>

        <!-- My Course & Faculty Details Table -->
        <div id="pnlCourses">
          <h3>My Course</h3>
          <table id="tblCourses" border="1">
            <thead>
              <tr>
                <th>Course Code</th>
                <th>Type</th>
                <th>Course Title</th>
                <th>Lectures</th>
                <th>Tutorial</th>
                <th>Practical</th>
                <th>Credits</th>
                <th>Faculty ( Block - Room - Cabin No )</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>CSE329</td>
                <td>PW</td>
                <td>PRELUDE TO COMPETITIVE CODING</td>
                <td>2</td>
                <td>0</td>
                <td>1</td>
                <td>3</td>
                <td>Raj Karan Singh ( 26-207-WOW1 ) Last Updated :: Mar 9 2026 4:07PM</td>
              </tr>
              <tr>
                <td>CSE330</td>
                <td>PW</td>
                <td>COMPETITIVE CODING APPROACHES-TECHNIQUES</td>
                <td>2</td>
                <td>0</td>
                <td>1</td>
                <td>3</td>
                <td>Deepak Kumar ( 27-209-CH13 ) Last Updated :: Aug 26 2026 3:43PM</td>
              </tr>
              <tr>
                <td>CSE408</td>
                <td>CR</td>
                <td>DESIGN AND ANALYSIS OF ALGORITHMS</td>
                <td>3</td>
                <td>0</td>
                <td>2</td>
                <td>4</td>
                <td>Tejinder Thind ( 34-203-C2 ) Last Updated :: Dec 20 2025 4:24PM</td>
              </tr>
              <tr>
                <td>CSE443</td>
                <td>TE</td>
                <td>SEMINAR ON SUMMER TRAINING</td>
                <td>0</td>
                <td>0</td>
                <td>6</td>
                <td>3</td>
                <td>Last Updated :: NA</td>
              </tr>
              <tr>
                <td>CSE471</td>
                <td>EM</td>
                <td>DEEP LEARNING FOR COMPUTER VISION</td>
                <td>2</td>
                <td>0</td>
                <td>2</td>
                <td>3</td>
                <td>Abhishek Tiwari ( 33-205-CH16 ) Last Updated :: Jun 18 2026 4:36PM</td>
              </tr>
              <tr>
                <td>CSE472</td>
                <td>EM</td>
                <td>DEEP LEARNING FOR NATURAL LANGUAGE PROCESSING</td>
                <td>2</td>
                <td>0</td>
                <td>2</td>
                <td>3</td>
                <td>Anzar Hussain Lone ( 33-205-CH8 ) Last Updated :: Aug 19 2026 4:26PM</td>
              </tr>
              <tr>
                <td>INT373</td>
                <td>OM</td>
                <td>AGILE DRIVEN DEVELOPMENT AND PROJECT MANAGEMENT</td>
                <td>2</td>
                <td>0</td>
                <td>2</td>
                <td>3</td>
                <td>Shairy ( 27-203-CH11 ) Last Updated :: Aug 7 2026 11:05AM</td>
              </tr>
              <tr>
                <td>PEAS01</td>
                <td>PE</td>
                <td>ANALYTICAL - I</td>
                <td>1</td>
                <td>0</td>
                <td>0</td>
                <td>0</td>
                <td>Navneet Kumar Singh ( 38-509-CH7 ) Last Updated :: Aug 19 2026 10:09AM</td>
              </tr>
              <tr>
                <td>PEVS01</td>
                <td>PE</td>
                <td>VERBAL - I</td>
                <td>1</td>
                <td>0</td>
                <td>0</td>
                <td>0</td>
                <td>Mohammad Arif Baba ( 33-216-CH16 ) Last Updated :: Mar 20 2026 12:54PM</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
      return doc;
    }

    it('detects timetable page from heading and tables', () => {
      const doc = createUmsTimetableDocument();
      expect(detectTimetablePage(doc).isTimetablePage).toBe(true);
      expect(detectTimetablePage(doc).hasTimetableGrid).toBe(true);
    });

    it('extracts complete timetable summary with slots and courses', () => {
      const doc = createUmsTimetableDocument();
      const summary = parseStudentTimeTable(doc);

      expect(summary).not.toBeNull();
      if (!summary) return;

      expect(summary.vid).toBe('12413692');
      expect(summary.homeSection).toBe('K3P24WM');
      expect(summary.courses.length).toBe(9);
      expect(summary.totalSlots).toBeGreaterThan(10);

      // Verify faculty directory entries
      const cse408Fac = summary.courses.find((f) => f.courseCode === 'CSE408');
      expect(cse408Fac).toBeDefined();
      expect(cse408Fac?.facultyName).toBe('Tejinder Thind');
      expect(cse408Fac?.facultyCabin).toBe('34-203-C2');
      expect(cse408Fac?.courseTitle).toBe('DESIGN AND ANALYSIS OF ALGORITHMS');
      expect(cse408Fac?.credits).toBe(4);

      // Verify cross-referenced slot has faculty and cabin populated
      const cse408Slot = summary.slots.find((s) => s.courseCode === 'CSE408');
      expect(cse408Slot).toBeDefined();
      expect(cse408Slot?.facultyName).toBe('Tejinder Thind');
      expect(cse408Slot?.facultyCabin).toBe('34-203-C2');
      expect(cse408Slot?.courseTitle).toBe('DESIGN AND ANALYSIS OF ALGORITHMS');

      // Verify slot without assigned teacher (PEAS01)
      const peasSlot = summary.slots.find((s) => s.courseCode === 'PEAS01');
      expect(peasSlot).toBeDefined();
      expect(peasSlot?.facultyName).toBe('Navneet Kumar Singh');
      expect(peasSlot?.facultyCabin).toBe('38-509-CH7');
    });

    it('parses cell with room number split across lines or spaces (e.g. 38- 917)', () => {
      const text = 'Lecture / G:All C:CSE329 / R: 38-\n917 / S:K4E0061';
      const slots = parseClassCellText(text, 'Tuesday', '09:30-10:20 AM');

      expect(slots.length).toBe(1);
      expect(slots[0].courseCode).toBe('CSE329');
      expect(slots[0].room).toBe('38-917');
      expect(slots[0].block).toBe('38');
      expect(slots[0].roomNumber).toBe('917');
    });

    it('synthesizes courses from grid slots when separate courseTable is missing', () => {
      const doc = document.implementation.createHTMLDocument('Timetable Grid Only');
      doc.body.innerHTML = `
        <div id="pnlHeader">
          <span>Time Table for VID : 12413692</span>
          <span>Home Section : K3P24WM</span>
        </div>
        <table id="tblGrid">
          <tr>
            <th>Timing</th>
            <th>Monday</th>
            <th>Tuesday</th>
          </tr>
          <tr>
            <td>09:30-10:20 AM</td>
            <td>Lecture / G:All C:CSE329 / R: 38-917 / S:K4E0061</td>
            <td>Practical / G:0 C:CSE472 / R: 33-502 / S:K2EM001</td>
          </tr>
        </table>
      `;

      const summary = parseStudentTimeTable(doc);
      expect(summary).not.toBeNull();
      expect(summary?.slots.length).toBe(2);
      expect(summary?.courses.length).toBe(2);
      expect(summary?.courses.map((c) => c.courseCode)).toContain('CSE329');
      expect(summary?.courses.map((c) => c.courseCode)).toContain('CSE472');
    });

    it('handles courseTable where Sr. No is column 0 and Course Code is column 1', () => {
      const doc = document.implementation.createHTMLDocument('Offset Columns');
      doc.body.innerHTML = `
        <span>Time Table for VID : 12413692</span>
        <span>Home Section : K3P24WM</span>
        <table>
          <tr>
            <th>Timing</th>
            <th>Monday</th>
          </tr>
          <tr>
            <td>09:30-10:20 AM</td>
            <td>Lecture / G:All C:CSE329 / R: 38-917 / S:K4E0061</td>
          </tr>
        </table>
        <table>
          <tr>
            <th>Sr. No.</th>
            <th>Course Code</th>
            <th>Course Title</th>
            <th>Type</th>
            <th>L</th>
            <th>T</th>
            <th>P</th>
            <th>Credits</th>
            <th>Faculty</th>
          </tr>
          <tr>
            <td>1</td>
            <td>CSE329</td>
            <td>PRELUDE TO COMPETITIVE CODING</td>
            <td>PW</td>
            <td>2</td>
            <td>0</td>
            <td>1</td>
            <td>3</td>
            <td>Raj Karan Singh ( 26-207-WOW1 ) Last Updated :: Mar 9 2026 4:07PM</td>
          </tr>
        </table>
      `;

      const summary = parseStudentTimeTable(doc);
      expect(summary).not.toBeNull();
      expect(summary?.courses.length).toBe(1);
      expect(summary?.courses[0].courseCode).toBe('CSE329');
      expect(summary?.courses[0].facultyName).toBe('Raj Karan Singh');
      expect(summary?.courses[0].facultyCabin).toBe('26-207-WOW1');
    });

    it('extracts timetable rendered inside child iframe (SSRS ReportViewer)', () => {
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);

      const frameDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (frameDoc) {
        frameDoc.body.innerHTML = `
          <span>Time Table for VID : 12413692</span>
          <span>Home Section : K3P24WM</span>
          <table>
            <tr>
              <th>Timing</th>
              <th>Monday</th>
              <th>Tuesday</th>
            </tr>
            <tr>
              <td>10:20-11:10 AM</td>
              <td>Lecture / G:All C:CSE472 / R: 33-301 / S:K2EM001</td>
              <td></td>
            </tr>
          </table>
        `;
      }

      const summary = parseStudentTimeTable(document);
      document.body.removeChild(iframe);

      expect(summary).not.toBeNull();
      expect(summary?.vid).toBe('12413692');
      expect(summary?.homeSection).toBe('K3P24WM');
      expect(summary?.slots.length).toBe(1);
      expect(summary?.slots[0].courseCode).toBe('CSE472');
    });

    it('strips "Legends" from homeSection when text is adjacent to legends row', () => {
      const doc = document.implementation.createHTMLDocument('Timetable');
      doc.body.innerHTML = `
        <table>
          <tr>
            <td>Time Table for VID : 12413692</td>
            <td>Home Section K3P24WM :</td>
          </tr>
          <tr>
            <td colspan="2">Legends : C - Course Code, F - Faculty, G - Group, R - Room, S - Section</td>
          </tr>
        </table>
        <table>
          <tr>
            <th>Timing</th>
            <th>Monday</th>
          </tr>
          <tr>
            <td>09:30-10:20 AM</td>
            <td>Lecture / G:All C:CSE329 / R: 38-917 / S:K4E0061</td>
          </tr>
        </table>
      `;

      const summary = parseStudentTimeTable(doc);
      expect(summary).not.toBeNull();
      expect(summary?.homeSection).toBe('K3P24WM');
      expect(summary?.homeSection).not.toContain('Legends');
    });
  });

  describe('menu element finders', () => {
    it('findAcademicsMenuElement returns interactive trigger excluding dropdown menu content', () => {
      const doc = document.implementation.createHTMLDocument('Dashboard');
      doc.body.innerHTML = `
        <ul class="nav navbar-nav">
          <li class="dropdown">
            <a href="#" class="dropdown-toggle" data-toggle="dropdown">
              Academics <b class="caret"></b>
            </a>
            <ul class="dropdown-menu">
              <li><a href="#">LMS</a></li>
              <li><a href="frmStudentTimeTable.aspx">View Time Table</a></li>
            </ul>
          </li>
        </ul>
      `;

      const trigger = findAcademicsMenuElement(doc);
      expect(trigger).not.toBeNull();
      expect(trigger?.tagName.toLowerCase()).toBe('a');
      expect(trigger?.classList.contains('dropdown-toggle')).toBe(true);
    });

    it('findTimetableLinkElement returns leaf interactive anchor link rather than parent container', () => {
      const doc = document.implementation.createHTMLDocument('Dashboard');
      doc.body.innerHTML = `
        <div class="menu-wrapper">
          <ul class="dropdown-menu">
            <li class="menu-item">
              <a href="../Reports/frmStudentTimeTable.aspx" class="dropdown-item">View Time Table</a>
            </li>
          </ul>
        </div>
      `;

      const link = findTimetableLinkElement(doc);
      expect(link).not.toBeNull();
      expect(link?.tagName.toLowerCase()).toBe('a');
      expect(link?.getAttribute('href')).toContain('frmStudentTimeTable.aspx');
    });

    it('findLmsMenuElement returns leaf interactive link for LMS', () => {
      const doc = document.implementation.createHTMLDocument('Dashboard');
      doc.body.innerHTML = `
        <ul class="dropdown-menu">
          <li class="dropdown-submenu">
            <a href="#" class="dropdown-item">LMS</a>
            <ul class="dropdown-menu">
              <li><a href="frmStudentTimeTable.aspx">View Time Table</a></li>
            </ul>
          </li>
        </ul>
      `;

      const lms = findLmsMenuElement(doc);
      expect(lms).not.toBeNull();
      expect(lms?.tagName.toLowerCase()).toBe('a');
      expect(lms?.textContent?.trim()).toBe('LMS');
    });
  });
});
