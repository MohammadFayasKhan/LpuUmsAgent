/*
 * Dynamic Context-Aware Narration Engine for ONEE.
 *
 * Replaces hardcoded canned templates with dynamic, context-aware spoken narration:
 * 1. Runtime State Provides Facts: Grounded strictly in real DOM/browser execution evidence.
 * 2. ONEE Intelligence Generates Wording: Dynamic wording tailored to the student's exact query.
 * 3. Semantic Deduplication & Throttling: Low-value DOM events (cursor moves, scrolls, mouse hovers)
 *    are discarded. High-level milestones are spoken at most once per execution.
 * 4. Progressive Pipelining: Delivers immediate request-specific acknowledgments, meaningful
 *    progress updates, and authoritative verified final results without blocking browser actions.
 */

import { OneeSemanticState, OneeRuntimeState } from '../lib/runtimeState';
import {
  NarrationContext,
  NarrationResult,
  SpeechPriority,
  NarrationMilestoneType
} from './VoiceTypes';
import { FinalResponseData } from '../shared/types';
import { getBackendUrl } from '../services/api';

export interface RuntimeFacts {
  executionId: string;
  userRequest?: string;
  goal?: string;
  intent?: string;
  phase: string;
  milestone?: string;
  currentAction?: string;
  browserObservation?: string;
  meaningfulChange?: string;
  verifiedFacts?: Record<string, any>;
  taskProgress?: number;
  previousNarration?: string[];
  recentNarrations?: string[];
  elapsedTime?: number;
}

export class DynamicNarrationEngine {
  private spokenSemanticKeys: Set<string> = new Set();
  private acknowledgedExecutions: Set<string> = new Set();
  private previousNarrations: string[] = [];
  private lastSpokenTime: number = 0;
  private currentExecutionId: string | null = null;
  private readonly THROTTLE_MS = 2500;

  /**
   * Evaluates structured runtime facts to determine if and what ONEE should speak.
   */
  public async evaluateFacts(facts: RuntimeFacts): Promise<NarrationResult | null> {
    const context: NarrationContext = {
      executionId: facts.executionId,
      userRequest: facts.userRequest,
      goal: facts.goal,
      intent: facts.intent,
      phase: facts.phase,
      currentAction: facts.currentAction
    };

    const mockRuntimeState: any = {
      agentState: {
        currentGoal: facts.goal || facts.userRequest,
        currentAction: facts.currentAction ? { reason: facts.currentAction } : undefined
      }
    };

    return this.evaluateMilestone(facts.phase as any, mockRuntimeState, context);
  }

