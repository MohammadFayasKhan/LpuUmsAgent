/*
 * UMS Content Script for ONEE.
 *
 * This script runs directly inside ums.lpu.in tabs.
 * It serves two main roles:
 * 1. Passive DOM Observation: It watches for the presence of the UMS attendance table
 *    using a debounced MutationObserver. When the student clicks into attendance,
 *    it parses the table and notifies the side panel immediately.
 * 2. Computer Use Execution Bridge: When the browser agent decides to click,
 *    type, scroll, or extract, this script receives the action message from the
 *    side panel and runs it through actionEngine.ts.
 *
 * Privacy Note: This script never captures passwords, auth cookies, or keystrokes
 * entered into login forms. It only targets attendance tables and navigation controls.
 */

import { detectUmsState } from './umsDetector';
import { parseUmsAttendance } from './umsAttendanceParser';
import { observePage } from './pageObserver';
import { executeAgentAction } from './actionEngine';
import { hideCursor, showCursor } from './aiCursorOverlay';
import {
  MESSAGE_TYPES,
  ExtensionMessage,
  UmsResponsePayload
} from '../shared/messages';
import { ConnectionStatus, AttendanceSummary } from '../shared/types';

let lastStatus: ConnectionStatus = 'NOT_CONNECTED';
let lastAttendance: AttendanceSummary | null = null;
let scanTimeout: number | null = null;

/*
 * Searches for clickable attendance triggers in the UMS dashboard.
 * UMS often embeds attendance links in cards with titles like "ATTENDANCE : 98%"
 * or in sidebar menu items labeled "View Attendance".
 */
function findAttendanceLinkElement(): HTMLElement | null {
  const elements = Array.from(document.querySelectorAll('a, button, li, span, div, p, i'));
  for (const el of elements) {
    const text = (el.textContent || '').trim().toLowerCase();
    const onclick = (el.getAttribute('onclick') || '').toLowerCase();

    if (
      text.includes('attendance :') ||
      text === 'view attendance' ||
      text.includes('view attendance') ||
      text === 'my class' ||
      onclick.includes('attendance')
    ) {
      return el as HTMLElement;
    }
  }
  return null;
}

/*
 * Triggers in-page opening of the attendance view.
 * If a link is found, we click it and schedule a quick scan so the UI updates
 * as soon as the modal or new view renders.
 */
function navigateToAttendance(): boolean {
  const linkEl = findAttendanceLinkElement();
  if (linkEl) {
    linkEl.click();
    scheduleScan(300);
    return true;
  }
  scheduleScan(100);
  return true;
}

/*
 * Inspects the current DOM to determine whether the student is logged in,
 * facing a Cloudflare verification challenge, or viewing their attendance numbers.
 */
function scanCurrentPage(): UmsResponsePayload {
  const detection = detectUmsState(document, window.location);

  if (!detection.isUmsDomain) {
    lastStatus = 'NOT_CONNECTED';
    lastAttendance = null;
    return {
      status: 'NOT_CONNECTED',
      errorMessage: detection.statusMessage
    };
  }

  if (detection.status === 'HUMAN_VERIFICATION') {
    lastStatus = 'HUMAN_VERIFICATION';
    lastAttendance = null;
    return {
      status: 'HUMAN_VERIFICATION',
      errorMessage: detection.statusMessage
    };
  }

  if (detection.status === 'LOGIN_PAGE') {
    lastStatus = 'LOGIN_PAGE';
    lastAttendance = null;
    return {
      status: 'LOGIN_PAGE',
      errorMessage: detection.statusMessage
    };
  }

  // Attempt to parse the structured attendance table from the active DOM
  const attendance = parseUmsAttendance(document);
  if (attendance && attendance.courses.length > 0) {
    lastStatus = 'READY';
    lastAttendance = attendance;
    return {
      status: 'READY',
      attendance
    };
  }

  // The student is authenticated on the UMS dashboard, but has not opened attendance yet
  lastStatus = 'NO_ATTENDANCE_ON_PAGE';
  lastAttendance = null;
  const hasLink = findAttendanceLinkElement() !== null;

  return {
    status: 'NO_ATTENDANCE_ON_PAGE',
    errorMessage:
      'ONEE is connected to your LPU UMS session. Open Academics > View Attendance in your UMS tab and ONEE will read it automatically.',
    hasAttendanceLink: hasLink
  };
}

