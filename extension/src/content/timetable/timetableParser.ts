/*
 * Student Time Table & Faculty Directory Parser for ONEE.
 *
 * Grounded directly on live LPU UMS DOM:
 * - URL: /lpuums/Reports/frmStudentTimeTable.aspx
 *
 * Extracts:
 * 1. Student metadata (VID, Home Section, Print Date).
 * 2. Weekly Time Table Matrix (Timing, Monday through Sunday).
 *    - Parses slot components: Type (Lecture/Practical), Group, Course Code, Room, Section.
 * 3. "My Course" & Faculty Directory table (below timetable):
 *    - Course Code, Course Type, Course Title, Lecture-Tutorial-Practical (L-T-P), Credits.
 *    - Faculty Name, Cabin Location (Block - Room - Cabin), Last Updated.
 * 4. Cross-references and enriches every schedule slot with course title & faculty cabin.
 */

import {
  TimetableSummary,
  TimetableSlot,
  CourseFacultyRecord,
  TimetableDay
} from '../../shared/types';

export const DAYS_OF_WEEK: TimetableDay[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
];

/**
 * Maps common LPU course type codes to friendly labels.
 */
export const COURSE_TYPE_LABELS: Record<string, string> = {
  CR: 'Core',
  DE: 'Department Elective',
  EM: 'Elective Major',
  OM: 'Open Minor',
  OE: 'Open Elective',
  PE: 'Professional Elective',
  PW: 'Practice / Pathway',
  SP: 'Specialization',
  SE: 'Social Science',
  TE: 'Training / Evaluation',
  BL: 'Backlog'
};

/**
 * Returns all accessible documents across the window and any child iframes (e.g. SSRS ReportViewer frames).
 */
export function getAllAccessibleDocuments(rootDoc: Document = document): Document[] {
  const docs: Document[] = [rootDoc];
  try {
    const iframes = Array.from(rootDoc.querySelectorAll('iframe, frame'));
    for (const frame of iframes) {
      try {
        const frameDoc =
          (frame as HTMLIFrameElement).contentDocument ||
          (frame as HTMLIFrameElement).contentWindow?.document;
        if (frameDoc && frameDoc.body && !docs.includes(frameDoc)) {
          docs.push(frameDoc);
          const nested = Array.from(frameDoc.querySelectorAll('iframe, frame'));
          for (const nf of nested) {
            try {
              const nd =
                (nf as HTMLIFrameElement).contentDocument ||
                (nf as HTMLIFrameElement).contentWindow?.document;
              if (nd && nd.body && !docs.includes(nd)) {
                docs.push(nd);
              }
            } catch {}
          }
        }
      } catch {}
    }
  } catch {}
  return docs;
}

/**
 * Detects whether the current page is the UMS Student Time Table report.
 */
export function detectTimetablePage(
  doc: Document = document,
  locationObj: { href: string; pathname?: string } = window.location
): { isTimetablePage: boolean; hasTimetableGrid: boolean } {
  const url = (locationObj.href || '').toLowerCase();
  const isUrlMatch =
    url.includes('frmstudenttimetable.aspx') ||
    url.includes('/reports/frmstudenttimetable') ||
    url.includes('studenttimetable');

  const allDocs = getAllAccessibleDocuments(doc);
  let pageText = '';
  const allTables: HTMLTableElement[] = [];
  for (const d of allDocs) {
    pageText += ' ' + (d.body?.textContent || '').toLowerCase();
    allTables.push(...Array.from(d.querySelectorAll<HTMLTableElement>('table')));
  }

  const hasTitleMatch =
    pageText.includes('student time table') ||
    (pageText.includes('time table for vid') && pageText.includes('home section'));

  const hasGrid = allTables.some((tbl) => {
    const text = (tbl.textContent || '').toLowerCase();
    return (
      (text.includes('timing') || text.includes('time')) &&
      text.includes('monday') &&
      text.includes('tuesday')
    );
  });

  return {
    isTimetablePage: Boolean(isUrlMatch || (hasTitleMatch && hasGrid)),
    hasTimetableGrid: hasGrid
  };
}

