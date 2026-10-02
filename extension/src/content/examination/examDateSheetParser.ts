/*
 * Deterministic Exam Date Sheet Parser for LPU UMS.
 *
 * This parser deterministically extracts examination schedules directly from the active
 * UMS DOM (studentums.lpu.in and ums.lpu.in) without requiring LLM transcription.
 *
 * Supported surfaces:
 * 1. Modern Student UMS (https://studentums.lpu.in/dashboard/examination/conduct/seatingplan)
 * 2. Classic UMS Examination pages (https://ums.lpu.in/lpuums/...)
 *
 * Extracted fields:
 * - courseCode (e.g. CSE443)
 * - courseName (e.g. Cloud Computing Systems)
 * - examType (e.g. End Term Exam, Mid Term Exam, Practical, Theory)
 * - examDate (normalized readable format: "13 Sep 2026")
 * - startTime & endTime (normalized 24h: "14:00" -> "17:00")
 * - reportingTime (e.g. "13:30")
 * - venue, room, building, seat (when provided)
 * - mode (Online Exam / Offline)
 * - status (Scheduled / Completed)
 */

import { ExamRecord, ExaminationSummary, ExtractionDiagnostics, SamplePaperInfo } from '../../shared/types';
import { extractStudentProfile } from '../umsDetector';
import { buildExamIdentity, deduplicateExams } from '../../shared/examinationCalculator';

/**
 * Normalizes text by removing non-breaking spaces and collapsing whitespace.
 */
function cleanText(str: string | null | undefined): string {
  if (!str) return '';
  return str.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Normalizes placeholder values (-, --, n/a, not allocated) to undefined.
 */
function cleanFieldVal(str: string | null | undefined): string | undefined {
  const cleaned = cleanText(str);
  if (!cleaned) return undefined;
  const lower = cleaned.toLowerCase();
  if (
    lower === '-' ||
    lower === '--' ||
    lower === '---' ||
    lower === 'n/a' ||
    lower === 'na' ||
    lower === 'nil' ||
    lower === 'null' ||
    lower === 'not allocated' ||
    lower === 'not assigned' ||
    lower === 'pending' ||
    lower === 'tbd'
  ) {
    return undefined;
  }
  return cleaned;
}

export const CALENDAR_DATE_REGEX = /\b\d{1,2}[\s\-]*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s\-]*\d{4}\b/i;
export const NUMERIC_DATE_REGEX = /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{4}\b/;
export const ISO_DATE_REGEX = /\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/;

/**
 * Checks if a string contains any recognized calendar date.
 */
export function hasCalendarDate(t: string | null | undefined): boolean {
  if (!t) return false;
  return (
    CALENDAR_DATE_REGEX.test(t) ||
    NUMERIC_DATE_REGEX.test(t) ||
    ISO_DATE_REGEX.test(t)
  );
}

/**
 * Checks if a string represents a genuine calendar date (e.g. "13 Sep 2026", "13/09/2026", "06 Oct2026").
 * Rejects placeholders like TBD, NIL, pending, or empty strings.
 */
export function isValidExamDate(dateStr: string | undefined): boolean {
  if (!dateStr) return false;
  const t = dateStr.trim().toUpperCase();
  if (
    !t ||
    t === 'TBD' ||
    t === 'NIL' ||
    t === 'NA' ||
    t === '-' ||
    t === 'NOT SCHEDULED' ||
    t === 'PENDING' ||
    t.includes('TBD')
  ) {
    return false;
  }
  return hasCalendarDate(t);
}

/**
 * Normalizes date representations into a standard format like "13 Sep 2026".
 * Returns empty string if the input is not a recognized calendar date.
 */
export function normalizeExamDate(rawDate: string): string {
  const cleaned = cleanText(rawDate);
  if (!cleaned) return '';

  const upper = cleaned.toUpperCase();
  if (
    upper === 'TBD' ||
    upper === 'NIL' ||
    upper === 'NA' ||
    upper === '-' ||
    upper === 'PENDING' ||
    upper === 'NOT SCHEDULED' ||
    upper.includes('TBD')
  ) {
    return '';
  }

  // Match formats: "13 Sep 2026", "13-Sep-2026", "13/Sep/2026", "13 September 2026", "06 Oct2026", "06Oct2026"
  const textMonthMatch = cleaned.match(/(\d{1,2})[-/\s]*([A-Za-z]{3,9})[-/\s]*(\d{4})/);
  if (textMonthMatch) {
    const day = parseInt(textMonthMatch[1], 10);
    const monthRaw = textMonthMatch[2].slice(0, 3).toLowerCase();
    const year = textMonthMatch[3];
    const monthNames: Record<string, string> = {
      jan: 'Jan', feb: 'Feb', mar: 'Mar', apr: 'Apr', may: 'May', jun: 'Jun',
      jul: 'Jul', aug: 'Aug', sep: 'Sep', oct: 'Oct', nov: 'Nov', dec: 'Dec'
    };
    const month = monthNames[monthRaw] || textMonthMatch[2];
    return `${day} ${month} ${year}`;
  }

  // Match formats: "13-09-2026", "13/09/2026", "13.09.2026" (DD-MM-YYYY)
  const numericMatch = cleaned.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (numericMatch) {
    const day = parseInt(numericMatch[1], 10);
    const monthIndex = parseInt(numericMatch[2], 10) - 1;
    const year = numericMatch[3];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[monthIndex] || String(monthIndex + 1);
    return `${day} ${month} ${year}`;
  }

  // Match ISO format: "2026-09-13" (YYYY-MM-DD)
  const isoMatch = cleaned.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    const year = isoMatch[1];
    const monthIndex = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[monthIndex] || String(monthIndex + 1);
    return `${day} ${month} ${year}`;
  }

  return '';
}

/**
 * Normalizes time strings to standard 24h format (e.g. "14:00").
 */
