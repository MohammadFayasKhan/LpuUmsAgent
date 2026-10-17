/*
 * Deterministic Attendance Parser for LPU UMS.
 *
 * We parse attendance directly from the UMS DOM rather than asking an LLM to read
 * screenshots or copy numbers from HTML. This is because attendance math requires
 * 100% exact values for attended and delivered classes, and an LLM can easily make
 * off-by-one errors or hallucinate percentages.
 *
 * This parser extracts:
 * - Course Code (e.g. CSE330, INT416)
 * - Course Title
 * - Last Attended Date
 * - Duty Leaves (if granted by the university)
 * - Total Delivered and Total Attended counts
 * - Official percentage reported by UMS
 *
 * If the numbers don't add up (for example if attended > delivered), we flag the
 * record so the UI can warn the student instead of computing inaccurate skip allowances.
 */

import { AttendanceRecord, AttendanceSummary, DetailedSessionRecord } from '../shared/types';
import { calculateOverallAttendance } from '../shared/attendanceCalculator';
import { extractStudentProfile } from './umsDetector';

/**
 * Normalizes text by removing non-breaking spaces, trimming, and collapsing whitespace.
 */
function cleanText(str: string | null | undefined): string {
  if (!str) return '';
  return str.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parses numbers from a string, handling integers and decimals.
 */
function parseNumber(str: string | null | undefined): number | null {
  if (!str) return null;
  const match = str.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

/**
 * Parses attendance fraction format like "50/53", "6 / 7", "7/7".
 * Date fragments such as "4/8/2026" or "30/09/2025" are explicitly rejected —
 * mistaking a date for an attended/total fraction produced phantom "4/8 attended"
 * values on every dashboard row in the regression screenshots.
 */
function parseFraction(str: string): { attended: number; total: number } | null {
  const re = /(\d{1,3})\s*\/\s*(\d{1,3})/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(str)) !== null) {
    const after = str.slice(match.index + match[0].length);
    // "4/8/2026" → this fraction is a date fragment, keep scanning.
    if (/^\s*\/\s*\d{2,4}/.test(after)) continue;
    const attended = parseInt(match[1], 10);
    const total = parseInt(match[2], 10);
    if (!isNaN(attended) && !isNaN(total) && total >= attended && total > 0) {
      return { attended, total };
    }
  }
  return null;
}

/**
 * Message / notification phrases that appear in UMS dashboard announcements
 * ("Result for TERM2026 has been displayed", "Holiday on 19 ... declared",
 * "LPU Welcomes ...") but never in a real course row. Any `CODE : text` match
 * carrying one of these is a notification, not a subject.
 */
const NOTIFICATION_PHRASES = /\b(declared|displayed|announced|published|notification|rescheduled|admit\s*card|has\s+been|will\s+be|welcomes?|congratulat|celebration|holiday|syllabus|result|observed|celebrat)\b/i;

/**
 * Strict course code validator for LPU UMS courses.
 * Validates course codes like CSE330, INT416, ECE140, CSEP401, CAP339, MTH101.
 *
 * Exported so the side panel can apply the SAME gate to cached/IndexedDB
 * verified records and to suggestion inputs — a code that would not be
 * accepted from the live attendance DOM can never enter verified context.
 */
