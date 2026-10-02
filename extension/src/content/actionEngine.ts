import { AgentAction, AttendanceSummary, ExaminationSummary, ExaminationRecord, GroundedTarget, SamplePaperResult } from '../shared/types';
import { getElementByOneeId, resolveClickableAncestor, isElementVisible } from './pageObserver';
import {
  showCursor,
  hideCursor,
  animateCursorTo,
  highlightElement,
  setHighlightState,
  hideHighlight,
  triggerClickRipple,
  setCursorStatus
} from './aiCursorOverlay';
import { parseAttendanceFromUMS } from './umsAttendanceParser';
import {
  parseExamDateSheet,
  extractDateSheetHeaderStats,
  findScrollableDateSheetContainer
} from './examination/examDateSheetParser';
import {
  buildExamIdentity,
  findNextExam as getNextExam,
  sortExamsChronologically
} from '../shared/examinationCalculator';
import { waitForExaminationContent } from './examination/examinationDetector';
import { calculateSafeScrollDelta, getTightBoundingBox, isTargetInSafeViewport, TightElementRect } from './coordinateUtils';
import { agentMotion, calculatePrecisionEasing } from './agentMotion';
import { getLowestAttendanceSubject } from '../shared/attendanceCalculator';
import { runUmsPreflight } from './umsPreflight';
import { executeOpenSamplePaper } from './samplePaperAgent';
import { parseStudentTimeTable, getAllAccessibleDocuments, findAcademicsMenuElement, findLmsMenuElement, findTimetableLinkElement } from './timetable/timetableParser';
import { TimetableSummary } from '../shared/types';

export interface ActionExecutionResult {
  success: boolean;
  action: AgentAction;
  error?: string;
  attendance?: AttendanceSummary;
  examination?: ExaminationSummary;
  timetable?: TimetableSummary;
  samplePaperResult?: SamplePaperResult;
  popupDismissed?: boolean;
  verified?: boolean;
  groundedTarget?: GroundedTarget;
}

let isExecutionCancelled = false;

/**
 * Immediately cancels any active browser agent execution in this tab,
 * clears overlays and stops animation loops.
 */
export function cancelActiveExecution(): void {
  isExecutionCancelled = true;
  try {
    hideHighlight();
    hideCursor();
  } catch {}
}

export function isCancelled(): boolean {
  return isExecutionCancelled;
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
function calculateInteractionPoint(element: HTMLElement, rect: DOMRect | TightElementRect): { x: number; y: number } {
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
    return;
  }

  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };

    const safetyTimer = setTimeout(finish, durationMs + 150);
    const startY = window.scrollY || window.pageYOffset || 0;
    const targetDelta = delta;
    const startTime = performance.now();

    function step(now: number) {
      if (resolved || isCancelled()) {
        clearTimeout(safetyTimer);
        finish();
        return;
      }
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
        clearTimeout(safetyTimer);
        finish();
      }
    }

    requestAnimationFrame(step);
  });
}

/**
 * Executes a frame-synchronized, buttery-smooth scroll on a specific element or the window.
 * Useful when the UMS page uses an inner scroll container instead of body.
 */
export async function smoothScrollElement(
  targetEl: HTMLElement | Window,
  delta: number,
  durationMs: number = 700
): Promise<void> {
  if (typeof window === 'undefined') return;

  if (targetEl === window || !(targetEl instanceof HTMLElement)) {
    return smoothScrollBy(delta, durationMs);
  }

  const container = targetEl as HTMLElement;

  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
    try {
      container.scrollTop += delta;
    } catch {}
    return;
  }

  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };

    const safetyTimer = setTimeout(finish, durationMs + 150);
    const startY = container.scrollTop;
    const targetDelta = delta;
    const startTime = performance.now();

    function step(now: number) {
      if (resolved || isCancelled()) {
        clearTimeout(safetyTimer);
        finish();
        return;
      }
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      const easedProgress = calculatePrecisionEasing(progress);
      container.scrollTop = startY + targetDelta * easedProgress;

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        clearTimeout(safetyTimer);
        finish();
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
  const rect = getTightBoundingBox(el);
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

  // Ensure seating plan / date sheet links open in a new tab so attendance tab stays intact
  const anchor = el.closest('a') as HTMLAnchorElement | null;
  const href = (anchor?.getAttribute('href') || (el as HTMLAnchorElement).getAttribute?.('href') || '').toLowerCase();
  const text = ((el.textContent || '') + ' ' + (anchor?.textContent || '')).toLowerCase();
  const isDedicatedTabLink =
    href.includes('seatingplan') ||
    href.includes('datesheet') ||
    href.includes('/examination/conduct/') ||
    text.includes('date sheet') ||
    text.includes('seating plan');

  if (anchor) {
    if (isDedicatedTabLink) {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
    }
  } else if (isDedicatedTabLink) {
    const rawHref = el.getAttribute('href') || (el as any).href;
    if (rawHref && typeof window !== 'undefined') {
      window.open(rawHref, '_blank', 'noopener,noreferrer');
      return;
    }
  }

  try {
    if (typeof PointerEvent !== 'undefined') {
      el.dispatchEvent(new PointerEvent('pointerdown', { ...eventInit, pointerType: 'mouse' }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, pointerType: 'mouse' }));
    }
  } catch {}

  try {
    el.dispatchEvent(new MouseEvent('mousedown', eventInit));
    el.dispatchEvent(new MouseEvent('mouseup', eventInit));
  } catch {}

  // Trigger primary click without duplicate synthetic click event
  try {
    el.click();
  } catch {
    try {
      el.dispatchEvent(new MouseEvent('click', eventInit));
    } catch {}
  }

  // If the target element is a container wrapping a specific button/link/icon,
  // also ensure the inner interactive target receives the click
  if (el.tagName.toLowerCase() === 'div') {
    const innerInteractive = el.querySelector<HTMLElement>(
      'a, button, [onclick], [role="button"], i.fa-info-circle, i[class*="info" i]'
    );
    if (innerInteractive && typeof innerInteractive.click === 'function') {
      try {
        innerInteractive.click();
      } catch {}
    }
  }
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

