/*
 * Narration Policy Engine for ONEE.
 *
 * Provides synchronous bridge to DynamicNarrationEngine:
 * - Single source of truth: Runtime State provides facts; ONEE intelligence generates wording.
 * - Anti-repetition: Deduplicates semantically identical utterances within an active window.
 * - Truthfulness: Never claims verification until real verified data exists.
 */

import { OneeSemanticState, OneeRuntimeState } from '../lib/runtimeState';
import { NarrationContext } from './VoiceTypes';
import { FinalResponseData, AgentCapability } from '../shared/types';
import { dynamicNarrationEngine } from './DynamicNarrationEngine';

export class NarrationPolicyEngine {
  private recentPhrases: Map<string, number> = new Map();
  private readonly DEDUP_WINDOW_MS = 4000;

  /**
   * Evaluates current state and returns a natural spoken phrase, or null if silent.
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


    // Legacy ASSIST mode: only initial plan acknowledgment and final verified result are spoken
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

    // LIVE_AGENT Mode: Progressive semantic milestone narration
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
        phrase = "The UMS page is loading.";
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
        phrase = null;
        break;
    }

    if (!phrase) return null;
    return this.filterRepetition(phrase);
  }

  public formatVerifiedResultSpeech(finalResponse: FinalResponseData): string {
    return dynamicNarrationEngine.formatVerifiedResultSpeech(finalResponse);
  }

  public filterRepetition(phrase: string): string | null {
    const now = Date.now();
    const lastSpoken = this.recentPhrases.get(phrase);

    if (lastSpoken && now - lastSpoken < this.DEDUP_WINDOW_MS) {
      return null;
    }

    this.recentPhrases.set(phrase, now);

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
    dynamicNarrationEngine.reset();
  }
}

export const narrationPolicy = new NarrationPolicyEngine();