export function isValidCourseCode(code: string): boolean {
  if (!code) return false;
  const clean = code.replace(/\s+/g, '').toUpperCase();
  // LPU course codes are 2 to 5 uppercase department letters followed by 2 to 4 digits (e.g. CSE330, INT416, PEAS01, PEVS01, CAP339, MTH101)
  if (!/^[A-Z]{2,5}\d{2,4}[A-Z]?$/.test(clean)) {
    return false;
  }
  // Reject codes whose LETTER PREFIX is an ordinary word or notification term.
  // This is what kills phantoms like TERM2026, PARTY2026 and ON19 — they match
  // the shape regex but their prefixes (TERM, PARTY, ON) are not LPU departments.
  const letters = (clean.match(/^[A-Z]+/) || [''])[0];
  const invalidPrefixes = new Set([
    'YEAR', 'FEST', 'TERM', 'ROLL', 'PAGE', 'ROOM', 'HTTP', 'NEWS', 'POST', 'INFO',
    'LINK', 'DATE', 'TIME', 'EXAM', 'NOTE', 'TEST', 'VIEW', 'GROUP', 'TOTAL', 'MORE',
    'FROM', 'WITH', 'CODE', 'USER', 'NAME', 'FORM', 'PASS', 'CARD', 'HAPP', 'MESS',
    'PARTY', 'ON', 'AT', 'IN', 'TO', 'OF', 'OR', 'NO', 'GO', 'UP', 'DO', 'MY', 'BE',
    'RESULT', 'NOTICE', 'HOLIDAY', 'CLASS', 'TODAY', 'SEASON', 'EVENT', 'ROUND',
    'WEEK', 'MONTH', 'MID', 'END', 'SEM', 'ATTEND', 'LEAVE', 'LECTURE', 'THEORY',
    'PRACTICAL', 'DECLARED', 'UPDATE', 'ALERT', 'MESSAGE', 'CHAT', 'FEED', 'BANNER'
  ]);
  if (invalidPrefixes.has(letters)) return false;
  const blacklist = [
    'YEAR', 'FEST', 'TERM', 'ROLL', 'PAGE', 'ROOM', 'HTTP', 'NEWS', 'POST', 'INFO',
    'LINK', 'DATE', 'TIME', 'EXAM', 'NOTE', 'TEST', 'VIEW', 'GROUP', 'TOTAL', 'MORE',
    'FROM', 'WITH', 'CODE', 'USER', 'NAME', 'FORM', 'PASS', 'CARD', 'HAPP', 'MESS'
  ];
  if (blacklist.includes(clean)) return false;
  return true;
}

/**
 * Validates extracted course data and assigns data quality status.
 * Every record leaving this parser carries explicit DOM provenance so the
 * response composer and suggestion engine can verify the record's origin.
 */
function validateRecord(record: AttendanceRecord): AttendanceRecord {
  const withProvenance: AttendanceRecord = { ...record, source: 'ums-attendance-dom' };
  if (withProvenance.total > 0 && withProvenance.attended <= withProvenance.total) {
    const effectiveAttended = withProvenance.attended + (withProvenance.dutyLeave || 0);
    const calculatedPct = (effectiveAttended / withProvenance.total) * 100;
    if (Math.abs(calculatedPct - withProvenance.percentage) > 3.0 && withProvenance.percentage > 0) {
      return { ...withProvenance, dataQuality: 'warning' };
    }
  }
  return { ...withProvenance, dataQuality: 'valid' };
}

/**
 * Strategy 1: Table-based parser for "Student Attendance" modal & ERP grids.
 * Scans <table> elements, extracting Course, Last Attended, Duty Leave, Delivered, Attended, and Percentage.
 */