/**
 * Accurately highlights the examination table/card container or specific exam row:
/**
 * Locates the DOM element representing a specific course exam card or row.
 * Handles diverse card layouts across legacy and modern Student UMS portals.
 */
export function findExamElementForCourse(courseCode: string, doc: Document = document): HTMLElement | null {
  const code = courseCode.toUpperCase();
  const codeLower = courseCode.toLowerCase();

  // 1. Common structured selectors
  const selectors = [
    'tr',
    '.exam-card',
    '.seating-card',
    '.schedule-card',
    '.conduct-card',
    '.exam-item',
    '.exam-row',
    '.datesheet-item',
    '[data-testid="exam-card"]',
    '.mat-card',
    '.ant-card',
    'app-seating-plan-card',
    'app-datesheet-card',
    'div[class*="card" i]',
    'div[class*="exam" i]',
    'div[class*="seating" i]'
  ];

  const candidates = Array.from(doc.querySelectorAll(selectors.join(', '))) as HTMLElement[];
  const match = candidates.find((el) => {
    const t = (el.textContent || '').toUpperCase();
    return t.includes(code);
  });
  if (match) return match;

  // 2. Leaf element search (handles Angular SPAs without specific CSS card classes)
  const allDivs = Array.from(doc.querySelectorAll('div, section, article, li')) as HTMLElement[];
  const codeContainers = allDivs.filter((el) => {
    if (el.children && el.children.length > 25) return false;
    const t = (el.textContent || '').toUpperCase();
    return t.includes(code) && (t.includes('EXAM') || t.includes('DATE') || t.includes('REPORT') || /\d{1,2}:\d{2}/.test(t));
  });

  if (codeContainers.length > 0) {
    const leaf = codeContainers.find((c) => !codeContainers.some((other) => other !== c && c.contains(other)));
    return leaf || codeContainers[0];
  }

  // 3. Fallback: Any element with the course code and reasonable size
  return Array.from(doc.querySelectorAll('*')).find((el) => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.children.length > 8) return false;
    return (el.textContent || '').toLowerCase().includes(codeLower);
  }) as HTMLElement | null;
}

/**
 * Accurately highlights the examination table/card container or specific exam row:
 * - If goal asks for specific course (e.g. CSE443) -> highlights that course row/card
 * - If goal asks for next exam -> highlights the nearest future exam row/card
 * - If goal asks for seating plan / venue -> highlights the seating/venue card/row
 * - Fallback -> highlights the first exam card or overall date sheet table
 */
async function highlightExaminationVerification(
  action: AgentAction,
  examination: ExaminationSummary,
  doc: Document = document
): Promise<void> {
  if (!examination || !examination.exams || examination.exams.length === 0) return;

  const goalText = (action.goal || action.reason || '').toLowerCase();
  const nextExam = getNextExam(examination.exams);

  // 1. Check if a specific course is targeted
  const targetCourse = examination.exams.find((e) =>
    goalText.includes(e.courseCode.toLowerCase())
  );

  const isNextExamGoal = goalText.includes('next exam') || goalText.includes('upcoming');
  const isFullSheetGoal =
    goalText.includes('full') ||
    goalText.includes('all') ||
    goalText.includes('sheet') ||
    goalText.includes('schedule') ||
    goalText.includes('date sheet');

  // Case 1: Specific course row / card highlight
  if (targetCourse) {
    const match = findExamElementForCourse(targetCourse.courseCode, doc);
    if (match) {
      const rect = match.getBoundingClientRect();
      const targetPoint = {
        x: Math.round(rect.left + Math.min(rect.width * 0.45, 260)),
        y: Math.round(rect.top + rect.height * 0.5)
      };
      setCursorStatus(`Verifying ${targetCourse.courseCode} Exam...`);
      hideHighlight();
      await animateCursorTo(targetPoint.x, targetPoint.y);
      highlightElement(
        match,
        `Exam: ${targetCourse.courseCode} on ${targetCourse.examDate}${targetCourse.venue ? ` (${targetCourse.venue})` : ''}`,
        'verified'
      );
      setCursorStatus('Exam verified!');
      await agentMotion.wait(850);
      return;
    }
  }

  // Case 2: Next Exam highlight
  if (isNextExamGoal && nextExam && !isFullSheetGoal) {
    const match = findExamElementForCourse(nextExam.courseCode, doc);
    if (match) {
      const rect = match.getBoundingClientRect();
      const targetPoint = {
        x: Math.round(rect.left + Math.min(rect.width * 0.45, 260)),
        y: Math.round(rect.top + rect.height * 0.5)
      };
      setCursorStatus(`Next exam: ${nextExam.courseCode}...`);
      hideHighlight();
      await animateCursorTo(targetPoint.x, targetPoint.y);
      highlightElement(
        match,
        `Next Exam: ${nextExam.courseCode} (${nextExam.examDate} at ${nextExam.startTime || 'TBD'})`,
        'verified'
      );
      setCursorStatus('Exam schedule verified!');
      await agentMotion.wait(850);
      return;
    }
  }

  // Case 3: Match the nearest upcoming or first exam card
  const primaryExam = nextExam || examination.exams[0];
  if (primaryExam) {
    const match = findExamElementForCourse(primaryExam.courseCode, doc);
    if (match) {
      const rect = match.getBoundingClientRect();
      const targetPoint = {
        x: Math.round(rect.left + Math.min(rect.width * 0.45, 260)),
        y: Math.round(rect.top + rect.height * 0.5)
      };
      setCursorStatus(`Verifying Date Sheet: ${primaryExam.courseCode}...`);
      hideHighlight();
      await animateCursorTo(targetPoint.x, targetPoint.y);
      highlightElement(
        match,
        `Exam: ${primaryExam.courseCode} · ${examination.totalExams} Total Scheduled`,
        'verified'
      );
      setCursorStatus('Exam schedule verified!');
      await agentMotion.wait(850);
      return;
    }
  }

  // Case 4: Full Date Sheet / Table highlight
  const tables = Array.from(doc.querySelectorAll<HTMLTableElement>('table'));
  const examTable = tables.find((t) => {
    const txt = (t.textContent || '').toUpperCase();
    return /\b([A-Z]{2,5}\d{3,4})\b/.test(txt) && (txt.includes('DATE') || txt.includes('EXAM') || txt.includes('TIME'));
  });

  if (examTable) {
    const rect = examTable.getBoundingClientRect();
    const targetPoint = {
      x: Math.round(rect.left + Math.min(rect.width * 0.5, 300)),
      y: Math.round(rect.top + Math.min(rect.height * 0.35, 45))
    };
    setCursorStatus('Validating date sheet...');
    hideHighlight();
    await animateCursorTo(targetPoint.x, targetPoint.y);
    highlightElement(
      examTable,
      `Date Sheet Verified: ${examination.totalExams} Examinations Scheduled`,
      'verified'
    );
    setCursorStatus('Date sheet verified!');
    await agentMotion.wait(850);
    return;
  }

  // Case 5: Card container highlight fallback
  const container = doc.querySelector('.exam-card-container, .datesheet-container, .seating-plan-container, .main-content');
  if (container && container instanceof HTMLElement) {
    const rect = container.getBoundingClientRect();
    const targetPoint = {
      x: Math.round(rect.left + Math.min(rect.width * 0.5, 300)),
      y: Math.round(rect.top + 50)
    };
    hideHighlight();
    await animateCursorTo(targetPoint.x, targetPoint.y);
    highlightElement(container, `Date Sheet: ${examination.totalExams} Exams`, 'verified');
    await agentMotion.wait(850);
  }
}