/**
 * Finds the "View Time Table" anchor link in the UMS dashboard navbar or quick links.
 */
export function findTimetableLinkElement(doc: Document = document): HTMLElement | null {
  const allDocs = getAllAccessibleDocuments(doc);

  for (const currentDoc of allDocs) {
    const allElements = Array.from(
      currentDoc.querySelectorAll<HTMLElement>('a, button, [role="link"], [role="button"], li, div, span')
    );

    // 1. Direct href or onclick match on leaf interactive elements (<a>, <button>, [role="link"])
    for (const el of allElements) {
      const tag = el.tagName.toLowerCase();
      const isInteractive = tag === 'a' || tag === 'button' || el.getAttribute('role') === 'link';
      const href = (el.getAttribute('href') || (el as any).href || '').toLowerCase();
      const onclick = (el.getAttribute('onclick') || '').toLowerCase();
      if ((href.includes('frmstudenttimetable') || onclick.includes('frmstudenttimetable')) && isInteractive) {
        return el;
      }
    }

    // 2. Any element with href or onclick containing frmstudenttimetable
    for (const el of allElements) {
      const href = (el.getAttribute('href') || (el as any).href || '').toLowerCase();
      const onclick = (el.getAttribute('onclick') || '').toLowerCase();
      if (href.includes('frmstudenttimetable') || onclick.includes('frmstudenttimetable')) {
        const interactiveChild = el.querySelector<HTMLElement>('a, button');
        return interactiveChild || el;
      }
    }

    // 3. Exact clean text match on leaf interactive element (does not contain child interactive elements)
    for (const el of allElements) {
      const tag = el.tagName.toLowerCase();
      const isInteractive =
        tag === 'a' ||
        tag === 'button' ||
        el.getAttribute('role') === 'link' ||
        el.getAttribute('role') === 'button' ||
        el.classList.contains('dropdown-item');

      if (isInteractive && !el.querySelector('a, button')) {
        const text = (el.textContent || '').replace(/[\u00a0\s]+/g, ' ').trim().toLowerCase();
        if (
          text === 'view time table' ||
          text === 'view timetable' ||
          text === 'student time table' ||
          text === 'time table' ||
          text === 'timetable'
        ) {
          return el;
        }
      }
    }

    // 4. Substring text match on leaf interactive elements
    for (const el of allElements) {
      const tag = el.tagName.toLowerCase();
      const isInteractive =
        tag === 'a' ||
        tag === 'button' ||
        el.getAttribute('role') === 'link' ||
        el.getAttribute('role') === 'button' ||
        el.classList.contains('dropdown-item');

      if (isInteractive && !el.querySelector('a, button')) {
        const text = (el.textContent || '').toLowerCase();
        if (
          (text.includes('view time table') || text.includes('view timetable')) &&
          text.length < 35
        ) {
          return el;
        }
      }
    }

    // 5. Fallback: Any element whose direct text matches
    for (const el of allElements) {
      const text = (el.textContent || '').replace(/[\u00a0\s]+/g, ' ').trim().toLowerCase();
      if (
        text === 'view time table' ||
        text === 'view timetable' ||
        text === 'student time table'
      ) {
        const interactiveChild = el.querySelector<HTMLElement>('a, button');
        return interactiveChild || el;
      }
    }
  }

  return null;
}

/**
 * Finds the "Academics" top navigation menu trigger in UMS dashboard navbar.
 */