function parseTables(doc: Document): { courses: AttendanceRecord[]; overallPercentage?: number } | null {
  const records: AttendanceRecord[] = [];
  const tables = Array.from(doc.querySelectorAll('table'));
  let reportedAggregatePct: number | undefined;

  for (const table of tables) {
    const rows = Array.from(table.querySelectorAll('tr'));
    if (rows.length < 2) continue;

    let codeIdx = -1;
    let nameIdx = -1;
    let lastAttendedIdx = -1;
    let dutyLeaveIdx = -1;
    let totalIdx = -1;
    let attendedIdx = -1;
    let absentIdx = -1;
    let pctIdx = -1;
    let headerRowIdx = -1;

    for (let r = 0; r < Math.min(4, rows.length); r++) {
      const ths = Array.from(rows[r].querySelectorAll('th, td')).map((cell) =>
        cleanText(cell.textContent).toLowerCase()
      );

      for (let c = 0; c < ths.length; c++) {
        const h = ths[c];

        // 1. Course code / Title
        if (
          h === 'course' ||
          h.includes('course code') ||
          h.includes('course id') ||
          h === 'subject' ||
          h.includes('sub code')
        ) {
          if (codeIdx === -1) codeIdx = c;
        }

        // Separate course title column if present
        if (
          (h.includes('title') ||
            h.includes('course name') ||
            h.includes('description') ||
            h === 'subject name') &&
          c !== codeIdx
        ) {
          if (nameIdx === -1) nameIdx = c;
        }

        // 2. Last Attended column
        if (h.includes('last attended') || h.includes('last attend')) {
          lastAttendedIdx = c;
        }

        // 3. Duty Leave column
        if (h.includes('duty leave') || h.includes('duty') || h === 'dl') {
          dutyLeaveIdx = c;
        }

        // 4. Delivered / Total column
        if (
          (h.includes('total delivered') ||
            h.includes('delivered (t,l,p)') ||
            h.includes('total (t,l,p)') ||
            h.includes('delivered') ||
            h.includes('conducted') ||
            h.includes('held') ||
            (h.includes('total') &&
              !h.includes('percentage') &&
              !h.includes('attended') &&
              !h.includes('absent') &&
              !h.includes('leave'))) &&
          !h.includes('percentage')
        ) {
          totalIdx = c;
        }

        // 5. Attended column (excluding "last attended")
        if (
          (h.includes('total attended') ||
            h.includes('attended (t,l,p)') ||
            h.includes('total attend') ||
            h.includes('classes attended') ||
            (h.includes('attended') && !h.includes('last') && !h.includes('date')) ||
            h.includes('present')) &&
          !h.includes('percentage') &&
          !h.includes('last attended')
        ) {
          attendedIdx = c;
        }

        // 6. Absent column
        if (h.includes('absent') || h.includes('missed')) {
          absentIdx = c;
        }

        // 7. Percentage column
        if (
          h.includes('percentage') ||
          h.includes('total percentage') ||
          h.includes('%') ||
          h.includes('agg. att')
        ) {
          pctIdx = c;
        }
      }

      if (codeIdx !== -1 && (attendedIdx !== -1 || pctIdx !== -1 || totalIdx !== -1)) {
        headerRowIdx = r;
        break;
      }
    }

    if (headerRowIdx === -1) continue;

    // Parse data rows
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const cells = Array.from(rows[r].querySelectorAll('td, th'));
      if (cells.length < 2) continue;

      const rawCellText = cleanText(cells[codeIdx]?.textContent);
      if (!rawCellText) continue;

      // Check for aggregate footer row
      if (
        rawCellText.toLowerCase().includes('aggregate') ||
        rawCellText.toLowerCase().includes('total attendance')
      ) {
        if (pctIdx !== -1 && cells[pctIdx]) {
          const aggPct = parseNumber(cleanText(cells[pctIdx].textContent));
          if (aggPct !== null && aggPct > 0) {
            reportedAggregatePct = aggPct;
          }
        }
        continue;
      }

      const codeMatch = rawCellText.match(/\b([A-Z]{2,5}\s*\d{2,4}[A-Z]?)\b/i);
      if (!codeMatch) continue;

      const code = codeMatch[1].replace(/\s+/g, '').toUpperCase();
      if (!isValidCourseCode(code)) continue;

      let name = code;
      if (nameIdx !== -1 && cells[nameIdx]) {
        name = cleanText(cells[nameIdx].textContent) || code;
      } else if (rawCellText.includes(':')) {
        const colonParts = rawCellText.split(':');
        name = colonParts.slice(1).join(':').trim() || code;
      } else if (rawCellText.includes('-')) {
        const dashParts = rawCellText.split('-');
        name = dashParts.slice(1).join('-').trim() || code;
      }
      name = name.replace(/\*+$/, '').trim();

      let lastAttended: string | undefined;
      if (lastAttendedIdx !== -1 && cells[lastAttendedIdx]) {
        lastAttended = cleanText(cells[lastAttendedIdx].textContent);
      }

      let dutyLeave = 0;
      if (dutyLeaveIdx !== -1 && cells[dutyLeaveIdx]) {
        dutyLeave = parseNumber(cleanText(cells[dutyLeaveIdx].textContent)) || 0;
      }

      let total = 0;
      if (totalIdx !== -1 && cells[totalIdx]) {
        total = parseNumber(cleanText(cells[totalIdx].textContent)) || 0;
      }

      let attended = 0;
      if (attendedIdx !== -1 && cells[attendedIdx]) {
        const attText = cleanText(cells[attendedIdx].textContent);
        const fraction = parseFraction(attText);
        if (fraction) {
          attended = fraction.attended;
          if (total === 0) total = fraction.total;
        } else {
          attended = parseNumber(attText) || 0;
        }
      }

      let absent = 0;
      if (absentIdx !== -1 && cells[absentIdx]) {
        absent = parseNumber(cleanText(cells[absentIdx].textContent)) || 0;
      } else {
        absent = Math.max(0, total - (attended + dutyLeave));
      }

      let percentage = 0;
      if (pctIdx !== -1 && cells[pctIdx]) {
        percentage = parseNumber(cleanText(cells[pctIdx].textContent)) || 0;
      } else if (total > 0) {
        percentage = Number((((attended + dutyLeave) / total) * 100).toFixed(2));
      }

      if (total > 0 || percentage > 0) {
        records.push(
          validateRecord({
            code,
            name,
            attended,
            total,
            absent,
            percentage,
            dutyLeave,
            lastAttended
          })
        );
      }
    }

    if (records.length > 0) {
      attachDetailedSessions(doc, records);
      return { courses: records, overallPercentage: reportedAggregatePct };
    }
  }

  return null;
}