export function normalizeTime(rawTime: string): string {
  const cleaned = cleanText(rawTime);
  if (!cleaned) return '';

  // 12-hour AM/PM format (e.g. "02:00 PM", "2:00 PM", "9:30 AM")
  const ampmMatch = cleaned.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = ampmMatch[2];
    const period = ampmMatch[3].toUpperCase();
    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    return `${String(hours).padStart(2, '0')}:${minutes}`;
  }

  // 24-hour format (e.g. "14:00", "09:30")
  const standardMatch = cleaned.match(/(\d{1,2}):(\d{2})/);
  if (standardMatch) {
    const hours = parseInt(standardMatch[1], 10);
    const minutes = standardMatch[2];
    return `${String(hours).padStart(2, '0')}:${minutes}`;
  }

  return cleaned;
}

/**
 * Parses time range like "14:00 - 17:00", "02:00 PM to 05:00 PM", "14:00 → 17:00".
 */
export function parseTimeRange(rawRange: string): { startTime?: string; endTime?: string } {
  const cleaned = cleanText(rawRange);
  if (!cleaned) return {};

  const parts = cleaned.split(/(?:\s*[-–—→to]\s*|\s+to\s+)/i);
  if (parts.length >= 2) {
    const startTime = normalizeTime(parts[0]);
    const endTime = normalizeTime(parts[1]);
    return {
      startTime: startTime || undefined,
      endTime: endTime || undefined
    };
  }

  const single = normalizeTime(cleaned);
  return { startTime: single || undefined };
}

export const EXCLUDED_COURSE_PREFIXES = new Set([
  'ROOM', 'HALL', 'BLOCK', 'STEP', 'YEAR', 'DATE', 'TIME', 'TERM', 'EXAM',
  'TOTAL', 'PAGE', 'NOTE', 'TEST', 'CODE', 'SLOT', 'SEAT', 'VIEW', 'OPEN',
  'LINK', 'PORTAL', 'STUDENT', 'CONDUCT', 'HOME', 'APP', 'MIN', 'MINS',
  'CLASS', 'HEAD', 'BODY', 'ITEM', 'ROW', 'COL', 'CARD', 'DESK', 'VENUE',
  'START', 'END', 'NOT', 'UMC', 'TODAY', 'REPORT', 'REPOR', 'STATUS', 'LAB', 'LABS',
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
]);

/**
 * Checks if a string is a valid university course code (e.g. CSE443, INT373, ECE249, CAP421, MTH101).
 * Filters out common non-course tokens like ROOM201, SEP2026, TOTAL7, etc.
 */
export function isValidCourseCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const clean = code.replace(/\s+/g, '').toUpperCase();
  const m = clean.match(/^([A-Z]{2,5})(\d{3,4})([A-Z]?)$/);
  if (!m) return false;
  const prefix = m[1];
  const digits = m[2];
  if (EXCLUDED_COURSE_PREFIXES.has(prefix)) return false;
  const num = parseInt(digits, 10);
  if (num >= 2020 && num <= 2035 && ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', 'YEAR', 'TERM'].includes(prefix)) {
    return false;
  }
  return true;
}

/**
 * Validates course codes like CSE443, INT373, ECE249, CAP421, MTH101.
 */
export function extractCourseCode(text: string): string | null {
  const matches = Array.from(text.matchAll(/\b([A-Z]{2,5}\s*\d{3,4}[A-Z]?)\b/gi));
  for (const m of matches) {
    const code = m[1].replace(/\s+/g, '').toUpperCase();
    if (isValidCourseCode(code)) {
      return code;
    }
  }
  return null;
}

/**
 * Extracts ExamRecords from standard HTML table structures.
 */
