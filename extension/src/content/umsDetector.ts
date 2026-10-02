/*
 * UMS Page and State Detector for ONEE.
 *
 * This module checks whether the current tab is on an authentic LPU UMS page,
 * and determines which phase of the UMS lifecycle is currently visible:
 * 1. Cloudflare / Turnstile verification challenge
 * 2. Unauthenticated Login screen
 * 3. Authenticated Dashboard / Academics page
 *
 * It also extracts the student's registration number from the page header if available.
 * We use that registration number as the active account ID to namespace all local
 * IndexedDB storage, preventing attendance numbers from mixing if two different students
 * use the same browser.
 */

import { ConnectionStatus } from '../shared/types';

export interface UmsDetectionResult {
  isUmsDomain: boolean;
  status: ConnectionStatus;
  statusMessage: string;
  studentName?: string;
  registrationNumber?: string;
  pageType: 'unknown' | 'verification' | 'login' | 'dashboard' | 'attendance' | 'examination' | 'other_ums';
}

/*
 * Validates that the active tab's hostname is an official LPU domain.
 * This prevents the extension from running on arbitrary websites.
 */
export function isLpuUmsHostname(hostname: string): boolean {
  if (!hostname) return false;
  const cleanHost = hostname.toLowerCase().trim();
  return (
    cleanHost === 'ums.lpu.in' ||
    cleanHost.endsWith('.ums.lpu.in') ||
    cleanHost === 'lpu.in' ||
    cleanHost.endsWith('.lpu.in')
  );
}

/*
 * Detects whether Cloudflare, DDoS-Guard, or a human verification challenge is active.
 *
 * We check for this specifically so the browser agent never attempts to click or solve
 * challenges automatically. When a challenge is present, ONEE pauses and prompts the
 * student to complete it themselves.
 */
export function detectHumanVerification(doc: Document = document): boolean {
  // Check common Cloudflare / Turnstile / captcha wrapper elements
  const challengeSelectors = [
    '#challenge-running',
    '#challenge-stage',
    '#cf-wrapper',
    '#cf-challenge-running',
    '.cf-browser-verification',
    '#turnstile-wrapper',
    'iframe[src*="cloudflare"]',
    'iframe[src*="turnstile"]'
  ];

  for (const selector of challengeSelectors) {
    if (doc.querySelector(selector)) {
      return true;
    }
  }

  // Check document title for challenge keywords
  const title = (doc.title || '').toLowerCase();
  if (
    title.includes('just a moment') ||
    title.includes('attention required') ||
    title.includes('cloudflare') ||
    title.includes('ddos-guard')
  ) {
    return true;
  }

  // Check body text on minimal challenge challenge pages
  const bodyText = (doc.body?.innerText || '').toLowerCase();
  if (
    bodyText.includes('verify you are human') ||
    bodyText.includes('checking your browser') ||
    bodyText.includes('verifying you are human')
  ) {
    return true;
  }

  return false;
}

/*
 * Detects whether the student is on an unauthenticated login page.
 * We look for the standard UMS login form fields (#txtUName, #txtPassword).
 *
 * When on this screen, the extension never touches the inputs. We notify the
 * side panel so the student can enter their credentials securely in the main page.
 */
export function detectLoginPage(doc: Document = document, url: string = window.location.href): boolean {
  const path = (new URL(url, 'https://ums.lpu.in')).pathname.toLowerCase();

  if (path.includes('login') || path === '/' || path.includes('default.aspx')) {
    const hasLoginInputs =
      doc.querySelector('input[type="password"]') !== null ||
      doc.querySelector('#txtUName') !== null ||
      doc.querySelector('#txtPassword') !== null ||
      doc.querySelector('#btnLogin') !== null;
    if (hasLoginInputs) {
      return true;
    }
  }
  return false;
}

/*
 * Reads the student's name and registration number from the UMS header bar.
 * This information is used strictly locally on the student's device to separate
 * chat history and attendance snapshots between different accounts.
 */
export function extractStudentProfile(doc: Document = document): {
  studentName?: string;
  registrationNumber?: string;
} {
  let studentName: string | undefined;
  let registrationNumber: string | undefined;

  const profileSelectors = [
    '#lblStudentName',
    '#lbl_StdName',
    '.user-name',
    '.student-profile-name',
    '.profile-name',
    '#lblUser',
    '#lblRegistrationNo',
    '#lblRegNo',
    '.reg-no'
  ];

  for (const sel of profileSelectors) {
    const el = doc.querySelector(sel);
    if (el && el.textContent) {
      const text = el.textContent.trim();
      if (sel.toLowerCase().includes('reg') && /\d{7,10}/.test(text)) {
        registrationNumber = text.match(/\d{7,10}/)?.[0];
      } else if (!studentName && text.length > 2 && !/\d{7,}/.test(text)) {
        // Strip common greetings like "Welcome, " or "Student: "
        studentName = text
          .replace(/^(welcome|hello|hi|student|hi,)\s*[:,-]?\s*/i, '')
          .split('(')[0]
          .trim();
      }
    }
  }

  // Fallback regex match across the top navigation bar text
  if (!studentName || !registrationNumber) {
    const userBlock = doc.querySelector('#header, .header, .top-nav, .user-info, .navbar');
    if (userBlock && userBlock.textContent) {
      const regMatch = userBlock.textContent.match(/Reg(?:istration)?\.?\s*(?:No|Number|#)?\.?\s*[:\-]?\s*(\d{7,10})/i);
      if (regMatch && !registrationNumber) {
        registrationNumber = regMatch[1];
      }
    }
  }

  return { studentName, registrationNumber };
}

/*
 * Main detection entry point called whenever the active tab URL or DOM changes.
 * Returns a comprehensive status packet used by the side panel UI.
 */
export function detectUmsState(
  doc: Document = document,
  currentLocation: Location = window.location
): UmsDetectionResult {
  const isUms = isLpuUmsHostname(currentLocation.hostname);

  if (!isUms) {
    return {
      isUmsDomain: false,
      status: 'NOT_CONNECTED',
      statusMessage: 'Open LPU UMS in this tab to connect ONEE.',
      pageType: 'unknown'
    };
  }

  // 1. Cloudflare challenge check
  if (detectHumanVerification(doc)) {
    return {
      isUmsDomain: true,
      status: 'HUMAN_VERIFICATION',
      statusMessage: 'Complete verification in the UMS tab. ONEE will resume automatically.',
      pageType: 'verification'
    };
  }

  // 2. Login screen check
  if (detectLoginPage(doc, currentLocation.href)) {
    return {
      isUmsDomain: true,
      status: 'LOGIN_PAGE',
      statusMessage: 'Sign in to LPU UMS. ONEE will read your dashboard when loaded.',
      pageType: 'login'
    };
  }

  // 3. Authenticated dashboard or sub-page
  const { studentName, registrationNumber } = extractStudentProfile(doc);
  const path = currentLocation.pathname.toLowerCase();

  let pageType: UmsDetectionResult['pageType'] = 'other_ums';
  if (
    path.includes('examination') ||
    path.includes('seatingplan') ||
    path.includes('datesheet') ||
    (doc.title && doc.title.toLowerCase().includes('date sheet'))
  ) {
    pageType = 'examination';
  } else if (path.includes('dashboard')) {
    pageType = 'dashboard';
  } else if (path.includes('attendance')) {
    pageType = 'attendance';
  }

  return {
    isUmsDomain: true,
    status: 'UMS_DETECTED',
    statusMessage: 'UMS connected',
    studentName,
    registrationNumber,
    pageType
  };
}