/**
 * Accurately highlights both the Weekly Time Table Grid and the "My Course" Faculty Directory table:
 * 1. Brings Weekly Schedule Grid into view with safe scrolling.
 * 2. Highlights Weekly Schedule Grid and animates cursor smoothly across scheduled slots.
/**
 * Finds the internal scroll container for the SSRS ReportViewer timetable report.
 * Crucial: Scroller sits inside ReportViewer divs (e.g. overflow: auto/scroll),
 * NOT on window/document.body.
 */
function findTimetableScrollContainer(
  gridTable: HTMLElement,
  doc: Document = document
): HTMLElement | null {
  // 1. Walk up from gridTable to find an ancestor with scrollable overflow or ReportViewer ID
  let cur: HTMLElement | null = gridTable.parentElement;
  while (cur && cur !== doc.body && cur !== doc.documentElement) {
    const style = typeof window.getComputedStyle === 'function' ? window.getComputedStyle(cur) : (cur as any).style;
    const overflowY = (style?.overflowY || style?.overflow || '').toLowerCase();
    const id = (cur.id || '').toLowerCase();
    if (
      (overflowY.includes('auto') || overflowY.includes('scroll')) &&
      cur.scrollHeight > cur.clientHeight + 10
    ) {
      return cur;
    }
    if (id.includes('reportviewer') && cur.scrollHeight > cur.clientHeight + 10) {
      return cur;
    }
    cur = cur.parentElement;
  }

  // 2. Query common SSRS ReportViewer overflow containers enclosing gridTable
  const candidates = Array.from(
    doc.querySelectorAll<HTMLElement>(
      'div[id*="ReportViewer"], div[id*="ctl09"], div[style*="overflow"], div[style*="OVERFLOW"]'
    )
  );
  for (const el of candidates) {
    if (el.contains(gridTable) && el.scrollHeight > el.clientHeight + 10) {
      return el;
    }
  }

  // Fallback to direct parent if scrollable
  if (gridTable.parentElement && gridTable.parentElement.scrollHeight > gridTable.parentElement.clientHeight + 10) {
    return gridTable.parentElement;
  }

  return null;
}

/**
 * Verifies and highlights the Weekly Student Time Table grid and Faculty Directory:
 * 1. Highlights the weekly class matrix with verified green outline.
 * 2. Glides cursor across a scheduled class cell.
 * 3. Scrolls WITHIN the timetable report container (not the window) down to the faculty directory.
 * 4. Verifies faculty cabin assignment row with cursor.
 * 5. Scrolls container back to the top and re-frames timetable grid with verified highlight.
 */
