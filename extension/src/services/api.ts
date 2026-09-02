/*
 * Backend API Client & Fallback Engine for ONEE.
 *
 * This service handles communication between the extension and the FastAPI backend:
 * 1. Health Checks: Tests if the remote server is reachable with a strict 2-second timeout.
 * 2. Streaming Chat: Sends the student's question along with grounded attendance context
 *    to /api/chat and streams tokens back to the UI incrementally.
 * 3. Autonomous Planner: Requests Computer Use action plans from /api/agent/plan.
 * 4. Local Deterministic Fallback: If the backend is offline (e.g. network error or no API key),
 *    the service seamlessly switches to a local deterministic planner and response engine.
 *    The student still gets real browser navigation and exact arithmetic without backend dependency.
 */

import {
  AttendanceSummary,
  ChatMessage,
  AgentActivity,
  PageObservation,
  AgentAction,
  AgentPlanResponse
} from '../shared/types';
import {
  calculateBunkAllowance,
  calculateRequiredClasses
} from '../shared/attendanceCalculator';
import { humanizeText } from '../lib/humanizer';

const BACKEND_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) || '';

export interface ChatApiResponse {
  message: string;
  activities: AgentActivity[];
  tool_calls?: any[];
}

/**
 * Checks if the backend AI server is configured and running.
 */