function parseExaminationTable(table: HTMLTableElement): ExamRecord[] {
  const records: ExamRecord[] = [];
  const rows = Array.from(table.querySelectorAll('tr'));
  if (rows.length < 2) return records;

  // Identify column indices from the header row
  const headerRow = rows[0];
  const headers = Array.from(headerRow.querySelectorAll('th, td')).map((c) =>
    cleanText(c.textContent).toLowerCase()
  );

  let courseCol = -1;
  let courseNameCol = -1;
  let dateCol = -1;
  let timeCol = -1;
  let reportingCol = -1;
  let venueCol = -1;
  let roomCol = -1;
  let buildingCol = -1;
  let seatCol = -1;
  let modeCol = -1;
  let typeCol = -1;
  let statusCol = -1;

  headers.forEach((h, idx) => {
    if (h.includes('course code') || h.includes('subject code') || h === 'course' || h === 'subject') {
      courseCol = idx;
    } else if (h.includes('course name') || h.includes('subject name') || h.includes('title')) {
      courseNameCol = idx;
    } else if (h.includes('date') || h.includes('exam date') || h.includes('day')) {
      dateCol = idx;
    } else if (h.includes('time') || h.includes('timing') || h.includes('slot') || h.includes('session')) {
      if (h.includes('reporting')) {
        reportingCol = idx;
      } else {
        timeCol = idx;
      }
    } else if (h.includes('reporting')) {
      reportingCol = idx;
    } else if (h.includes('venue') || h.includes('centre') || h.includes('center')) {
      venueCol = idx;
    } else if (h.includes('room') || h.includes('hall')) {
      roomCol = idx;
    } else if (h.includes('block') || h.includes('building')) {
      buildingCol = idx;
    } else if (h.includes('seat') || h.includes('row') || h.includes('desk')) {
      seatCol = idx;
    } else if (h.includes('mode') || h.includes('exam mode')) {
      modeCol = idx;
    } else if (h.includes('type') || h.includes('exam type') || h.includes('pattern')) {
      typeCol = idx;
    } else if (h.includes('status')) {
      statusCol = idx;
    }
  });

  // Table must contain a course column AND at least one exam schedule identifier (date, time, seat, room)
  if (courseCol === -1 || (dateCol === -1 && timeCol === -1 && seatCol === -1 && roomCol === -1)) {
    return records;
  }

  for (let r = 1; r < rows.length; r++) {
    const cells = Array.from(rows[r].querySelectorAll('td, th'));
    if (cells.length === 0) continue;

    const rowText = cleanText(rows[r].textContent);
    if (!rowText || rowText.toLowerCase().includes('no record') || rowText.toLowerCase().includes('no data')) {
      continue;
    }

    let courseCode = '';
    let courseName: string | undefined;
    let examDate = '';
    let rawDate: string | undefined;
    let startTime: string | undefined;
    let endTime: string | undefined;
    let reportingTime: string | undefined;
    let venue: string | undefined;
    let room: string | undefined;
    let building: string | undefined;
    let seat: string | undefined;
    let mode: string | undefined;
    let examType: string | undefined;
    let status: string | undefined;

    if (courseCol >= 0 && cells[courseCol]) {
      const codeFound = extractCourseCode(cells[courseCol].textContent || '');
      if (codeFound) courseCode = codeFound;
    }

    // Try extracting course code from any cell if header wasn't mapped
    if (!courseCode) {
      for (const cell of cells) {
        const found = extractCourseCode(cell.textContent || '');
        if (found) {
          courseCode = found;
          break;
        }
      }
    }

    if (!courseCode) continue;

    if (courseNameCol >= 0 && cells[courseNameCol]) {
      courseName = cleanText(cells[courseNameCol].textContent) || undefined;
    }

    if (dateCol >= 0 && cells[dateCol]) {
      rawDate = cleanText(cells[dateCol].textContent);
      examDate = normalizeExamDate(rawDate);
    } else {
      // Look for date in row text
      for (const cell of cells) {
        const normalized = normalizeExamDate(cell.textContent || '');
        if (normalized && normalized !== cleanText(cell.textContent)) {
          examDate = normalized;
          rawDate = cleanText(cell.textContent);
          break;
        }
      }
    }

    if (timeCol >= 0 && cells[timeCol]) {
      const range = parseTimeRange(cells[timeCol].textContent || '');
      startTime = range.startTime;
      endTime = range.endTime;
    }

    if (reportingCol >= 0 && cells[reportingCol]) {
      reportingTime = normalizeTime(cells[reportingCol].textContent || '') || undefined;
    }

    if (venueCol >= 0 && cells[venueCol]) {
      venue = cleanFieldVal(cells[venueCol].textContent);
    }
    if (roomCol >= 0 && cells[roomCol]) {
      room = cleanFieldVal(cells[roomCol].textContent);
    }
    if (buildingCol >= 0 && cells[buildingCol]) {
      building = cleanFieldVal(cells[buildingCol].textContent);
    }
    if (seatCol >= 0 && cells[seatCol]) {
      seat = cleanFieldVal(cells[seatCol].textContent);
    }
    if (modeCol >= 0 && cells[modeCol]) {
      mode = cleanFieldVal(cells[modeCol].textContent);
    }
    if (typeCol >= 0 && cells[typeCol]) {
      examType = cleanFieldVal(cells[typeCol].textContent);
    }
    if (statusCol >= 0 && cells[statusCol]) {
      status = cleanFieldVal(cells[statusCol].textContent);
    }

    // Check for mode in row text if not found
    if (!mode) {
      const lower = rowText.toLowerCase();
      if (lower.includes('online exam') || lower.includes('online mode')) {
        mode = 'Online Exam';
      } else if (lower.includes('offline exam') || lower.includes('offline mode') || venue || room) {
        mode = 'Offline Exam';
      }
    }

    const effectiveDate = examDate || normalizeExamDate(rawDate || '');
    if (!isValidExamDate(effectiveDate)) {
      // Course has no scheduled date in active date sheet - skip it
      continue;
    }

    records.push({
      courseCode,
      courseName,
      examType,
      examDate: effectiveDate,
      rawDate,
      startTime,
      endTime,
      reportingTime,
      venue,
      room,
      building,
      seat,
      mode,
      status
    });
  }

  return records;
}

/**
 * Checks if the element or its descendants represent a Sample Question Paper control.
 */
export function extractSamplePaper(cardEl: Element): SamplePaperInfo | undefined {
  const sampleElements = Array.from(
    cardEl.querySelectorAll<HTMLElement>('a, button, div, span, p')
  );

  for (const el of sampleElements) {
    const text = (el.textContent || '').toLowerCase().trim();
    const title = (el.getAttribute('title') || '').toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();

    // Prevent large container divs from matching if they just wrap other text
    const isDirectInteractive = el.matches('a, button, [role="button"], .btn');
    if (text.length > 120 && !isDirectInteractive) {
      continue;
    }

    if (
      text.includes('sample question paper') ||
      text.includes('sample paper') ||
      title.includes('sample question paper') ||
      aria.includes('sample question paper')
    ) {
      const href = el.getAttribute('href') || el.closest('a')?.getAttribute('href') || undefined;
      const id = el.getAttribute('data-onee-id') || el.id || undefined;
      return {
        available: true,
        label: 'Sample Question Paper',
        href: href && href !== '#' && !href.startsWith('javascript:') ? href : undefined,
        elementId: id
      };
    }
  }

  return undefined;
}

/**
 * Extracts question pattern instructions from examination text.
 */
export function extractInstructions(text: string): string | undefined {
  const mcqMatch = text.match(/(\d+\s+Multiple Choice Questions[^\n\r]+)/i);
  if (mcqMatch) return cleanText(mcqMatch[1]);

  const subjMatch = text.match(/(\d+\s+Short Question[^\n\r]+)/i) || text.match(/(Part\s+[A-Z]\s*[-–—][^\n\r]+)/i);
  if (subjMatch) return cleanText(subjMatch[1]);

  const instMatch = text.match(/Instruction\s*[-–—:]\s*([^\n\r]+)/i);
  if (instMatch) return cleanText(instMatch[0]);

  return undefined;
}

/**
 * Helper to test which known course codes are present within a block of text using word boundaries.
 */
export function getEnclosedCodes(text: string, allCodes: string[]): string[] {
  if (!text || allCodes.length === 0) return [];
  const upper = text.toUpperCase();
  return allCodes.filter((c) => {
    const regex = new RegExp(`\\b${c}\\b`, 'i');
    return regex.test(upper);
  });
}