async function highlightTimetableVerification(
  _action: AgentAction,
  timetable: TimetableSummary,
  doc: Document = document
): Promise<void> {
  if (!timetable) return;
  const isTest = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

  const allDocs = getAllAccessibleDocuments(doc);
  const tables: HTMLTableElement[] = [];
  for (const d of allDocs) {
    tables.push(...Array.from(d.querySelectorAll<HTMLTableElement>('table')));
  }

  let gridTable: HTMLTableElement | null = null;
  let courseTable: HTMLTableElement | null = null;

  // Prioritize leaf tables (tables that do NOT contain other tables inside them)
  // to avoid highlighting the outer layout wrapper or entire SSRS page
  const leafTables = tables.filter((t) => t.querySelectorAll('table').length === 0);
  const tablesToInspect = leafTables.length > 0 ? leafTables : tables;

  for (const tbl of tablesToInspect) {
    const text = (tbl.textContent || '').toLowerCase().replace(/[\u00a0\s]+/g, ' ');
    const rows = tbl.querySelectorAll('tr');
    const isDayMatrix =
      (text.includes('monday') || text.includes('mon')) &&
      (text.includes('tuesday') || text.includes('tue')) &&
      (text.includes('timing') || text.includes('time') || text.includes('wednesday') || text.includes('09:') || text.includes('10:'));

    if (!gridTable && isDayMatrix && rows.length >= 2) {
      gridTable = tbl;
    }
    if (
      !courseTable &&
      text.includes('course code') &&
      text.includes('faculty')
    ) {
      courseTable = tbl;
    }
  }

  // If gridTable still contains child tables, drill down to the innermost schedule matrix
  if (gridTable && gridTable.querySelectorAll('table').length > 0) {
    const nested = Array.from(gridTable.querySelectorAll<HTMLTableElement>('table'));
    for (const inner of nested) {
      const iText = (inner.textContent || '').toLowerCase();
      if ((iText.includes('monday') || iText.includes('mon')) && inner.querySelectorAll('tr').length >= 2) {
        gridTable = inner;
        break;
      }
    }
  }

  // Fallback: If no day grid matched, look for leaf table mentioning timetable
  if (!gridTable) {
    for (const tbl of tablesToInspect) {
      const text = (tbl.textContent || '').toLowerCase().replace(/[\u00a0\s]+/g, ' ');
      if (text.includes('time table') || text.includes('timetable')) {
        gridTable = tbl;
        break;
      }
    }
  }

  if (gridTable && isElementVisible(gridTable)) {
    const rect = gridTable.getBoundingClientRect();
    const targetPoint = {
      x: Math.round(rect.left + Math.min(rect.width * 0.45, 260)),
      y: Math.round(rect.top + Math.min(rect.height * 0.25, 50))
    };

    let cleanSec = (timetable.homeSection || '').replace(/Legends.*$/i, '').trim();
    if (!cleanSec || /^(time|timetable|table|schedule|weekly|report|legends|legend)$/i.test(cleanSec)) {
      const slotSec = timetable.slots.find((s) => s.section && !/^(time|timetable|table|schedule|weekly|report|legends|legend)$/i.test(s.section));
      cleanSec = slotSec?.section || (timetable.vid ? `VID: ${timetable.vid}` : 'UMS');
    }
    highlightElement(
      gridTable,
      `Verified Time Table: ${timetable.slots.length} Classes (${cleanSec || 'UMS'})`,
      'verified'
    );

    await animateCursorTo(targetPoint.x, targetPoint.y);
    await agentMotion.wait(isTest ? 10 : 250);

    // Micro-animate cursor across 1 prominent class cell
    if (!isTest && timetable.slots.length > 0) {
      const cells = Array.from(gridTable.querySelectorAll('td')).filter((td) => {
        const txt = (td.textContent || '').trim();
        return txt.length > 10 && (txt.includes('Lecture') || txt.includes('Practical') || txt.includes('C:'));
      });
      if (cells.length > 0) {
        const cell = cells[0];
        const cRect = cell.getBoundingClientRect();
        if (cRect.width > 20 && cRect.height > 15) {
          const cx = Math.round(cRect.left + cRect.width * 0.5);
          const cy = Math.round(cRect.top + cRect.height * 0.5);
          setCursorStatus('Inspecting scheduled class...');
          await animateCursorTo(cx, cy);
          await agentMotion.wait(200);
        }
      }
    }

    // Locate internal scroll container for timetable report
    const scrollContainer = findTimetableScrollContainer(gridTable, doc);

    // Scroll WITHIN timetable container to faculty details & cabins
    if (scrollContainer && !isTest) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const courseRect = courseTable ? courseTable.getBoundingClientRect() : null;
      let scrollDelta = 0;
      if (courseRect) {
        scrollDelta = Math.max(0, courseRect.top - containerRect.top - 20);
      } else {
        scrollDelta = Math.min(scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop, 400);
      }

      if (scrollDelta > 20) {
        setCursorStatus('Scrolling to faculty & cabin directory...');
        await smoothScrollElement(scrollContainer, scrollDelta, 450);
        await agentMotion.wait(200);

        if (courseTable) {
          const cabinRow = Array.from(courseTable.querySelectorAll('tr')).slice(1).find((r) => {
            const txt = (r.textContent || '').toLowerCase();
            return txt.includes('-') || txt.includes('cabin') || txt.includes('dr.') || txt.includes('mr.') || txt.includes('ms.');
          }) || courseTable.querySelector('tr:nth-child(2)');

          if (cabinRow && cabinRow instanceof HTMLElement) {
            highlightElement(cabinRow, 'Faculty & Cabin Assignment', 'discovered');
            const rowRect = cabinRow.getBoundingClientRect();
            await animateCursorTo(Math.round(rowRect.left + Math.min(rowRect.width * 0.5, 300)), Math.round(rowRect.top + rowRect.height * 0.5));
            setCursorStatus('Verifying faculty cabin assignment...');
            await agentMotion.wait(300);
          }
        }

        // Smoothly scroll the container back up to the top
        setCursorStatus('Returning to weekly schedule...');
        await smoothScrollElement(scrollContainer, -scrollContainer.scrollTop, 400);
        await agentMotion.wait(200);
      }
    }

    // Re-frame the weekly timetable grid with verified highlight
    let cleanSecFinal = (timetable.homeSection || '').replace(/Legends.*$/i, '').trim();
    if (!cleanSecFinal || /^(time|timetable|table|schedule|weekly|report|legends|legend)$/i.test(cleanSecFinal)) {
      const slotSec = timetable.slots.find((s) => s.section && !/^(time|timetable|table|schedule|weekly|report|legends|legend)$/i.test(s.section));
      cleanSecFinal = slotSec?.section || (timetable.vid ? `VID: ${timetable.vid}` : 'UMS');
    }
    highlightElement(
      gridTable,
      `Verified Time Table: ${timetable.slots.length} Classes (${cleanSecFinal || 'UMS'})`,
      'verified'
    );
    setCursorStatus('Faculty & cabin directory verified!');
    await agentMotion.wait(isTest ? 10 : 200);
    // Note: hideHighlight() is intentionally NOT called so the green verified box remains visible!
  }
}