export function findAcademicsMenuElement(doc: Document = document): HTMLElement | null {
  const allElements = Array.from(
    doc.querySelectorAll<HTMLElement>(
      'a, button, [role="button"], .nav-item, .dropdown-toggle, li, span, div'
    )
  );

  // 1. Prioritize interactive triggers (a, button, role=button, dropdown-toggle)
  for (const el of allElements) {
    const tag = el.tagName.toLowerCase();
    const isInteractive =
      tag === 'a' ||
      tag === 'button' ||
      el.getAttribute('role') === 'button' ||
      el.classList.contains('dropdown-toggle') ||
      el.getAttribute('data-toggle') === 'dropdown';

    if (isInteractive) {
      // Exclude nested dropdown menus from text calculation
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('ul, ol, .dropdown-menu').forEach((n) => n.remove());
      const text = (clone.textContent || '').replace(/[\u00a0\s]+/g, ' ').trim().toLowerCase();
      if (
        (text === 'academics' || text.startsWith('academics')) &&
        text.length < 25
      ) {
        const innerTrigger = el.querySelector<HTMLElement>('a.dropdown-toggle, a, button');
        return innerTrigger || el;
      }
    }
  }

  // 2. Fallback to any element whose direct text starts with Academics
  for (const el of allElements) {
    const clone = el.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('ul, ol, .dropdown-menu').forEach((n) => n.remove());
    const text = (clone.textContent || '').replace(/[\u00a0\s]+/g, ' ').trim().toLowerCase();
    if (
      (text === 'academics' || text.startsWith('academics')) &&
      text.length < 25
    ) {
      const interactiveChild = el.querySelector<HTMLElement>('a, button, [role="button"], .dropdown-toggle');
      return interactiveChild || el;
    }
  }

  return null;
}

/**
 * Finds the "LMS" menu item inside the Academics dropdown menu.
 */
export function findLmsMenuElement(doc: Document = document): HTMLElement | null {
  const allElements = Array.from(
    doc.querySelectorAll<HTMLElement>('a, button, [role="button"], li, span, div')
  );

  // 1. Prioritize leaf interactive links / buttons
  for (const el of allElements) {
    const tag = el.tagName.toLowerCase();
    const isInteractive =
      tag === 'a' ||
      tag === 'button' ||
      el.getAttribute('role') === 'button' ||
      el.classList.contains('dropdown-item');

    if (isInteractive && !el.querySelector('a, button')) {
      const text = (el.textContent || '').replace(/[\u00a0\s]+/g, ' ').trim().toLowerCase();
      if (
        text === 'lms' ||
        text.startsWith('lms ') ||
        text === 'lms/view time table' ||
        text === 'lms - learning management system' ||
        text.includes('learning management')
      ) {
        return el;
      }
    }
  }

  // 2. Fallback to any element
  for (const el of allElements) {
    const text = (el.textContent || '').replace(/[\u00a0\s]+/g, ' ').trim().toLowerCase();
    if (
      text === 'lms' ||
      text.startsWith('lms ') ||
      text.includes('learning management')
    ) {
      const interactiveChild = el.querySelector<HTMLElement>('a, button, [role="button"]');
      return interactiveChild || el;
    }
  }

  return null;
}

/**
 * Parses individual class string like:
 * "Lecture / G:All C:CSE329 / R: 38-917 / S:K4E0061"
 * or "Practical / G:0 C:CSE472 / R: 33-502 / S:K2EM001"
 * or "Project Work/ Other Weekly Activities. Check Schedule Below"
 */
