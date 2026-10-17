/*
 * Explicit Voice Runtime Architecture for ONEE.
 *
 * Separates the 3 fundamental concepts:
 * 1. AGENT EXECUTION: "What is ONEE doing?" (Browser Agent, UMS DOM interaction)
 * 2. CONVERSATIONAL RESPONSE: "What should ONEE tell the student?" (LLM & Fact Grounding)
 * 3. VOICE RENDERING: "How do we turn language into audio?" (Worker-based Kokoro + AudioController)
 *
 * Subsystems:
 * - VoiceModeController: Mode switching (OFF, ASSIST, LIVE_AGENT) & preferences persistence
 * - NarrationPlanner: Determines IF and WHAT to speak from structured facts
 * - NarrationQueue: Pipelined sentence & chunk queuing
 * - KokoroTTSProvider: Dedicated Web Worker Kokoro model client
 * - AudioController: Independent non-blocking Web Audio API playback
 * - CancellationController: Barge-in and execution invalidation
 * - ExecutionGuard: Strict multi-stage execution ID verification
 */

import { VoiceMode, VoicePreferences, VoiceState, VoiceEventPayload, NarrationResult } from './VoiceTypes';
import { VoiceQueue } from './VoiceQueue';
import { kokoroTTSProvider, KokoroTTSProvider } from './providers/KokoroTTSProvider';
import { audioController, AudioController } from './AudioController';
import { dynamicNarrationEngine, DynamicNarrationEngine, RuntimeFacts } from './DynamicNarrationEngine';
import { voiceProfiler, VoicePerformanceProfiler } from './VoicePerformanceProfiler';
import { DEFAULT_VOICE_PREFERENCES } from './VoiceProvider';
import { FinalResponseData } from '../shared/types';
import { oneeBridge } from '../lib/oneeEvents';

export class VoiceModeController {
  private preferences: VoicePreferences = { ...DEFAULT_VOICE_PREFERENCES };
  private onModeChanged?: (mode: VoiceMode) => void;

  constructor(initialPrefs?: Partial<VoicePreferences>, onModeChanged?: (mode: VoiceMode) => void) {
    if (initialPrefs) {
      this.preferences = { ...this.preferences, ...initialPrefs };
    }
    this.onModeChanged = onModeChanged;
  }

  public getMode(): VoiceMode {
    return this.preferences.mode;
  }

  public getPreferences(): VoicePreferences {
    return { ...this.preferences };
  }

  public updatePreferences(patch: Partial<VoicePreferences>) {
    this.preferences = { ...this.preferences, ...patch };
    if (patch.mode) {
      this.preferences.enabled = patch.mode !== 'OFF';
      this.onModeChanged?.(patch.mode);
    }
  }

  public setMode(mode: VoiceMode) {
    this.updatePreferences({ mode, enabled: mode !== 'OFF' });
  }

  public isVoiceEnabled(): boolean {
    return this.preferences.enabled && this.preferences.mode !== 'OFF';
  }
}

export class CancellationController {
  private activeExecutionId: string | null = null;
  private audioController: AudioController;
  private kokoroProvider: KokoroTTSProvider;
  private narrationQueue: VoiceQueue;

  constructor(
    audioCtrl: AudioController,
    kokoro: KokoroTTSProvider,
    queue: VoiceQueue
  ) {
    this.audioController = audioCtrl;
    this.kokoroProvider = kokoro;
    this.narrationQueue = queue;
  }

  public setActiveExecutionId(executionId: string | null) {
    if (this.activeExecutionId !== executionId) {
      this.activeExecutionId = executionId;
      this.audioController.setActiveExecutionId(executionId);
      this.narrationQueue.setActiveExecutionId(executionId);
    }
  }

  public getActiveExecutionId(): string | null {
    return this.activeExecutionId;
  }

  public cancel(reason: string = 'user_interruption') {
    this.narrationQueue.cancel();
    this.kokoroProvider.stop();
    this.audioController.stop(reason);
    dynamicNarrationEngine.reset(this.activeExecutionId || undefined);
    oneeBridge.emitState('CANCELLED', 'Stopped');
  }

