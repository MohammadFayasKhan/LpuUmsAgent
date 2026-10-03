/*
 * Central Voice Controller for ONEE.
 *
 * Coordinates:
 * 1. Microphone capture and Speech-to-Text (Native SpeechRecognition with Groq Whisper fallback).
 * 2. Barge-in detection and speech interruption.
 * 3. NarrationManager and VoiceQueue lifecycle.
 * 4. Dispatching spoken commands into the existing agent execution pipeline.
 * 5. Local storage persistence for voice preferences.
 */

import {
  VoiceMode,
  VoiceState,
  VoicePreferences,
  ISpeechRecognitionProvider,
  VoiceStateListener,
  VoiceEventPayload
} from './VoiceTypes';
import { DEFAULT_VOICE_PREFERENCES } from './VoiceProvider';
import { nativeSpeechRecognitionProvider } from './providers/NativeSpeechRecognitionProvider';
import { groqWhisperProvider } from './providers/GroqWhisperProvider';
import { VoiceQueue } from './VoiceQueue';
import { NarrationManager } from './NarrationManager';
import { FinalResponseData } from '../shared/types';
import { oneeBridge } from '../lib/oneeEvents';

const STORAGE_KEY = 'onee_voice_preferences_v2';

export class VoiceController {
  private static instance: VoiceController;

  private preferences: VoicePreferences = { ...DEFAULT_VOICE_PREFERENCES };
  private state: VoiceState = 'IDLE';
  private listeners: Set<VoiceStateListener> = new Set();

  private voiceQueue: VoiceQueue;
  private narrationManager: NarrationManager;
  private activeSttProvider: ISpeechRecognitionProvider;

  // Delegate callback to dispatch transcribed commands into existing agent pipeline
  private commandHandler?: (transcript: string) => Promise<void> | void;
  // Delegate callback to safely cancel active Computer Use execution
  private cancelAgentHandler?: () => void;

  private constructor() {
    this.voiceQueue = new VoiceQueue(this.preferences, (isSpeaking, currentItem) => {
      if (isSpeaking) {
        if (this.state !== 'LISTENING' && this.state !== 'TRANSCRIBING') {
          this.setState('SPEAKING', { spokenText: currentItem?.text });
        }
      } else {
        if (this.state === 'SPEAKING') {
          this.setState('IDLE');
        }
      }
    });

    this.narrationManager = new NarrationManager(this.voiceQueue, this.preferences);

    // Default to native browser recognition
    this.activeSttProvider = nativeSpeechRecognitionProvider.isSupported()
      ? nativeSpeechRecognitionProvider
      : groqWhisperProvider;

    this.loadPreferences();
    this.narrationManager.attach();
  }

  public static getInstance(): VoiceController {
    if (!VoiceController.instance) {
      VoiceController.instance = new VoiceController();
    }
    return VoiceController.instance;
  }

  public registerHandlers(
    onCommand: (transcript: string) => Promise<void> | void,
    onCancelAgent?: () => void
  ) {
    this.commandHandler = onCommand;
    this.cancelAgentHandler = onCancelAgent;
  }

  public subscribe(listener: VoiceStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): VoiceState {
    return this.state;
  }

  public getPreferences(): VoicePreferences {
    return { ...this.preferences };
  }

  public async setMode(mode: VoiceMode) {
    this.preferences.mode = mode;
    this.preferences.enabled = mode !== 'OFF';
    this.narrationManager.setMode(mode);
    this.voiceQueue.updatePreferences({ mode, enabled: mode !== 'OFF' });
    await this.savePreferences();
    this.notify({ state: this.state });
  }

  public async updatePreferences(updates: Partial<VoicePreferences>) {
    this.preferences = { ...this.preferences, ...updates };
    this.voiceQueue.updatePreferences(updates);
    this.narrationManager.updatePreferences(updates);
    await this.savePreferences();
  }

  /**
   * Activates the microphone and starts listening.
   * If ONEE is speaking, immediately triggers barge-in: stops TTS and listens.
   */
  public async startListening(): Promise<void> {
    if (this.preferences.mode === 'OFF') {
      // Temporarily elevate to ASSIST or LIVE_AGENT if user clicked mic
      await this.setMode('LIVE_AGENT');
    }

    // Barge-in: immediately stop any ongoing speech synthesis
    this.stopSpeaking();

    this.setState('LISTENING');
    oneeBridge.emitState('LISTENING', 'Listening...');

    const onInterim = (interim: string) => {
      this.setState('LISTENING', { interimTranscript: interim });
    };

    const onFinal = (finalTranscript: string) => {
      const clean = finalTranscript.trim();
      if (!clean) {
        this.setState('IDLE');
        return;
      }

      this.handleVoiceCommand(clean);
    };

    const onError = async (err: Error) => {
      console.warn('[VoiceController] Recognition error on provider:', this.activeSttProvider.name, err);

      // If native recognition fails, attempt fallback to Groq Whisper once
      if (
        this.activeSttProvider.name === nativeSpeechRecognitionProvider.name &&
        groqWhisperProvider.isSupported()
      ) {
        console.info('[VoiceController] Falling back to Groq Whisper STT...');
        this.activeSttProvider = groqWhisperProvider;
        try {
          await this.activeSttProvider.start(onInterim, onFinal, (fallbackErr) => {
            this.setState('ERROR', { error: fallbackErr.message });
            setTimeout(() => this.setState('IDLE'), 2500);
          });
          return;
        } catch {}
      }

      this.setState('ERROR', { error: err.message });
      setTimeout(() => this.setState('IDLE'), 2500);
    };

    const onEnd = () => {
      if (this.state === 'LISTENING') {
        this.setState('IDLE');
      }
    };

    try {
      await this.activeSttProvider.start(onInterim, onFinal, onError, onEnd);
    } catch (err: any) {
      onError(err);
    }
  }

