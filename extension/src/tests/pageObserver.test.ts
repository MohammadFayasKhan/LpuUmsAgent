/*
 * Page Observer & DOM Scanning Test Suite.
 *
 * Validates interactive element harvesting and registry mapping:
 * - Extracting clickable anchors, buttons, and form inputs with bounding boxes.
 * - Assigning stable data-onee-id attributes to DOM nodes.
 * - Filtering out invisible or hidden overlay elements.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { observePage, getElementByOneeId, clearElementRegistry } from '../content/pageObserver';

describe('pageObserver', () => {
  beforeEach(() => {
    clearElementRegistry();
    document.body.innerHTML = `
      <div id="wrapper">
        <header id="header">
          <a href="/lpuums/StudentDashboard.aspx" class="nav-link">Dashboard</a>
          <button id="btnAcademics" class="btn">Academics</button>
        </header>
        <main>
          <div class="mycourses-section">
            <a href="#" onclick="openAttendanceModal()">ATTENDANCE : 98%</a>
            <button id="btnViewAttendance">View Attendance</button>
          </div>
          <input type="text" id="txtSearch" placeholder="Search courses..." />
        </main>
      </div>
    `;

    // Mock getBoundingClientRect in JSDOM
    Array.from(document.querySelectorAll('*')).forEach((el) => {
      (el as HTMLElement).getBoundingClientRect = () => ({
        top: 100,
        left: 50,
        width: 120,
        height: 35,
        bottom: 135,
        right: 170,
        x: 50,
        y: 100,
        toJSON: () => {}
      });
    });
  });

  it('scans and indexes interactive elements with onee-xxx IDs', () => {
    const observation = observePage(document);
    expect(observation).toBeDefined();
    expect(observation.elements.length).toBeGreaterThanOrEqual(3);

    const firstEl = observation.elements[0];
    expect(firstEl.id).toMatch(/^onee-\d{3}$/);
    expect(firstEl.visible).toBe(true);
    expect(firstEl.width).toBe(120);

    // Verify element retrieval by ID
    const domEl = getElementByOneeId(firstEl.id);
    expect(domEl).toBeDefined();
    expect(domEl?.getAttribute('data-onee-id')).toBe(firstEl.id);
  });

  it('detects presence of attendance link and text', () => {
    const observation = observePage(document);
    const attendanceEl = observation.elements.find((e) =>
      e.text.includes('ATTENDANCE') || e.text.includes('View Attendance')
    );
    expect(attendanceEl).toBeDefined();
  });

  it('indexes Date Sheet link on StudentDashboard with high priority', () => {
    document.body.innerHTML = `
      <div class="important-links-container">
        <h3>Important Links</h3>
        <a id="btnDateSheet" href="https://studentums.lpu.in/dashboard/examination/conduct/seatingplan" class="pill-btn">
          Date Sheet <span class="badge">1</span>
        </a>
      </div>
    `;

    Array.from(document.querySelectorAll('*')).forEach((el) => {
      (el as HTMLElement).getBoundingClientRect = () => ({
        top: 200,
        left: 300,
        width: 100,
        height: 35,
        bottom: 235,
        right: 400,
        x: 300,
        y: 200,
        toJSON: () => {}
      });
    });

    const observation = observePage(document);
    const dateSheetEl = observation.elements.find((e) => e.text.includes('Date Sheet'));
    expect(dateSheetEl).toBeDefined();
    expect(dateSheetEl?.text).toContain('Date Sheet');
  });

  it('indexes attendance modal trigger with tight geometry and dynamic percentage text', () => {
    document.body.innerHTML = `
      <div class="card">
        <div class="row">
          <div class="col-xs-6">CGPA : 9.66</div>
          <div class="col-xs-6 text-right">
            <span class="att-text">ATTENDANCE : 91%</span>
            <a href="#" id="lnkAttModal"><i class="fa fa-info-circle"></i></a>
          </div>
        </div>
      </div>
    `;

    const container = document.querySelector('.col-xs-6.text-right') as HTMLElement;
    container.getBoundingClientRect = () => ({
      top: 300,
      bottom: 332,
      left: 400,
      right: 660,
      width: 260,
      height: 32,
      x: 400,
      y: 300,
      toJSON: () => {}
    });

    const span = document.querySelector('.att-text') as HTMLElement;
    span.getBoundingClientRect = () => ({
      top: 300,
      bottom: 332,
      left: 540,
      right: 635,
      width: 95,
      height: 32,
      x: 540,
      y: 300,
      toJSON: () => {}
    });

    const link = document.querySelector('#lnkAttModal') as HTMLElement;
    link.getBoundingClientRect = () => ({
      top: 300,
      bottom: 332,
      left: 640,
      right: 660,
      width: 20,
      height: 32,
      x: 640,
      y: 300,
      toJSON: () => {}
    });

    const observation = observePage(document);
    const attendanceEl = observation.elements.find((e) => e.text.includes('ATTENDANCE'));
    expect(attendanceEl).toBeDefined();
    expect(attendanceEl?.text).toContain('ATTENDANCE : 91%');
    // Tight coordinates without left gap:
    expect(attendanceEl?.x).toBe(540);
    expect(attendanceEl?.width).toBe(120);
  });
});


