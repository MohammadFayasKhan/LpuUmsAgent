/*
 * Elaborated Voice Summary Generator for ONEE.
 *
 * Transforms verified academic results (timetables, attendance, examinations, seating plans)
 * and assistant markdown messages into a single, cohesive, elaborated spoken summary.
 *
 * Guarantees:
 * 1. Single Voice Response: Speaks ONE complete, natural narrative rather than choppy, broken fragments.
 * 2. Academic Detail Grounding: Mentions exact subject names, timings, rooms, and metrics fluently.
 * 3. Speech Cleanliness: Strips markdown artifacts, pipe tables, links, and hashtags.
 */

import { TimetableSummary, AttendanceSummary, ExaminationSummary } from '../shared/types';
import { calculateBunkAllowance } from '../shared/attendanceCalculator';
import { transformSpeechIdentity } from './VoiceProvider';

export interface VoiceSummaryContext {
  query?: string;
  capability?: string;
  intent?: string;
  timetable?: TimetableSummary | null;
  attendance?: AttendanceSummary | null;
  examination?: ExaminationSummary | null;
  verifiedResult?: any;
}

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Short natural acknowledgements that open a spoken answer. The choice follows
// the student's own wording, so it varies between requests while staying stable
// for a repeated question — no fixed robotic prefix.
const SPOKEN_OPENERS = ['Sure.', 'Got it.', 'Here you go.', 'Alright.'];

function spokenOpener(seed: string): string {
  const key = (seed || '').toLowerCase();
  let total = 0;
  for (let i = 0; i < key.length; i++) {
    total = (total * 31 + key.charCodeAt(i)) % 100003;
  }
  return SPOKEN_OPENERS[total % SPOKEN_OPENERS.length];
}

function formatSpokenRoom(room?: string): string {
  if (!room || room === 'TBD' || room.toLowerCase() === 'awaited') return 'your assigned room';
  const clean = room.replace(/Room\s*/i, '').trim();
  return `Room ${clean}`;
}

