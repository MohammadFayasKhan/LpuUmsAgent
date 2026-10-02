/*
 * Semantic Examination Page & Navigation Detector for LPU UMS.
 *
 * Reliably identifies:
 * 1. Whether the student is on the Date Sheet / Seating Plan interface:
 *    - URL matching studentums.lpu.in or examination conduct path
 *    - Visible page headings ("Examination", "Date Sheet", "Seating Plan", "Conduct")
 *    - Breadcrumbs containing "Examination" / "Seating Plan"
 *    - Table / card containers with course codes and exam dates
 * 2. Location of the "Date Sheet" link under "Important Links" below the navbar
 *    on ums.lpu.in/lpuums/StudentDashboard.aspx.
 */

import { findExaminationCardElements } from './examDateSheetParser';

export interface ExamPageDetectionResult {
  isExamPage: boolean;
  pageKind: 'seating_plan' | 'date_sheet' | 'dashboard_with_links' | 'other';
  hasDateSheetLink: boolean;
  dateSheetElement?: HTMLElement;
}

/**
 * Searches for the "Date Sheet" / "Date Sheet / Seating Plan" link below the navbar
 * in the Important Links / Quick Links section of StudentDashboard.aspx.
 */
function resolveClickableTarget(el: HTMLElement): HTMLElement {
  if (el.tagName.toLowerCase() === 'a' || el.tagName.toLowerCase() === 'button') {
    return el;
  }
  const inner = el.querySelector('a, button, [role="button"]');
  if (inner && inner instanceof HTMLElement) {
    return inner;
  }
  const outer = el.closest('a, button, [role="button"]');
  if (outer && outer instanceof HTMLElement) {
    return outer;
  }
  return el;
}

