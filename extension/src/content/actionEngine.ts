import { AgentAction, AttendanceSummary, GroundedTarget } from '../shared/types';
import { getElementByOneeId, resolveClickableAncestor, isElementVisible } from './pageObserver';
import {
  showCursor,
  animateCursorTo,
  highlightElement,
  setHighlightState,
  hideHighlight,
  triggerClickRipple,
  setCursorStatus
} from './aiCursorOverlay';
import { parseAttendanceFromUMS } from './umsAttendanceParser';
import { calculateSafeScrollDelta } from './coordinateUtils';
import { agentMotion, calculatePrecisionEasing } from './agentMotion';
import { getLowestAttendanceSubject } from '../shared/attendanceCalculator';

export interface ActionExecutionResult {
  success: boolean;
  action: AgentAction;
  error?: string;
  attendance?: AttendanceSummary;
  verified?: boolean;
  groundedTarget?: GroundedTarget;
}

/**
 * Validates whether an action target element is valid, interactive, and connected to the DOM.
 */
function validateElement(id: string): { valid: boolean; element?: HTMLElement; error?: string } {
  const rawEl = getElementByOneeId(id);
  if (!rawEl) {
    return { valid: false, error: `Element with ID "${id}" was not found in current page registry.` };
  }

  const element = resolveClickableAncestor(rawEl);

  if (!element.isConnected) {
    return { valid: false, error: `Element "${id}" has been disconnected from active DOM.` };
  }

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) {
    if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'test') {
      return { valid: false, error: `Element "${id}" has 0 viewport dimensions and is not visible.` };
    }
  }

  return { valid: true, element };
}

/**
 * Waits for active DOM layout transitions, modal fade-ins, and AJAX rendering to settle.
 */
async function waitForPageSettling(minDelayMs: number = 300): Promise<void> {
  await agentMotion.wait(minDelayMs);
  return new Promise((resolve) => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => resolve(), { timeout: 400 });
    } else {
      setTimeout(resolve, 80);
    }
  });
}

/**
 * Calculates a safe interaction point inside the target element.
 */
function calculateInteractionPoint(element: HTMLElement, rect: DOMRect): { x: number; y: number } {
  const tag = element.tagName.toLowerCase();
  const isTableCell = tag === 'td' || tag === 'th' || tag === 'tr';

  if (isTableCell) {
    return {
      x: rect.left + Math.min(rect.width * 0.5, 40),
      y: rect.top + rect.height * 0.5
    };
  }

  return {
    x: rect.left + rect.width * 0.5,
    y: rect.top + rect.height * 0.5
  };
}

/**
 * Executes a frame-synchronized, buttery-smooth RAF page scroll with Cosine easing.
 */
export async function smoothScrollBy(delta: number, durationMs: number = 700): Promise<void> {
  if (typeof window === 'undefined' || typeof window.scrollBy !== 'function') return;
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
    try {
      window.scrollBy({ top: delta });
    } catch {}
    return;
  }

  return new Promise((resolve) => {
    const startY = window.scrollY || window.pageYOffset || 0;
    const targetDelta = delta;
    const startTime = performance.now();

    function step(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const easedProgress = calculatePrecisionEasing(progress);
      const currentScrollY = window.scrollY || window.pageYOffset || 0;
      const desiredScrollY = startY + targetDelta * easedProgress;
      const stepDelta = desiredScrollY - currentScrollY;

      if (Math.abs(stepDelta) >= 0.5) {
        try {
          window.scrollBy(0, stepDelta);
        } catch {}
      }

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        resolve();
      }
    }

    requestAnimationFrame(step);
  });
}

/**
 * Brings the target element into the comfortable safe viewport zone without overshooting.
 */
async function ensureTargetInSafeZone(element: HTMLElement, reason?: string): Promise<void> {
  const delta = calculateSafeScrollDelta(element);
  if (delta !== 0) {
    setCursorStatus(reason ? `Bringing ${reason} into view...` : 'Bringing target into view...');
    await smoothScrollBy(delta, 650);
    const settleDelay = agentMotion.getTimings().scrollSettleDelay;
    await agentMotion.wait(settleDelay);
  }
}

/**
 * Dispatches realistic DOM mouse and pointer events to simulate genuine user interaction.
 */