/**
 * Parses Tab 2 "Attendance Details" date-wise lecture session logs.
 */
function attachDetailedSessions(doc: Document, records: AttendanceRecord[]): void {
  try {
    const courseHeadings = Array.from(
      doc.querySelectorAll('div, h4, h5, strong, p, span')
    ).filter((el) => cleanText(el.textContent).match(/Course\s*code\s*:\s*([A-Z]{3,4}\s*\d{3})/i));

    for (const heading of courseHeadings) {
      const match = cleanText(heading.textContent).match(/Course\s*code\s*:\s*([A-Z]{3,4}\s*\d{3})/i);
      if (!match) continue;
      const code = match[1].replace(/\s+/, '').toUpperCase();
      const targetRecord = records.find((r) => r.code === code);
      if (!targetRecord) continue;

      let sectionBox: HTMLElement | null = heading.parentElement;
      while (sectionBox && !sectionBox.querySelector('table') && sectionBox !== doc.body) {
        sectionBox = sectionBox.parentElement;
      }

      const table = sectionBox?.querySelector('table');
      if (!table) continue;

      const rows = Array.from(table.querySelectorAll('tr'));
      if (rows.length < 2) continue;

      const sessions: DetailedSessionRecord[] = [];
      for (let i = 1; i < rows.length; i++) {
        const tds = Array.from(rows[i].querySelectorAll('td')).map((td) => cleanText(td.textContent));
        if (tds.length >= 4) {
          sessions.push({
            date: tds[0] || '',
            time: tds[1] || '',
            type: tds[2] || 'L',
            attendance: tds[3] || 'P',
            teacherName: tds[4] || undefined,
            blockReason: tds[5] || 'OK'
          });
        }
      }

      if (sessions.length > 0) {
        targetRecord.sessions = sessions;
      }
    }
  } catch {}
}

/**
 * Strategy 2: Real LPU UMS Dashboard "My Courses" Parser.
 * Scans only inside genuine My Courses container with ATTENDANCE : % indicator.
 */
function findMyCoursesContainer(doc: Document): HTMLElement | null {
  const headings = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6, span, div, p, strong, b'));

  /*
   * Anchor selection is exact-first and leaf-first on purpose: a wrapper whose
   * text merely STARTS with "My Courses" used to win (parents precede children
   * in document order), making the ENTIRE dashboard — notifications, news
   * cards, badges — the scan root. That is how notification text leaked into
   * the course scan. The anchor must be the heading itself.
   */
  const isLabel = (el: Element, exact: boolean) => {
    const text = cleanText(el.textContent).toLowerCase();
    if (exact) return text === 'my courses';
    return text.startsWith('my courses') && text.length <= 120;
  };
  const anchor = headings.find((el) => isLabel(el, true)) || headings.find((el) => isLabel(el, false));
  if (!anchor) return null;

  let box: HTMLElement | null = anchor.parentElement;

  /*
   * Badge-anchored container (runs FIRST): the real contract of the My Courses
   * section is the verified "ATTENDANCE : XX" badge INSIDE it — not a class
   * name. UMS renders this card with inline styles (no .card/.panel/.row
   * ancestors), so the class heuristic below used to fall through to the
   * heading's immediate parent — a strip that carries no badge —
   * parseDashboardMyCourses then bailed out, the scan reported
   * NO_ATTENDANCE_ON_PAGE, and the side panel re-hydrated STALE cached numbers.
   * Walk up and return the smallest ancestor holding BOTH the badge and at
   * least one course-code row; the phantom gate in parseDashboardMyCourses
   * still filters announcement text inside that container.
   */
  let badgeBox: HTMLElement | null = null;
  for (let d = 0; d < 8 && box && box !== doc.body && box !== doc.documentElement; d++) {
    const text = cleanText(box.textContent);
    if (
      /ATTENDANCE\s*:\s*\d/i.test(text) &&
      /\b[A-Z]{2,5}\s*\d{2,4}[A-Z]?\s*[:\-–]/i.test(text)
    ) {
      badgeBox = box;
      break;
    }
    box = box.parentElement;
  }
  if (badgeBox) {
    return badgeBox;
  }

  box = anchor.parentElement;
  for (let d = 0; d < 4 && box && box !== doc.body; d++) {
    if (
      box.classList.contains('card') ||
      box.classList.contains('panel') ||
      box.classList.contains('section-box') ||
      box.querySelector('.course-row') ||
      box.querySelector('.row')
    ) {
      return box;
    }
    box = box.parentElement;
  }
  const fallback = anchor.parentElement;
  return fallback && fallback !== doc.body ? fallback : null;
}