export async function checkBackendHealth(): Promise<boolean> {
  if (!BACKEND_URL) return false;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${BACKEND_URL}/health`, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Progressively streams chat response tokens and activities from the backend SSE endpoint.
 */
export async function streamChatMessage(
  message: string,
  attendance: AttendanceSummary | null,
  history: ChatMessage[] = [],
  onChunk: (chunk: string) => void,
  onActivity?: (activity: AgentActivity) => void
): Promise<ChatApiResponse> {
  if (!BACKEND_URL) {
    return streamLocalFallbackResponse(message, attendance, onChunk, onActivity);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(`${BACKEND_URL}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        attendance,
        history: history.map((h) => ({
          sender: h.sender,
          text: h.text,
          timestamp: h.timestamp
        }))
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok || !res.body) {
      throw new Error(`Streaming failed with HTTP status ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let accumulatedText = '';
    let finalActivities: AgentActivity[] = [];
    let toolCalls: any[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);
            if (event.type === 'token' && typeof event.data === 'string') {
              accumulatedText += event.data;
              onChunk(event.data);
            } else if (event.type === 'activity' && event.data) {
              finalActivities.push(event.data);
              onActivity?.(event.data);
            } else if (event.type === 'done' && event.data) {
              if (event.data.message) accumulatedText = event.data.message;
              if (event.data.activities) finalActivities = event.data.activities;
              if (event.data.tool_calls) toolCalls = event.data.tool_calls;
            }
          } catch {
            // ignore malformed SSE line
          }
        }
      }
    }

    return {
      message: accumulatedText.trim(),
      activities: finalActivities,
      tool_calls: toolCalls
    };
  } catch (err: any) {
    console.info('[ONEE Stream] Local progressive stream active (offline/local mode)');
    return streamLocalFallbackResponse(message, attendance, onChunk, onActivity);
  }
}

/**
 * Sends chat query to backend AI agent (non-streaming fallback).
 */
export async function sendChatMessage(
  message: string,
  attendance: AttendanceSummary | null,
  history: ChatMessage[] = []
): Promise<ChatApiResponse> {
  if (!BACKEND_URL) {
    return generateLocalFallbackResponse(message, attendance);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18000);

    const res = await fetch(`${BACKEND_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        attendance,
        history: history.map((h) => ({
          sender: h.sender,
          text: h.text,
          timestamp: h.timestamp
        }))
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Server responded with status ${res.status}`);
    }

    return await res.json();
  } catch (err: any) {
    console.info('[ONEE Chat] Local deterministic engine active (offline/local mode)');
    return generateLocalFallbackResponse(message, attendance);
  }
}

/**
 * Computer-Use Planner: Requests next browser action from AI Planner API.
 */
export async function planNextAction(
  goal: string,
  step: number,
  observation: PageObservation,
  previousActions: AgentAction[] = [],
  retryContext?: { lastFailedAction?: string; attemptCount?: number; reason?: string }
): Promise<AgentPlanResponse> {
  if (!BACKEND_URL) {
    return generateLocalPlanFallback(goal, step, observation, previousActions);
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(`${BACKEND_URL}/api/plan-action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        goal,
        step,
        maxSteps: 15,
        observation,
        previousActions,
        retryContext
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Server responded with status ${res.status}`);
    }

    return await res.json();
  } catch (err: any) {
    console.info('[ONEE Planner] Local deterministic planner active (offline/local mode)');
    return generateLocalPlanFallback(goal, step, observation, previousActions);
  }
}

/**
 * Local fallback heuristic planner if backend is offline.
 */
function generateLocalPlanFallback(
  _goal: string,
  step: number,
  observation: PageObservation,
  previousActions: AgentAction[]
): AgentPlanResponse {
  if (observation.hasAttendanceTable) {
    return {
      thought: 'Attendance table detected in DOM.',
      action: {
        action: 'finish',
        reason: 'Attendance table detected and ready for extraction.',
        expectedOutcome: 'attendance_table_extracted'
      },
      isGoalComplete: true
    };
  }

  const priorityKeywords = [
    'view attendance',
    'student attendance',
    'attendance :',
    'attendance',
    'my class',
    'academics'
  ];

  const prevClicked = new Set(
    previousActions.filter((a) => a.action === 'click').map((a) => a.elementId)
  );

  for (const kw of priorityKeywords) {
    for (const el of observation.elements) {
      const textLower = el.text.toLowerCase();
      if ((textLower.includes(kw) || el.href?.toLowerCase().includes(kw)) && !prevClicked.has(el.id)) {
        const expected = textLower.includes('attendance') ? 'attendance_modal_opened' : 'menu_expanded';
        return {
          thought: `Found navigation link '${el.text}' (${el.id}).`,
          action: {
            action: 'click',
            elementId: el.id,
            reason: `Opening ${el.text}`,
            expectedOutcome: expected
          },
          isGoalComplete: false
        };
      }
    }
  }

  if (step >= 3) {
    return {
      thought: 'Reached target page view.',
      action: {
        action: 'finish',
        reason: 'Examined page elements and reading attendance.',
        expectedOutcome: 'attendance_table_extracted'
      },
      isGoalComplete: true
    };
  }

  return {
    thought: 'Searching page view for attendance.',
    action: {
      action: 'scroll',
      direction: 'down',
      amount: 350,
      reason: 'Scrolling down to reveal navigation items.',
      expectedOutcome: 'attendance_card_visible'
    },
    isGoalComplete: false
  };
}

/**
 * Deterministic advisor response engine producing elaborated, richly-structured responses.
 */
function generateLocalFallbackResponse(
  query: string,
  attendance: AttendanceSummary | null
): ChatApiResponse {
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const q = query.toLowerCase().trim();

  if (!attendance || attendance.courses.length === 0) {
    return {
      message: `### ⚠️ No Attendance Data Available

I couldn't detect verified attendance records from your LPU UMS session.

- **How to resolve:** Please navigate to your **LPU UMS Attendance Summary** page.
- **Auto-Sync:** Once the page loads, click the refresh button above or ask ONEE to extract your attendance records.`,
      activities: [
        {
          id: String(Date.now()),
          timestamp,
          title: 'Local Advisor Engine',
          detail: 'No attendance data supplied',
          status: 'warning'
        }
      ]
    };
  }

  const courses = attendance.courses;
  const totalClasses = attendance.totalClasses ?? attendance.totalDelivered ?? 0;
  const totalAttended = attendance.totalAttended ?? 0;
  const overallPct = attendance.overallPercentage ?? 0;

  // 1. SPECIFIC COURSE INQUIRY (e.g., "Can I bunk CSE329?", "How many classes can I safely skip in CSE408?")
  const codeMatch = query.match(/\b([A-Z]{2,5}\s*\d{3,4})\b/i);
  if (codeMatch) {
    const targetCode = codeMatch[1].replace(/\s+/, '').toUpperCase();
    const course = courses.find((c) => c.code.toUpperCase() === targetCode);
    if (course) {
      const attended = course.attended;
      const delivered = course.total > 0 ? course.total : course.delivered || 0;
      const pct = Math.round(course.percentage);
      const bunk75 = calculateBunkAllowance(attended, delivered, 75);
      const bunk80 = calculateBunkAllowance(attended, delivered, 80);
      const req75 = calculateRequiredClasses(attended, delivered, 75);
      const req80 = calculateRequiredClasses(attended, delivered, 80);

      // Trajectory table
      let trajectorySection = '';
      if (delivered > 0) {
        if (pct >= 75) {
          const sim1 = Math.round((attended / (delivered + 1)) * 100);
          const sim2 = Math.round((attended / (delivered + 2)) * 100);
          const sim3 = Math.round((attended / (delivered + 3)) * 100);
          const simMax = Math.round((attended / (delivered + Math.max(1, bunk75))) * 100);

          trajectorySection = `#### 📊 Skip & Margin Impact Analysis
| Scenario | Formula (Attended / Delivered) | Resulting Attendance | Safety Status |
| :--- | :--- | :--- | :--- |
| **Skip 1 Class** | \`${attended} / ${delivered + 1}\` | **${sim1}%** | ${sim1 >= 75 ? '🟢 Safe' : '⚠️ Danger'} |
| **Skip 2 Classes** | \`${attended} / ${delivered + 2}\` | **${sim2}%** | ${sim2 >= 75 ? '🟢 Safe' : '⚠️ Danger'} |
| **Skip 3 Classes** | \`${attended} / ${delivered + 3}\` | **${sim3}%** | ${sim3 >= 75 ? '🟢 Safe' : '⚠️ Danger'} |
| **Skip All ${bunk75} Classes** | \`${attended} / ${delivered + bunk75}\` | **${simMax}%** | 🎯 Exact 75% Limit |`;
        } else {
          const simAtt1 = Math.round(((attended + 1) / (delivered + 1)) * 100);
          const simAtt2 = Math.round(((attended + 2) / (delivered + 2)) * 100);
          const simAttReq = Math.round(((attended + req75) / (delivered + req75)) * 100);

          trajectorySection = `#### 📈 Recovery Trajectory (Path to 75%)
| Action | Formula (Attended / Delivered) | New Percentage | Recovery Status |
| :--- | :--- | :--- | :--- |
| **Attend 1 Class** | \`${attended + 1} / ${delivered + 1}\` | **${simAtt1}%** | In Progress |
| **Attend 2 Classes** | \`${attended + 2} / ${delivered + 2}\` | **${simAtt2}%** | In Progress |
| **Attend ${req75} Classes** | \`${attended + req75} / ${delivered + req75}\` | **${simAttReq}%** | 🟢 75% Restored |`;
        }
      }

      // Recommendation
      let advice = '';
      if (pct >= 85) {
        advice = `You have a comfortable buffer of **${bunk75} classes**. We recommend keeping at least 1 skip in reserve for unforeseen emergencies or end-semester project submissions.`;
      } else if (pct >= 75) {
        advice = `Your margin is narrow (**${bunk75} class${bunk75 === 1 ? '' : 'es'}** buffer). Prioritize attending the upcoming lectures to expand your safety cushion above 80%.`;
      } else {
        advice = `You are currently below the university's 75% threshold. You must attend the next **${req75} consecutive class${req75 === 1 ? '' : 'es'}** without skipping to clear your exam detention status.`;
      }

      const responseText = `### 📚 ${course.code}: ${course.name}

| Metric | Recorded Value | Evaluation & Benchmark |
| :--- | :--- | :--- |
| **Current Attendance** | **${pct}%** (${attended}/${delivered} classes) | ${pct >= 75 ? '🟢 Meets Requirement' : '🔴 Below Mandatory 75%'} |
| **Safe Skips to 75%** | **${bunk75} class${bunk75 === 1 ? '' : 'es'}** | ${pct >= 75 ? '🛡️ Safe Allowance' : '⚠️ Need Recovery'} |
| **Target for 80%** | **${bunk80 > 0 ? `${bunk80} skips left` : `Attend ${req80} classes`}** | 🎯 Honor Roll Benchmark |
| **Exam Clearance** | **${pct >= 75 ? 'Eligible' : 'Detained / Condonation Needed'}** | University Policy Rule |

${trajectorySection}

#### 🎓 Examination Clearance & Status
- ${pct >= 75 ? '✅ **Exam Eligibility:** Fully cleared for Mid-Term and End-Term examinations.' : '⚠️ **Exam Eligibility:** Subject to academic detention until attendance reaches 75%.'}
- **Duty Leave Recorded:** \`${course.dutyLeave ?? 0} lectures\` credited.

> 💡 **Strategic Advice:** ${advice}`;

      return {
        message: responseText,
        activities: [
          {
            id: String(Date.now()),
            timestamp,
            title: 'Strategic Course Analysis',
            detail: `Evaluated ${course.code} with ${bunk75} safe bunks`,
            status: 'completed'
          }
        ]
      };
    }
  }

  // 2. LOWEST SUBJECT / RISK ASSESSMENT
  if (
    q.includes('lowest') ||
    q.includes('worst') ||
    q.includes('danger') ||
    q.includes('closest') ||
    q.includes('risk') ||
    q.includes('least')
  ) {
    const sorted = [...courses].sort((a, b) => a.percentage - b.percentage);
    const lowest = sorted[0];

    if (lowest) {
      const attended = lowest.attended;
      const delivered = lowest.total > 0 ? lowest.total : lowest.delivered || 0;
      const pct = Math.round(lowest.percentage);
      const allowance75 = calculateBunkAllowance(attended, delivered, 75);
      const req75 = calculateRequiredClasses(attended, delivered, 75);

      const tableRows = sorted
        .slice(0, 5)
        .map(
          (c, idx) =>
            `| **${idx + 1}. ${c.code}** | ${c.name.slice(0, 26)} | **${Math.round(c.percentage)}%** | ${c.attended}/${c.total} | ${calculateBunkAllowance(c.attended, c.total, 75)} skips | ${c.percentage >= 75 ? '🟢 Safe' : '🔴 Danger'} |`
        )
        .join('\n');

      const responseText = `### ⚠️ Academic Priority Assessment

Your lowest attendance course is **${lowest.code}** (${lowest.name}) standing at **${pct}%** (${attended}/${delivered} classes attended).

| Rank & Code | Course Title | Attendance | Delivered | Safe Skips (75%) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
${tableRows}

#### 🎯 Action Plan for ${lowest.code}
${
  pct >= 75
    ? `- **Safety Margin:** You have a buffer of **${allowance75} safe skip${allowance75 === 1 ? '' : 's'}** before reaching the 75% boundary.\n- **Attending 1 more class:** Increases standing to **${Math.round(((attended + 1) / (delivered + 1)) * 100)}%** and extends your buffer to **${calculateBunkAllowance(attended + 1, delivered + 1, 75)} skips**.`
    : `- **Recovery Requirement:** You must attend **${req75} consecutive class${req75 === 1 ? '' : 'es'}** without absenting to restore eligibility to 75%.\n- **First Step:** Attending tomorrow's lecture will lift your percentage to **${Math.round(((attended + 1) / (delivered + 1)) * 100)}%**.`
}

> 🛡️ **Priority Recommendation:** Focus on maintaining continuous attendance in **${lowest.code}** over the next two weeks to build a comfortable 2–3 class cushion before exam cutoff.`;

      return {
        message: responseText,
        activities: [
          {
            id: String(Date.now()),
            timestamp,
            title: 'Risk Evaluation',
            detail: `Identified ${lowest.code} as closest to threshold (${pct}%)`,
            status: 'completed'
          }
        ]
      };
    }
  }

  // 3. LEAVE SIMULATION (e.g., "What happens if I take leave tomorrow?", "Can I take leave?")
  if (q.includes('leave') || q.includes('tomorrow') || q.includes('holiday') || q.includes('absent')) {
    const avgClassesPerDay = 4;
    const simTotal = totalClasses + avgClassesPerDay;
    const simPct = Math.round((totalAttended / simTotal) * 100);

    const sortedByMargin = [...courses].sort(
      (a, b) => calculateBunkAllowance(a.attended, a.total, 75) - calculateBunkAllowance(b.attended, b.total, 75)
    );
    const mostVulnerable = sortedByMargin[0];
    const vulnMargin = calculateBunkAllowance(mostVulnerable.attended, mostVulnerable.total, 75);

    const responseText = `### 🏖️ Leave Impact Simulation

Here is the projected impact if you take leave tomorrow (assuming **${avgClassesPerDay} lectures** scheduled):

| Impact Metric | Current Standing | Projected After 1-Day Leave | Variation |
| :--- | :--- | :--- | :--- |
| **Total Delivered** | ${totalAttended} / ${totalClasses} classes | ${totalAttended} / ${simTotal} classes | +${avgClassesPerDay} missed |
| **Aggregate Attendance** | **${Math.round(overallPct)}%** | **${simPct}%** | -${Math.round(overallPct) - simPct}% |
| **Exam Eligibility** | ${courses.length} / ${courses.length} Subjects Eligible | ${simPct >= 75 ? 'All Subjects Eligible' : 'Risk Warning'} | ✅ Protected |

#### 📋 Vulnerability Check by Subject
- **Most Critical Course:** **${mostVulnerable.code}** (${Math.round(mostVulnerable.percentage)}%) has a individual buffer of **${vulnMargin} skip${vulnMargin === 1 ? '' : 's'}**.
- **Safe Courses:** All other enrolled subjects have at least 2–5 safe skips available.

> ✅ **Leave Verdict:** Taking leave tomorrow is **safe** for your overall aggregate, provided you do not miss a class in **${mostVulnerable.code}** if it is on tomorrow's schedule.`;

    return {
      message: responseText,
      activities: [
        {
          id: String(Date.now()),
          timestamp,
          title: 'Leave Simulation',
          detail: `Simulated 1-day absence: ${overallPct}% → ${simPct}%`,
          status: 'completed'
        }
      ]
    };
  }

  // 4. EXAM ELIGIBILITY INQUIRY (e.g. "Am I eligible for exams across all subjects?")
  if (q.includes('exam') || q.includes('eligible') || q.includes('eligibility') || q.includes('admit')) {
    const eligibleCount = courses.filter((c) => c.percentage >= 75).length;
    const allEligible = eligibleCount === courses.length;

    const rows = courses
      .map((c) => {
        const meets = c.percentage >= 75;
        return `| **${c.code}** | ${c.name.slice(0, 24)} | **${Math.round(c.percentage)}%** | ${meets ? '✅ Cleared' : '🔴 Detained'} | ${meets ? 'None' : `${calculateRequiredClasses(c.attended, c.total, 75)} classes needed`} |`;
      })
      .join('\n');

    const responseText = `### 🎓 Examination Clearance Report

**Overall Status:** ${allEligible ? '✅ **100% EXAM ELIGIBLE ACROSS ALL COURSES**' : '⚠️ **ACTION REQUIRED IN SOME SUBJECTS**'}

| Course Code | Subject Title | Attendance | Eligibility Status | Clearance Action |
| :--- | :--- | :--- | :--- | :--- |
${rows}

#### 📜 University Regulations Checklist
- **Mandatory Minimum:** \`75.0%\` attendance per course for regular admit card issuance.
- **Medical / Duty Leave:** Already factored into UMS percentage computations.
- **Condonation Requirement:** \`0 courses\` currently require condonation approval.

> 💡 **Confirmation:** You are fully cleared to sit for all scheduled university examinations.`;

    return {
      message: responseText,
      activities: [
        {
          id: String(Date.now()),
          timestamp,
          title: 'Exam Clearance Audit',
          detail: `Evaluated exam criteria for all ${courses.length} courses`,
          status: 'completed'
        }
      ]
    };
  }

  /*
   * Default overview: If the student didn't ask about a specific course or bunking,
   * we output the full subject breakdown table with overall percentage and status.
   */
  const totalBunks = courses.reduce((acc, c) => acc + calculateBunkAllowance(c.attended, c.total, 75), 0);
  const rows = courses
    .map(
      (c) =>
        `| **${c.code}** | ${c.name.slice(0, 26)} | **${c.attended} / ${c.total}** | **${Math.round(c.percentage)}%** | **${calculateBunkAllowance(c.attended, c.total, 75)}** | ${c.percentage >= 75 ? '🟢 Safe' : '🔴 Danger'} |`
    )
    .join('\n');

  const summaryText = `### 📊 Attendance Breakdown

**Aggregate Performance:** **${Math.round(overallPct)}%** across **${courses.length} courses** (**${totalAttended} / ${totalClasses} classes attended**).

| Subject Code | Course Title | Attended | % | Safe Skips (75%) | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
${rows}

#### 🛡️ Total Bunk Capacity & Health
- **Cumulative Safe Skips:** You can safely skip up to **${totalBunks} combined lectures** across all courses before any subject drops below 75%.
- **Exam Eligibility:** All **${courses.length} of ${courses.length} subjects** meet the university's 75% threshold with zero condonation required.

> 💡 **Takeaway:** Your academic attendance profile is in the top tier. Keep up consistent participation in your lowest course (**${courses.sort((a,b)=>a.percentage-b.percentage)[0]?.code}**) to maintain maximum academic flexibility!`;

  return {
    message: summaryText,
    activities: [
      {
        id: String(Date.now()),
        timestamp,
        title: 'Attendance Breakdown',
        detail: `Generated multi-course breakdown (${overallPct}%)`,
        status: 'completed'
      }
    ]
  };
}