function dispatchRealClick(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;

  const eventInit: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX,
    clientY,
    buttons: 1
  };

  try {
    if (typeof PointerEvent !== 'undefined') {
      el.dispatchEvent(new PointerEvent('pointerdown', { ...eventInit, pointerType: 'mouse' }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, pointerType: 'mouse' }));
    }
  } catch {}

  try {
    el.dispatchEvent(new MouseEvent('mousedown', eventInit));
    el.dispatchEvent(new MouseEvent('mouseup', eventInit));
    el.dispatchEvent(new MouseEvent('click', eventInit));
  } catch {}

  try {
    el.click();
  } catch {}
}

/**
 * Finds the exact visible Attendance Summary table in the open modal or page.
 */
function findVisibleAttendanceTable(doc: Document = document): HTMLTableElement | null {
  const tables = Array.from(doc.querySelectorAll<HTMLTableElement>('table'));
  let bestTable: HTMLTableElement | null = null;
  let bestScore = -1;

  for (const table of tables) {
    if (!isElementVisible(table)) continue;
    const rect = table.getBoundingClientRect();
    if (typeof process === 'undefined' || process.env?.NODE_ENV !== 'test') {
      if (rect.width < 150 || rect.height < 50) continue;
    }

    const text = (table.textContent || '').toLowerCase();
    let score = 0;

    if (text.includes('course') || text.includes('subject')) score += 10;
    if (text.includes('percentage') || text.includes('%')) score += 10;
    if (text.includes('delivered') || text.includes('conducted')) score += 10;
    if (text.includes('attended') || text.includes('present')) score += 10;
    if (text.includes('duty leave')) score += 5;
    if (text.includes('aggregate')) score += 10;

    // Check if inside modal
    if (table.closest('.modal, [role="dialog"], .ui-dialog, [id*="Attendance" i], .modal-body, .modal-content')) {
      score += 15;
    }

    if (score > bestScore && score >= 20) {
      bestScore = score;
      bestTable = table;
    }
  }

  return bestTable;
}

/**
 * Accurately highlights the appropriate DOM element according to the user's specific goal:
 * - If goal asks for lowest subject -> highlights the specific lowest subject row
 * - If goal asks for a specific course (e.g. CSE330) -> highlights that course row
 * - If goal asks to open summary / read full attendance / overview -> highlights the ENTIRE attendance table
 */
async function highlightAttendanceVerification(
  action: AgentAction,
  attendance: AttendanceSummary,
  doc: Document = document
): Promise<void> {
  if (!attendance || !attendance.courses || attendance.courses.length === 0) return;

  const goalText = (action.goal || action.reason || '').toLowerCase();
  const isLowestGoal = goalText.includes('lowest') || goalText.includes('least') || goalText.includes('minimum');

  // Check if a specific course code is mentioned in the goal (e.g. CSE330, INT373)
  const mentionedCourse = attendance.courses.find((c) =>
    goalText.includes(c.code.toLowerCase())
  );

  const targetTable = findVisibleAttendanceTable(doc);

  if (isLowestGoal) {
    const lowest = getLowestAttendanceSubject(attendance.courses);
    if (lowest) {
      const scope = targetTable || doc;
      const rows = Array.from(scope.querySelectorAll('tr, .table-row, [role="row"]'));
      const matchingRow = rows.find((r) => r.textContent?.toLowerCase().includes(lowest.code.toLowerCase()));
      if (matchingRow && matchingRow instanceof HTMLElement) {
        const rect = matchingRow.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 10) {
          const targetPoint = {
            x: Math.round(rect.left + Math.min(rect.width * 0.45, 260)),
            y: Math.round(rect.top + rect.height * 0.5)
          };
          setCursorStatus(`Verifying ${lowest.code}...`);
          hideHighlight();
          await animateCursorTo(targetPoint.x, targetPoint.y);
          highlightElement(matchingRow, `Lowest Subject: ${lowest.code} (${lowest.percentage}%)`, 'verified');
          setCursorStatus('Attendance verified!');
          await agentMotion.wait(850);
          return;
        }
      }
    }
  } else if (mentionedCourse) {
    const scope = targetTable || doc;
    const rows = Array.from(scope.querySelectorAll('tr, .table-row, [role="row"]'));
    const matchingRow = rows.find((r) => r.textContent?.toLowerCase().includes(mentionedCourse.code.toLowerCase()));
    if (matchingRow && matchingRow instanceof HTMLElement) {
      const rect = matchingRow.getBoundingClientRect();
      if (rect.width > 50 && rect.height > 10) {
        const targetPoint = {
          x: Math.round(rect.left + Math.min(rect.width * 0.45, 260)),
          y: Math.round(rect.top + rect.height * 0.5)
        };
        setCursorStatus(`Verifying ${mentionedCourse.code}...`);
        hideHighlight();
        await animateCursorTo(targetPoint.x, targetPoint.y);
        highlightElement(
          matchingRow,
          `${mentionedCourse.code}: ${mentionedCourse.percentage}% (${mentionedCourse.attended}/${mentionedCourse.total})`,
          'verified'
        );
        setCursorStatus('Attendance verified!');
        await agentMotion.wait(850);
        return;
      }
    }
  }

  // Default / Full Summary Goal: Highlight the entire visible attendance table
  if (targetTable) {
    const rect = targetTable.getBoundingClientRect();
    const targetPoint = {
      x: Math.round(rect.left + Math.min(rect.width * 0.5, 300)),
      y: Math.round(rect.top + Math.min(rect.height * 0.35, 45))
    };
    setCursorStatus('Validating attendance...');
    hideHighlight();
    await animateCursorTo(targetPoint.x, targetPoint.y);
    highlightElement(
      targetTable,
      `Attendance Summary: ${attendance.totalCourses} Subjects (${attendance.overallPercentage}% Aggregate)`,
      'verified'
    );
    setCursorStatus('Attendance verified!');
    await agentMotion.wait(850);
  } else {
    // If no single table element found, highlight first course row
    const firstCourse = attendance.courses[0];
    const rows = Array.from(doc.querySelectorAll('tr, .table-row, [role="row"]'));
    const matchingRow = rows.find((r) => r.textContent?.toLowerCase().includes(firstCourse.code.toLowerCase()));
    if (matchingRow && matchingRow instanceof HTMLElement) {
      const rect = matchingRow.getBoundingClientRect();
      if (rect.width > 50 && rect.height > 10) {
        const targetPoint = {
          x: Math.round(rect.left + Math.min(rect.width * 0.45, 260)),
          y: Math.round(rect.top + rect.height * 0.5)
        };
        hideHighlight();
        await animateCursorTo(targetPoint.x, targetPoint.y);
        highlightElement(matchingRow, `Attendance: ${attendance.overallPercentage}% Aggregate`, 'verified');
        await agentMotion.wait(850);
      }
    }
  }
}