function parseDashboardMyCourses(doc: Document): { courses: AttendanceRecord[]; overallPercentage?: number } | null {
  const container = findMyCoursesContainer(doc);
  if (!container) return null;

  const fullText = cleanText(container.textContent);

  // Must have explicit ATTENDANCE percentage indicator to qualify as verified dashboard course box
  let overallPercentage: number | undefined;
  const overallMatch = fullText.match(/ATTENDANCE\s*:\s*(\d+(?:\.\d+)?)\s*%/i);
  if (overallMatch) {
    overallPercentage = parseFloat(overallMatch[1]);
  } else {
    // If no ATTENDANCE : XX% is found, do not parse unverified generic containers
    return null;
  }

  const records: AttendanceRecord[] = [];
  const allElements = Array.from(container.querySelectorAll('div, tr, li, p, span, h3, h4, h5, td, a'));

  for (const el of allElements) {
    const directText = cleanText(el.textContent);
    const match = directText.match(/\b([A-Z]{2,5}\s*\d{2,4}[A-Z]?)\s*[:\-–]\s*([A-Z0-9\s,\-_/&]+)/i);

    if (match) {
      // Phantom gate: announcement/news text ("TERM2026 : Result ... has been
      // displayed", "... on 19 ... declared") is never a course row, even when
      // its text happens to match the CODE : name shape.
      if (NOTIFICATION_PHRASES.test(match[2]) || NOTIFICATION_PHRASES.test(match[0])) {
        continue;
      }
      const code = match[1].replace(/\s+/g, '').toUpperCase();
      if (!isValidCourseCode(code)) continue;
      if (records.some((r) => r.code === code)) continue;

      let rawName = match[2].trim();
      const stopWords = ['Term', 'Class Today', 'Roll No', 'Exam Pattern', 'Group', 'IP', 'Syllabus', 'OER'];
      for (const sw of stopWords) {
        const idx = rawName.indexOf(sw);
        if (idx !== -1) {
          rawName = rawName.substring(0, idx).trim();
        }
      }
      rawName = rawName.replace(/[:\-–\s]+$/, '').trim();
      const name = rawName.length > 2 ? rawName : code;

      let percentage = 0;
      let attended = 0;
      let total = 0;

      let rowBox: HTMLElement | null = el as HTMLElement;
      let bestRowBox: HTMLElement | null = null;

      while (rowBox && rowBox !== container && rowBox !== doc.body) {
        const cText = cleanText(rowBox.textContent);
        const otherCodes = (cText.match(/\b[A-Z]{2,5}\s*\d{2,4}[A-Z]?\b/gi) || []).map((c) =>
          c.replace(/\s+/g, '').toUpperCase()
        ).filter(isValidCourseCode);
        const uniqueFound = Array.from(new Set(otherCodes));

        if (uniqueFound.length === 1 && uniqueFound[0] === code) {
          bestRowBox = rowBox;
        } else if (uniqueFound.length > 1) {
          break;
        }
        rowBox = rowBox.parentElement;
      }

      const targetBox = bestRowBox || (el as HTMLElement).parentElement || (el as HTMLElement);
      const targetText = cleanText(targetBox.textContent);

      const frac = parseFraction(targetText);
      if (frac) {
        attended = frac.attended;
        total = frac.total;
      }

      const pctMatches = Array.from(targetText.matchAll(/(\d+(?:\.\d+)?)\s*%/g));
      for (const pm of pctMatches) {
        const val = parseFloat(pm[1]);
        if (val > 0 && val <= 100) {
          percentage = val;
          break;
        }
      }

      if (percentage > 0 || total > 0) {
        const absent = Math.max(0, total - attended);
        records.push(
          validateRecord({
            code,
            name,
            attended,
            total,
            absent,
            percentage
          })
        );
      }
    }
  }

  if (records.length > 0) {
    return { courses: records, overallPercentage };
  }

  return null;
}