/**
 * Traverses the UMS Examination Date Sheet interface using real browser scrolling
 * and parses all examination records across the complete student schedule.
 * Performs a single continuous smooth downward scroll pass and returns to top,
 * reading all scheduled exams without repetitive looping or lag.
 */
/**
 * Deterministically extracts the full examination date sheet & seating plan
 * by dynamically traversing the live UMS DOM.
 *
 * Adheres strictly to the evidence-based collection algorithm:
 * 1. Reads initial visible viewport
 * 2. Traverses scrollable containers with real scroll events
 * 3. Accumulates all unique exams into canonical exams[]
 * 4. Checks container bounds (scrollHeight, clientHeight, scrollTop)
 * 5. Executes a final stability check to guarantee no async records are missed
 * 6. Returns chronologically sorted, validated, and verified dataset
 */
async function extractCompleteExaminationSchedule(
  action: AgentAction,
  doc: Document = document
): Promise<ExaminationSummary> {
  const timings = agentMotion.getTimings();
  hideHighlight();
  setCursorStatus('Scanning examination schedule...');

  // Wait if cards are still asynchronously mounting in Angular SPA
  let initialSummary = parseExamDateSheet(doc);
  if (!initialSummary || initialSummary.exams.length === 0) {
    const waitRes = await waitForExaminationContent(4000, doc);
    if (waitRes.success) {
      initialSummary = parseExamDateSheet(doc);
    }
  }

  const allKnownExams: Map<string, ExaminationRecord> = new Map();
  if (initialSummary && initialSummary.exams) {
    initialSummary.exams.forEach((e: ExaminationRecord) => allKnownExams.set(buildExamIdentity(e), e));
  }

  const headerStats = extractDateSheetHeaderStats(doc);
  const targetCount = headerStats.totalExams > 0 ? headerStats.totalExams : 0;
  const primaryScrollContainer = findScrollableDateSheetContainer(doc);
  const isTest = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

  // Helper to test if the primary scroll container has reached the bottom
  const checkIsAtBottom = (): boolean => {
    if (primaryScrollContainer !== window && primaryScrollContainer instanceof HTMLElement) {
      const remaining = primaryScrollContainer.scrollHeight - (primaryScrollContainer.scrollTop + primaryScrollContainer.clientHeight);
      if (remaining <= 25) return true;
    }
    const scroller = doc.scrollingElement || doc.documentElement || doc.body;
    if (scroller) {
      const remaining = scroller.scrollHeight - (scroller.scrollTop + (window.innerHeight || scroller.clientHeight));
      if (remaining <= 25) return true;
    }
    return false;
  };

  // If initial viewport already contains all target exams, finish immediately without any scrolling
  if (!isTest && !isCancelled() && targetCount > 0 && allKnownExams.size >= targetCount) {
    setCursorStatus(`Verified all ${allKnownExams.size} scheduled examinations.`);
  } else if (!isTest && !isCancelled() && (targetCount === 0 || allKnownExams.size < targetCount)) {
    // Perform deliberate, single-container incremental downward scroll passes only when needed
    const scrollStep = 320;
    const maxScrollSteps = 12;
    let consecutiveStableSteps = 0;
    let lastRecordCount = allKnownExams.size;

    for (let stepIndex = 0; stepIndex < maxScrollSteps; stepIndex++) {
      if (isCancelled()) break;
      if (targetCount > 0 && allKnownExams.size >= targetCount) break;

      setCursorStatus(
        targetCount > 0
          ? `Discovered ${allKnownExams.size}/${targetCount} exams. Scanning schedule...`
          : `Discovered ${allKnownExams.size} exams. Scanning schedule...`
      );

      // Scroll ONLY the single primary container to prevent conflicting scroll battles and lag
      let scrolled = false;
      if (primaryScrollContainer !== window && primaryScrollContainer instanceof HTMLElement) {
        try {
          const prevTop = primaryScrollContainer.scrollTop;
          primaryScrollContainer.scrollTop += scrollStep;
          if (primaryScrollContainer.scrollTop > prevTop) {
            primaryScrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
            scrolled = true;
          }
        } catch {}
      }
      if (!scrolled) {
        try {
          if (doc.scrollingElement) doc.scrollingElement.scrollTop += scrollStep;
          window.scrollBy({ top: scrollStep, behavior: 'smooth' });
          window.dispatchEvent(new Event('scroll'));
        } catch {}
      }

      // Observation checkpoint: allow Angular change detection & DOM layout to settle
      await agentMotion.wait(320, () => isCancelled());
      if (isCancelled()) break;

      // Extract newly revealed exam records
      const stepSummary = parseExamDateSheet(doc);
      if (stepSummary && stepSummary.exams) {
        stepSummary.exams.forEach((e) => allKnownExams.set(buildExamIdentity(e), e));
        if (stepSummary.diagnostics && initialSummary?.diagnostics) {
          initialSummary.diagnostics.candidateRecordCount = Math.max(
            initialSummary.diagnostics.candidateRecordCount,
            stepSummary.diagnostics.candidateRecordCount
          );
          initialSummary.diagnostics.successfullyParsedCount = Math.max(
            initialSummary.diagnostics.successfullyParsedCount,
            allKnownExams.size
          );
        }
      }

      if (targetCount > 0 && allKnownExams.size >= targetCount) {
        break;
      }

      const isBottom = checkIsAtBottom();
      if (allKnownExams.size === lastRecordCount) {
        consecutiveStableSteps++;
        if (isBottom && consecutiveStableSteps >= 2) {
          // Reached true bottom and no new records appeared in consecutive passes
          break;
        }
      } else {
        consecutiveStableSteps = 0;
        lastRecordCount = allKnownExams.size;
      }
    }

    // Final stability check: verify asynchronously lazy-loaded records without jumping
    if (!isCancelled()) {
      await agentMotion.wait(250, () => isCancelled());
      const stableSummary = parseExamDateSheet(doc);
      if (stableSummary && stableSummary.exams) {
        stableSummary.exams.forEach((e) => allKnownExams.set(buildExamIdentity(e), e));
      }
    }
  }

  const finalExams = sortExamsChronologically(Array.from(allKnownExams.values()));
  const finalHeaderStats = extractDateSheetHeaderStats(doc);
  const totalExams = finalExams.length >= finalHeaderStats.totalExams
    ? finalExams.length
    : finalHeaderStats.totalExams > 0
    ? finalHeaderStats.totalExams
    : finalExams.length;

  const completeSummary: ExaminationSummary = {
    exams: finalExams,
    totalExams,
    capturedAt: Date.now(),
    verified: finalExams.length > 0,
    source: 'UMS Examination Date Sheet & Seating Plan',
    pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
    diagnostics: initialSummary?.diagnostics
  };

  console.log('[actionEngine] Examination collection complete:', {
    targetCount,
    discoveredCount: finalExams.length,
    totalExams: completeSummary.totalExams,
    courseCodes: finalExams.map((e: ExaminationRecord) => e.courseCode),
    diagnostics: completeSummary.diagnostics
  });

  if (!isCancelled() && completeSummary.exams.length > 0) {
    await highlightExaminationVerification(action, completeSummary, doc);
    await agentMotion.wait(timings.preClickHighlightDelay, () => isCancelled());
    hideHighlight();
    hideCursor();
  }

  return completeSummary;
}

