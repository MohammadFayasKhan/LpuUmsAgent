/*
 * Narration Manager for ONEE Voice Agent.
 *
 * Subscribes to the centralized RuntimeState and dispatches live,
 * synchronized spoken updates to the VoiceQueue.
 */

import { runtimeState, DerivedOneeState, OneeRuntimeState } from '../lib/runtimeState';
import { VoiceQueue } from './VoiceQueue';
import { narrationPolicy, NarrationContext } from './NarrationPolicy';
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
    if (!this.preferences.enabled || this.preferences.mode === 'OFF') {
      return;
    }

    const executionId = raw.agentState?.executionContext?.executionId || null;
    if (executionId !== this.currentExecutionId) {
      this.currentExecutionId = executionId;
      this.voiceQueue.setActiveExecutionId(executionId);
    }

    // Only process if semantic state changed or new final response arrived
    if (
      derived.semanticState === this.lastSemanticState &&
      derived.semanticState !== 'SUCCESS'
    ) {
      return;
    }

    this.lastSemanticState = derived.semanticState;

    const context: NarrationContext = {
      mode: this.preferences.mode,
      level: this.preferences.narrationLevel,
      activeExecutionId: this.currentExecutionId
    };

    const phrase = narrationPolicy.getNarrationPhrase(derived.semanticState, raw, context);

    if (phrase) {
      const isFinal = derived.semanticState === 'SUCCESS';
      this.voiceQueue.enqueue(phrase, {
        priority: isFinal ? 'NORMAL' : 'LOW',
        executionId: this.currentExecutionId || undefined,
        isFinalResult: isFinal,
        providerPreference: isFinal ? 'auto' : 'native'
      });
    }
  }

  /**
   * Immediate spoken acknowledgment when a student speaks or submits a goal.
   * e.g., "Sure, I'll check that for you."
   */
  public acknowledgeGoal(goal: string, executionId: string) {
    if (!this.preferences.enabled || this.preferences.mode === 'OFF') return;

    this.currentExecutionId = executionId;
    this.voiceQueue.setActiveExecutionId(executionId);

    const goalLower = goal.toLowerCase();
    let ack = "Sure, I'll check that on UMS.";

    if (goalLower.includes('exam') || goalLower.includes('date sheet') || goalLower.includes('datesheet')) {
      ack = "Sure, I'll check your examination schedule.";
    } else if (goalLower.includes('seat') || goalLower.includes('room') || goalLower.includes('venue')) {
      ack = "Sure, I'll locate your seat.";
    } else if (goalLower.includes('sample paper')) {
      ack = "Sure, I'll find that sample paper for you.";
    } else if (goalLower.includes('timetable') || goalLower.includes('class')) {
      ack = "Sure, I'll check your timetable.";
    } else if (goalLower.includes('attendance') || goalLower.includes('bunk')) {
      ack = "Sure, I'll check your attendance.";
    }

    this.voiceQueue.enqueue(ack, {
      priority: 'NORMAL',
      executionId,
      providerPreference: 'native'
    });
  }

  /**
   * Speaks verified result explicitly.
   */
  public speakVerifiedResult(finalResponse: FinalResponseData, executionId?: string) {
    if (!this.preferences.enabled || this.preferences.mode === 'OFF') return;

    const speech = narrationPolicy.formatVerifiedResultSpeech(finalResponse);
    if (!speech) return;

    const targetExecId = executionId || this.currentExecutionId || undefined;
    this.voiceQueue.enqueue(speech, {
      priority: 'NORMAL',
      executionId: targetExecId,
      isFinalResult: true,
      providerPreference: 'auto'
    });
  }

  /**
   * Immediate stop & cancel.
   */
  public stop() {
    this.voiceQueue.cancel();
    narrationPolicy.reset();
    this.lastSemanticState = null;
  }
}
