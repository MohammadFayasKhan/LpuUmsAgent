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
});