function cleanSpokenTitle(title?: string): string {
  if (!title) return '';
  return title
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts structured rows from a markdown table in response text.
 */
function parseMarkdownTableRows(text: string): Record<string, string>[] {
  const lines = text.split('\n');
  const tableLines = lines.filter((l) => l.trim().startsWith('|'));
  if (tableLines.length < 3) return [];

  const headers = tableLines[0]
    .split('|')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  const dataRows: Record<string, string>[] = [];

  for (let i = 2; i < tableLines.length; i++) {
    const rawCells = tableLines[i]
      .split('|')
      .map((c) => c.replace(/[*_`]/g, '').trim())
      .filter((_, idx, arr) => idx > 0 && idx < arr.length);

    if (rawCells.length >= 2) {
      const rowObj: Record<string, string> = {};
      headers.forEach((h, hIdx) => {
        if (rawCells[hIdx] !== undefined) {
          rowObj[h] = rawCells[hIdx];
        }
      });
      dataRows.push(rowObj);
    }
  }

  return dataRows;
}

/**
 * Generates an elaborated voice summary for timetable queries.
 */
function summarizeTimetable(
  fullMessageText: string,
  context?: VoiceSummaryContext
): string | null {
  const queryLower = (context?.query || '').toLowerCase();
  const textLower = fullMessageText.toLowerCase();

  // Detect requested day
  let targetDay: string | null = null;
  for (const d of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
    if (queryLower.includes(d) || textLower.includes(`schedule for **${d}**`) || textLower.includes(`schedule (**${d}**)`)) {
      targetDay = d.charAt(0).toUpperCase() + d.slice(1);
      break;
    }
  }

  const todayIndex = new Date().getDay();
  const todayDay = DAYS_OF_WEEK[todayIndex];
  const tomorrowDay = DAYS_OF_WEEK[(todayIndex + 1) % 7];

  if (!targetDay) {
    if (queryLower.includes('tomorrow')) {
      targetDay = tomorrowDay;
    } else {
      targetDay = todayDay;
    }
  }

  // Check if weekly matrix query
  const isWeekly =
    queryLower.includes('matrix') ||
    queryLower.includes('all classes') ||
    queryLower.includes('weekly') ||
    queryLower.includes('complete list') ||
    textLower.includes('weekly class schedule matrix');

  if (isWeekly && context?.timetable) {
    const totalSlots = context.timetable.slots?.length || 0;
    const totalCourses = context.timetable.courses?.length || 0;
    return `Here is your complete weekly class schedule. You have ${totalSlots} total sessions scheduled across your ${totalCourses} enrolled courses from Monday to Saturday. All classroom numbers and timings are verified from your UMS report.`;
  }

  // Resolve slots for the target day
  let daySlots: any[] = [];

  if (context?.timetable?.slots && Array.isArray(context.timetable.slots)) {
    daySlots = context.timetable.slots.filter(
      (s) => (s.day || '').toLowerCase() === targetDay!.toLowerCase()
    );
  } else if (context?.verifiedResult?.classes && Array.isArray(context.verifiedResult.classes)) {
    daySlots = context.verifiedResult.classes;
  } else if (context?.verifiedResult?.details?.todayClasses) {
    daySlots = context.verifiedResult.details.todayClasses;
  }

  // Fallback: parse markdown table directly
  if (daySlots.length === 0) {
    const parsedRows = parseMarkdownTableRows(fullMessageText);
    if (parsedRows.length > 0) {
      daySlots = parsedRows.map((r) => ({
        time: r['time slot'] || r['time'] || r['slot & time'] || 'TBD',
        courseCode: r['subject code'] || r['course code'] || r['subject'] || '',
        courseTitle: r['course title'] || r['course name'] || '',
        room: r['room & block'] || r['room'] || r['room / venue'] || '',
        type: r['type'] || 'Lecture'
      }));
    }
  }

  if (daySlots.length === 0) {
    return `You have no classes scheduled on ${targetDay} according to your verified UMS timetable. Enjoy your free day!`;
  }

  const count = daySlots.length;
  const sessionWord = count === 1 ? 'class' : 'classes';

  // Build descriptive narration for classes
  const descriptions: string[] = daySlots.map((s) => {
    const title = cleanSpokenTitle(s.courseTitle) || s.courseCode || 'Class';
    const room = formatSpokenRoom(s.room);
    const time = s.time || '';
    return `${title} at ${time} in ${room}`;
  });

  if (count === 1) {
    return `You have 1 class scheduled for ${targetDay}: ${descriptions[0]}.`;
  }

  if (count <= 3) {
    const listStr = descriptions.slice(0, -1).join(', followed by ') + ', and ' + descriptions[descriptions.length - 1];
    return `You have ${count} ${sessionWord} scheduled for ${targetDay}. Your schedule includes ${listStr}.`;
  }

  // 4+ classes: Elaborate first two and last session
  const first = descriptions[0];
  const second = descriptions[1];
  const last = descriptions[descriptions.length - 1];
  const middleCount = count - 2;

  return `You have ${count} ${sessionWord} scheduled for ${targetDay}. Your day begins with ${first}, followed by ${second}. You have ${middleCount} more session${middleCount > 1 ? 's' : ''} in the afternoon, concluding with ${last}.`;
}

/**
 * Generates an elaborated voice summary for attendance queries.
 */
function summarizeAttendance(
  fullMessageText: string,
  context?: VoiceSummaryContext
): string | null {
  const queryLower = (context?.query || '').toLowerCase();
  const att = context?.attendance;

  if (att && att.courses && att.courses.length > 0) {
    const overall = Math.round(att.overallPercentage);
    const totalCourses = att.courses.length;
    const sorted = [...att.courses].sort((a, b) => a.percentage - b.percentage);
    const lowest = sorted[0];
    const highest = sorted[sorted.length - 1];
    const requestedCourseMatch = queryLower.match(/\b([a-z]{2,5})\s*(\d{3,4}[a-z]?)\b/i);
    const requestedCode = requestedCourseMatch
      ? `${requestedCourseMatch[1]}${requestedCourseMatch[2]}`.toUpperCase()
      : null;
    const requestedCourse = requestedCode
      ? att.courses.find((course) =>
          (course.code || '').replace(/\s+/g, '').toUpperCase() === requestedCode
        )
      : undefined;
    const focusCourse = requestedCourse || lowest;
    const focusBunks = calculateBunkAllowance(focusCourse.attended, focusCourse.total, 75);

    if (
      fullMessageText.includes('Strategic Attendance Maintenance Plan') ||
      queryLower.includes('maintain')
    ) {
      const lowBunks = calculateBunkAllowance(lowest.attended, lowest.total, 75);
      return `Here is your strategic attendance maintenance plan. You are currently standing at ${overall} percent overall across ${totalCourses} subjects. Your lowest subject is ${lowest.code} at ${Math.round(lowest.percentage)} percent with ${lowBunks} safe skips. Keep every subject above 78 percent to maintain a safe buffer above the examination detention cutoff.`;
    }

    if (queryLower.includes('lowest') || queryLower.includes('least') || queryLower.includes('worst') || queryLower.includes('bunk') || queryLower.includes('skip') || queryLower.includes('bank') || queryLower.includes('miss')) {
      const courseName = cleanSpokenTitle(focusCourse.name);
      const focusLabel =
        courseName && courseName.toUpperCase() !== (focusCourse.code || '').toUpperCase()
          ? `${focusCourse.code}, ${courseName}`
          : focusCourse.code;
      const pct = Math.round(focusCourse.percentage);
      const skipWord = focusBunks === 1 ? 'class' : 'classes';

      // The student named a course, so answer for that course specifically.
      if (requestedCourse) {
        return focusCourse.percentage >= 75
          ? `For ${focusLabel}, your attendance is ${pct} percent, with ${focusCourse.attended} of ${focusCourse.total} classes attended. You can safely skip ${focusBunks} ${skipWord} before the 75 percent limit.`
          : `For ${focusLabel}, your attendance is ${pct} percent, with ${focusCourse.attended} of ${focusCourse.total} classes attended, which is below the 75 percent limit. Attend the upcoming classes to restore regular exam eligibility.`;
      }

      // Otherwise the question is about the weakest subject: direct answer,
      // supporting fact, then a concise natural conclusion. The opener is added
      // by the opened() wrapper so it is never duplicated.
      return focusCourse.percentage >= 75
        ? `${focusLabel} is currently your lowest attendance, at ${pct} percent, with ${focusCourse.attended} of ${focusCourse.total} classes attended. Overall you are standing at ${overall} percent across ${totalCourses} subjects, and ${focusCourse.code} still has ${focusBunks} safe ${skipWord} above the 75 percent limit. So that is the subject to keep the closest eye on.`
        : `${focusLabel} is currently your lowest attendance, at ${pct} percent, with ${focusCourse.attended} of ${focusCourse.total} classes attended, which is below the 75 percent examination limit. Overall you are standing at ${overall} percent across ${totalCourses} subjects. So that is the subject that needs attention right away.`;
    }

    if (queryLower.includes('eligible') || queryLower.includes('clearance') || queryLower.includes('admit')) {
      const dangerCourses = att.courses.filter((c) => c.percentage < 75);
      if (dangerCourses.length === 0) {
        return `You are fully cleared for university examinations across all ${totalCourses} registered courses, with an overall attendance standing of ${overall} percent.`;
      } else {
        return `You currently have ${dangerCourses.length} course${dangerCourses.length > 1 ? 's' : ''} below the 75 percent exam cutoff. Your overall aggregate attendance is ${overall} percent.`;
      }
    }

    return `Your overall attendance across all ${totalCourses} enrolled courses is ${overall} percent. Your highest standing is in ${highest.code} at ${Math.round(highest.percentage)} percent, while your lowest is in ${lowest.code} at ${Math.round(lowest.percentage)} percent.`;
  }

  // Fallback: parse numbers from text
  const pctMatch = fullMessageText.match(/(\d{1,3})%/);
  if (pctMatch) {
    return `Your verified attendance stands at ${pctMatch[1]} percent according to your UMS dashboard.`;
  }

  return null;
}

/**
 * Generates an elaborated voice summary for examination & seating plan queries.
 */
function summarizeExamination(
  fullMessageText: string,
  context?: VoiceSummaryContext
): string | null {
  const examData = context?.examination;
  let exams = examData?.exams || [];

  if (exams.length === 0) {
    const rows = parseMarkdownTableRows(fullMessageText);
    if (rows.length > 0) {
      exams = rows.map((r) => ({
        courseCode: r['subject code'] || r['course code'] || '',
        courseName: r['course name'] || r['course title'] || '',
        examDate: r['exam date'] || r['date'] || '',
        startTime: r['slot & time'] || r['time'] || '',
        room: r['room & hall'] || r['room'] || '',
        seat: r['seat number'] || r['seat'] || ''
      })) as any[];
    }
  }

  if (exams.length === 0) return null;

  const query = (context?.query || '').toLowerCase();
  const totalExams = examData?.totalExams || exams.length;

  // 1. Check if the user is asking about a specific course code (e.g. INT373, CSE408)
  const courseMatch = query.match(/\b([A-Za-z]{2,5}\s*\d{3,4})\b/i);
  const requestedCode = courseMatch ? courseMatch[1].replace(/\s+/g, '').toUpperCase() : null;

  // 2. Check if a specific date was mentioned (e.g. "18 Oct", "14 Oct")
  const dateMatch = query.match(/\b(\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)\b/i);
  const requestedDate = dateMatch ? dateMatch[1].toLowerCase() : null;

  let matchedExam = requestedCode
    ? exams.find((e) => (e.courseCode || '').replace(/\s+/g, '').toUpperCase() === requestedCode)
    : null;

  if (!matchedExam && requestedDate) {
    matchedExam = exams.find((e) => (e.examDate || '').toLowerCase().includes(requestedDate));
  }

  const isSeatQuery = query.includes('seat') || query.includes('seating') || query.includes('bench') || query.includes('where do i sit') || query.includes('where is');

  if (matchedExam) {
    const title = cleanSpokenTitle(matchedExam.courseName) || matchedExam.courseCode;
    const roomStr = matchedExam.room && matchedExam.room !== 'Awaited' ? `in Room ${matchedExam.room}` : 'with venue awaited';
    const timeStr = matchedExam.startTime ? `at ${matchedExam.startTime}` : '';

    if (isSeatQuery) {
      const seat = matchedExam.seat;
      if (seat && !/^(awaited|not allotted|tbd|na|-|nil|pending)$/i.test(seat.trim())) {
        return `For your ${matchedExam.courseCode} ${title} examination on ${matchedExam.examDate} ${timeStr} ${roomStr}, your allocated seat is ${seat}.`;
      } else {
        return `For your ${matchedExam.courseCode} ${title} examination scheduled on ${matchedExam.examDate} ${timeStr} ${roomStr}, your specific seat allotment is currently awaited on UMS and will be published closer to the exam time.`;
      }
    }

    return `Your ${matchedExam.courseCode} ${title} examination is scheduled on ${matchedExam.examDate} ${timeStr} ${roomStr}.`;
  }

  // 3. Fallback: General upcoming date sheet summary
  const isExamRelated =
    isSeatQuery ||
    query.includes('exam') ||
    query.includes('datesheet') ||
    query.includes('date sheet') ||
    query.includes('schedule') ||
    context?.capability === 'examination' ||
    context?.capability === 'seating_plan' ||
    fullMessageText.includes('### 📅 Verified Examination Date Sheet') ||
    fullMessageText.includes('### 🪑 Examination Venue & Seating Details');

  if (!isExamRelated) {
    return null;
  }

  const nextExam = exams[0];
  const nextTitle = cleanSpokenTitle(nextExam.courseName) || nextExam.courseCode;
  const roomStr = nextExam.room && nextExam.room !== 'Awaited' ? ` in Room ${nextExam.room}` : '';
  const seatStr = nextExam.seat && !/^(awaited|not allotted|tbd|na|-|nil|pending)$/i.test(nextExam.seat.trim()) ? `, seat number ${nextExam.seat}` : '';

  if (isSeatQuery) {
    return `Your seat allotment for upcoming examinations is currently awaited on UMS and will be updated as exam dates approach. Your next exam is ${nextTitle} on ${nextExam.examDate} at ${nextExam.startTime}${roomStr}.`;
  }

  return `Your next scheduled examination is ${nextTitle} on ${nextExam.examDate} at ${nextExam.startTime}${roomStr}${seatStr}. In total, you have ${totalExams} upcoming exams in your verified UMS date sheet.`;
}

/**
 * Generates an elaborated voice summary for registered courses & faculty directory queries.
 */
function summarizeCoursesAndFaculty(
  fullMessageText: string,
  context?: VoiceSummaryContext
): string | null {
  const query = (context?.query || '').toLowerCase();
  const tt = context?.timetable;
  const courses = tt?.courses || [];

  const courseMatch = query.match(/\b([A-Za-z]{2,5}\s*\d{3,4})\b/i);
  const targetCode = courseMatch ? courseMatch[1].replace(/\s+/g, '').toUpperCase() : null;

  // Specific course faculty inquiry
  if (targetCode && (query.includes('faculty') || query.includes('teacher') || query.includes('cabin') || query.includes('who teaches') || query.includes('professor'))) {
    const matched = courses.find((c) => (c.courseCode || '').toUpperCase() === targetCode);
    if (matched) {
      const facName = matched.facultyName || 'your assigned course faculty';
      const cabin = matched.facultyCabin || matched.cabinNumber;
      const cabinStr = cabin ? `, with cabin location at ${cabin}` : '';
      return `${matched.courseCode} ${cleanSpokenTitle(matched.courseTitle)} is taught by ${facName}${cabinStr}.`;
    }
  }

  // Overall curriculum / courses list
  const totalCourses = tt?.totalCourses || courses.length || (fullMessageText.match(/(\d+)\s+courses/i)?.[1] ? parseInt(fullMessageText.match(/(\d+)\s+courses/i)![1], 10) : 0);
  const totalCredits = tt?.totalCredits || (fullMessageText.match(/(\d+)\s+total\s+credits/i)?.[1] ? parseInt(fullMessageText.match(/(\d+)\s+total\s+credits/i)![1], 10) : 0);

  if (totalCourses > 0) {
    const creditsClause = totalCredits > 0 ? ` totaling ${totalCredits} credits` : '';
    return `You are officially registered in ${totalCourses} courses${creditsClause} for this semester verified from your UMS portal. All faculty details, cabin numbers, and course credits are available in your directory table.`;
  }

  return null;
}

/**
 * Generates an elaborated voice summary for sample question paper queries.
 */
function summarizeSamplePapers(
  fullMessageText: string,
  context?: VoiceSummaryContext
): string | null {
  const queryLower = (context?.query || '').toLowerCase();
  const textLower = fullMessageText.toLowerCase();

  const isSamplePaper =
    queryLower.includes('sample paper') ||
    queryLower.includes('sample question') ||
    queryLower.includes('model paper') ||
    queryLower.includes('previous year paper') ||
    queryLower.includes('question paper') ||
    textLower.includes('official sample question paper') ||
    textLower.includes('sample question papers');

  if (!isSamplePaper) return null;

  // Extract course code if present
  const courseMatch =
    fullMessageText.match(/Official Sample Question Paper:\s*\*\*([A-Za-z0-9]+)\*\*/i) ||
    context?.query?.match(/\b([A-Za-z]{2,5})\s*(\d{3,4}[A-Za-z]?)\b/i);

  let courseCode = '';
  if (courseMatch) {
    let pfx = courseMatch[1].toUpperCase();
    const num = courseMatch[2] ? courseMatch[2].toUpperCase() : '';
    if (pfx === 'CSC') pfx = 'CSE';
    courseCode = num ? `${pfx}${num}` : pfx;
  }

  if (courseCode) {
    return `I found the official sample question paper for ${courseCode} on your UMS examination portal. You can view the question distribution and download the model paper directly by clicking the purple Sample Question Paper button on your exam card.`;
  }

  return `Here are the official sample question papers available on your UMS examination portal. You can view or download the model question paper for any scheduled course directly from your exam cards.`;
}

/**
 * Cleans arbitrary assistant markdown into a single coherent paragraph for voice.
 */
function cleanAssistantMarkdownToParagraph(markdown: string): string {
  if (!markdown) return '';

  const lower = markdown.toLowerCase();
  if (
    lower.includes("i am onee") ||
    lower.includes("i'm onee") ||
    lower.includes("i’m onee") ||
    lower.includes("intelligent ai academic companion") ||
    lower.includes("intelligent ai companion") ||
    lower.includes("lpu ai academic companion") ||
    lower.includes("ask onee")
  ) {
    return "Hey, I'm ONEE, your LPU AI academic companion! I can help you with your class timetable, attendance and safe bunks, exam date sheet, seating plan, sample question papers, and faculty cabins. What would you like to check today?";
  }

  const cleaned = markdown
    .replace(/^#+\s.*$/gm, '') // Remove header lines
    .replace(/^\s*\|.*\|.*$\n?/gm, '') // Remove entire markdown table rows
    .replace(/\|[^\n|]+\|/g, ' ') // Remove remaining pipe table fragments
    .replace(/[-•*]\s+/g, '') // Remove bullet points
    .replace(/>\s*[💡ℹ️⚠️]?\s*(?:Directory|Schedule|Note|Exam)?\s*Note:.*$/gim, '') // Remove note footers
    .replace(/>\s*/g, '') // Remove blockquotes
    .replace(/[*_`~]/g, '') // Remove bold, italic, code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert links
    .replace(/:\s*(\.|\s|$)/g, '. ') // Normalize sentence-ending colons into periods
    .replace(/\s+/g, ' ') // Collapse whitespace
    .trim();

  // Extract first 2-3 sentences
  const sentences = cleaned.match(/[^.!?]+[.!?]+/g) || [cleaned];
  const summarySentences = sentences
    .map((s) => s.trim())
    .filter((s) => s.length > 10 && !s.toLowerCase().includes('http') && !s.toLowerCase().startsWith('directory note'))
    .slice(0, 3);

  const result = summarySentences.join(' ') || cleaned;
  const formatted = result.endsWith('.') || result.endsWith('!') || result.endsWith('?') ? result : `${result}.`;
  return transformSpeechIdentity(formatted);
}

/**
 * Main Entry Point: Produces a single, complete, elaborated spoken voice summary.
 */
export function generateElaboratedVoiceSummary(
  fullMessageText: string,
  context?: VoiceSummaryContext
): string {
  if (!fullMessageText || !fullMessageText.trim()) return '';

  const cap = (context?.capability || '').toLowerCase();
  const query = (context?.query || '').toLowerCase().trim();

  // Priority 0: Identity & Greetings Firewall
  // Ensures queries like "who are you?", "hello", "what can you do?" never get hijacked
  // by cached academic context (e.g. previous seating plan/date sheet results) or markdown bullet points.
  const isIdentity =
    cap === 'onee_identity' ||
    /\b(?:who\s+(?:are\s+you|is\s+this|am\s+i\s+(?:talking|speaking)\s+to|r\s+u)|what(?:\s*'?s|\s+is)\s+your\s+name|introduce\s+yourself|tell\s+me\s+about\s+yourself|what\s+can\s+you\s+do|what\s+are\s+you)\b/i.test(query);

  const isGreeting =
    cap === 'conversation' ||
    /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|yo|howdy|hey\s+onee|hi\s+onee|hello\s+onee)[\s!.,?]*$/i.test(query);

  if (isIdentity) {
    return "Glad you asked! Hey, I'm ONEE, your LPU AI academic companion! I can help you with your class timetable, attendance and safe bunks, exam date sheet, seating plan, sample question papers, and faculty cabins. What would you like to check today?";
  }

  // If conversational or pure greeting, convert assistant message into clean spoken text directly
  // so academic feature lists never trigger domain-specific summaries
  if (cap === 'conversation' || isGreeting) {
    const cleanedPara = cleanAssistantMarkdownToParagraph(fullMessageText);
    if (cleanedPara) return transformSpeechIdentity(cleanedPara);
    return "Hey! I'm ONEE, your LPU AI academic companion. What would you like to check today? I can help you with your classes, attendance, or upcoming exams.";
  }

  /*
   * Spoken answers follow: short natural greeting -> direct answer -> concise
   * conclusion. A summary that already opens naturally is never double-greeted.
   */
  const opened = (text: string): string => {
    const trimmed = (text || '').trim();
    if (!trimmed) return trimmed;
    if (/^(hey|hi|hello|sure|got it|alright|here you go|glad you asked|of course)\b/i.test(trimmed)) {
      return trimmed;
    }
    return `${spokenOpener(query)} ${trimmed}`;
  };

  // 1. Sample Papers domain (Checked before timetable so "sample paper for CSC 408 subject" is never hijacked)
  if (
    cap === 'sample_paper' ||
    cap === 'sample_papers' ||
    query.includes('sample paper') ||
    query.includes('sample question') ||
    query.includes('model paper') ||
    query.includes('question paper') ||
    fullMessageText.includes('Official Sample Question Paper') ||
    fullMessageText.includes('Official Sample Question Papers')
  ) {
    const summary = summarizeSamplePapers(fullMessageText, context);
    if (summary) return opened(transformSpeechIdentity(summary));
  }

  // 2. Specific course faculty or curriculum directory domain
  if (
    query.includes('faculty') ||
    query.includes('teacher') ||
    query.includes('cabin') ||
    query.includes('courses') ||
    query.includes('curriculum') ||
    fullMessageText.includes('Registered Courses & Faculty Directory') ||
    fullMessageText.includes('Course Faculty:')
  ) {
    const summary = summarizeCoursesAndFaculty(fullMessageText, context);
    if (summary) return opened(transformSpeechIdentity(summary));
  }

  // 3. Attendance domain. It must take precedence over timetable because a
  // question such as "how many classes can I bank in CSE472" contains the word
  // "classes" but is an attendance calculation, not a schedule request.
  if (
    cap === 'attendance' ||
    query.includes('attendance') ||
    query.includes('bunk') ||
    query.includes('skip') ||
    query.includes('bank') ||
    query.includes('maintain') ||
    fullMessageText.includes('### 📊 Attendance Breakdown') ||
    fullMessageText.includes('### ⚠️ Academic Priority Assessment') ||
    fullMessageText.includes('Strategic Attendance Maintenance Plan')
  ) {
    const summary = summarizeAttendance(fullMessageText, context);
    if (summary) return opened(transformSpeechIdentity(summary));
  }

  // 4. Timetable domain
  if (
    cap === 'timetable' ||
    query.includes('timetable') ||
    query.includes('time table') ||
    query.includes('class') ||
    query.includes('lecture') ||
    query.includes('schedule') ||
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].some((d) => query.includes(d)) ||
    fullMessageText.includes('### 📅 Verified Schedule') ||
    fullMessageText.includes('### 📅 Complete Weekly Class Schedule Matrix')
  ) {
    const summary = summarizeTimetable(fullMessageText, context);
    if (summary) return opened(transformSpeechIdentity(summary));
  }

  // 5. Examination & Seating Plan domain
  if (
    cap === 'examination' ||
    cap === 'seating_plan' ||
    query.includes('exam') ||
    query.includes('seat') ||
    query.includes('seating') ||
    query.includes('date sheet') ||
    query.includes('datesheet') ||
    fullMessageText.includes('### 📅 Verified Examination Date Sheet') ||
    fullMessageText.includes('### 🪑 Examination Venue & Seating Details')
  ) {
    const summary = summarizeExamination(fullMessageText, context);
    if (summary) return opened(transformSpeechIdentity(summary));
  }

  // 6. Default: convert markdown response into a clean, smooth, spoken paragraph
  return opened(transformSpeechIdentity(cleanAssistantMarkdownToParagraph(fullMessageText)));
}