  /**
   * Generates an immediate, request-specific acknowledgment based on what the student actually asked.
   * Runs in < 1ms to start speech immediately while browser task and LLM reasoning begin in parallel.
   */
  public generateAcknowledgement(userRequest: string, executionId: string): NarrationResult | null {
    if (!userRequest.trim()) return null;

    if (this.acknowledgedExecutions.has(executionId)) {
      return null;
    }
    this.acknowledgedExecutions.add(executionId);

    const reqLower = userRequest.toLowerCase();

    // Check for goal redirection / adaptation
    if (reqLower.includes('actually') || reqLower.includes('instead') || reqLower.includes('switch to')) {
      if (reqLower.includes('attendance')) {
        return this.createAckResult("Switching over to check your attendance.", executionId);
      }
      if (reqLower.includes('exam') || reqLower.includes('date sheet')) {
        return this.createAckResult("Switching over to check your exams.", executionId);
      }
      if (reqLower.includes('timetable') || reqLower.includes('class')) {
        return this.createAckResult("Switching over to check your timetable.", executionId);
      }
      return this.createAckResult("Switching over to check that now.", executionId);
    }

    // Check for specific course code (e.g. CSE408, MTH166, INT306)
    const courseCodeMatch = userRequest.match(/\b([A-Z]{2,4}\d{3,4})\b/i);
    const courseCode = courseCodeMatch ? courseCodeMatch[1].toUpperCase() : null;

    // Next exam specifically
    if (
      reqLower.includes('next exam') ||
      reqLower.includes('next paper') ||
      reqLower.includes('upcoming exam') ||
      reqLower.includes('first exam')
    ) {
      return this.createAckResult("Checking your next exam now.", executionId);
    }

    // Full date sheet / examination schedule
    if (
      reqLower.includes('full date sheet') ||
      reqLower.includes('full datesheet') ||
      reqLower.includes('all exams') ||
      reqLower.includes('exam schedule') ||
      reqLower.includes('show my date sheet') ||
      reqLower.includes('full examination schedule')
    ) {
      return this.createAckResult("Pulling up your complete examination schedule.", executionId);
    }

    // Course-specific exam query (e.g. "When is CSE408?", "What about CSE408?")
    if (
      courseCode &&
      (reqLower.includes('when') ||
        reqLower.includes('exam') ||
        reqLower.includes('date') ||
        reqLower.includes('what about') ||
        reqLower.includes('how about'))
    ) {
      return this.createAckResult(`Looking up ${courseCode} in your examination records.`, executionId);
    }

    // Seating plan / room / hall / venue
    if (
      reqLower.includes('seat') ||
      reqLower.includes('room') ||
      reqLower.includes('hall') ||
      reqLower.includes('venue') ||
      reqLower.includes('where is my exam')
    ) {
      if (courseCode) {
        return this.createAckResult(`Locating your exam seat and room for ${courseCode}.`, executionId);
      }
      return this.createAckResult("Locating your exam room and seating details.", executionId);
    }

    // Sample question paper
    if (reqLower.includes('sample paper') || reqLower.includes('model paper') || reqLower.includes('previous year')) {
      if (courseCode) {
        return this.createAckResult(`Finding the sample question paper for ${courseCode}.`, executionId);
      }
      return this.createAckResult("Finding the sample question paper for your exam.", executionId);
    }

    // Bunk allowance / safe miss
    if (
      reqLower.includes('bunk') ||
      reqLower.includes('skip') ||
      reqLower.includes('miss class') ||
      reqLower.includes('can i miss')
    ) {
      if (courseCode) {
        return this.createAckResult(`Checking your safe bunk margin for ${courseCode}.`, executionId);
      }
      return this.createAckResult("Checking your attendance buffer.", executionId);
    }

    // Attendance
    if (reqLower.includes('attendance') || reqLower.includes('low attendance') || reqLower.includes('overall attendance')) {
      return this.createAckResult(
        courseCode ? `Checking your attendance for ${courseCode}.` : "Checking your attendance numbers.",
        executionId
      );
    }

    // Timetable / classes today or tomorrow
    if (reqLower.includes('timetable') || reqLower.includes('class') || reqLower.includes('today')) {
      if (reqLower.includes('tomorrow')) {
        return this.createAckResult("Checking tomorrow's class schedule.", executionId);
      }
      return this.createAckResult("Checking today's class schedule.", executionId);
    }

    // Natural default request acknowledgment
    return this.createAckResult("Checking that on UMS now.", executionId);
  }

  private createAckResult(text: string, executionId: string): NarrationResult {
    this.previousNarrations.push(text);
    return {
      text,
      purpose: 'ACKNOWLEDGEMENT',
      executionId,
      priority: 'ACKNOWLEDGEMENT',
      shouldSpeak: true,
      semanticKey: `ACK_${executionId}`
    };
  }

