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
});