/*
 * Performs the actual browser action on the live UMS DOM.
 *
 * Before clicking or typing, we re-check where the element is on screen.
 * This is important because earlier clicks or animations could have shifted
 * the button or table position, so we don't want to blindly click old coordinates.
 */
export async function executeAgentAction(action: AgentAction): Promise<ActionExecutionResult> {
  showCursor();
  const timings = agentMotion.getTimings();

  try {
    switch (action.action) {
      case 'click': {
        if (!action.elementId) {
          return { success: false, action, error: 'Element ID is required for click action.' };
        }

        /*
         * Pre-check: Verify the element is still attached to the DOM and visible.
         * If UMS closed the dialog or swapped the container, we fail early with a clear
         * reason so the planner can retry with a fresh observation.
         */
        const { valid, element, error } = validateElement(action.elementId);
        if (!valid || !element) {
          return { success: false, action, error };
        }

        /*
         * If the target is tucked behind the fixed UMS header or below the fold,
         * we smoothly scroll it into the safe middle area before moving the cursor.
         */
        await ensureTargetInSafeZone(element, action.reason);

        /*
         * Re-measure the element's bounding box after scrolling finishes.
         * The scroll changes the element's viewport coordinates, so we must calculate
         * the click point from the fresh rectangle.
         */
        let rect = element.getBoundingClientRect();
        let targetPoint = calculateInteractionPoint(element, rect);

        // 4. Target Discovery State
        const label = action.reason ? `Target: ${action.reason}` : 'Locating target...';
        highlightElement(element, label, 'discovered');
        await agentMotion.wait(timings.preClickHighlightDelay);

        // 5. Approaching State & Trajectory Movement
        setHighlightState('approaching');
        await animateCursorTo(targetPoint.x, targetPoint.y);

        // 6. Pre-Click Settle Period (250–500ms): Verify target geometry before clicking
        rect = element.getBoundingClientRect();
        targetPoint = calculateInteractionPoint(element, rect);
        setHighlightState('verified');
        setCursorStatus(action.reason || 'Opening Attendance');

        await agentMotion.wait(timings.preClickSettleDelay);

        // 7. Click Pulse & Real DOM Event Dispatch
        await triggerClickRipple();
        dispatchRealClick(element);
        hideHighlight();

        // 8. Post-Click Stabilization
        await waitForPageSettling(timings.postClickStabilization);

        return { success: true, action };
      }

      case 'type': {
        if (!action.elementId) {
          return { success: false, action, error: 'Element ID is required for type action.' };
        }

        const { valid, element, error } = validateElement(action.elementId);
        if (!valid || !element) {
          return { success: false, action, error };
        }

        await ensureTargetInSafeZone(element);

        const rect = element.getBoundingClientRect();
        const targetPoint = calculateInteractionPoint(element, rect);

        highlightElement(element, `Typing "${action.text || ''}"...`, 'discovered');
        await agentMotion.wait(timings.preClickHighlightDelay);

        await animateCursorTo(targetPoint.x, targetPoint.y);
        setHighlightState('verified');
        await agentMotion.wait(timings.preClickSettleDelay);

        await triggerClickRipple();

        element.focus();
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
          element.value = action.text || '';
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }

        await waitForPageSettling(300);
        hideHighlight();
        return { success: true, action };
      }

      case 'scroll': {
        const direction = action.direction || 'down';
        const amount = Math.min(action.amount || 350, Math.round(window.innerHeight * 0.65));
        const delta = direction === 'down' ? amount : -amount;

        setCursorStatus(`Scrolling ${direction}...`);
        await smoothScrollBy(delta, 750);
        await agentMotion.wait(timings.scrollSettleDelay);
        hideHighlight();

        return { success: true, action };
      }

      case 'select': {
        if (!action.elementId) {
          return { success: false, action, error: 'Element ID is required for select action.' };
        }

        const { valid, element, error } = validateElement(action.elementId);
        if (!valid || !element || !(element instanceof HTMLSelectElement)) {
          return { success: false, action, error: error || 'Target is not a select element.' };
        }

        await ensureTargetInSafeZone(element);

        const rect = element.getBoundingClientRect();
        const targetPoint = calculateInteractionPoint(element, rect);

        highlightElement(element, `Selecting ${action.value || ''}...`, 'discovered');
        await animateCursorTo(targetPoint.x, targetPoint.y);
        setHighlightState('verified');
        await agentMotion.wait(timings.preClickSettleDelay);

        element.value = action.value || '';
        element.dispatchEvent(new Event('change', { bubbles: true }));
        await waitForPageSettling(250);
        hideHighlight();

        return { success: true, action };
      }

      case 'hover': {
        if (!action.elementId) {
          return { success: false, action, error: 'Element ID is required for hover action.' };
        }

        const { valid, element, error } = validateElement(action.elementId);
        if (!valid || !element) {
          return { success: false, action, error };
        }

        await ensureTargetInSafeZone(element);
        const rect = element.getBoundingClientRect();
        const targetPoint = calculateInteractionPoint(element, rect);

        highlightElement(element, action.reason || 'Hovering element...', 'discovered');
        await animateCursorTo(targetPoint.x, targetPoint.y);
        setHighlightState('verified');
        await agentMotion.wait(timings.targetHoverDelay * 2);
        hideHighlight();

        return { success: true, action };
      }

      case 'wait': {
        const ms = action.durationMs || 1000;
        setCursorStatus(action.reason || 'Waiting for page update...');
        await agentMotion.wait(ms);
        hideHighlight();
        return { success: true, action };
      }

      case 'goBack': {
        setCursorStatus('Navigating back...');
        window.history.back();
        await waitForPageSettling(timings.postClickStabilization);
        hideHighlight();
        return { success: true, action };
      }

      case 'extractAttendance': {
        hideHighlight();
        setCursorStatus('Reading attendance table...');
        const attendance = parseAttendanceFromUMS(document);
        if (attendance && attendance.courses.length > 0) {
          await highlightAttendanceVerification(action, attendance, document);
        }
        await agentMotion.wait(timings.preClickHighlightDelay);
        return { success: true, action, attendance: attendance || undefined };
      }

      case 'finish': {
        hideHighlight();
        setCursorStatus(action.reason || 'Goal accomplished!');
        const attendance = parseAttendanceFromUMS(document);
        if (attendance && attendance.courses.length > 0) {
          await highlightAttendanceVerification(action, attendance, document);
        }
        await agentMotion.wait(timings.preClickHighlightDelay);
        return { success: true, action, attendance: attendance || undefined };
      }

      default:
        return { success: false, action, error: `Unknown action: ${(action as any).action}` };
    }
  } catch (err: any) {
    hideHighlight();
    return { success: false, action, error: err.message || 'Action execution failed.' };
  }
}
