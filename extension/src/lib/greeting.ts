/*
 * Dynamic greeting engine for ONEE.
 *
 * Every greeting the student sees or hears is composed here so the same
 * canned line is never repeated:
 *  - the opener varies by time of day AND rotates per minute (deterministic),
 *  - the reply echoes the student's own words ("Hey Sophia!" -> "Hey!"),
 *  - the tail reflects what is actually verified in this session (aggregate
 *    attendance, next exam) instead of a generic capability dump.
 */

export type SocialKind = 'greeting' | 'identity' | 'thanks';

/** Academic request words — a real request must NEVER be swallowed as a greeting. */
const DOMAIN_RE =
  /\b(class|classes|exam|exams|attendance|bunk|bunks|skip|skips|timetable|time table|schedule|seat|seating|paper|papers|marks|result|results|faculty|cabin|room|lecture|lectures|lab|labs|practical|datesheet|date sheet|percentage|semester|report)\b/;

const IDENTITY_RE =
  /^(who are you|who r u|what are you|what is your name|what'?s your name|what can you do|introduce yourself|tell me about yourself|about yourself|your capabilities)/;

/**
 * Classifies greeting / identity / thanks in any natural form — tolerant of
 * names ("hey sophia"), punctuation, and filler — while refusing anything
 * that contains a genuine academic request.
 */
export function classifySocial(text: string): SocialKind | null {
  const norm = text
    .toLowerCase()
    // Drop apostrophes FIRST so "what's your name" -> "whats your name" and
    // the identity regex (what'?s) still matches after punctuation stripping.
    .replace(/[''\u2019]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!norm) return null;

  // Identity questions may mention domain words ("what can you do about attendance").
  if (IDENTITY_RE.test(norm)) return 'identity';

  // A real academic request wins over greeting-shaped openers.
  if (DOMAIN_RE.test(norm)) return null;

  const words = norm.split(' ');
  if (words.length <= 4 && /^(thank you|thanks|thankyou|thx|ty|appreciate it)\b/.test(norm)) {
    return 'thanks';
  }
  if (
    words.length <= 7 &&
    /^(hey|hi|hello|yo|yoo|heya|hola|sup|hii|helloo|namaste|gm|gn|good (morning|afternoon|evening|night|day))\b/.test(
      norm
    )
  ) {
    return 'greeting';
  }
  return null;
}

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'lateNight';

export function timeOfDay(hour: number = new Date().getHours()): TimeOfDay {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'lateNight';
}

/** Deterministic per-minute rotation: same request shape, fresh wording. */
function rotate<T>(variants: T[], salt: number = 0): T {
  const now = new Date();
  return variants[(now.getMinutes() + now.getDate() + salt) % variants.length];
}

const SESSION_OPENERS: Record<TimeOfDay, string[]> = {
  morning: [
    "Good morning! I'm Sofia, ready when you are.",
    "Morning! Your classes and attendance are one ask away.",
    "Good morning → I'm here whenever you're set."
  ],
  afternoon: [
    "Hey, good afternoon → I'm Sofia.",
    "Good afternoon! What are we working on today?",
    "Hey there, good afternoon. I'm all yours."
  ],
  evening: [
    "Good evening → I'm Sofia, ready to help.",
    "Hey, good evening. What's on the agenda?",
    "Good evening! Let's get it done."
  ],
  lateNight: [
    "Burning the midnight oil? I'm Sofia → I'm right here.",
    "Up late studying? I've got your schedule and deadlines.",
    "Late night grind → I'm with you. What do you need?"
  ]
};

/** Voice session opener (spoken once per sidepanel session). */
export function sessionGreetingLine(): string {
  return rotate(SESSION_OPENERS[timeOfDay()]);
}

export interface GreetingContext {
  hasAttendance?: boolean;
  aggregateAttendance?: number | null;
  subjectCount?: number;
  nextExam?: { courseCode: string; examDate: string } | null;
  studentName?: string | null;
}

const CLOSERS = [
  'What would you like to check first?',
  "Where should we start?",
  "What's on your mind?",
  'Ask me anything about your semester.'
];

/**
 * Composes the canonical chat greeting + its spoken twin for the resolved
 * social intent (greeting / identity / thanks).
 */
export function buildChatGreeting(
  kind: SocialKind,
  ctx: GreetingContext = {}
): { chatMsg: string; spoken: string } {
  const tod = timeOfDay();
  const openers: Record<TimeOfDay, string[]> = {
    morning: ['Good morning!', 'Morning!'],
    afternoon: ['Good afternoon!', 'Hey, good afternoon!'],
    evening: ['Good evening!', 'Hey, good evening!'],
    lateNight: ['You are up late!', 'Burning the midnight oil?']
  };
  const opener = rotate(openers[tod]);
  const closer = rotate(CLOSERS, kind === 'identity' ? 3 : 0);
  const namePart = ctx.studentName ? `, ${ctx.studentName.split(' ')[0]}` : '';

  // Live, session-verified context — different every time their data changes.
  const contextLines: string[] = [];
  if (ctx.hasAttendance && typeof ctx.aggregateAttendance === 'number') {
    contextLines.push(
      `- 📊 **Right now:** Your aggregate attendance is **${Math.round(ctx.aggregateAttendance)}%**${
        ctx.subjectCount ? ` across **${ctx.subjectCount} subjects**` : ''
      } → ask for your safe-bunk plan.`
    );
  }
  if (ctx.nextExam?.courseCode) {
    contextLines.push(
      `- 📝 **Next up:** **${ctx.nextExam.courseCode}** on **${ctx.nextExam.examDate}** → ask me for reporting time and seat.`
    );
  }
  const contextBlock = contextLines.length > 0 ? `${contextLines.join('\n')}\n\n` : '';

  const intro =
    kind === 'identity'
      ? "I'm **ONEE** → your LPU AI academic companion, connected to your UMS portal."
      : "I'm **ONEE**, your LPU academic companion → connected to your UMS portal.";

  const chatMsg =
    `### 👋 ${opener}${namePart}\n\n` +
    `${intro}\n\n` +
    (kind === 'thanks'
      ? `Always happy to help. ${closer}\n\n`
      : contextBlock) +
    (kind === 'identity'
      ? `#### 🌟 What I can do for you\n` +
        `1. 📅 **Class Timetable:** Schedules, rooms, and blocks.\n` +
        `2. 📊 **Attendance & Safe Bunks:** Percentages and safe skips.\n` +
        `3. 📝 **Exam Date Sheet:** Dates, timings, and reporting times.\n` +
        `4. 🪑 **Seating Plan:** Halls, rooms, and seats.\n` +
        `5. 📄 **Sample Papers:** Official papers, downloaded for you.\n` +
        `6. 👨‍🏫 **Faculty Directory:** Teachers and cabin details.\n\n` +
        `*${closer}*`
      : `#### 🌟 Ready when you are\n` +
        `1. 📅 **Classes today** → times, rooms, and blocks.\n` +
        `2. 📊 **Attendance & safe bunks** → stay above 75% with a plan.\n` +
        `3. 📝 **Exams** → datesheets, seats, and reporting times.\n` +
        `4. 📄 **Sample papers & faculty cabins** → fetched on request.\n\n` +
        `*${closer}*`);

  const spokenCtx =
    ctx.hasAttendance && typeof ctx.aggregateAttendance === 'number'
      ? ` Your aggregate attendance is ${Math.round(ctx.aggregateAttendance)} percent${
          ctx.subjectCount ? ` across ${ctx.subjectCount} subjects` : ''
        }.`
      : '';
  const spokenExam = ctx.nextExam?.courseCode
    ? ` Your next exam is ${ctx.nextExam.courseCode} on ${ctx.nextExam.examDate}.`
    : '';
  const spoken =
    kind === 'thanks'
      ? `You're welcome${namePart}! ${closer}`
      : `${opener}${namePart ? ' ' + namePart.trim() : ''} I'm Sofia, your LPU academic companion.` +
        `${spokenCtx}${spokenExam} ${closer}`;

  return { chatMsg, spoken };
}
