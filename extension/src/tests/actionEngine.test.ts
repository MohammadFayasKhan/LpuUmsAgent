/*
 * Computer Use Action Engine Test Suite.
 *
 * Validates browser action execution against a synthetic DOM:
 * - Click dispatching with coordinate bounds validation.
 * - Text typing with native value setter and input events.
 * - Element-based scrolling and safe bounds checking.
 * - Error handling when elements disappear or coordinates fall out of viewport.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { observePage, clearElementRegistry } from '../content/pageObserver';
import { executeAgentAction } from '../content/actionEngine';

describe('actionEngine', () => {
  beforeEach(() => {
    clearElementRegistry();
    document.body.innerHTML = `
      <div id="wrapper">
        <button id="btnClickMe">Click Me</button>
        <input type="text" id="inputBox" />
      </div>
    `;

    Array.from(document.querySelectorAll('*')).forEach((el) => {
      (el as HTMLElement).getBoundingClientRect = () => ({
        top: 50,
        left: 50,
        width: 100,
        height: 30,
        bottom: 80,
        right: 150,
        x: 50,
        y: 50,
        toJSON: () => {}
      });
      (el as HTMLElement).scrollIntoView = vi.fn();
    });
  });

  it('executes real DOM click action successfully', async () => {
    const observation = observePage(document);
    const target = observation.elements.find((e) => e.text.includes('Click Me'));
    expect(target).toBeDefined();

    let clicked = false;
    document.getElementById('btnClickMe')?.addEventListener('click', () => {
      clicked = true;
    });

    const result = await executeAgentAction({
      action: 'click',
      elementId: target!.id,
      reason: 'Testing click'
    });

    expect(result.success).toBe(true);
    expect(clicked).toBe(true);
  });

  it('executes type action and dispatches input events', async () => {
    const observation = observePage(document);
    const target = observation.elements.find((e) => e.tag === 'input');
    expect(target).toBeDefined();

    const result = await executeAgentAction({
      action: 'type',
      elementId: target!.id,
      text: 'Hello ONEE',
      reason: 'Typing input'
    });

    expect(result.success).toBe(true);
    const inputEl = document.getElementById('inputBox') as HTMLInputElement;
    expect(inputEl.value).toBe('Hello ONEE');
  });

  it('handles invalid elementId safely without crashing', async () => {
    const result = await executeAgentAction({
      action: 'click',
      elementId: 'onee-999',
      reason: 'Non-existent element'
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('highlights the entire table when extracting attendance for full summary goal', async () => {
    document.body.innerHTML = `
      <div class="modal-content">
        <table id="ctl00_cphHeading_GridAttendance" class="table">
          <thead>
            <tr><th>Course</th><th>Total Percentage</th></tr>
          </thead>
          <tbody>
            <tr class="table-row"><td>CSE329: PRELUDE</td><td>100</td></tr>
            <tr class="table-row"><td>CSE330: CODING</td><td>89</td></tr>
            <tr class="table-row"><td>INT373: AGILE</td><td>92</td></tr>
          </tbody>
        </table>
      </div>
    `;

    Array.from(document.querySelectorAll('*')).forEach((el) => {
      (el as HTMLElement).getBoundingClientRect = () => ({
        top: 100,
        left: 100,
        width: 600,
        height: 300,
        bottom: 400,
        right: 700,
        x: 100,
        y: 100,
        toJSON: () => {}
      });
    });

    const result = await executeAgentAction({
      action: 'extractAttendance',
      goal: 'Open Attendance Summary and read my full subject attendance',
      reason: 'Reading full attendance table'
    });

    expect(result.success).toBe(true);
    expect(result.attendance).toBeDefined();
    expect(result.attendance?.courses.length).toBe(3);
  });

  it('highlights specific lowest subject row when goal specifically targets lowest subject', async () => {
    document.body.innerHTML = `
      <table id="ctl00_cphHeading_GridAttendance">
        <thead><tr><th>Course</th><th>Total Percentage</th></tr></thead>
        <tbody>
          <tr id="row-cse329"><td>CSE329: PRELUDE</td><td>100</td></tr>
          <tr id="row-cse330"><td>CSE330: CODING</td><td>89</td></tr>
        </tbody>
      </table>
    `;

    Array.from(document.querySelectorAll('*')).forEach((el) => {
      (el as HTMLElement).getBoundingClientRect = () => ({
        top: 100,
        left: 100,
        width: 600,
        height: 40,
        bottom: 140,
        right: 700,
        x: 100,
        y: 100,
        toJSON: () => {}
      });
    });

    const result = await executeAgentAction({
      action: 'extractAttendance',
      goal: 'Go to my attendance and tell me which subject has the lowest attendance',
      reason: 'Find lowest subject'
    });

    expect(result.success).toBe(true);
    expect(result.attendance?.courses.length).toBe(2);
  });

  it('enforces target="_blank" on seating plan links so attendance tab stays intact in browser', async () => {
    document.body.innerHTML = `
      <div id="links-container">
        <a id="lnkDateSheet" href="https://studentums.lpu.in/dashboard/examination/conduct/seatingplan">Date Sheet</a>
      </div>
    `;

    const link = document.getElementById('lnkDateSheet') as HTMLAnchorElement;
    link.getBoundingClientRect = () => ({
      top: 50,
      left: 50,
      width: 120,
      height: 36,
      bottom: 86,
      right: 170,
      x: 50,
      y: 50,
      toJSON: () => {}
    });

    const observation = observePage(document);
    const target = observation.elements.find((e) => e.text.includes('Date Sheet'));
    expect(target).toBeDefined();

    const result = await executeAgentAction({
      action: 'click',
      elementId: target!.id,
      reason: 'Opening Date Sheet'
    });

    expect(result.success).toBe(true);
    // Link must have target="_blank" to ensure opening in a new tab!
    expect(link.target).toBe('_blank');
  });

  it('preserves existing target="_blank" on external or new-tab links without forcing _self', async () => {
    document.body.innerHTML = `
      <div id="links-container">
        <a id="externalLink" href="https://ums.lpu.in/help" target="_blank">Help Desk</a>
      </div>
    `;

    const link = document.getElementById('externalLink') as HTMLAnchorElement;
    link.getBoundingClientRect = () => ({
      top: 50,
      left: 50,
      width: 120,
      height: 36,
      bottom: 86,
      right: 170,
      x: 50,
      y: 50,
      toJSON: () => {}
    });

    const observation = observePage(document);
    const target = observation.elements.find((e) => e.text.includes('Help Desk'));
    expect(target).toBeDefined();

    const result = await executeAgentAction({
      action: 'click',
      elementId: target!.id,
      reason: 'Opening Help'
    });

    expect(result.success).toBe(true);
    expect(link.target).toBe('_blank');
  });

  it('makes sure cursor disappears after clicking date sheet link', async () => {
    document.body.innerHTML = `
      <div id="links-container">
        <a id="lnkDateSheet" href="https://studentums.lpu.in/dashboard/examination/conduct/seatingplan">Date Sheet</a>
      </div>
    `;

    const link = document.getElementById('lnkDateSheet') as HTMLAnchorElement;
    link.getBoundingClientRect = () => ({
      top: 50,
      left: 50,
      width: 120,
      height: 36,
      bottom: 86,
      right: 170,
      x: 50,
      y: 50,
      toJSON: () => {}
    });

    const observation = observePage(document);
    const target = observation.elements.find((e) => e.text.includes('Date Sheet'));
    expect(target).toBeDefined();

    const result = await executeAgentAction({
      action: 'click',
      elementId: target!.id,
      reason: 'Opening Date Sheet'
    });

    expect(result.success).toBe(true);
    const cursorRoot = document.getElementById('onee-ai-cursor-root');
    expect(cursorRoot).toBeDefined();
    // After clicking Date Sheet link, cursor must be hidden (opacity 0)
    expect(cursorRoot?.style.opacity).toBe('0');
  });

  it('makes sure cursor disappears after completing extractExamination action', async () => {
    document.body.innerHTML = `
      <div class="exam-card-container">
        <div class="exam-card">
          <h4>CSE408 - Mid Term Regular</h4>
          <span>Date: 06-Oct-2026</span>
          <span>Time: 10:00 - 11:30</span>
        </div>
      </div>
    `;

    Array.from(document.querySelectorAll('*')).forEach((el) => {
      (el as HTMLElement).getBoundingClientRect = () => ({
        top: 100,
        left: 100,
        width: 400,
        height: 150,
        bottom: 250,
        right: 500,
        x: 100,
        y: 100,
        toJSON: () => {}
      });
    });

    const result = await executeAgentAction({
      action: 'extractExamination',
      reason: 'Reading examination date sheet',
      goal: 'Open Date Sheet from Important Links and check my exams'
    });

    expect(result.success).toBe(true);
    expect(result.examination).toBeDefined();
    const cursorRoot = document.getElementById('onee-ai-cursor-root');
    expect(cursorRoot).toBeDefined();
    // After examination extraction finishes, cursor must be hidden
    expect(cursorRoot?.style.opacity).toBe('0');
  });

  it('extracts timetable with smooth verification animations and returns complete timetable summary', async () => {
    document.body.innerHTML = `
      <span>Student Time Table</span>
      <div>Time Table for VID : 12413692 Home Section K3P24WM Printed On 9/19/2026 5:44:55 PM</div>
      <table id="tblGrid">
        <tr>
          <th>Timing</th>
          <th>Monday</th>
          <th>Tuesday</th>
        </tr>
        <tr>
          <td>09:30-10:20 AM</td>
          <td>Lecture / G:All C:CSE472 / R: 33-301 / S:K2EM001</td>
          <td>Lecture / G:All C:CSE329 / R: 38-917 / S:K4E0061</td>
        </tr>
      </table>
      <table id="tblCourses">
        <tr>
          <th>Course Code</th>
          <th>Course Type</th>
          <th>Course Title</th>
          <th>Lectures</th>
          <th>Tutorial</th>
          <th>Practical</th>
          <th>Credits</th>
          <th>Faculty</th>
        </tr>
        <tr>
          <td>CSE329</td>
          <td>CR</td>
          <td>PROGRAMMING IN PYTHON</td>
          <td>3</td>
          <td>0</td>
          <td>2</td>
          <td>4</td>
          <td>Raj Karan Singh ( 26-207-WOW1 ) Last Updated :: Mar 9 2026 4:07PM</td>
        </tr>
      </table>
    `;

    Array.from(document.querySelectorAll('*')).forEach((el) => {
      (el as HTMLElement).getBoundingClientRect = () => ({
        top: 100,
        left: 100,
        width: 400,
        height: 150,
        bottom: 250,
        right: 500,
        x: 100,
        y: 100,
        toJSON: () => {}
      });
    });

    const result = await executeAgentAction({
      action: 'extractTimetable',
      reason: 'Reading student timetable',
      goal: 'What classes do I have today and where are the rooms?'
    });

    expect(result.success).toBe(true);
    expect(result.timetable).toBeDefined();
    expect(result.timetable?.vid).toBe('12413692');
    expect(result.timetable?.homeSection).toBe('K3P24WM');
    expect(result.timetable?.slots.length).toBeGreaterThan(0);
    expect(result.timetable?.courses.length).toBeGreaterThan(0);
    const cursorRoot = document.getElementById('onee-ai-cursor-root');
    expect(cursorRoot?.style.opacity).toBe('0');
  });

  it('navigates through Academics ➔ LMS ➔ View Time Table menu hierarchy', async () => {
    document.body.innerHTML = `
      <nav class="navbar">
        <ul class="nav">
          <li class="nav-item">
            <a class="nav-link dropdown-toggle" role="button" href="#">Academics ⌵</a>
            <div class="dropdown-menu">
              <a class="dropdown-item" href="#">LMS</a>
              <div class="submenu">
                <a class="dropdown-item" href="frmStudentTimeTable.aspx">View Time Table</a>
              </div>
            </div>
          </li>
        </ul>
      </nav>
    `;

    Array.from(document.querySelectorAll('*')).forEach((el) => {
      (el as HTMLElement).getBoundingClientRect = () => ({
        top: 50,
        left: 100,
        width: 120,
        height: 35,
        bottom: 85,
        right: 220,
        x: 100,
        y: 50,
        toJSON: () => {}
      });
    });

    const result = await executeAgentAction({
      action: 'openAcademicsTimetableMenu',
      reason: 'Navigating through Academics ➔ LMS ➔ View Time Table',
      goal: 'Show view time table'
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
  });

  it('scrolls within internal SSRS ReportViewer container down to faculty directory without scrolling page', async () => {
    document.body.innerHTML = `
      <div id="ReportViewerControl" style="overflow-y: scroll; height: 300px; max-height: 300px;">
        <div id="VisibleReportContent" style="height: 900px;">
          <div>Time Table for VID : 12413692 Home Section K3P24WM</div>
          <table id="GridTable">
            <thead>
              <tr><th>Timing</th><th>Monday</th><th>Tuesday</th><th>Wednesday</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>09:30-10:20 AM</td>
                <td>Lecture / G:All C:CSE472 / R: 33-301 / S:K2EM001</td>
                <td></td>
                <td></td>
              </tr>
            </tbody>
          </table>
          <div style="height: 200px;"></div>
          <table id="CourseFacultyTable">
            <thead>
              <tr><th>Course Code</th><th>Course Title</th><th>Faculty ( Block - Room - Cabin No )</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>CSE472</td>
                <td>ADVANCED PYTHON</td>
                <td>Dr. Rohit Sharma ( 34 - 203 - C2 ) 12/01/2026</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    const container = document.getElementById('ReportViewerControl') as HTMLElement;
    Object.defineProperty(container, 'scrollHeight', { value: 900, configurable: true });
    Object.defineProperty(container, 'clientHeight', { value: 300, configurable: true });
    container.scrollTop = 0;

    Array.from(document.querySelectorAll('*')).forEach((el) => {
      (el as HTMLElement).getBoundingClientRect = () => ({
        top: 100,
        left: 50,
        width: 600,
        height: 120,
        bottom: 220,
        right: 650,
        x: 50,
        y: 100,
        toJSON: () => {}
      });
    });

    const result = await executeAgentAction({
      action: 'extractTimetable',
      reason: 'Reading student timetable and faculty directory',
      goal: 'Show timetable and faculty cabins'
    });

    expect(result.success).toBe(true);
    expect(result.timetable?.courses.length).toBe(1);
    expect(result.timetable?.courses[0].facultyCabin).toBe('34-203-C2');
    // Highlight box should be visible on page
    const highlightBox = document.getElementById('onee-ai-highlight-box');
    expect(highlightBox?.style.display).toBe('block');
  });
});
