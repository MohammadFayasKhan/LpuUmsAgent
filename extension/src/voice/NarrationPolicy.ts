/*
 * Narration Policy Engine for ONEE.
 *
 * Translates centralized semantic agent states into concise, natural,
 * human-sounding spoken narration without requiring expensive LLM round-trips.
 *
 * Core Guarantees:
 * 1. Single Source of Truth: Driven exclusively by OneeSemanticState and AgentState.
 * 2. Truthfulness: Never claims "I found your exam" until validation & verification succeed.
 * 3. Semantic-Only: Never exposes mechanical cursor/DOM movements ("The cursor is moving").
 * 4. Mode-Filtered: Honors OFF, ASSIST, and LIVE_AGENT modes.
 * 5. Anti-Repetition: Deduplicates identical utterances within an active window.
 */

import { OneeSemanticState, OneeRuntimeState } from '../lib/runtimeState';
import { VoiceMode, NarrationLevel } from './VoiceTypes';
import { FinalResponseData, AgentCapability } from '../shared/types';

export interface NarrationContext {
  mode: VoiceMode;
  level: NarrationLevel;
  lastSpokenPhrase?: string;
  lastSpokenTime?: number;
  activeExecutionId?: string | null;
}

export class NarrationPolicyEngine {
  private recentPhrases: Map<string, number> = new Map();
  private readonly DEDUP_WINDOW_MS = 4000;

  /**
   * Evaluates current state and returns a short natural spoken phrase, or null if silent.
   */
  public getNarrationPhrase(
    semanticState: OneeSemanticState,
    runtimeState: OneeRuntimeState,
    context: NarrationContext
  ): string | null {
    if (context.mode === 'OFF') {
      return null;
    }

    const { agentState } = runtimeState;
    const capability: AgentCapability | undefined = agentState?.capability;
    const isExam =
      capability === 'EXAM_DATE_SHEET' ||
      capability === 'SEATING_PLAN' ||
      capability === 'SAMPLE_PAPER' ||
      (agentState?.currentGoal || '').toLowerCase().includes('exam') ||
      (agentState?.currentGoal || '').toLowerCase().includes('date sheet') ||
      (agentState?.currentGoal || '').toLowerCase().includes('seat');

    const isTimetable =
      capability === 'TIMETABLE' ||
      (agentState?.currentGoal || '').toLowerCase().includes('timetable') ||
      (agentState?.currentGoal || '').toLowerCase().includes('class');

    // In ASSIST mode, we only speak initial plan acknowledgment and final verified result
    if (context.mode === 'ASSIST') {
      if (semanticState === 'SUCCESS' && agentState?.finalResponse) {
        return this.formatVerifiedResultSpeech(agentState.finalResponse);
      }
      if (semanticState === 'PLANNING') {
        const phrase = isExam
          ? "Checking your examination schedule on UMS."
          : isTimetable
          ? "Checking your timetable on UMS."
          : "Checking your attendance on UMS.";
        return this.filterRepetition(phrase);
      }
      return null;
    }

    // LIVE_AGENT Mode: Full semantic milestone narration
    let phrase: string | null = null;

    switch (semanticState) {
      case 'PLANNING':
        if (isExam) {
          phrase = "I'll check your examination schedule on UMS.";
        } else if (isTimetable) {
          phrase = "I'll check your timetable on UMS.";
        } else {
          phrase = "I'll check your attendance on UMS.";
        }
        break;

      case 'LOCATING':
        if (isExam) {
          phrase = "Finding your examination section.";
        } else if (isTimetable) {
          phrase = "Locating your timetable records.";
        } else {
          phrase = "Finding the attendance table.";
        }
        break;

      case 'ACTING': {
        const reason = (agentState?.currentAction?.reason || '').toLowerCase();
        if (reason.includes('date sheet') || reason.includes('datesheet')) {
          phrase = "Opening your examination schedule.";
        } else if (reason.includes('seating')) {
          phrase = "Opening the seating plan.";
        } else if (reason.includes('sample paper')) {
          phrase = "Opening the sample paper.";
        } else if (reason.includes('timetable') || reason.includes('lms')) {
          phrase = "Opening your timetable.";
        } else if (reason.includes('attendance')) {
          phrase = "Opening your attendance.";
        } else {
          phrase = "Interacting with the page.";
        }
        break;
      }

      case 'WAITING':
        phrase = "The UMS page is loading. I'll wait for it.";
        break;

      case 'EXTRACTING':
        if (isExam) {
          phrase = "I found the records. Reading your examination schedule.";
        } else if (isTimetable) {
          phrase = "Reading your class and faculty schedule.";
        } else {
          const count = runtimeState.attendance?.totalCourses;
          phrase = count
            ? `Reading records for ${count} subjects.`
            : "Reading your attendance records.";
        }
        break;

      case 'VERIFYING':
        phrase = "Verifying the details.";
        break;

      case 'SUCCESS':
        if (agentState?.finalResponse) {
          return this.formatVerifiedResultSpeech(agentState.finalResponse);
        }
        phrase = "Everything is verified.";
        break;

      case 'CANCELLED':
        phrase = "Stopped.";
        break;

      case 'ERROR':
        phrase = "I couldn't verify that on UMS.";
        break;

      case 'RECONNECTING':
        phrase = "The connection dropped. Reconnecting.";
        break;

      case 'MOVING':
      case 'OBSERVING':
      case 'USER_TYPING':
      case 'THINKING':
      case 'IDLE':
      default:
        // Deliberately silent to avoid robotically chattering on low-level mouse movements
        phrase = null;
        break;
    }

    if (!phrase) return null;
    return this.filterRepetition(phrase);
  }

  /**
   * Formats verified final data into natural spoken speech.
   * This is ONLY called once verified: true is guaranteed by application logic.
   */
  public formatVerifiedResultSpeech(finalResponse: FinalResponseData): string {
    const details = finalResponse.details;

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
      const todayClasses = details?.todayClasses;
      if (todayClasses && todayClasses.length > 0) {
        const nextClass = details?.currentOrNextClass || todayClasses[0];
        let speech = `You have ${todayClasses.length} classes scheduled today. `;
        if (nextClass) {
          speech += `Your class is ${nextClass.courseCode} in room ${nextClass.room || 'assigned room'}.`;
        }
        return speech;
      }
      return finalResponse.title || "Your student timetable has been verified.";
    }

    if (finalResponse.type === 'lowest_attendance' || finalResponse.type === 'safe_bunk') {
      if (finalResponse.subjectCode && finalResponse.percentage !== undefined) {
        let speech = `Your lowest attendance is ${finalResponse.subjectCode} at ${Math.round(finalResponse.percentage)} percent.`;
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

  private filterRepetition(phrase: string): string | null {
    const now = Date.now();
    const lastSpoken = this.recentPhrases.get(phrase);

    if (lastSpoken && now - lastSpoken < this.DEDUP_WINDOW_MS) {
      return null;
    }

    this.recentPhrases.set(phrase, now);

    // Prune stale entries
    if (this.recentPhrases.size > 20) {
      this.recentPhrases.forEach((time, key) => {
        if (now - time > 15000) {
          this.recentPhrases.delete(key);
        }
      });
    }

    return phrase;
  }

  public reset() {
    this.recentPhrases.clear();
  }
}

export const narrationPolicy = new NarrationPolicyEngine();