export function parseClassCellText(
  cellText: string,
  day: TimetableDay,
  time: string
): TimetableSlot[] {
  const clean = (cellText || '').replace(/[\u00a0\s]+/g, ' ').trim();
  if (
    !clean ||
    clean === '&nbsp;' ||
    clean === '-' ||
    clean.toLowerCase() === 'nil' ||
    clean.toLowerCase() === 'n/a' ||
    clean.toLowerCase() === 'na'
  ) {
    return [];
  }

  // Handle Project Work / Activities
  if (
    clean.toLowerCase().includes('project work') ||
    clean.toLowerCase().includes('other weekly activities')
  ) {
    return [
      {
        id: `slot-${day}-${time}-PROJECT`,
        day,
        time,
        type: 'Project Work',
        group: 'All',
        courseCode: 'PROJECT',
        courseTitle: 'Project Work / Weekly Activities',
        room: 'Check Schedule Below',
        rawText: clean
      }
    ];
  }

  // A cell can have multiple classes (e.g. for different groups or split rows)
  // Split on occurrences of "Lecture" or "Practical" or "Tutorial"
  const lines = clean
    .split(/(?=(?:Lecture|Practical|Tutorial)\s*\/)/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const slots: TimetableSlot[] = [];

  for (const line of lines) {
    const typeMatch = line.match(/^(Lecture|Practical|Tutorial)/i);
    const type = typeMatch ? typeMatch[1] : 'Lecture';

    const groupMatch = line.match(/G\s*:\s*([^/\s]+)/i);
    const group = groupMatch ? groupMatch[1].trim() : 'All';

    const courseMatch = line.match(/C\s*:\s*([A-Z0-9]+)/i);
    const courseCode = courseMatch ? courseMatch[1].trim().toUpperCase() : undefined;

    // A valid class slot must contain a course code
    if (!courseCode) continue;

    const roomMatch = line.match(/R\s*:\s*([0-9A-Z\s-]+?)(?=\s*\/|$)/i);
    const room = roomMatch ? roomMatch[1].replace(/\s+/g, '').trim() : undefined;

    const sectionMatch = line.match(/S\s*:\s*([0-9A-Z]+)/i);
    const section = sectionMatch ? sectionMatch[1].trim() : undefined;

    let block: string | undefined;
    let roomNumber: string | undefined;
    if (room && room.includes('-')) {
      const parts = room.split('-');
      block = parts[0];
      roomNumber = parts.slice(1).join('-');
    }

    slots.push({
      id: `slot-${day}-${time}-${courseCode}-${group}`,
      day,
      time,
      type,
      group,
      courseCode,
      room,
      block,
      roomNumber,
      section,
      rawText: line
    });
  }

  return slots;
}

/**
 * Parses faculty cell text:
 * "Raj Karan Singh ( 26-207-WOW1 ) Last Updated :: Mar 9 2026 4:07PM"
 * or "Last Updated :: NA"
 */
export function parseFacultyCell(facultyText: string): {
  facultyName?: string;
  facultyCabin?: string;
  facultyBlock?: string;
  facultyRoom?: string;
  cabinNumber?: string;
  lastUpdated?: string;
} {
  const clean = facultyText.replace(/\s+/g, ' ').trim();
  if (!clean || clean.toLowerCase() === 'last updated :: na' || clean.toLowerCase() === 'na') {
    return {
      facultyName: 'Not Assigned',
      facultyCabin: 'N/A',
      lastUpdated: 'NA'
    };
  }

  const updatedMatch = clean.match(/Last Updated\s*::\s*(.+)$/i);
  const lastUpdated = updatedMatch ? updatedMatch[1].trim() : undefined;

  const mainPart = clean.replace(/Last Updated\s*::\s*(.+)$/i, '').trim();

  // Pattern: "Faculty Name ( 26-207-WOW1 )"
  const parenMatch = mainPart.match(/^([^(]+)\(\s*([^)]+)\s*\)/);
  if (parenMatch) {
    const facultyName = parenMatch[1].trim();
    const facultyCabin = parenMatch[2].trim().replace(/\s*-\s*/g, '-');

    let facultyBlock: string | undefined;
    let facultyRoom: string | undefined;
    let cabinNumber: string | undefined;

    if (facultyCabin.includes('-')) {
      const parts = facultyCabin.split('-').map((p) => p.trim());
      facultyBlock = parts[0];
      facultyRoom = parts[1];
      cabinNumber = parts.slice(2).join('-');
    }

    return {
      facultyName,
      facultyCabin,
      facultyBlock,
      facultyRoom,
      cabinNumber,
      lastUpdated
    };
  }

  return {
    facultyName: mainPart || undefined,
    lastUpdated
  };
}

/**
 * Extracts and returns complete structured Time Table and Faculty Directory.
 * Traverses all accessible frames (including SSRS ReportViewer iframes) and
 * tolerates variations in table column positioning and whitespace.
 */
export function parseStudentTimeTable(doc: Document = document): TimetableSummary | null {
  const allDocs = getAllAccessibleDocuments(doc);

  let fullText = '';
  const allTables: HTMLTableElement[] = [];

  for (const d of allDocs) {
    fullText += ' ' + (d.body?.textContent || '');
    allTables.push(...Array.from(d.querySelectorAll<HTMLTableElement>('table')));
  }

  const cleanFullText = fullText.replace(/[\u00a0\s]+/g, ' ').trim();

  // 1. Extract VID
  const vidMatch =
    cleanFullText.match(/Time Table for VID\s*:\s*([0-9]+)/i) ||
    cleanFullText.match(/VID\s*:\s*([0-9]+)/i) ||
    cleanFullText.match(/\bVID\b\s*[:\s]+([0-9]+)/i);
  const vid = vidMatch ? vidMatch[1].trim() : '';

  // 2. Extract Home Section (e.g. "Home Section : K3P24WM" or "Home Section K3P24WM :")
  let homeSection = '';
  const sectionMatch =
    cleanFullText.match(/Home Section\s*:\s*([0-9A-Z]+)/i) ||
    cleanFullText.match(/Home Section\s+([0-9A-Z]+)\s*:/i) ||
    cleanFullText.match(/Home Section\s+([0-9A-Z]+)/i) ||
    cleanFullText.match(/\bHome\s+Section\b[^\w]*([0-9A-Z]+)/i) ||
    cleanFullText.match(/\bSection\b\s*:\s*([0-9A-Z]+)/i);

  if (sectionMatch) {
    const candidate = sectionMatch[1].replace(/Legends.*$/i, '').trim();
    if (!/^(time|timetable|table|schedule|weekly|report|legends|legend)$/i.test(candidate)) {
      homeSection = candidate;
    }
  }

  // Also verify directly against individual table cells for exact match
  for (const tbl of allTables) {
    const cells = Array.from(tbl.querySelectorAll('td, th'));
    for (let i = 0; i < cells.length; i++) {
      const cellText = (cells[i].textContent || '').replace(/[\u00a0\s]+/g, ' ').trim();
      if (/home\s*section/i.test(cellText)) {
        const m = cellText.match(/home\s*section\s*:?\s*([A-Z0-9]+)/i);
        if (m && !/^(legend|time|table)/i.test(m[1])) {
          homeSection = m[1].replace(/Legends.*$/i, '').trim();
          break;
        }
        if (i + 1 < cells.length) {
          const nextText = (cells[i + 1].textContent || '').replace(/[\u00a0\s]+/g, ' ').replace(/Legends.*$/i, '').trim();
          const mNext = nextText.match(/^([A-Z0-9]+)/i);
          if (mNext && !/^(legend|time|table)/i.test(mNext[1])) {
            homeSection = mNext[1].trim();
            break;
          }
        }
      }
    }
    if (homeSection && !/^(time|timetable|table|schedule|weekly|report|legends|legend)$/i.test(homeSection)) break;
  }

  // 3. Extract Printed On Date
  const printedMatch = cleanFullText.match(/Printed On\s+([0-9/:\sAPMapm]+)/i);
  const printedOn = printedMatch ? printedMatch[1].trim() : undefined;

  if (allTables.length === 0) {
    if (!vid && !homeSection) return null;
  }

  // Locate the weekly schedule grid table and course table across all tables
  let gridTable: HTMLTableElement | null = null;
  let courseTable: HTMLTableElement | null = null;

  for (const tbl of allTables) {
    const text = (tbl.textContent || '').toLowerCase().replace(/[\u00a0\s]+/g, ' ');
    if (
      !gridTable &&
      (text.includes('monday') || text.includes('tuesday')) &&
      (text.includes('timing') || text.includes('time') || text.includes('wednesday') || text.includes('09:') || text.includes('10:'))
    ) {
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

  // 4. Parse Course & Faculty Directory Table first so we can enrich slots
  const courses: CourseFacultyRecord[] = [];
  if (courseTable) {
    const rows = Array.from(courseTable.querySelectorAll('tr'));
    let codeColIdx = -1;
    let typeColIdx = -1;
    let titleColIdx = -1;
    let lColIdx = -1;
    let tColIdx = -1;
    let pColIdx = -1;
    let credColIdx = -1;
    let facColIdx = -1;

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td, th')).map((c) =>
        (c.textContent || '').replace(/[\u00a0\s]+/g, ' ').trim()
      );
      const lowerCells = cells.map((c) => c.toLowerCase());

      // Identify header column indices
      if (lowerCells.some((c) => c.includes('course code') || c === 'code')) {
        codeColIdx = lowerCells.findIndex((c) => c.includes('course code') || c === 'code');
        typeColIdx = lowerCells.findIndex((c) => c.includes('type'));
        titleColIdx = lowerCells.findIndex((c) => c.includes('title') || c.includes('course name'));
        lColIdx = lowerCells.findIndex((c) => c === 'l' || c.includes('lecture'));
        tColIdx = lowerCells.findIndex((c) => c === 't' || c.includes('tutorial'));
        pColIdx = lowerCells.findIndex((c) => c === 'p' || c.includes('practical'));
        credColIdx = lowerCells.findIndex((c) => c.includes('credit'));
        facColIdx = lowerCells.findIndex((c) => c.includes('faculty'));
        continue;
      }

      if (cells.length < 3) continue;

      // Locate course code column dynamically
      let courseCode = '';
      let targetCodeIdx = codeColIdx;

      if (targetCodeIdx === -1) {
        targetCodeIdx = cells.findIndex((c) => /^[A-Z]{2,6}\s*\d{2,4}[A-Z0-9]?$/i.test(c));
      }

      if (targetCodeIdx !== -1 && cells[targetCodeIdx]) {
        const candidate = cells[targetCodeIdx].replace(/\s+/g, '').toUpperCase();
        if (/^[A-Z]{2,6}\d{2,4}[A-Z0-9]?$/i.test(candidate) && !candidate.includes('CODE')) {
          courseCode = candidate;
        }
      }

      if (!courseCode) continue;

      const courseType = typeColIdx !== -1 ? cells[typeColIdx] : (cells[targetCodeIdx + 1] || undefined);
      const courseTypeName = courseType ? COURSE_TYPE_LABELS[courseType] || courseType : undefined;
      const courseTitle = titleColIdx !== -1 ? cells[titleColIdx] : (cells[targetCodeIdx + 2] || '');
      const lectures = lColIdx !== -1 ? parseInt(cells[lColIdx], 10) || 0 : 0;
      const tutorial = tColIdx !== -1 ? parseInt(cells[tColIdx], 10) || 0 : 0;
      const practical = pColIdx !== -1 ? parseInt(cells[pColIdx], 10) || 0 : 0;
      const credits = credColIdx !== -1 ? parseInt(cells[credColIdx], 10) || 0 : 0;

      const facultyRaw = facColIdx !== -1 ? cells[facColIdx] : (cells[cells.length - 1] || '');
      const facultyParsed = parseFacultyCell(facultyRaw);

      courses.push({
        courseCode,
        courseType,
        courseTypeName,
        courseTitle,
        lectures,
        tutorial,
        practical,
        credits,
        facultyName: facultyParsed.facultyName,
        facultyCabin: facultyParsed.facultyCabin,
        facultyBlock: facultyParsed.facultyBlock,
        facultyRoom: facultyParsed.facultyRoom,
        cabinNumber: facultyParsed.cabinNumber,
        lastUpdated: facultyParsed.lastUpdated
      });
    }
  }

  // Map for fast course code lookup
  const courseMap = new Map<string, CourseFacultyRecord>();
  for (const c of courses) {
    courseMap.set(c.courseCode.toUpperCase(), c);
  }

  // 5. Parse the Weekly Time Table Grid Table
  const slots: TimetableSlot[] = [];

  if (gridTable) {
    const rows = Array.from(gridTable.querySelectorAll('tr'));
    let dayIndexMap: Array<{ day: TimetableDay; colIndex: number }> = [];

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('td, th')).map((c) =>
        (c.textContent || '').replace(/[\u00a0\s]+/g, ' ').trim()
      );
      const lowerCells = cells.map((c) => c.toLowerCase());

      const monIdx = lowerCells.findIndex((c) => c.includes('monday'));
      if (monIdx !== -1) {
        dayIndexMap = [];
        for (let i = 0; i < cells.length; i++) {
          const name = lowerCells[i];
          const matchDay = DAYS_OF_WEEK.find((d) => name.includes(d.toLowerCase()));
          if (matchDay) {
            dayIndexMap.push({ day: matchDay, colIndex: i });
          }
        }
        continue;
      }

      // If we already identified header days, parse time slot row
      if (dayIndexMap.length > 0 && cells.length > 1) {
        // Find which cell in the first 3 columns contains the time
        // e.g. "09:30-10:20 AM" or "10:20-11:10 AM"
        const timeCell = cells.slice(0, 3).find((c) => /\d{1,2}:\d{2}/.test(c)) || cells[0];
        if (!timeCell || !timeCell.match(/\d{1,2}:\d{2}/)) continue;

        for (const { day, colIndex } of dayIndexMap) {
          if (colIndex >= cells.length) continue;
          const cellContent = cells[colIndex];
          if (!cellContent) continue;

          const parsedSlots = parseClassCellText(cellContent, day, timeCell);

          for (const s of parsedSlots) {
            // Enrich slot with course & faculty metadata
            if (s.courseCode) {
              const matchedCourse = courseMap.get(s.courseCode.toUpperCase());
              if (matchedCourse) {
                s.courseTitle = matchedCourse.courseTitle;
                s.facultyName = matchedCourse.facultyName;
                s.facultyCabin = matchedCourse.facultyCabin;
              }
            }
            slots.push(s);
          }
        }
      }
    }
  }

  // 6. Synthesize course records from schedule slots if courseTable wasn't rendered/present
  if (courses.length === 0 && slots.length > 0) {
    const uniqueCodes = Array.from(new Set(slots.map((s) => s.courseCode).filter(Boolean))) as string[];
    for (const code of uniqueCodes) {
      if (code === 'PROJECT') continue;
      const slotForCode = slots.find((s) => s.courseCode === code);
      courses.push({
        courseCode: code,
        courseTitle: slotForCode?.courseTitle || `${code} Course`,
        lectures: slots.filter((s) => s.courseCode === code && s.type.toLowerCase().includes('lecture')).length,
        practical: slots.filter((s) => s.courseCode === code && s.type.toLowerCase().includes('practical')).length,
        tutorial: slots.filter((s) => s.courseCode === code && s.type.toLowerCase().includes('tutorial')).length,
        credits: 0
      });
    }
  }

  const totalCredits = courses.reduce((acc, c) => acc + (c.credits || 0), 0);

  if (!homeSection || /^(time|timetable|table|schedule|weekly|report|legends|legend|verified section)$/i.test(homeSection)) {
    const slotSec = slots.find((s) => s.section && !/^(time|timetable|table|schedule|weekly|report|legends|legend)$/i.test(s.section));
    if (slotSec && slotSec.section) {
      homeSection = slotSec.section;
    }
  }

  return {
    vid: vid || 'Verified Student',
    homeSection: homeSection || 'Verified Section',
    printedOn,
    slots,
    courses,
    totalSlots: slots.length,
    totalCourses: courses.length,
    totalCredits,
    capturedAt: Date.now(),
    verified: true,
    source: 'UMS Student Time Table Report'
  };
}