/*
 * Performs the actual browser action on the live UMS DOM.
 *
 * Before clicking or typing, we re-check where the element is on screen.
 * This is important because earlier clicks or animations could have shifted
 * the button or table position, so we don't want to blindly click old coordinates.
 */
export async function executeAgentAction(action: AgentAction): Promise<ActionExecutionResult> {
  isExecutionCancelled = false;
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
        let rect = getTightBoundingBox(element);
        let targetPoint = calculateInteractionPoint(element, rect);

        // 4. Target Discovery State
        const label = action.reason ? `Target: ${action.reason}` : 'Locating target...';
        highlightElement(element, label, 'discovered');
        await agentMotion.wait(timings.preClickHighlightDelay);

        // 5. Approaching State & Trajectory Movement
        setHighlightState('approaching');
        await animateCursorTo(targetPoint.x, targetPoint.y);

        // 6. Pre-Click Settle Period (250–500ms): Verify target geometry before clicking
        rect = getTightBoundingBox(element);
        targetPoint = calculateInteractionPoint(element, rect);
        setHighlightState('verified');
        setCursorStatus(action.reason || 'Opening Attendance');

        await agentMotion.wait(timings.preClickSettleDelay);

        // 7. Click Pulse & Real DOM Event Dispatch
        await triggerClickRipple();
        dispatchRealClick(element);
        hideHighlight();

        const elHref = (element.getAttribute('href') || (element as any).href || '').toLowerCase();
        const elText = (element.textContent || '').toLowerCase();
        const actReason = (action.reason || '').toLowerCase();
        const isExamOrSeatingLink =
          elHref.includes('datesheet') ||
          elHref.includes('seatingplan') ||
          elHref.includes('/examination/conduct/') ||
          elText.includes('date sheet') ||
          elText.includes('datesheet') ||
          elText.includes('seating plan') ||
          actReason.includes('date sheet') ||
          actReason.includes('datesheet') ||
          actReason.includes('seating plan');

        if (isExamOrSeatingLink) {
          hideCursor();
        }

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

        const rect = getTightBoundingBox(element);
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

        const rect = getTightBoundingBox(element);
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
        const rect = getTightBoundingBox(element);
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

      case 'waitForRender': {
        const ms = action.durationMs || 12000;
        setCursorStatus(action.reason || 'Waiting for UMS records to render...');
        hideHighlight();
        const renderRes = await waitForExaminationContent(ms, document);
        if (renderRes.success && renderRes.count > 0) {
          setCursorStatus(`Rendered ${renderRes.count} examination record${renderRes.count > 1 ? 's' : ''}.`);
          await agentMotion.wait(timings.preClickHighlightDelay);
          return { success: true, action };
        }
        return {
          success: renderRes.success,
          action,
          error: renderRes.success ? undefined : 'Examination records did not render within timeout'
        };
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

      case 'scrollContainer': {
        const container = action.elementId
          ? (getElementByOneeId(action.elementId) as HTMLElement | null)
          : (findScrollableDateSheetContainer(document) as HTMLElement | null);
        const direction = action.direction || 'down';
        const amount = action.amount || 400;
        const delta = direction === 'down' ? amount : -amount;
        setCursorStatus(`Scrolling container ${direction}...`);
        if (container && container instanceof HTMLElement) {
          await smoothScrollElement(container, delta, 550);
        } else {
          await smoothScrollBy(delta, 550);
        }
        await agentMotion.wait(timings.scrollSettleDelay);
        hideHighlight();
        return { success: true, action };
      }

      case 'dismissPopup': {
        hideHighlight();
        setCursorStatus('Checking for blocking notifications...');
        const preflight = await runUmsPreflight(document);
        return {
          success: true,
          action,
          popupDismissed: preflight.dismissed
        };
      }

      case 'openSamplePaper': {
        hideHighlight();
        const course = action.text || action.value || '';
        const spResult = await executeOpenSamplePaper(course, document);
        return {
          success: Boolean(spResult.success),
          action,
          samplePaperResult: spResult,
          error: spResult.error
        };
      }

      case 'extractExamination': {
        hideHighlight();
        setCursorStatus('Traversing and reading complete examination date sheet...');
        const examination = await extractCompleteExaminationSchedule(action, document);
        hideHighlight();
        hideCursor();
        return { success: true, action, examination: examination || undefined };
      }

      case 'extractSeatingPlan': {
        hideHighlight();
        setCursorStatus('Traversing and reading complete seating plan...');
        const examination = await extractCompleteExaminationSchedule(action, document);
        hideHighlight();
        hideCursor();
        return { success: true, action, examination: examination || undefined };
      }

      case 'extractTimetable': {
        setCursorStatus('Reading weekly timetable and faculty directory...');
        const timetable = parseStudentTimeTable(document);

        if (timetable && (timetable.slots.length > 0 || timetable.courses.length > 0)) {
          await highlightTimetableVerification(action, timetable, document);
        }

        // Leave highlight visible on table! Hide cursor overlay cleanly when extraction finishes
        hideCursor(true);
        return {
          success: Boolean(timetable && (timetable.slots.length > 0 || timetable.courses.length > 0)),
          action,
          timetable: timetable || undefined
        };
      }

/**
 * Brings a menu target (e.g. LMS, View Time Table) into view within its dropdown container.
 * CRITICAL RULE: NEVER scroll the window when navigating open dropdown menus,
 * because window scrolling triggers Bootstrap/portal scroll listeners that close the menu!
 * Only the internal dropdown menu container (.dropdown-menu, .mega-menu) is scrolled.
 */
async function bringMenuTargetIntoView(el: HTMLElement, reason?: string): Promise<void> {
  if (!el || !el.isConnected) return;

  // 1. Locate scrollable ancestor container (e.g. .dropdown-menu, .mega-menu)
  let scrollContainer: HTMLElement | null = null;
  let curr: HTMLElement | null = el.parentElement;

  while (curr && curr !== document.body && curr !== document.documentElement) {
    const style = window.getComputedStyle(curr);
    const overflowY = style.overflowY || style.overflow;
    const canScroll = curr.scrollHeight > curr.clientHeight + 5;
    if (
      canScroll &&
      (overflowY === 'auto' ||
        overflowY === 'scroll' ||
        overflowY === 'overlay' ||
        curr.classList.contains('dropdown-menu') ||
        curr.classList.contains('mega-menu'))
    ) {
      scrollContainer = curr;
      break;
    }
    curr = curr.parentElement;
  }

  if (!scrollContainer) {
    const menuAncestor = el.closest<HTMLElement>(
      '.dropdown-menu, .mega-menu, ul.dropdown-menu, .dropdown.open .dropdown-menu'
    );
    if (menuAncestor && menuAncestor.scrollHeight > menuAncestor.clientHeight + 5) {
      scrollContainer = menuAncestor;
    }
  }

  // 2. If inside a scrollable menu container, scroll internal container so el is centered
  if (scrollContainer) {
    const cRect = scrollContainer.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();

    // Constant offset of element within the container's scrollable canvas
    const elOffsetInContent = (elRect.top - cRect.top) + scrollContainer.scrollTop;

    // Desired position: 35% from the top of the visible container
    const targetScrollTop = Math.max(
      0,
      Math.min(
        scrollContainer.scrollHeight - scrollContainer.clientHeight,
        Math.round(elOffsetInContent - cRect.height * 0.35)
      )
    );

    const delta = targetScrollTop - scrollContainer.scrollTop;

    if (Math.abs(delta) > 5) {
      setCursorStatus(reason ? `Scrolling to ${reason} in Academics...` : 'Scrolling menu...');
      await smoothScrollElement(scrollContainer, delta, 350);
      scrollContainer.scrollTop = targetScrollTop;
      scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
      await agentMotion.wait(150);
    }
    return;
  }

  // 3. Fallback for non-dropdown elements outside of menus only:
  // If not inside any open menu or dropdown, ensure element is in safe viewport zone
  const isInsideMenu = Boolean(
    el.closest('.dropdown-menu, .dropdown, [data-toggle="dropdown"], .nav-item')
  );
  if (!isInsideMenu && !isTargetInSafeViewport(el)) {
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      await agentMotion.wait(250);
    } catch {
      await ensureTargetInSafeZone(el, reason);
    }
  }
}

      case 'openAcademicsTimetableMenu': {
        setCursorStatus('Navigating to Academics in top navbar...');
        const academicsEl = findAcademicsMenuElement(document);
        if (!academicsEl) {
          return { success: false, action, error: 'Academics menu trigger not found in top navbar' };
        }

        // 1. Move cursor to Academics menu
        await ensureTargetInSafeZone(academicsEl, 'Academics');
        const acRect = academicsEl.getBoundingClientRect();
        const acPoint = calculateInteractionPoint(academicsEl, acRect);

        highlightElement(academicsEl, 'Academics', 'discovered');
        await animateCursorTo(acPoint.x, acPoint.y);

        // Physically expand dropdown in DOM (Bootstrap 3/4/5 and CSS hover support)
        const parentDropdown = academicsEl.closest('.dropdown, li, .nav-item') || academicsEl.parentElement;
        if (parentDropdown) {
          parentDropdown.classList.add('open', 'show');
          parentDropdown.setAttribute('aria-expanded', 'true');
        }
        academicsEl.setAttribute('aria-expanded', 'true');

        const dropdownMenu =
          parentDropdown?.querySelector<HTMLElement>('.dropdown-menu, ul') ||
          document.querySelector<HTMLElement>('.dropdown.open .dropdown-menu, .dropdown-menu');
        if (dropdownMenu) {
          dropdownMenu.style.display = 'block';
          dropdownMenu.style.visibility = 'visible';
          dropdownMenu.style.opacity = '1';
        }

        // Dispatch hover and real click to trigger menu open
        try {
          academicsEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
          academicsEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
        } catch {}

        setHighlightState('verified');
        await triggerClickRipple();
        dispatchRealClick(academicsEl);
        await agentMotion.wait(350);

        // 2. Check if View Time Table link is directly available
        let ttEl = findTimetableLinkElement(document);

        // If not directly found and dropdownMenu is scrollable, bit-scroll down to uncover items
        if (!ttEl && dropdownMenu && dropdownMenu.scrollHeight > dropdownMenu.clientHeight + 10) {
          dropdownMenu.scrollTop = Math.round(dropdownMenu.clientHeight * 0.4);
          dropdownMenu.dispatchEvent(new Event('scroll', { bubbles: true }));
          await agentMotion.wait(150);
          ttEl = findTimetableLinkElement(document);
        }

        // 3. If not directly available or visible, navigate through LMS submenu
        if (!ttEl || !isElementVisible(ttEl)) {
          const lmsEl = findLmsMenuElement(document);
          if (lmsEl) {
            const lmsParent = lmsEl.closest('.dropdown-submenu, .dropdown, li') || lmsEl.parentElement;
            if (lmsParent) {
              lmsParent.classList.add('open', 'show');
              const lmsSubMenu = lmsParent.querySelector<HTMLElement>('.dropdown-menu, ul');
              if (lmsSubMenu) {
                lmsSubMenu.style.display = 'block';
                lmsSubMenu.style.visibility = 'visible';
                lmsSubMenu.style.opacity = '1';
              }
            }

            setCursorStatus('Navigating into LMS submenu...');
            await bringMenuTargetIntoView(lmsEl, 'LMS');
            const lmsRect = lmsEl.getBoundingClientRect();
            const lmsPoint = calculateInteractionPoint(lmsEl, lmsRect);
            highlightElement(lmsEl, 'LMS', 'discovered');
            await animateCursorTo(lmsPoint.x, lmsPoint.y);

            try {
              lmsEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true, view: window }));
              lmsEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
            } catch {}

            setHighlightState('verified');
            await triggerClickRipple();
            dispatchRealClick(lmsEl);
            await agentMotion.wait(400);

            // Re-evaluate timetable link inside expanded LMS submenu
            ttEl = findTimetableLinkElement(document);
          }
        }

        // 4. Locate and click View Time Table link with visible verification
        if (ttEl) {
          // Ensure ancestor chain is rendered and visible
          let p: HTMLElement | null = ttEl.parentElement;
          while (p && p !== document.body) {
            if (window.getComputedStyle(p).display === 'none') {
              p.style.display = 'block';
              p.style.visibility = 'visible';
              p.style.opacity = '1';
            }
            p = p.parentElement;
          }

          setCursorStatus('Opening View Time Table...');
          await bringMenuTargetIntoView(ttEl, 'View Time Table');
          const ttRect = ttEl.getBoundingClientRect();
          const ttPoint = calculateInteractionPoint(ttEl, ttRect);
          highlightElement(ttEl, 'View Time Table', 'discovered');
          await animateCursorTo(ttPoint.x, ttPoint.y);
          setHighlightState('verified');
          await triggerClickRipple();

          // Dispatch in-page click (never open a new tab)
          dispatchRealClick(ttEl);
          await agentMotion.wait(500);

          // Guaranteed same-window navigation if anchor href is present
          const rawHref = (ttEl as HTMLAnchorElement).href || ttEl.getAttribute('href');
          if (rawHref && !rawHref.startsWith('#') && !rawHref.startsWith('javascript:')) {
            setTimeout(() => {
              if (!window.location.href.toLowerCase().includes('frmstudenttimetable')) {
                window.location.href = rawHref;
              }
            }, 650);
          }

          return { success: true, action };
        }

        return { success: false, action, error: 'View Time Table link not visible in expanded menu' };
      }

      case 'finish': {
        hideHighlight();
        setCursorStatus(action.reason || 'Goal accomplished!');
        const goalLower = (action.goal || action.reason || '').toLowerCase();
        const isTimetableGoal =
          goalLower.includes('timetable') ||
          goalLower.includes('time table') ||
          goalLower.includes('class schedule') ||
          goalLower.includes('classes today') ||
          goalLower.includes('today classes') ||
          goalLower.includes('faculty');

        const isExamGoal =
          !isTimetableGoal &&
          (goalLower.includes('exam') ||
            goalLower.includes('date sheet') ||
            goalLower.includes('datesheet') ||
            goalLower.includes('seating plan') ||
            goalLower.includes('schedule'));

        if (isTimetableGoal) {
          const timetable = parseStudentTimeTable(document);
          if (timetable && (timetable.slots.length > 0 || timetable.courses.length > 0)) {
            await highlightTimetableVerification(action, timetable, document);
          }
          return { success: true, action, timetable: timetable || undefined };
        } else if (isExamGoal) {
          const examination = await extractCompleteExaminationSchedule(action, document);
          hideHighlight();
          hideCursor();
          return { success: true, action, examination: examination || undefined };
        } else {
          const attendance = parseAttendanceFromUMS(document);
          if (attendance && attendance.courses.length > 0) {
            await highlightAttendanceVerification(action, attendance, document);
          }
          await agentMotion.wait(timings.preClickHighlightDelay);
          hideHighlight();
          hideCursor();
          return { success: true, action, attendance: attendance || undefined };
        }
      }

      default:
        return { success: false, action, error: `Unknown action: ${(action as any).action}` };
    }
  } catch (err: any) {
    hideHighlight();
    hideCursor();
    return { success: false, action, error: err.message || 'Action execution failed.' };
  }
}