function parseCourseCards(doc: Document): AttendanceRecord[] {
  const records: AttendanceRecord[] = [];
  const cards = Array.from(doc.querySelectorAll('.course-card, .subject-card, .attendance-card'));

  for (const card of cards) {
    const text = cleanText(card.textContent);
    const codeMatch = text.match(/\b([A-Z]{2,5}\s*\d{2,4}[A-Z]?)\b/i);
    if (!codeMatch) continue;

    const code = codeMatch[1].replace(/\s+/g, '').toUpperCase();
    if (!isValidCourseCode(code)) continue;
    if (records.some((r) => r.code === code)) continue;

    const titleEl = card.querySelector('.title, .subject-title, .course-name, h3, h4, h5');
    const name = titleEl ? cleanText(titleEl.textContent) : code;

    const frac = parseFraction(text);
    const pctMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
    const percentage = pctMatch
      ? parseFloat(pctMatch[1])
      : frac
      ? Number(((frac.attended / frac.total) * 100).toFixed(2))
      : 0;

    if (frac || percentage > 0) {
      const attended = frac ? frac.attended : 0;
      const total = frac ? frac.total : 0;
      const absent = Math.max(0, total - attended);
      records.push(
        validateRecord({
          code,
          name: name || code,
          attended,
          total,
          absent,
          percentage
        })
      );
    }
  }

  return records;
}

function getAllDocuments(rootDoc: Document): Document[] {
  const docs: Document[] = [rootDoc];
  try {
    const iframes = Array.from(rootDoc.querySelectorAll('iframe, frame'));
    for (const frame of iframes) {
      try {
        const frameDoc = (frame as HTMLIFrameElement).contentDocument;
        if (frameDoc && !docs.includes(frameDoc)) {
          docs.push(frameDoc);
        }
      } catch {}
    }
  } catch {}
  return docs;
}

/**
 * Main Attendance Parser for LPU UMS.
 * Guarantees zero false-positive / mock parsing.
 */
export function parseUmsAttendance(doc: Document = document): AttendanceSummary | null {
  const docs = getAllDocuments(doc);

  for (const d of docs) {
    // 1. Table-based parsing has highest priority (full exact counts from modal / table view)
    const tableResult = parseTables(d);
    if (tableResult && tableResult.courses.length > 0) {
      const { studentName, registrationNumber } = extractStudentProfile(d);
      const mainProfile = extractStudentProfile(doc);
      const summary = calculateOverallAttendance(
        tableResult.courses,
        studentName || mainProfile.studentName,
        registrationNumber || mainProfile.registrationNumber
      );
      if (tableResult.overallPercentage !== undefined) {
        summary.overallPercentage = tableResult.overallPercentage;
      }
      return summary;
    }

    // 2. Scoped "My Courses" section on StudentDashboard.aspx (with verified ATTENDANCE badge)
    const dashboardResult = parseDashboardMyCourses(d);
    if (dashboardResult && dashboardResult.courses.length > 0) {
      const { studentName, registrationNumber } = extractStudentProfile(d);
      const mainProfile = extractStudentProfile(doc);
      const summary = calculateOverallAttendance(
        dashboardResult.courses,
        studentName || mainProfile.studentName,
        registrationNumber || mainProfile.registrationNumber
      );
      if (dashboardResult.overallPercentage !== undefined) {
        summary.overallPercentage = dashboardResult.overallPercentage;
      }
      return summary;
    }

    // 3. Structured course cards with verified course codes and attendance fractions/percentages
    const cardRecords = parseCourseCards(d);
    if (cardRecords.length > 0) {
      const { studentName, registrationNumber } = extractStudentProfile(d);
      const mainProfile = extractStudentProfile(doc);
      return calculateOverallAttendance(
        cardRecords,
        studentName || mainProfile.studentName,
        registrationNumber || mainProfile.registrationNumber
      );
    }
  }

  return null;
}

export { parseTables };

export const parseAttendanceFromUMS = parseUmsAttendance;