  /**
   * Evaluates runtime state and generates dynamic, context-aware spoken narration
   * for meaningful agent milestones.
   */
  public async evaluateMilestone(
    semanticState: OneeSemanticState,
    runtimeState: OneeRuntimeState,
    context: NarrationContext
  ): Promise<NarrationResult | null> {
    const mode = context.userPreferences?.mode || 'LIVE_AGENT';
    if (mode === 'OFF') return null;

    const executionId = context.executionId || this.currentExecutionId || 'default-exec';
    if (this.currentExecutionId !== executionId) {
      this.resetForNewExecution(executionId);
    }

    // Final result is authoritative and verified
    if (semanticState === 'SUCCESS' && runtimeState.agentState?.finalResponse) {
      const speech = this.formatVerifiedResultSpeech(
        runtimeState.agentState.finalResponse,
        context.userRequest
      );
      this.previousNarrations.push(speech);
      return {
        text: speech,
        purpose: 'FINAL_RESULT',
        executionId,
        priority: 'FINAL_RESULT',
        shouldSpeak: true,
        semanticKey: `FINAL_${executionId}`
      };
    }

    // Filter out low-value events: cursor movement, mouse hover, scroll, DOM mutations, planning thoughts
    const lowValueStates: OneeSemanticState[] = [
      'IDLE',
      'USER_TYPING',
      'THINKING',
      'OBSERVING',
      'MOVING'
    ];
    if (lowValueStates.includes(semanticState)) {
      return null;
    }

    if (semanticState === 'WAITING') {
      // Only narrate waiting if page load is noticeably delayed (> 5s)
      return null;
    }

    const { agentState } = runtimeState;
    const currentActionReason = agentState?.currentAction?.reason || '';
    const actionLower = currentActionReason.toLowerCase();
    const userReqLower = (context.userRequest || agentState?.currentGoal || '').toLowerCase();

    // Determine milestone category and semantic key
    let milestoneType: NarrationMilestoneType = 'MEANINGFUL_PROGRESS';
    let semanticKey = '';

    if (semanticState === 'ERROR') {
      milestoneType = 'BLOCKER';
      semanticKey = `ERROR_${executionId}`;
    } else if (semanticState === 'CANCELLED') {
      milestoneType = 'ADAPTATION';
      semanticKey = `CANCELLED_${executionId}`;
    } else if (semanticState === 'VERIFYING') {
      milestoneType = 'VERIFICATION';
      semanticKey = `VERIFYING_${executionId}`;
    } else if (semanticState === 'EXTRACTING') {
      milestoneType = 'USER_RELEVANT_DISCOVERY';
      semanticKey = `EXTRACTING_${executionId}`;
    } else if (semanticState === 'ACTING') {
      milestoneType = 'MEANINGFUL_PROGRESS';
      if (actionLower.includes('date sheet') || actionLower.includes('datesheet')) {
        semanticKey = `ACT_DATESHEET_${executionId}`;
      } else if (actionLower.includes('seating')) {
        semanticKey = `ACT_SEATING_${executionId}`;
      } else if (actionLower.includes('sample paper')) {
        semanticKey = `ACT_SAMPLE_PAPER_${executionId}`;
      } else if (actionLower.includes('timetable') || actionLower.includes('lms')) {
        semanticKey = `ACT_TIMETABLE_${executionId}`;
      } else if (actionLower.includes('attendance')) {
        semanticKey = `ACT_ATTENDANCE_${executionId}`;
      } else {
        semanticKey = `ACT_${executionId}_${currentActionReason.slice(0, 15)}`;
      }
    } else {
      return null;
    }

    // Semantic Deduplication: do not speak the same milestone twice for this execution
    if (this.spokenSemanticKeys.has(semanticKey)) {
      return null;
    }

    // Semantic Throttling: minimum interval between non-urgent progress updates
    const now = Date.now();
    if (milestoneType !== 'BLOCKER' && milestoneType !== 'ADAPTATION') {
      if (now - this.lastSpokenTime < this.THROTTLE_MS) {
        return null;
      }
    }

    // Attempt Fast LLM Dynamic Narration via backend
    let dynamicWording: string | null = null;
    try {
      dynamicWording = await this.fetchBackendDynamicNarration({
        execution_id: executionId,
        user_request: context.userRequest || agentState?.currentGoal || '',
        current_goal: agentState?.currentGoal || context.userRequest || '',
        phase: semanticState,
        milestone_type: milestoneType,
        current_action: currentActionReason,
        browser_observation: agentState?.currentAction?.action,
        target: agentState?.currentAction?.reason || agentState?.capability,
        previous_narrations: this.previousNarrations
      });
    } catch {
      dynamicWording = null;
    }

    // Contextual Dynamic Fallback (if backend is offline or slow)
    if (!dynamicWording) {
      dynamicWording = this.generateContextualFallbackPhrase(
        semanticState,
        milestoneType,
        userReqLower,
        actionLower,
        runtimeState
      );
    }

    if (!dynamicWording) {
      return null;
    }

    this.spokenSemanticKeys.add(semanticKey);
    this.lastSpokenTime = Date.now();
    this.previousNarrations.push(dynamicWording);

    const priority: SpeechPriority =
      milestoneType === 'BLOCKER'
        ? 'BLOCKER'
        : milestoneType === 'USER_RELEVANT_DISCOVERY'
        ? 'USER_RELEVANT_DISCOVERY'
        : 'MEANINGFUL_PROGRESS';

    return {
      text: dynamicWording,
      purpose: milestoneType,
      executionId,
      priority,
      shouldSpeak: true,
      semanticKey
    };
  }

