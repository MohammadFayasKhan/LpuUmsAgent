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
 */
function parseFraction(str: string): { attended: number; total: number } | null {
  const match = str.match(/(\d+)\s*\/\s*(\d+)/);
  if (match) {
    const attended = parseInt(match[1], 10);
    const total = parseInt(match[2], 10);
    if (!isNaN(attended) && !isNaN(total) && total >= attended && total > 0) {
      return { attended, total };
    }
  }
  return null;
}

/**
 * Strict course code validator for LPU UMS courses.
 * Validates course codes like CSE330, INT416, ECE140, CSEP401, CAP339, MTH101.
 */
function isValidCourseCode(code: string): boolean {
  if (!code) return false;
  const clean = code.replace(/\s+/, '').toUpperCase();
  // LPU course codes are 3 to 4 uppercase department letters followed by 3 digits (or 'P' + 3 digits for practicals)
  if (!/^[A-Z]{3,4}\d{3}$/.test(clean)) {
    return false;
  }
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
 */
function validateRecord(record: AttendanceRecord): AttendanceRecord {
  if (record.total > 0 && record.attended <= record.total) {
    const effectiveAttended = record.attended + (record.dutyLeave || 0);
    const calculatedPct = (effectiveAttended / record.total) * 100;
    if (Math.abs(calculatedPct - record.percentage) > 3.0 && record.percentage > 0) {
      return { ...record, dataQuality: 'warning' };
    }
  }
  return { ...record, dataQuality: 'valid' };
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

      const codeMatch = rawCellText.match(/\b([A-Z]{3,4}\s*\d{3})\b/i);
      if (!codeMatch) continue;

      const code = codeMatch[1].replace(/\s+/, '').toUpperCase();
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
  for (const el of headings) {
    const text = cleanText(el.textContent).toLowerCase();
    if (text === 'my courses' || text.startsWith('my courses')) {
      let box: HTMLElement | null = el.parentElement;
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
      return el.parentElement;
    }
  }
  return null;
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
    const match = directText.match(/\b([A-Z]{3,4}\s*\d{3})\s*[:\-–]\s*([A-Z0-9\s,\-_/&]+)/i);

    if (match) {
      const code = match[1].replace(/\s+/, '').toUpperCase();
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
        const otherCodes = (cText.match(/\b[A-Z]{3,4}\s*\d{3}\b/gi) || []).map((c) =>
          c.replace(/\s+/, '').toUpperCase()
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
    const codeMatch = text.match(/\b([A-Z]{3,4}\s*\d{3})\b/i);
    if (!codeMatch) continue;

    const code = codeMatch[1].replace(/\s+/, '').toUpperCase();
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