  public stopListening(): void {
    if (this.activeSttProvider.isListening()) {
      this.activeSttProvider.stop();
    }
    if (this.state === 'LISTENING' || this.state === 'TRANSCRIBING') {
      this.setState('IDLE');
    }
  }

  /**
   * Immediately stops speech and flushes audio queue.
   */
  public stopSpeaking(): void {
    this.voiceQueue.cancel();
    if (this.state === 'SPEAKING') {
      this.setState('IDLE');
    }
  }

  /**
   * User voice interruption command ("stop", "cancel", "hold on").
   */
  public handleInterruption(): void {
    this.stopSpeaking();
    this.stopListening();

    if (this.cancelAgentHandler) {
      this.cancelAgentHandler();
    }

    oneeBridge.emitState('CANCELLED', 'Stopped');
    this.setState('CANCELLED');

    this.voiceQueue.enqueue("Stopped.", {
      priority: 'HIGH',
      providerPreference: 'native'
    });

    setTimeout(() => {
      if (this.state === 'CANCELLED') {
        this.setState('IDLE');
      }
    }, 2000);
  }

  /**
   * Processes a recognized student transcript.
   */
  private async handleVoiceCommand(transcript: string) {
    this.stopListening();
    this.setState('UNDERSTANDING', { transcript });

    const lower = transcript.toLowerCase().trim();

    // Check for explicit voice stop commands
    if (
      lower === 'stop' ||
      lower === 'cancel' ||
      lower === 'abort' ||
      lower === 'hold on' ||
      lower.startsWith('stop ') ||
      lower.startsWith('cancel ')
    ) {
      this.handleInterruption();
      return;
    }

    try {
      if (this.commandHandler) {
        await this.commandHandler(transcript);
      }
    } catch (err: any) {
      console.warn('[VoiceController] Command dispatch error:', err);
      this.setState('ERROR', { error: err.message });
    } finally {
      if (this.state === 'UNDERSTANDING') {
        this.setState('IDLE');
      }
    }
  }

  public acknowledgeGoal(goal: string, executionId: string) {
    this.narrationManager.acknowledgeGoal(goal, executionId);
  }

  public speakVerifiedResult(finalResponse: FinalResponseData, executionId?: string) {
    this.narrationManager.speakVerifiedResult(finalResponse, executionId);
  }

  public speakText(text: string, isFinal: boolean = false, executionId?: string) {
    if (this.preferences.mode === 'OFF') return;
    this.voiceQueue.enqueue(text, {
      priority: isFinal ? 'NORMAL' : 'LOW',
      executionId,
      isFinalResult: isFinal,
      providerPreference: isFinal ? 'auto' : 'native'
    });
  }

  public setActiveExecutionId(executionId: string | null) {
    this.voiceQueue.setActiveExecutionId(executionId);
  }

  private setState(state: VoiceState, payload?: Partial<VoiceEventPayload>) {
    this.state = state;
    this.notify({ state, ...payload });
  }

  private notify(payload: VoiceEventPayload) {
    this.listeners.forEach((listener) => {
      try {
        listener(this.state, payload);
      } catch (err) {
        console.warn('[VoiceController] Error in listener callback:', err);
      }
    });
  }

  private async loadPreferences() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        if (data[STORAGE_KEY]) {
          this.preferences = { ...DEFAULT_VOICE_PREFERENCES, ...data[STORAGE_KEY] };
          this.voiceQueue.updatePreferences(this.preferences);
          this.narrationManager.updatePreferences(this.preferences);
        }
      }
    } catch (err) {
      console.warn('[VoiceController] Error loading preferences from storage:', err);
    }
  }

  private async savePreferences() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({ [STORAGE_KEY]: this.preferences });
      }
    } catch (err) {
      console.warn('[VoiceController] Error saving preferences to storage:', err);
    }
  }
}

export const voiceController = VoiceController.getInstance();