export function findDateSheetLinkElement(doc: Document = document): HTMLElement | null {
  const elements = Array.from(doc.querySelectorAll('a, button, [role="button"], li, div, span'));

  // Priority 1: Match element text where numbers/badges are stripped (e.g. "Date Sheet 1" -> "date sheet")
  for (const el of elements) {
    const rawText = (el.textContent || '').trim().toLowerCase();
    const cleanText = rawText.replace(/[0-9]/g, '').replace(/\s+/g, ' ').trim();
    const title = (el.getAttribute('title') || '').toLowerCase();

    if (
      cleanText === 'date sheet' ||
      cleanText === 'datesheet' ||
      cleanText === 'date sheet / seating plan' ||
      cleanText === 'datesheet / seating plan' ||
      cleanText === 'seating plan' ||
      cleanText === 'examination date sheet' ||
      title === 'date sheet' ||
      title === 'datesheet'
    ) {
      return resolveClickableTarget(el as HTMLElement);
    }
  }

  // Priority 2: Check inside container under "Important Links" heading
  const allHeaders = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6, strong, b, div, span'));
  for (const h of allHeaders) {
    if ((h.textContent || '').trim().toLowerCase().includes('important links')) {
      const container = h.closest('.box, .panel, .card, .container, .row, section, div') || h.parentElement;
      if (container) {
        const links = Array.from(container.querySelectorAll('a, button, [role="button"], li, span, div'));
        for (const l of links) {
          const t = (l.textContent || '').replace(/[0-9]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
          if (t.includes('date sheet') || t.includes('datesheet') || t.includes('seating plan')) {
            return resolveClickableTarget(l as HTMLElement);
          }
        }
      }
    }
  }

  // Priority 3: Href / onclick attributes pointing to seating plan or date sheet
  for (const el of elements) {
    const href = (el.getAttribute('href') || '').toLowerCase();
    const onclick = (el.getAttribute('onclick') || '').toLowerCase();
    const id = (el.id || '').toLowerCase();

    if (
      href.includes('seatingplan') ||
      href.includes('datesheet') ||
      href.includes('examination/conduct') ||
      onclick.includes('seatingplan') ||
      onclick.includes('datesheet') ||
      id.includes('datesheet') ||
      id.includes('seatingplan')
    ) {
      return resolveClickableTarget(el as HTMLElement);
    }
  }

  // Priority 4: Broad fallback search across document
  for (const el of elements) {
    const text = (el.textContent || '').trim().toLowerCase();
    if (text.includes('date sheet') || text.includes('datesheet')) {
      return resolveClickableTarget(el as HTMLElement);
    }
  }

  return null;
}

/**
 * Evaluates whether the current page is an authentic Date Sheet / Seating Plan view
 * using multiple semantic signals (URL, headings, breadcrumbs, content).
 */
export function detectExaminationPage(
  doc: Document = document,
  location: Location = window.location
): ExamPageDetectionResult {
  const url = (location.href || '').toLowerCase();
  const title = (doc.title || '').toLowerCase();
  const dateSheetEl = findDateSheetLinkElement(doc);

  // 0. StudentDashboard.aspx is the dashboard, NEVER the seating plan page!
  if (url.includes('studentdashboard')) {
    return {
      isExamPage: false,
      pageKind: 'dashboard_with_links',
      hasDateSheetLink: dateSheetEl !== null,
      dateSheetElement: dateSheetEl || undefined
    };
  }

  // 1. URL-based signals for authentic examination pages
  const isUmsSurface = url.includes('lpu.in') || url.includes('ums');
  const isSeatingPlanUrl = url.includes('seatingplan') || url.includes('/examination/conduct/');
  const isDateSheetUrl = url.includes('examinationdatesheet') || (url.includes('datesheet') && !url.includes('studentdashboard'));

  if (isUmsSurface && (isSeatingPlanUrl || isDateSheetUrl)) {
    return {
      isExamPage: true,
      pageKind: isSeatingPlanUrl ? 'seating_plan' : 'date_sheet',
      hasDateSheetLink: false
    };
  }

  // 2. Heading & breadcrumb signals on non-dashboard pages
  const headings = Array.from(doc.querySelectorAll('h1, h2, h3, h4, .page-title, .breadcrumb, .heading'))
    .map((h) => (h.textContent || '').toLowerCase().trim());
  const hasExamHeading =
    headings.some(
      (h) =>
        h === 'examination date sheet' ||
        h === 'seating plan' ||
        h === 'date sheet' ||
        h.includes('examination conduct')
    ) ||
    title === 'examination date sheet' ||
    title === 'seating plan';

  // 3. Table / Card signals - check for course code pattern + exam keywords / dates / times
  const bodyText = (doc.body?.textContent || '').toUpperCase();
  const hasCourseCode = /\b([A-Z]{2,5}\d{3,4})\b/.test(bodyText);
  const hasExamIndicators =
    bodyText.includes('ROOM') ||
    bodyText.includes('REPORT') ||
    bodyText.includes('SEAT') ||
    bodyText.includes('PRACTICAL') ||
    bodyText.includes('THEORY') ||
    bodyText.includes('ONLINE EXAM');

  const hasExamContent = hasCourseCode && hasExamIndicators;

  if (hasExamHeading && hasExamContent) {
    return {
      isExamPage: true,
      pageKind: hasExamHeading ? 'seating_plan' : 'date_sheet',
      hasDateSheetLink: false
    };
  }

  if (dateSheetEl !== null) {
    return {
      isExamPage: false,
      pageKind: 'dashboard_with_links',
      hasDateSheetLink: true,
      dateSheetElement: dateSheetEl
    };
  }

  return {
    isExamPage: false,
    pageKind: 'other',
    hasDateSheetLink: false
  };
}

/**
 * Convenience helper to determine if a URL/document represents an examination surface.
 */
export function isExaminationPage(url?: string, doc: Document = document): boolean {
  const checkUrl = (url || (typeof window !== 'undefined' && window.location ? window.location.href : '')).toLowerCase();
  const detection = detectExaminationPage(doc, { href: checkUrl } as Location);
  return detection.isExamPage;
}

/**
 * Checks whether examination records (cards or table rows) have finished rendering in the live DOM.
 * This distinguishes between the initial page shell and the asynchronously loaded Angular records.
 */
export function isExaminationContentRendered(doc: Document = document): {
  rendered: boolean;
  count: number;
  container?: HTMLElement;
  records?: HTMLElement[];
} {
  // Check 1: Table-based examination rows
  const tables = Array.from(doc.querySelectorAll('table'));
  for (const table of tables) {
    const text = (table.textContent || '').toUpperCase();
    if (/\b([A-Z]{2,5}\d{3,4})\b/.test(text) && (text.includes('DATE') || text.includes('EXAM') || text.includes('TIME'))) {
      const rows = Array.from(table.querySelectorAll('tbody tr, tr')).filter((r) =>
        /\b([A-Z]{2,5}\d{3,4})\b/.test((r.textContent || '').toUpperCase())
      ) as HTMLElement[];
      if (rows.length > 0) {
        return { rendered: true, count: rows.length, container: table, records: rows };
      }
    }
  }

  // Check 2: Card-based examination elements (Student UMS SPA)
  const cards = findExaminationCardElements(doc);
  if (cards.length > 0) {
    const container = cards[0].parentElement as HTMLElement;
    return { rendered: true, count: cards.length, container, records: cards };
  }

  // Check 3: Explicit empty state container (e.g. "No Examination Scheduled")
  // Guard: If header stats show exams (e.g. "Total Exam 6"), do NOT false-trigger empty state from stats like "Not Allowed 0"
  const bodyTextRaw = (doc.body?.textContent || '');
  const totalExamMatch = bodyTextRaw.match(/total\s+exam[s:]*\s*(\d+)/i);
  const totalExamCount = totalExamMatch ? parseInt(totalExamMatch[1], 10) : 0;

  if (totalExamCount === 0) {
    const emptyStateRegex = /(no\s+examination\s+scheduled|no\s+date\s*sheet\s+(found|available)|no\s+seating\s*plan\s+(allocated|available)|no\s+records?\s+found|not\s+permitted\s+to\s+appear|not\s+allowed\s+to\s+appear)/i;
    const emptyEl = Array.from(doc.querySelectorAll('.empty-state, .alert, .no-data, p, h4, h5, div')).find(
      (el) => {
        const text = (el.textContent || '').trim();
        if (text.length > 200 || /not\s+allowed\s*[:\s]*0/i.test(text)) return false;
        return emptyStateRegex.test(text);
      }
    ) as HTMLElement | undefined;

    if (emptyEl) {
      return { rendered: true, count: 0, container: emptyEl, records: [] };
    }
  }

  return { rendered: false, count: 0 };
}

/**
 * Actively waits for examination content to render on the page using a MutationObserver
 * with bounded polling. Resolves immediately if content is already present.
 */
export function waitForExaminationContent(
  timeoutMs: number = 8000,
  doc: Document = document
): Promise<{ success: boolean; count: number; elapsedMs: number }> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const initialCheck = isExaminationContentRendered(doc);
    if (initialCheck.rendered) {
      resolve({ success: true, count: initialCheck.count, elapsedMs: 0 });
      return;
    }

    let resolved = false;
    let timerId: any = null;
    let pollIntervalId: any = null;
    let observer: MutationObserver | null = null;

    const cleanup = () => {
      resolved = true;
      if (timerId) clearTimeout(timerId);
      if (pollIntervalId) clearInterval(pollIntervalId);
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    };

    const verifyReadiness = () => {
      if (resolved) return;
      const check = isExaminationContentRendered(doc);
      if (check.rendered) {
        const elapsed = Date.now() - startTime;
        cleanup();
        resolve({ success: true, count: check.count, elapsedMs: elapsed });
      }
    };

    // Attach MutationObserver to watch DOM subtree additions
    try {
      if (typeof MutationObserver !== 'undefined' && doc.documentElement) {
        observer = new MutationObserver(() => {
          verifyReadiness();
        });
        observer.observe(doc.documentElement, {
          childList: true,
          subtree: true,
          attributes: false,
          characterData: true
        });
      }
    } catch {
      // Fallback to polling if MutationObserver unavailable
    }

    // Interval polling every 200ms
    pollIntervalId = setInterval(verifyReadiness, 200);

    // Bounded timeout safety
    timerId = setTimeout(() => {
      if (!resolved) {
        const check = isExaminationContentRendered(doc);
        const elapsed = Date.now() - startTime;
        cleanup();
        resolve({ success: check.rendered, count: check.count, elapsedMs: elapsed });
      }
    }, timeoutMs);
  });
}