/**
 * Extracts distinct calendar dates from text.
 */
export function extractDistinctDates(text: string): string[] {
  if (!text) return [];
  const matches = Array.from(
    text.matchAll(/\b\d{1,2}[\s\-]*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s\-]*\d{4}\b/gi)
  );
  return Array.from(new Set(matches.map((m) => m[0].toLowerCase().replace(/\s+/g, ' '))));
}

/**
 * Discovers all examination card or row elements in the active DOM.
 * Accurately discovers all individual cards even when courses repeat on different dates
 * without assuming fixed classes or climbing into multi-card page wrappers.
 */
export function findExaminationCardElements(
  doc: Document = document,
  diagnostics?: ExtractionDiagnostics
): HTMLElement[] {
  // Step 1: Collect all genuine course codes present anywhere on the page
  const bodyText = doc.body ? (doc.body.textContent || '') : '';
  const allDocCodes = Array.from(
    new Set(
      Array.from(bodyText.matchAll(/\b([A-Z]{2,5}\s*\d{3,4}[A-Z]?)\b/gi))
        .map((m) => m[1].replace(/\s+/g, '').toUpperCase())
        .filter(isValidCourseCode)
    )
  );

  const discoveredCards: HTMLElement[] = [];

  const isPageLevelWrapper = (el: HTMLElement): boolean => {
    if (el === doc.body || el === doc.documentElement) return true;
    const tag = el.tagName.toLowerCase();
    if (tag === 'main' || tag === 'mat-sidenav-content' || tag === 'mat-drawer-content') return true;
    const cls = (typeof el.className === 'string' ? el.className : el.getAttribute('class') || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    if (
      cls.includes('dashboard') ||
      cls.includes('page-wrapper') ||
      cls.includes('content-wrapper') ||
      cls.includes('main-content') ||
      id.includes('main') ||
      id.includes('dashboard')
    ) {
      return true;
    }
    // If it contains page title or stats or search bar, it's a page-level wrapper, NOT an individual card
    if (el.querySelector('h1, h2, h3, .stats-row, .stats-overview, .breadcrumb, input[placeholder*="Search" i]')) {
      return true;
    }
    return false;
  };

  // Strategy 1: Bottom-up anchoring from innermost course code elements
  const candidateElements = Array.from(
    doc.querySelectorAll<HTMLElement>(
      'h1, h2, h3, h4, h5, h6, b, strong, [class*="title" i], [class*="course" i], [class*="code" i], [class*="header" i], [class*="badge" i], td, span, a, p, div'
    )
  );

  for (const el of candidateElements) {
    if (el === doc.body || el === doc.documentElement) continue;
    const directText = (el.textContent || '').trim();
    if (directText.length > 80) continue;
    const match = directText.match(/\b([A-Z]{2,5}\s*\d{3,4}[A-Z]?)\b/);
    if (!match || !isValidCourseCode(match[1])) continue;
    const thisCode = match[1].replace(/\s+/g, '').toUpperCase();

    // Skip if any child has this course code (we want the innermost code element)
    const hasDeeperCodeChild = Array.from(el.children).some((c) => {
      const cText = (c.textContent || '').trim();
      const cMatch = cText.match(/\b([A-Z]{2,5}\s*\d{3,4}[A-Z]?)\b/);
      return cMatch && cMatch[1].replace(/\s+/g, '').toUpperCase() === thisCode;
    });
    if (hasDeeperCodeChild) continue;

    // Walk up ancestors to locate the individual card boundary
    let curr: HTMLElement | null = el.parentElement;
    let bestCardContainer: HTMLElement | null = null;

    while (curr && curr !== doc.body && curr !== doc.documentElement) {
      if (isPageLevelWrapper(curr)) break;

      const parentText = cleanText(curr.textContent);
      if (parentText.length > 4000) break;

      const enclosed = getEnclosedCodes(parentText, allDocCodes);
      if (enclosed.length > 1) {
        // curr encloses multiple distinct exams -> curr is the list container!
        break;
      }

      const distinctDates = extractDistinctDates(parentText);
      if (distinctDates.length > 1) {
        break;
      }

      if (
        hasCalendarDate(parentText) ||
        parentText.toLowerCase().includes('awaited') ||
        parentText.toLowerCase().includes('mid term') ||
        parentText.toLowerCase().includes('end term')
      ) {
        bestCardContainer = curr;
        // curr contains the course code and date/timing information: this is the card boundary
        break;
      }
      curr = curr.parentElement;
    }

    if (bestCardContainer && !isPageLevelWrapper(bestCardContainer)) {
      if (!discoveredCards.includes(bestCardContainer)) {
        discoveredCards.push(bestCardContainer);
      }
    }
  }

  // Strategy 2: Repeating Sibling Discovery (Angular *ngFor repeating elements)
  // For any identified card, inspect its parent container's children
  const siblingCards: HTMLElement[] = [];
  for (const card of discoveredCards) {
    const parent = card.parentElement;
    if (!parent) continue;
    for (const sibling of Array.from(parent.children) as HTMLElement[]) {
      if (sibling === doc.body || sibling === doc.documentElement) continue;
      if (isPageLevelWrapper(sibling)) continue;
      if (discoveredCards.includes(sibling) || siblingCards.includes(sibling)) continue;

      const sibText = cleanText(sibling.textContent);
      if (sibText.length < 15 || sibText.length > 3500) continue;
      const sibCodes = getEnclosedCodes(sibText, allDocCodes);
      if (sibCodes.length === 1) {
        if (
          hasCalendarDate(sibText) ||
          sibText.toLowerCase().includes('awaited') ||
          sibText.toLowerCase().includes('exam')
        ) {
          siblingCards.push(sibling);
        }
      }
    }
  }
  for (const sc of siblingCards) {
    if (!discoveredCards.includes(sc)) discoveredCards.push(sc);
  }

  // Strategy 3: Card Candidate Selectors (Without outer wrapper climbing!)
  const cardSelectors = [
    '.conduct-card',
    '.exam-card',
    '.seating-card',
    '.schedule-card',
    '.datesheet-item',
    '.exam-item',
    '.exam-row',
    '[data-testid*="exam" i]',
    'app-seating-plan-card',
    'app-datesheet-card',
    'div[class*="conduct-card" i]',
    'div[class*="exam-card" i]',
    'div[class*="seating-card" i]',
    'div[class*="schedule-card" i]',
    'div[class*="exam-item" i]',
    'div[class*="datesheet-item" i]'
  ];

  const selectorCandidates = Array.from(
    doc.querySelectorAll<HTMLElement>(cardSelectors.join(', '))
  ).filter((el) => {
    if (isPageLevelWrapper(el)) return false;
    const text = cleanText(el.textContent);
    if (text.length < 15 || text.length > 3500) return false;
    const enclosed = getEnclosedCodes(text, allDocCodes);
    if (enclosed.length !== 1) return false;
    return hasCalendarDate(text) || text.toLowerCase().includes('awaited') || text.toLowerCase().includes('exam');
  });

  for (const el of selectorCandidates) {
    if (!discoveredCards.includes(el)) discoveredCards.push(el);
  }

  // Hierarchy Normalization:
  // If element A contains element B:
  // - If A is a page-level wrapper, discard A.
  // - If A has multiple distinct course codes, discard A.
  // - If B is an inner child (e.g. just h4), discard B and keep A.
  const filteredCards = discoveredCards.filter((cand) => {
    if (isPageLevelWrapper(cand)) return false;
    const candText = cleanText(cand.textContent);
    const candCodes = getEnclosedCodes(candText, allDocCodes);
    if (candCodes.length > 1) return false;
    const candDates = extractDistinctDates(candText);
    if (candDates.length > 1) return false;

    // Check if cand contains another candidate in discoveredCards:
    const containsOther = discoveredCards.some((other) => other !== cand && cand.contains(other));
    if (containsOther) {
      if (cand.querySelector('h1, h2, h3, .stats-row, .breadcrumb, input[placeholder*="Search" i]')) {
        return false;
      }
    }

    // Check if cand is contained by another candidate:
    const isContainedByOther = discoveredCards.some((other) => {
      if (other === cand || !other.contains(cand)) return false;
      const otherText = cleanText(other.textContent);
      const otherCodes = getEnclosedCodes(otherText, allDocCodes);
      return otherCodes.length === 1 && !isPageLevelWrapper(other);
    });

    if (isContainedByOther) {
      // If cand has no calendar date, but parent does, cand is an inner child
      if (!hasCalendarDate(candText)) {
        return false;
      }
    }

    return true;
  });

  const finalCards = filteredCards.length > 0 ? filteredCards : discoveredCards;

  // Sort in document appearance order
  finalCards.sort((a, b) => {
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  if (diagnostics) {
    diagnostics.candidateRecordCount = finalCards.length;
    diagnostics.candidateContainers = Array.from(
      new Set(finalCards.map((c) => `${c.tagName.toLowerCase()}.${(c.className || '').trim().replace(/\s+/g, '.')}`))
    );
  }

  return finalCards;
}

/**
 * Extracts summary counter numbers at the top of the UMS Date Sheet page.
 */
export function extractDateSheetHeaderStats(doc: Document = document): {
  totalExams: number;
  todaysExams: number;
  upcomingExams: number;
  notAllowedExams: number;
} {
  let totalExams = 0;
  let todaysExams = 0;
  let upcomingExams = 0;
  let notAllowedExams = 0;

  const elements = Array.from(
    doc.querySelectorAll<HTMLElement>('div, span, p, h1, h2, h3, h4, h5, h6, b, strong')
  );

  for (const el of elements) {
    if (el.children.length > 3) continue;
    const text = ((el as HTMLElement).innerText || el.textContent || '').trim().toLowerCase();

    if (text === 'total exam' || (text.includes('total exam') && text.length < 30)) {
      const container = el.closest('.card, .stats-card, [class*="card" i]') || el.parentElement || el;
      const numMatch = ((container as HTMLElement).innerText || container.textContent || '').match(/\b(\d+)\b/);
      if (numMatch) totalExams = Math.max(totalExams, parseInt(numMatch[1], 10));
    } else if (
      text.includes("today's exam") ||
      text === 'today exam' ||
      (text.includes('today') && text.includes('exam') && text.length < 30)
    ) {
      const container = el.closest('.card, .stats-card, [class*="card" i]') || el.parentElement || el;
      const numMatch = ((container as HTMLElement).innerText || container.textContent || '').match(/\b(\d+)\b/);
      if (numMatch) todaysExams = Math.max(todaysExams, parseInt(numMatch[1], 10));
    } else if (
      text.includes('upcoming exam') ||
      (text.includes('upcoming') && text.includes('exam') && text.length < 30)
    ) {
      const container = el.closest('.card, .stats-card, [class*="card" i]') || el.parentElement || el;
      const numMatch = ((container as HTMLElement).innerText || container.textContent || '').match(/\b(\d+)\b/);
      if (numMatch) upcomingExams = Math.max(upcomingExams, parseInt(numMatch[1], 10));
    } else if (text.includes('not allowed') && text.length < 30) {
      const container = el.closest('.card, .stats-card, [class*="card" i]') || el.parentElement || el;
      const numMatch = ((container as HTMLElement).innerText || container.textContent || '').match(/\b(\d+)\b/);
      if (numMatch) notAllowedExams = Math.max(notAllowedExams, parseInt(numMatch[1], 10));
    }
  }

  return { totalExams, todaysExams, upcomingExams, notAllowedExams };
}

/**
 * Discovers all scrollable container elements on modern Angular SPA layouts.
 */
export function findAllScrollableDateSheetContainers(doc: Document = document): HTMLElement[] {
  const scrollables: HTMLElement[] = [];
  const candidates = Array.from(
    doc.querySelectorAll<HTMLElement>(
      'mat-sidenav-content, mat-drawer-content, main, [role="main"], .main-content, .main-panel, .content-wrapper, .dashboard-body, #seatingPlan, .seating-container, .seatingplan, div[style*="overflow"], div[class*="scroll" i], div[class*="conduct" i], div[class*="seating" i]'
    )
  );

  for (const el of candidates) {
    if (el === doc.body || el === doc.documentElement) continue;
    if (typeof window !== 'undefined' && window.getComputedStyle) {
      const style = window.getComputedStyle(el);
      const oy = style.overflowY;
      const ox = style.overflow;
      if (
        (oy === 'auto' || oy === 'scroll' || ox === 'auto' || ox === 'scroll' || el.tagName.toLowerCase().includes('sidenav-content')) &&
        el.scrollHeight > el.clientHeight + 25
      ) {
        if (!scrollables.includes(el)) scrollables.push(el);
      }
    } else if (el.scrollHeight > el.clientHeight + 25) {
      if (!scrollables.includes(el)) scrollables.push(el);
    }
  }

  // Also check ancestor hierarchy of discovered cards
  const cards = doc.querySelectorAll<HTMLElement>('.card, [class*="card" i], .exam-card, .conduct-card, tr');
  for (const card of Array.from(cards)) {
    let curr: HTMLElement | null = card.parentElement;
    while (curr && curr !== doc.body && curr !== doc.documentElement) {
      if (curr.scrollHeight > curr.clientHeight + 25 && !scrollables.includes(curr)) {
        scrollables.push(curr);
      }
      curr = curr.parentElement;
    }
  }

  return scrollables;
}

/**
 * Discovers the primary container element that scrolls on the UMS Date Sheet page.
 */
export function findScrollableDateSheetContainer(doc: Document = document): HTMLElement | Window {
  const allScrollables = findAllScrollableDateSheetContainers(doc);
  if (allScrollables.length > 0) {
    return allScrollables[0];
  }
  return typeof window !== 'undefined' ? window : (doc.documentElement || doc.body);
}

/**
 * Parses a single ExamRecord from a scoped card element and its text.
 */
export function parseSingleExamFromScope(
  code: string,
  scopeElement: HTMLElement,
  scopeText: string
): ExamRecord | null {
  // Course Name
  const titleEl = scopeElement.querySelector('.title, .course-name, .subject-name, h4, h5, .heading');
  let courseName: string | undefined;
  if (titleEl) {
    const cleaned = cleanText(titleEl.textContent);
    const withoutCode = cleaned.replace(new RegExp(`^${code}\\s*[-–—:]?\\s*`, 'i'), '').trim();
    if (withoutCode && withoutCode !== code && !isValidCourseCode(withoutCode)) {
      courseName = withoutCode;
    } else if (cleaned && !cleaned.includes(code)) {
      courseName = cleaned;
    }
  }

  // Date
  let examDate = '';
  let rawDate: string | undefined;
  const dateMatch = scopeText.match(
    /(?:date\s*[:\-]?\s*)?(\d{1,2}[-/\s]*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-/\s]*\d{4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{4}[-/.]\d{1,2}[-/.]\d{4})/i
  );
  if (dateMatch) {
    rawDate = dateMatch[1];
    examDate = normalizeExamDate(rawDate);
  }

  // Time
  const timeMatch = scopeText.match(
    /(?:time\s*[:\-]?\s*)?(\d{1,2}:\d{2}(?:\s*[AP]M)?\s*(?:[-–—→to]\s*|\s+to\s+)\d{1,2}:\d{2}(?:\s*[AP]M)?)/i
  );
  let startTime: string | undefined;
  let endTime: string | undefined;
  if (timeMatch) {
    const parsed = parseTimeRange(timeMatch[1]);
    startTime = parsed.startTime;
    endTime = parsed.endTime;
  }

  // Reporting Time: Absolute or Relative
  let reportingTime: string | undefined;
  const repMatch = scopeText.match(/reporting(?:\s*time)?\s*[:\-]?\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i);
  if (repMatch) {
    reportingTime = normalizeTime(repMatch[1]);
  } else {
    const relRepMatch = scopeText.match(/report\s+(\d+)\s+minutes?\s+before/i);
    if (relRepMatch && startTime) {
      const minsBefore = parseInt(relRepMatch[1], 10);
      const [hStr, mStr] = startTime.split(':');
      const h = parseInt(hStr, 10);
      const m = parseInt(mStr || '0', 10);
      if (!isNaN(h) && !isNaN(minsBefore)) {
        let totalMins = h * 60 + m - minsBefore;
        if (totalMins < 0) totalMins += 24 * 60;
        const repH = Math.floor(totalMins / 60);
        const repM = totalMins % 60;
        reportingTime = `${String(repH).padStart(2, '0')}:${String(repM).padStart(2, '0')} (${minsBefore} mins before)`;
      }
    }
  }

  // Venue / Room / Seat
  let venue: string | undefined;
  let room: string | undefined;
  let seat: string | undefined;

  const roomMatch = scopeText.match(/(?:room|hall)\s*[:\-]?\s*([A-Za-z0-9\-_]+)/i);
  if (roomMatch) room = roomMatch[1];

  const venueMatch = scopeText.match(
    /(?:venue|centre|center|block|building)\s*[:\-]?\s*([A-Za-z0-9\s\-_]+?)(?=(?:room|seat|time|date|$))/i
  );
  if (venueMatch) venue = cleanText(venueMatch[1]);

  const seatMatch = scopeText.match(/(?:seat|desk|row)\s*(?:no|number)?\s*[:\-]?\s*([A-Za-z0-9\-_]+)/i);
  if (seatMatch) seat = seatMatch[1];

  const lowerScope = scopeText.toLowerCase();
  if (!venue && !room && !seat) {
    if (scopeText.includes('Awaited') || lowerScope.includes('awaited')) {
      venue = 'Awaited';
    }
  }

  // Mode & Online venue resolution
  let mode: string | undefined;
  if (lowerScope.includes('online exam link') || lowerScope.includes('online exam') || lowerScope.includes('online mode')) {
    mode = 'Online Exam';
    if (!venue || venue === 'Awaited' || lowerScope.includes('online exam link')) {
      venue = 'Online Exam Link';
    }
  } else if (lowerScope.includes('offline') || room || (venue && venue !== 'Awaited')) {
    mode = 'Offline Exam';
  }

  // Exam Type
  let examType: string | undefined;
  const typeExplicitMatch = scopeText.match(
    /(?:Theory|Practical)\s+(?:Mid|End)\s+Term\s*-\s*All\s+(?:MCQ\s+)?(?:Objective|Subjective)(?:\s+Type)?/i
  );
  if (typeExplicitMatch) {
    examType = cleanText(typeExplicitMatch[0]);
  } else {
    const isPractical = lowerScope.includes('practical');
    const isEndTerm = lowerScope.includes('end term') || lowerScope.includes('ete');
    const isMidTerm = lowerScope.includes('mid term') || lowerScope.includes('mte');
    const isRegular = lowerScope.includes('regular');

    if (isPractical && isEndTerm) {
      examType = isRegular ? 'Practical End Term Regular' : 'Practical End Term';
    } else if (isEndTerm) {
      examType = isRegular ? 'End Term Regular' : 'End Term Exam';
    } else if (isMidTerm) {
      examType = isRegular ? 'Mid Term Regular' : 'Mid Term Exam';
    } else if (isPractical) {
      examType = 'Practical Exam';
    } else if (lowerScope.includes('theory')) {
      examType = 'Theory Exam';
    }
  }

  // Status: Today, Upcoming, Completed
  let status: string | undefined;
  if (scopeText.includes('Today')) {
    status = 'Today';
  } else if (scopeText.includes('Upcoming')) {
    status = 'Upcoming';
  }

  // Instructions
  const instructions = extractInstructions(scopeText);

  // Sample Question Paper
  const samplePaper = extractSamplePaper(scopeElement);

  if (!courseName && examType) {
    courseName = examType;
  }

  const effectiveDate = examDate || normalizeExamDate(rawDate || '');
  if (!isValidExamDate(effectiveDate)) {
    return null;
  }

  const partialRecord: Partial<ExamRecord> = {
    courseCode: code,
    courseName,
    examType,
    examDate: effectiveDate,
    rawDate,
    startTime,
    endTime,
    reportingTime,
    venue,
    room,
    seat,
    mode,
    status,
    instructions,
    samplePaper,
    sourceElement: scopeElement.getAttribute('data-onee-id') || undefined
  };

  return {
    ...partialRecord,
    id: buildExamIdentity(partialRecord)
  } as ExamRecord;
}

/**
 * Extracts ExamRecords from card/list-based examination interfaces (e.g. Student UMS cards).
 * Dynamically parses all individual cards without truncating or stopping at the first record.
 */
export function parseExaminationCards(
  doc: Document = document,
  diagnostics?: ExtractionDiagnostics
): ExamRecord[] {
  const records: ExamRecord[] = [];
  const cardElements = findExaminationCardElements(doc, diagnostics);

  for (const card of cardElements) {
    const text = cleanText(card.textContent);
    // Find all distinct course codes in this card/container
    const codeMatches = Array.from(
      new Set(
        Array.from(text.matchAll(/\b([A-Z]{2,5}\s*\d{3,4}[A-Z]?)\b/gi))
          .map((m) => m[1].replace(/\s+/g, '').toUpperCase())
          .filter(isValidCourseCode)
      )
    );

    if (codeMatches.length === 0) {
      if (diagnostics) {
        diagnostics.rejectedCount++;
        diagnostics.rejectionReasons.push({
          candidateIdentifier: card.className || card.tagName,
          reason: 'No valid course code found in card element',
          rawSnippet: text.slice(0, 100)
        });
      }
      continue;
    }

    for (const code of codeMatches) {
      let scopeElement: HTMLElement = card;
      let scopeText = text;

      // If a card/container has multiple codes, narrow down to the sub-element for this course
      if (codeMatches.length > 1) {
        const subEl = Array.from(card.querySelectorAll<HTMLElement>('*')).find((child) => {
          const childText = cleanText(child.textContent);
          const hasThisCode = new RegExp(`\\b${code}\\b`, 'i').test(childText);
          const hasNoOtherCode = !codeMatches.some((other) => other !== code && new RegExp(`\\b${other}\\b`, 'i').test(childText));
          const hasDate = hasCalendarDate(childText);
          return hasThisCode && hasNoOtherCode && hasDate;
        });
        if (subEl) {
          scopeElement = subEl;
          scopeText = cleanText(subEl.textContent);
        }
      }

      const exam = parseSingleExamFromScope(code, scopeElement, scopeText);
      if (exam) {
        records.push(exam);
        if (diagnostics) diagnostics.successfullyParsedCount++;
      } else if (diagnostics) {
        diagnostics.rejectedCount++;
        diagnostics.rejectionReasons.push({
          candidateIdentifier: card.className || card.tagName,
          courseCode: code,
          reason: 'Failed to extract valid exam date or required fields',
          rawSnippet: scopeText.slice(0, 120)
        });
      }
    }
  }

  return records;
}

/**
 * Fallback discovery strategy: Slices document content around course code headings
 * to extract exam records even when repeating card containers are irregular or non-standard.
 */
export function parseExaminationByHeadingSlices(
  doc: Document = document,
  diagnostics?: ExtractionDiagnostics
): ExamRecord[] {
  const records: ExamRecord[] = [];
  const bodyText = doc.body ? (doc.body.textContent || '') : '';
  const allDocCodes = Array.from(
    new Set(
      Array.from(bodyText.matchAll(/\b([A-Z]{2,5}\s*\d{3,4}[A-Z]?)\b/gi))
        .map((m) => m[1].replace(/\s+/g, '').toUpperCase())
        .filter(isValidCourseCode)
    )
  );

  if (allDocCodes.length === 0) return records;

  for (const code of allDocCodes) {
    const codeRegex = new RegExp(`\\b${code}\\b`, 'i');
    const elements = Array.from(
      doc.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6, b, strong, [class*="title" i], [class*="course" i], [class*="code" i], td, div')
    ).filter((el) => {
      if (el === doc.body || el === doc.documentElement) return false;
      const text = (el.textContent || '').trim();
      if (text.length > 80) return false;
      return codeRegex.test(text);
    });

    if (elements.length === 0) continue;

    // Innermost element containing code
    const innermost = elements.find((el) => !Array.from(el.children).some((c) => codeRegex.test(c.textContent || ''))) || elements[0];

    // Find enclosing slice that has calendar date and no other course code
    let curr: HTMLElement | null = innermost.parentElement;
    let cardSlice: HTMLElement | null = null;

    while (curr && curr !== doc.body && curr !== doc.documentElement) {
      const text = cleanText(curr.textContent);
      if (text.length > 4000) break;
      const enclosed = getEnclosedCodes(text, allDocCodes);
      if (enclosed.length > 1) break;
      if (hasCalendarDate(text) || text.toLowerCase().includes('awaited') || text.toLowerCase().includes('exam')) {
        cardSlice = curr;
        break;
      }
      curr = curr.parentElement;
    }

    const targetEl = cardSlice || innermost.parentElement || innermost;
    const targetText = cleanText(targetEl.textContent);

    const record = parseSingleExamFromScope(code, targetEl, targetText);
    if (record) {
      records.push(record);
      if (diagnostics) diagnostics.successfullyParsedCount++;
    } else if (diagnostics) {
      diagnostics.rejectedCount++;
      diagnostics.rejectionReasons.push({
        candidateIdentifier: targetEl.className || targetEl.tagName,
        courseCode: code,
        reason: 'Heading slice extraction rejected record',
        rawSnippet: targetText.slice(0, 100)
      });
    }
  }

  return records;
}

/**
 * Main parser entry point: Inspects the active document and returns a structured ExaminationSummary.
 */
export function parseExamDateSheet(doc: Document = document): ExaminationSummary | null {
  const currentUrl = typeof window !== 'undefined' && window.location ? (window.location.href || '').toLowerCase() : '';
  if (currentUrl.includes('studentdashboard')) {
    return null;
  }

  const profile = extractStudentProfile(doc);
  const tables = Array.from(doc.querySelectorAll<HTMLTableElement>('table'));

  const diagnostics: ExtractionDiagnostics = {
    candidateContainers: [],
    candidateRecordCount: 0,
    successfullyParsedCount: 0,
    rejectedCount: 0,
    rejectionReasons: [],
    discoveryStrategiesUsed: [],
    pageExpectedCount: 0
  };

  let allExams: ExamRecord[] = [];

  // 1. Try parsing structured HTML tables first
  for (const table of tables) {
    const parsed = parseExaminationTable(table);
    if (parsed.length > 0) {
      allExams.push(...parsed);
      diagnostics.discoveryStrategiesUsed.push('TABLE_EXTRACTION');
    }
  }

  // 2. Also parse card/list layouts -> always run if tables found nothing,
  //    or if tables found fewer valid exams than header stats indicate
  const headerStats = extractDateSheetHeaderStats(doc);
  diagnostics.pageExpectedCount = headerStats.totalExams > 0 ? headerStats.totalExams : undefined;
  const tableValidCount = allExams.filter((e) => isValidExamDate(e.examDate)).length;
  const targetFromHeader = headerStats.totalExams > 0 ? headerStats.totalExams : 0;

  if (tableValidCount === 0 || (targetFromHeader > 0 && tableValidCount < targetFromHeader)) {
    const cardExams = parseExaminationCards(doc, diagnostics);
    if (cardExams.length > 0) {
      allExams.push(...cardExams);
      diagnostics.discoveryStrategiesUsed.push('CARD_EXTRACTION');
    }
  }

  // 3. Fallback targeted strategy: Heading Slice Extraction
  // If targetFromHeader > 0 and allExams.length < targetFromHeader, or if 0 exams found:
  const validExams = allExams.filter((exam) => isValidExamDate(exam.examDate));
  let uniqueExams = deduplicateExams(validExams);

  if (uniqueExams.length === 0 || (targetFromHeader > 0 && uniqueExams.length < targetFromHeader)) {
    const fallbackExams = parseExaminationByHeadingSlices(doc, diagnostics);
    if (fallbackExams.length > 0) {
      allExams.push(...fallbackExams);
      diagnostics.discoveryStrategiesUsed.push('HEADING_SLICE_FALLBACK');
      uniqueExams = deduplicateExams(allExams.filter((e) => isValidExamDate(e.examDate)));
    }
  }

  console.log('[ONEE Examination Diagnostics]', {
    candidateContainers: diagnostics.candidateContainers,
    candidateRecordCount: diagnostics.candidateRecordCount,
    successfullyParsedCount: diagnostics.successfullyParsedCount,
    rejectedCount: diagnostics.rejectedCount,
    rejectionReasons: diagnostics.rejectionReasons,
    discoveryStrategiesUsed: diagnostics.discoveryStrategiesUsed,
    expectedFromHeader: targetFromHeader,
    finalUniqueExamsCount: uniqueExams.length
  });

  if (uniqueExams.length === 0) {
    return null;
  }

  const totalExams = headerStats.totalExams > 0 ? headerStats.totalExams : uniqueExams.length;

  return {
    exams: uniqueExams,
    totalExams,
    studentName: profile.studentName,
    registrationNumber: profile.registrationNumber,
    capturedAt: Date.now(),
    verified: true,
    source: 'UMS_DOM',
    pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
    diagnostics
  };
}

// Canonical alias for backward and cross-module compatibility
export const parseExaminationDateSheet = parseExamDateSheet;

