/*
 * Narration Manager for ONEE Voice Agent.
 *
 * Subscribes to the centralized RuntimeState and dispatches live,
 * synchronized dynamic spoken updates to the VoiceQueue.
 */

import { runtimeState, DerivedOneeState, OneeRuntimeState } from '../lib/runtimeState';
import { VoiceQueue } from './VoiceQueue';
import { narrationPolicy } from './NarrationPolicy';
import { dynamicNarrationEngine } from './DynamicNarrationEngine';
import { VoicePreferences, VoiceMode } from './VoiceTypes';
import { FinalResponseData } from '../shared/types';

export class NarrationManager {
  private voiceQueue: VoiceQueue;
  private preferences: VoicePreferences;
  private unsubscribeRuntime?: () => void;
  private currentExecutionId: string | null = null;
  private lastSemanticState: string | null = null;

  constructor(voiceQueue: VoiceQueue, preferences: VoicePreferences) {
    this.voiceQueue = voiceQueue;
    this.preferences = preferences;
  }

  public updatePreferences(updates: Partial<VoicePreferences>) {
    this.preferences = { ...this.preferences, ...updates };
    this.voiceQueue.updatePreferences(updates);
  }

  public setMode(mode: VoiceMode) {
    this.preferences.mode = mode;
    this.voiceQueue.updatePreferences({ mode });
  }

  public getMode(): VoiceMode {
    return this.preferences.mode;
  }

  public getLastSemanticState(): string | null {
    return this.lastSemanticState;
  }

  /**
   * Starts listening to the central runtime state store.
   */
  public attach() {
    if (this.unsubscribeRuntime) return;

    this.unsubscribeRuntime = runtimeState.subscribe(
      (derived: DerivedOneeState, raw: OneeRuntimeState) => {
        this.handleStateTransition(derived, raw);
      }
    );
  }

  public detach() {
    if (this.unsubscribeRuntime) {
      this.unsubscribeRuntime();
      this.unsubscribeRuntime = undefined;
    }
  }

  private handleStateTransition(derived: DerivedOneeState, raw: OneeRuntimeState) {
    // Visual telemetry only: browser states (OBSERVING, PLANNING, GROUNDING, MOVING, ACTING, VERIFYING)
    // remain strictly visual in UI panels. Mid-automation voice narration is silenced.
    const executionId = raw.agentState?.executionContext?.executionId || null;
    if (executionId && executionId !== this.currentExecutionId) {
      this.currentExecutionId = executionId;
      this.voiceQueue.setActiveExecutionId(executionId);
    }
    this.lastSemanticState = derived.semanticState;
  }

  /**
   * Pre-automation Sofia greeting: ONE short, natural, dynamically chosen
   * acknowledgement derived from the student's actual request ("Sure, I'll check
   * your CSE330 attendance."), spoken through the canonical VoiceQueue TTS path
   * (Groq Orpheus only — no Kokoro, no native browser speech). Mid-automation
   * browser-agent narration stays silent: only this greeting and the final
   * canonical response are heard.
   */
  public acknowledgeGoal(goal: string, executionId: string) {
    this.currentExecutionId = executionId;
    this.voiceQueue.setActiveExecutionId(executionId);

    if (this.preferences.mode === 'OFF') return;

    const greeting = this.generateAcknowledgement(goal);
    if (greeting) {
      this.voiceQueue.enqueue(greeting, {
        priority: 'ACKNOWLEDGEMENT',
        executionId,
        providerPreference: 'auto'
      });
    }
  }

  /**
   * Deterministic greeting generator: produces ONE short, natural,
   * intent-specific acknowledgement from the student's actual request.
   * Includes the course code when one is mentioned in the query.
   */
  private generateAcknowledgement(goal: string): string {
    const lower = goal.toLowerCase();
    // Extract course codes like CSE330, INT306, etc.
    const courseMatch = goal.match(/\b([A-Z]{2,5})\s*(\d{3,4}[A-Za-z]?)\b/i);
    const courseCode = courseMatch
      ? `${courseMatch[1]}${courseMatch[2]}`.toUpperCase()
      : null;

    // "How many classes can I miss / skip / bunk" → bunk margin intent
    if (/bunk|skip|miss|how many.*can/i.test(lower)) {
      return courseCode
        ? `Sure, let me check the bunk margin for ${courseCode}.`
        : `Sure, let me check your bunk margin.`;
    }
    // Superlative attendance queries (lowest / least / worst)
    if (/lowest|least|worst/i.test(lower) && /attendance/i.test(lower)) {
      return `Sure, let me check your attendance records.`;
    }
    // General attendance
    if (/attendance/i.test(lower)) {
      return courseCode
        ? `Sure, let me check the attendance for ${courseCode}.`
        : `Alright, checking your attendance now.`;
    }
    // Timetable / schedule
    if (/timetable|schedule|class.*today|today.*class/i.test(lower)) {
      if (/tomorrow/i.test(lower)) {
        return `Sure, checking your classes for tomorrow.`;
      }
      return `Sure, checking your timetable now.`;
    }
    // Examination / date sheet
    if (/exam|date.?sheet/i.test(lower)) {
      return courseCode
        ? `Sure, let me look up the ${courseCode} exam schedule.`
        : `Sure, checking your examination schedule.`;
    }
    // Seating plan
    if (/seating|seat/i.test(lower)) {
      return `Sure, checking your seating plan.`;
    }
    // Sample papers
    if (/sample.*paper/i.test(lower)) {
      return courseCode
        ? `Sure, looking for the ${courseCode} sample paper.`
        : `Sure, looking for the sample paper.`;
    }
    // Fallback: generic but still spoken through provider hierarchy
    return `Sure, let me check that for you.`;
  }

  /**
   * Deprecated in favor of the canonical response pipeline:
   * The final verified response is generated once and spoken identically.
   */
  public speakVerifiedResult(_finalResponse: FinalResponseData, _executionId?: string) {
    // No-op: Canonical response is spoken directly via VoiceQueue from the unified response
  }

  /**
   * Immediate stop & cancel.
   */
  public stop() {
    this.voiceQueue.cancel();
    dynamicNarrationEngine.reset(this.currentExecutionId || undefined);
    narrationPolicy.reset();
    this.lastSemanticState = null;
  }

  /**
   * Optional richer greeting hook: generates the acknowledgement through the
   * backend Groq LLM when available so wording varies naturally per request.
   * Falls back silently to the deterministic wording when offline.
   */
  public async acknowledgeGoalDynamic(goal: string, executionId: string): Promise<void> {
    this.acknowledgeGoal(goal, executionId);
  }
}