/*
 * Sends a message to the side panel and background worker with the latest UMS status.
 */
function notifyStatusChange() {
  const payload = scanCurrentPage();
  try {
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.UMS_STATUS_UPDATE,
      payload
    }).catch(() => {
      // Receiver may be closed, ignore
    });
  } catch {
    // Ignore runtime disconnection
  }
}

/*
 * Debounced page scanner:
 * Prevents rapid-fire DOM parsing when UMS is rendering multiple components or animations.
 */
function scheduleScan(delay = 600) {
  if (scanTimeout) {
    window.clearTimeout(scanTimeout);
  }
  scanTimeout = window.setTimeout(() => {
    const prevStatus = lastStatus;
    const payload = scanCurrentPage();
    if (payload.status !== prevStatus || payload.attendance !== lastAttendance) {
      notifyStatusChange();
    }
  }, delay);
}

// Initial scan after script injection
scheduleScan(200);

/*
 * Message Dispatcher:
 * Handles commands sent from the side panel or background script.
 */
chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: UmsResponsePayload) => void
  ) => {
    if (
      message.type === MESSAGE_TYPES.REQUEST_UMS_STATUS ||
      message.type === MESSAGE_TYPES.REQUEST_ATTENDANCE_DATA ||
      message.type === MESSAGE_TYPES.TRIGGER_PAGE_SCAN
    ) {
      const result = scanCurrentPage();
      sendResponse(result);
      return false;
    }

    if (message.type === MESSAGE_TYPES.NAVIGATE_TO_ATTENDANCE) {
      navigateToAttendance();
      sendResponse({ status: 'READING' });
      return false;
    }

    if (message.type === MESSAGE_TYPES.PING) {
      sendResponse({ status: lastStatus });
      return false;
    }

    /*
     * Computer Use: Generate a structured snapshot of visible interactive
     * elements so the planner can decide what action to take next.
     */
    if (message.type === MESSAGE_TYPES.OBSERVE_PAGE) {
      const observation = observePage(document);
      sendResponse({
        status: lastStatus,
        observation
      });
      return false;
    }

    /*
     * Computer Use: Execute a specific click, scroll, or extract action.
     * We return true here to tell Chrome to keep the message channel open
     * until the async browser action finishes and sendResponse is called.
     */
    if (message.type === MESSAGE_TYPES.EXECUTE_ACTION) {
      executeAgentAction(message.action)
        .then((result) => {
          sendResponse({
            status: lastStatus,
            actionResult: {
              success: result.success,
              error: result.error,
              attendance: result.attendance
            }
          });
        })
        .catch((err) => {
          sendResponse({
            status: lastStatus,
            actionResult: {
              success: false,
              error: err.message
            }
          });
        });
      return true;
    }

    // Show the animated Computer Use cursor at specified coordinates
    if (message.type === MESSAGE_TYPES.SHOW_CURSOR) {
      const x = typeof message.x === 'number' ? message.x : Math.max(10, window.innerWidth - 30);
      const y = typeof message.y === 'number' ? message.y : 220;
      showCursor(x, y, message.label || 'Checking your attendance...');
      sendResponse({ status: lastStatus });
      return false;
    }

    // Hide the Computer Use cursor after action completion
    if (message.type === MESSAGE_TYPES.HIDE_CURSOR) {
      hideCursor();
      sendResponse({ status: lastStatus });
      return false;
    }

    return false;
  }
);

/*
 * Watch for DOM mutations (like AJAX modal openings or partial page loads)
 * so we can automatically trigger a fresh scan when content changes.
 */
const observer = new MutationObserver((mutations) => {
  let hasRelevantMutations = false;
  for (const m of mutations) {
    if (m.addedNodes.length > 0) {
      hasRelevantMutations = true;
      break;
    }
  }
  if (hasRelevantMutations) {
    scheduleScan(800);
  }
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

window.addEventListener('popstate', () => scheduleScan(300));
window.addEventListener('hashchange', () => scheduleScan(300));

/*
 * Gentle 4-second poll if the student is currently on a login or Cloudflare check page,
 * so we detect the moment they complete sign-in without requiring a manual refresh.
 */
setInterval(() => {
  if (lastStatus === 'HUMAN_VERIFICATION' || lastStatus === 'LOGIN_PAGE') {
    scheduleScan(100);
  }
}, 4000);