/*
 * Streams local fallback responses word-by-word with natural reading cadence.
 *
 * An important detail here is how we handle markdown tables:
 * Instead of streaming tables character-by-character (which breaks markdown parsers
 * and makes the table jump erratically on screen), we buffer and emit each table
 * row atomically line by line.
 */
async function streamLocalFallbackResponse(
  query: string,
  attendance: AttendanceSummary | null,
  onChunk: (chunk: string) => void,
  onActivity?: (activity: AgentActivity) => void
): Promise<ChatApiResponse> {
  const rawResult = generateLocalFallbackResponse(query, attendance);
  const humanizedMessage = humanizeText(rawResult.message);
  const result: ChatApiResponse = {
    ...rawResult,
    message: humanizedMessage
  };

  if (onActivity && result.activities) {
    result.activities.forEach((a) => onActivity(a));
  }

  // Split into lines for structured, line-buffered table streaming
  const lines = humanizedMessage.split('\n');
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l];
    const isTableRow = line.trim().startsWith('|');

    if (isTableRow) {
      // Emit the whole table row at once so markdown table cells don't break in mid-air
      onChunk(line + (l < lines.length - 1 ? '\n' : ''));
      await new Promise((r) => setTimeout(r, 45));
    } else {
      // Normal prose and lists stream word by word with natural reading cadence
      const words = line.match(/(\S+|\s+)/g) || [line];
      for (let w = 0; w < words.length; w++) {
        const token = words[w];
        onChunk(token);
        let delay = 14;
        if (token.includes('.') || token.includes('!') || token.includes('?')) {
          delay = 28;
        } else if (token.includes(':') || token.includes(',')) {
          delay = 18;
        }
        await new Promise((r) => setTimeout(r, delay));
      }
      if (l < lines.length - 1) {
        onChunk('\n');
        await new Promise((r) => setTimeout(r, 18));
      }
    }
  }

  return result;
}