  public cancelExecution(executionId: string) {
    if (this.activeExecutionId === executionId) {
      this.cancel(`cancelled_${executionId}`);
      this.activeExecutionId = null;
    } else {
      this.audioController.cancelExecution(executionId);
    }
  }
}

export class ExecutionGuard {
  private cancellationController: CancellationController;

  constructor(canceller: CancellationController) {
    this.cancellationController = canceller;
  }

  public isValid(executionId?: string): boolean {
    const active = this.cancellationController.getActiveExecutionId();
    if (!executionId || !active) return true;
    return executionId === active;
  }
}

export class NarrationPlanner {
  private engine: DynamicNarrationEngine;

  constructor(engine: DynamicNarrationEngine) {
    this.engine = engine;
  }

  public generateAcknowledgement(goal: string, executionId: string): NarrationResult | null {
    return this.engine.generateAcknowledgement(goal, executionId);
  }

  public formatVerifiedResult(finalResponse: FinalResponseData, userRequest?: string): string {
    return this.engine.formatVerifiedResultSpeech(finalResponse, userRequest);
  }

  public evaluateFacts(facts: RuntimeFacts): Promise<NarrationResult | null> {
    return this.engine.evaluateFacts(facts);
  }
}

export class VoiceRuntime {
  private static instance: VoiceRuntime;

  public readonly modeController: VoiceModeController;
  public readonly audioController: AudioController;
  public readonly kokoroProvider: KokoroTTSProvider;
  public readonly queue: VoiceQueue;
  public readonly narrationPlanner: NarrationPlanner;
  public readonly cancellationController: CancellationController;
  public readonly guard: ExecutionGuard;
  public readonly profiler: VoicePerformanceProfiler;

  private state: VoiceState = 'IDLE';
  private listeners: Set<(state: VoiceState, payload?: Partial<VoiceEventPayload>) => void> = new Set();

  private constructor() {
    this.audioController = audioController;
    this.kokoroProvider = kokoroTTSProvider;
    this.queue = new VoiceQueue(undefined, (isSpeaking, item) => {
      if (isSpeaking) {
        if (this.state !== 'LISTENING' && this.state !== 'TRANSCRIBING') {
          this.setState('SPEAKING', { spokenText: item?.text });
        }
      } else {
        if (this.state === 'SPEAKING') {
          this.setState('IDLE');
        }
      }
    });

    this.modeController = new VoiceModeController(this.queue['preferences'], (mode) => {
      this.queue.updatePreferences({ mode, enabled: mode !== 'OFF' });
    });

    this.cancellationController = new CancellationController(
      this.audioController,
      this.kokoroProvider,
      this.queue
    );

    this.guard = new ExecutionGuard(this.cancellationController);
    this.narrationPlanner = new NarrationPlanner(dynamicNarrationEngine);
    this.profiler = voiceProfiler;
  }

  public static getInstance(): VoiceRuntime {
    if (!VoiceRuntime.instance) {
      VoiceRuntime.instance = new VoiceRuntime();
    }
    return VoiceRuntime.instance;
  }

  public subscribe(listener: (state: VoiceState, payload?: Partial<VoiceEventPayload>) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setState(state: VoiceState, payload?: Partial<VoiceEventPayload>) {
    this.state = state;
    this.listeners.forEach((l) => {
      try {
        l(state, payload);
      } catch {}
    });
  }

  public getState(): VoiceState {
    return this.state;
  }

  public start() {
    this.setState('IDLE');
  }

  public stop() {
    this.cancellationController.cancel('runtime_stop');
    this.setState('IDLE');
  }

  public cancelExecution(executionId: string) {
    this.cancellationController.cancelExecution(executionId);
  }

  public speakImmediate(text: string, executionId?: string) {
    if (!this.modeController.isVoiceEnabled()) return;
    this.queue.enqueue(text, {
      priority: 'HIGH',
      executionId: executionId || (this.cancellationController.getActiveExecutionId() || undefined)
    });
  }
}

export function getVoiceRuntime(): VoiceRuntime {
  return VoiceRuntime.getInstance();
}