  /**
   * Fetches dynamic narration from the backend Groq LLM with a 900ms ceiling.
   */
  private async fetchBackendDynamicNarration(payload: Record<string, any>): Promise<string | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 900);

    try {
      const backendUrl = getBackendUrl();
      const res = await fetch(`${backendUrl}/api/voice/narrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      if (!res.ok) return null;

      const data = await res.json();
      if (data?.should_speak && data?.text) {
        return data.text.trim();
      }
      return null;
    } catch {
      clearTimeout(timeoutId);
      return null;
    }
  }

  /**
   * Smart local contextual wording generator (used if backend LLM call is unavailable).
   * Unlike rigid templates, it crafts speech dynamically using the user's specific request terms,
   * course code, and active milestone.
   */
  private generateContextualFallbackPhrase(
    semanticState: OneeSemanticState,
    milestoneType: NarrationMilestoneType,
    userReq: string,
    actionReason: string,
    runtimeState: OneeRuntimeState
  ): string | null {
    const courseCodeMatch = userReq.match(/\b([A-Z]{2,4}\d{3,4})\b/i);
    const courseCode = courseCodeMatch ? courseCodeMatch[1].toUpperCase() : null;

    if (milestoneType === 'BLOCKER') {
      return "I ran into an issue verifying that on UMS.";
    }

    if (milestoneType === 'ADAPTATION') {
      return "Stopped current execution.";
    }

    if (milestoneType === 'VERIFICATION') {
      return "Verifying the details now.";
    }

    if (semanticState === 'EXTRACTING') {
      if (userReq.includes('exam') || userReq.includes('date sheet') || userReq.includes('seat')) {
        if (courseCode) {
          return `Found your exam records. Checking the schedule for ${courseCode}.`;
        }
        return "Found your examination schedule. Reading the records now.";
      }
      if (userReq.includes('timetable') || userReq.includes('class')) {
        return "Reading your class and faculty timetable.";
      }
      const subjectCount = runtimeState.attendance?.totalCourses;
      return subjectCount
        ? `Found the attendance table with ${subjectCount} courses. Calculating your numbers.`
        : "Found the records. Reading your attendance table.";
    }

    if (semanticState === 'ACTING') {
      if (actionReason.includes('date sheet') || actionReason.includes('datesheet')) {
        if (userReq.includes('next exam')) {
          return "Opening the Date Sheet so I can identify your actual next paper.";
        }
        if (userReq.includes('full') || userReq.includes('all')) {
          return "Opening the complete Date Sheet to pull all your papers.";
        }
        if (courseCode) {
          return `Opening the Date Sheet to look up ${courseCode}.`;
        }
        return "Opening the Date Sheet on UMS.";
      }

      if (actionReason.includes('seating')) {
        if (courseCode) {
          return `Opening the seating plan to locate your hall and room for ${courseCode}.`;
        }
        return "Opening the seating plan to find your hall and seat.";
      }

      if (actionReason.includes('sample paper')) {
        return courseCode
          ? `Opening the sample question paper for ${courseCode}.`
          : "Opening the sample question paper.";
      }

      if (actionReason.includes('timetable') || actionReason.includes('lms')) {
        return "Navigating to your student timetable on LMS.";
      }

      if (actionReason.includes('attendance')) {
        return "Navigating to your attendance dashboard.";
      }
    }

    return null;
  }

  /**
   * Formats verified final data into truthful natural spoken speech.
   * Grounded strictly on real verified numbers and records.
   */
  public formatVerifiedResultSpeech(finalResponse: FinalResponseData, userRequest?: string): string {
    const details = finalResponse.details;
    const reqLower = (userRequest || '').toLowerCase();
    const courseCodeMatch = (userRequest || '').match(/\b([A-Z]{2,4}\d{3,4})\b/i);
    const requestedCourse = courseCodeMatch ? courseCodeMatch[1].toUpperCase() : null;

    // Specific course follow-up or query (e.g. "What about CSE408?", "When is CSE408?")
    if (requestedCourse && details?.exams && Array.isArray(details.exams)) {
      const match = details.exams.find(
        (e: any) => e.courseCode?.toUpperCase() === requestedCourse
      );
      if (match) {
        let speech = `Your exam for ${match.courseCode} is on ${match.examDate}`;
        if (match.startTime) speech += ` at ${match.startTime}`;
        if (match.seat && match.seat !== 'Not Allotted') {
          speech += `. Your seat is ${match.seat}`;
          if (match.room) speech += ` in room ${match.room}`;
        }
        speech += '.';
        return speech;
      }
    }

    // Full date sheet request
    if (finalResponse.type === 'exam_date_sheet' || (reqLower.includes('full') && details?.exams)) {
      const total = details?.totalExams || details?.exams?.length || 0;
      const next = details?.nextExam;
      let speech = `Examination schedule verified. Found ${total} scheduled exams.`;
      if (next) {
        speech += ` Your next paper is ${next.courseCode} on ${next.examDate}`;
        if (next.startTime) speech += ` at ${next.startTime}`;
        speech += '.';
      }
      return speech;
    }

    if (finalResponse.type === 'next_exam') {
      const next = details?.nextExam;
      if (next) {
        let speech = `Your next exam is ${next.courseCode} on ${next.examDate}`;
        if (next.startTime) speech += ` at ${next.startTime}`;
        if (next.reportingTime) speech += `, reporting by ${next.reportingTime}`;
        if (next.seat && next.seat !== 'Not Allotted') {
          speech += `. Your seat is ${next.seat}`;
          if (next.room) speech += ` in room ${next.room}`;
          if (next.building) speech += `, ${next.building}`;
        }
        speech += '.';
        return speech;
      }
      return finalResponse.title || "Your upcoming exams are verified.";
    }

    if (finalResponse.type === 'seating_plan') {
      const next = details?.nextExam;
      if (next && next.seat && next.seat !== 'Not Allotted') {
        let speech = `Your seat for ${next.courseCode} is ${next.seat}`;
        if (next.room) speech += ` in room ${next.room}`;
        if (next.building) speech += `, ${next.building}`;
        speech += '.';
        return speech;
      }
      return finalResponse.title || "Your seating plan has been verified.";
    }

    if (finalResponse.type === 'sample_paper') {
      if (finalResponse.samplePaperResult?.success) {
        return `I found and opened the sample question paper for ${finalResponse.samplePaperResult.courseCode}.`;
      }
      return `Sample paper for ${finalResponse.subjectCode || 'the course'} was checked on UMS.`;
    }

    if (finalResponse.type === 'timetable') {
      if (finalResponse.title && !finalResponse.title.includes('Weekly Class Schedule') && finalResponse.title.length > 5) {
        return finalResponse.title;
      }
      const todayClasses = details?.todayClasses;
      if (todayClasses && todayClasses.length > 0) {
        const nextClass = details?.currentOrNextClass || todayClasses[0];
        let speech = `You have ${todayClasses.length} classes scheduled today. `;
        if (nextClass) {
          speech += `Your class is ${nextClass.courseCode} in room ${nextClass.room || 'assigned room'}.`;
        }
        return speech;
      }
      return finalResponse.explanation || finalResponse.title || "Your student timetable has been verified.";
    }

    if (finalResponse.type === 'lowest_attendance' || finalResponse.type === 'safe_bunk') {
      if (finalResponse.subjectCode && finalResponse.percentage !== undefined) {
        let speech = finalResponse.type === 'safe_bunk'
          ? `Your attendance in ${finalResponse.subjectCode} is ${Math.round(finalResponse.percentage)} percent.`
          : `Your lowest attendance is ${finalResponse.subjectCode} at ${Math.round(finalResponse.percentage)} percent.`;
        if (finalResponse.safeBuffer !== undefined) {
          if (finalResponse.safeBuffer > 0) {
            speech += ` You can safely miss ${finalResponse.safeBuffer} ${finalResponse.safeBuffer === 1 ? 'class' : 'classes'} without falling below 75 percent.`;
          } else {
            speech += ` You cannot skip any classes for this subject right now.`;
          }
        }
        return speech;
      }
    }

    if (finalResponse.type === 'full_summary') {
      const overall = details?.overallPercentage;
      const total = details?.totalCourses;
      if (overall !== undefined) {
        return `Your overall attendance across ${total || 'all'} subjects is ${Math.round(overall)} percent.`;
      }
    }

    return finalResponse.title || "Your request has been verified.";
  }

  private resetForNewExecution(executionId: string) {
    this.currentExecutionId = executionId;
    this.spokenSemanticKeys.clear();
    this.previousNarrations = [];
    this.lastSpokenTime = 0;
  }

  public reset(executionId?: string) {
    if (executionId) {
      this.acknowledgedExecutions.delete(executionId);
    } else {
      this.acknowledgedExecutions.clear();
    }
    this.spokenSemanticKeys.clear();
    this.previousNarrations = [];
    this.lastSpokenTime = 0;
    this.currentExecutionId = null;
  }
}

export const dynamicNarrationEngine = new DynamicNarrationEngine();
