/*
 * Central Voice Controller for ONEE.
 *
 * Coordinates:
 * 1. Microphone capture and Speech-to-Text (Groq Whisper primary, browser fallback).
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
import {
  DEFAULT_VOICE_PREFERENCES,
  KOKORO_VOICE_URIS,
  DEFAULT_KOKORO_VOICE_URI,
  resolveSttProviderPreference
} from './VoiceProvider';
import { groqWhisperProvider, GroqWhisperProvider } from './providers/GroqWhisperProvider';
import { logVoiceDiagnostic } from './VoiceDiagnostics';
import { VoiceQueue } from './VoiceQueue';
import { NarrationManager } from './NarrationManager';
import { audioController } from './AudioController';
import { getBackendUrl } from '../services/api';
import { voiceProfiler } from './VoicePerformanceProfiler';
import { FinalResponseData } from '../shared/types';
import { sessionGreetingLine } from '../lib/greeting';
import { oneeBridge } from '../lib/oneeEvents';

const STORAGE_KEY = 'onee_voice_preferences_v3';

export class VoiceController {
  private static instance: VoiceController;

  /**
   * Silence window that must elapse after the last recognized text before a
   * staged fragment is treated as the FINAL transcript. An interim/partial
   * fragment never executes on its own.
   */
  public static STT_COMPLETION_WINDOW_MS = 1400;

  private preferences: VoicePreferences = { ...DEFAULT_VOICE_PREFERENCES };
  private state: VoiceState = 'IDLE';
  private listeners: Set<VoiceStateListener> = new Set();

  private voiceQueue: VoiceQueue;
  private narrationManager: NarrationManager;
  private activeSttProvider: ISpeechRecognitionProvider;
  private sttSession = 0;
  // Cancels a pending completion-window delivery when the mic session is torn down.
  private cancelSttCompletion: (() => void) | null = null;
  private sessionGreetingPlayed = false;
  private runtimeMessageHandler: ((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => void) | null = null;

  // Delegate callback to dispatch transcribed commands into existing agent pipeline
  private commandHandler?: (transcript: string) => Promise<void> | void;
  // Delegate callback to safely cancel active Computer Use execution
  private cancelAgentHandler?: () => void;

  private constructor() {
    this.voiceQueue = new VoiceQueue(this.preferences, (isSpeaking, currentItem) => {
      if (isSpeaking) {
        if (this.state !== 'LISTENING' && this.state !== 'TRANSCRIBING') {
          this.setState('SPEAKING', { spokenText: currentItem?.text });
          oneeBridge.emitState('SPEAKING', 'Speaking 🔊');
        }
      } else {
        if (this.state === 'SPEAKING') {
          this.setState('IDLE');
          oneeBridge.emitState('IDLE');
        }
      }
    });

    // Shared execution-ID telemetry used by the onMicResult diagnostic path so one
    // user utterance can be traced from mic -> backend -> Groq -> audio -> AudioController.

    this.narrationManager = new NarrationManager(this.voiceQueue, this.preferences);

    // FINAL SPEC: Groq Whisper is the ONLY STT provider and Groq Orpheus is
    // the ONLY TTS provider. Browser SpeechRecognition, native SpeechSynthesis,
    // and local Kokoro were removed from the runtime — no fallback path exists.
    this.activeSttProvider = groqWhisperProvider;

    this.loadPreferences();
    this.narrationManager.attach();

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      this.runtimeMessageHandler = (message) => {
        if (message?.type === 'ONEE_MIC_PERMISSION_GRANTED') {
          if (this.state === 'LISTENING' || this.state === 'TRANSCRIBING') return;
          console.log('[VoiceController] Microphone permission granted! Auto-starting listening...');
          this.startListening().catch(() => {});
        }
      };
      chrome.runtime.onMessage.addListener(this.runtimeMessageHandler);
    }
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

  /**
   * Prepares the audio output path before the answer is ready so the first
   * Groq Orpheus response can play immediately. Groq is a cloud provider and
   * needs no local model warm-up.
   */
  public prewarmSpeech(): void {
    audioController.unlockAudio().catch(() => {});
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
   * One session-level readiness greeting. Not tied to LLM, Browser Agent, or mic.
   * Safe to call on every sidepanel mount; it speaks at most once per JS context.
   */
  public playSessionGreeting(): void {
    if (this.sessionGreetingPlayed) return;
    if (this.preferences.mode === 'OFF') return;
    this.sessionGreetingPlayed = true;
    const execId = `session-greet-${Date.now()}`;
    this.setActiveExecutionId(execId);
    // Dynamic: time-aware opener that rotates every minute instead of one
    // canned line played identically on every launch.
    this.speakText(sessionGreetingLine(), true, execId, true);
  }

  /**
   * Activates the microphone and starts listening.
   * If ONEE is speaking, immediately triggers barge-in: stops TTS and listens.
   */
  public async startListening(): Promise<void> {
    audioController.unlockAudio().catch(() => {});

    if (this.preferences.mode === 'OFF') {
      // Elevate to LIVE_AGENT if user clicked mic
      await this.setMode('LIVE_AGENT');
    }

    // Barge-in: stop speech and any in-flight Browser Agent before a new capture.
    this.stopSpeaking();
    if (this.cancelAgentHandler) {
      this.cancelAgentHandler();
    }

    // Warm the audio output path while the student is speaking.
    this.prewarmSpeech();

    // Invalidate the previous utterance without permanently stopping the mic stream.
    this.invalidateSttSession();
    this.setState('LISTENING');
    oneeBridge.emitState('LISTENING', 'Listening...');
    const session = ++this.sttSession;
    const canonicalStt = resolveSttProviderPreference(this.preferences.sttMode);
    const useGroq = canonicalStt === 'groq' && groqWhisperProvider.isSupported();
    const requestExecutionId = `voice-req-${Date.now()}-${session}`;
    // Lifecycle boundary: one fresh request token per microphone press. Logs both
    // the configured and the actually selected STT provider (never just config).
    logVoiceDiagnostic('voice_request_created', 'voice-controller', {
      session,
      requestExecutionId,
      configuredStt: this.preferences.sttMode || 'unset',
      resolvedStt: canonicalStt,
      selectedProvider: useGroq ? groqWhisperProvider.name : 'unavailable',
      groqSupported: groqWhisperProvider.isSupported()
    }, requestExecutionId);
    let transcriptDelivered = false;
    let groqError: Error | null = null;

    /*
     * An interim transcript is NEVER an executable command. A VAD/short-pause
     * final from the capture layer ("hey, can you tell me…") is held in a
     * completion window: only sustained silence after the last recognized text
     * without any continuation audio counts as the FINAL transcript that may
     * reach intent resolution and the browser agent once, under one execution ID.
     */
    let pendingTranscript = '';
    let completionTimer: ReturnType<typeof setTimeout> | null = null;
    const COMPLETION_WINDOW_MS = VoiceController.STT_COMPLETION_WINDOW_MS;

    const deliverTranscriptOnce = () => {
      // A stale/cancelled session must never dispatch a command.
      if (session !== this.sttSession) return;
      if (completionTimer) {
        clearTimeout(completionTimer);
        completionTimer = null;
      }
      if (transcriptDelivered) {
        console.warn('[ONEE][STT] Duplicate transcript delivery prevented.');
        return;
      }
      const finalTranscript = pendingTranscript.trim();
      if (!finalTranscript) return;
      transcriptDelivered = true;
      console.info(
        `[ONEE][STT] SESSION=${session} STT_PROVIDER=groq STT_MODEL=${GroqWhisperProvider.WHISPER_MODEL} STT_STATUS=success TRANSCRIPT=FINAL`
      );
      // Canonical transcript boundary: after this event no recognition result may
      // mutate the transcript for this session.
      logVoiceDiagnostic('transcript_finalized', groqWhisperProvider.name,
        {
          session,
          provider: 'groq-whisper',
          model: GroqWhisperProvider.WHISPER_MODEL,
          transcriptLength: finalTranscript.length,
          transcript: finalTranscript
        }, requestExecutionId
      );
      this.handleVoiceCommand(finalTranscript, 'groq');
    };

    const scheduleTranscriptDelivery = () => {
      if (!pendingTranscript.trim() || transcriptDelivered) return;
      // Restart the completion window: only sustained silence after the last
      // recognized text turns the staged fragment into a FINAL transcript.
      if (completionTimer) clearTimeout(completionTimer);
      completionTimer = setTimeout(() => {
        completionTimer = null;
        deliverTranscriptOnce();
      }, COMPLETION_WINDOW_MS);
    };

    this.cancelSttCompletion = () => {
      if (completionTimer) {
        clearTimeout(completionTimer);
        completionTimer = null;
      }
    };

    const isCurrent = () => session === this.sttSession && !transcriptDelivered;
    const setTerminalError = (error: Error) => {
      if (completionTimer) {
        clearTimeout(completionTimer);
        completionTimer = null;
      }
      if (!isCurrent()) return;
      console.warn('[ONEE][STT] Voice request failed:', error.message);
      this.setState('ERROR', { error: error.message });
      setTimeout(() => {
        if (session === this.sttSession && !transcriptDelivered) this.setState('IDLE');
      }, 2500);
    };

    const onInterim = (interim: string) => {
      if (!isCurrent()) return;
      const text = (interim || '').trim();
      const lower = text.toLowerCase();
      if (lower.startsWith('transcribing')) {
        this.setState('TRANSCRIBING', { interimTranscript: text });
        return;
      }
      this.setState('LISTENING', { interimTranscript: text });
      if (!pendingTranscript) return;
      if (lower.startsWith('listening') && !lower.includes('speech detected')) return;
      scheduleTranscriptDelivery();
    };

    const onGroqFinal = (finalTranscript: string) => {
      console.info('[ONEE][STT] Groq Whisper returned the canonical transcript for this session.');
      const clean = finalTranscript.trim();
      if (!clean || !isCurrent()) return;
      pendingTranscript = clean;
      deliverTranscriptOnce();
    };

    /*
     * FINAL SPEC: Groq Whisper is the only transcription path. A Groq failure
     * is reported honestly as a terminal error — there is no browser
     * SpeechRecognition fallback anywhere in the runtime.
     */
    const onGroqError = (error: Error) => {
      if (!isCurrent()) return;
      groqError = error;
      logVoiceDiagnostic('groq_stt_request_failed', groqWhisperProvider.name, { session }, undefined, error.message);
      const isNetwork = /failed to fetch|networkerror|load failed|econnrefused/i.test(error.message);
      const hint = isNetwork
        ? ` Voice backend unreachable at ${getBackendUrl()}. Start the ONEE backend (uvicorn app.main:app) and retry.`
        : '';
      setTerminalError(new Error(`Groq Whisper transcription failed: ${error.message}.${hint}`));
    };

    const onGroqEnd = () => {
      if (!isCurrent()) return;
      if (!transcriptDelivered && !groqError) {
        setTerminalError(new Error('No speech was detected. Please try again.'));
      }
    };

    if (!useGroq) {
      setTerminalError(new Error('Audio recording (MediaRecorder) is not available in this browser.'));
      return;
    }

    console.info(
      `[ONEE][STT] STT_PROVIDER=groq STT_MODEL=${GroqWhisperProvider.WHISPER_MODEL} STT_STATUS=primary-active fallback=none sttMode=${canonicalStt}`
    );

    this.activeSttProvider = groqWhisperProvider;
    try {
      await groqWhisperProvider.start(onInterim, onGroqFinal, onGroqError, onGroqEnd);
    } catch (err: any) {
      groqError = groqError || new Error(err?.message || 'Groq Whisper failed to start.');
      logVoiceDiagnostic('groq_stt_request_failed', groqWhisperProvider.name, { session }, undefined, groqError.message);
      setTerminalError(groqError);
    }
  }

  /**
   * Ends the current STT session token and capture callbacks. Live microphone
   * tracks stay granted for the next press in this sidepanel session.
   */
  private invalidateSttSession(): void {
    this.sttSession += 1;
    if (this.cancelSttCompletion) {
      this.cancelSttCompletion();
      this.cancelSttCompletion = null;
    }
    groqWhisperProvider.abortUtterance(true);
    groqWhisperProvider.cancelPendingWork();
  }

  /**
   * Graceful stop: ends recording and lets the active provider transcribe
   * the captured audio. Does NOT abort or discard — that is what
   * invalidateSttSession() is for (barge-in / new request).
   */
  public stopListening(): void {
    // Cancel the staged-transcript completion window so it doesn't fire
    // after we've already told the provider to stop.
    if (this.cancelSttCompletion) {
      this.cancelSttCompletion();
      this.cancelSttCompletion = null;
    }

    // Stop the recorder gracefully. GroqWhisperProvider.stop() triggers
    // onstop → handleRecorderStop → transcribeBlob → onGroqFinal callback,
    // which delivers the transcript through the normal pipeline.
    if (this.activeSttProvider === groqWhisperProvider) {
      groqWhisperProvider.stop();
    }

    // Show TRANSCRIBING while Groq processes the audio; the transcript
    // callback will transition to UNDERSTANDING → IDLE.
    if (this.state === 'LISTENING') {
      this.setState('TRANSCRIBING');
    }
  }

  /**
   * Immediately stops speech and flushes audio queue.
   */
  public stopSpeaking(): void {
    this.voiceQueue.cancel();
    audioController.stop('stop_speaking');
    if (this.state === 'SPEAKING') {
      this.setState('IDLE');
    }
  }

  /**
   * User voice interruption command ("stop", "cancel", "hold on").
   */
  public handleInterruption(): void {
    this.stopSpeaking();
    // Hard abort: discard any in-flight recording and transcription
    this.invalidateSttSession();
    // Release the microphone so the OS/Chrome mic indicator turns off while
    // idle (no half-open stream survives an interruption).
    groqWhisperProvider.abort();
    if (this.state === 'LISTENING' || this.state === 'TRANSCRIBING') {
      this.setState('IDLE');
    }

    if (this.cancelAgentHandler) {
      this.cancelAgentHandler();
    }

    oneeBridge.emitState('CANCELLED', 'Stopped');
    this.setState('CANCELLED');

    const interruptId = `interrupt-${Date.now()}`;
    this.setActiveExecutionId(interruptId);
    this.voiceQueue.enqueue("Stopped.", {
      priority: 'HIGH',
      executionId: interruptId,
      providerPreference: 'auto'
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
  private async handleVoiceCommand(transcript: string, sttProvider: 'groq' | 'local' = 'groq') {
    this.invalidateSttSession();
    // The capture session is over (transcript finalized): release the
    // microphone so the OS/Chrome mic indicator turns OFF while idle.
    groqWhisperProvider.abort();
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

    const voiceExecId = `voice-${Date.now()}`;
    voiceProfiler.record(voiceExecId, 'inputReceived');
    voiceProfiler.record(voiceExecId, 'sttFinal');
    oneeBridge.emit(
      'onMicResult',
      `Heard via ${sttProvider === 'groq' ? 'Groq Whisper' : 'browser fallback'} (${voiceExecId})`
    );
    oneeBridge.emit('executionTelemetry', `FINAL_TRANSCRIPT_READY (${voiceExecId})`);

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
    voiceProfiler.record(executionId, 'inputReceived');
    voiceProfiler.record(executionId, 'narrationRequested');
    this.narrationManager.acknowledgeGoal(goal, executionId);
  }

  public speakVerifiedResult(finalResponse: FinalResponseData, executionId?: string) {
    if (executionId) {
      voiceProfiler.record(executionId, 'finalResponseGenerated');
    }
    this.narrationManager.speakVerifiedResult(finalResponse, executionId);
  }

  public speakText(text: string, isFinal: boolean = false, executionId?: string, force: boolean = false) {
    if (!force && this.preferences.mode === 'OFF') return;
    audioController.unlockAudio().catch(() => {});
    const effectiveExecId = executionId || `speak_${Date.now()}`;
    if (!executionId || force) {
      this.setActiveExecutionId(effectiveExecId);
    }
    if (isFinal) {
      // The final spoken event is always the separate Sofia summary, never the
      // canonical chatbot response itself.
      console.info('[ONEE][VOICE_EVENT] SOFIA_FINAL_SUMMARY staged for speaking.');
    }
    this.voiceQueue.enqueue(text, {
      priority: isFinal ? 'FINAL_RESULT' : 'LOW',
      executionId: effectiveExecId,
      isFinalResult: isFinal,
      providerPreference: 'auto',
      force
    });
  }

  public setActiveExecutionId(executionId: string | null) {
    this.voiceQueue.setActiveExecutionId(executionId);
    audioController.setActiveExecutionId(executionId);
  }

  public getActiveExecutionId(): string | null {
    return this.voiceQueue.getActiveExecutionId();
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
        const data = await chrome.storage.local.get([STORAGE_KEY, 'onee_voice_preferences_v2']);
        const loaded = data[STORAGE_KEY] || data['onee_voice_preferences_v2'];
        if (loaded) {
          const cleanVoice = loaded.voiceURI && (KOKORO_VOICE_URIS as readonly string[]).includes(loaded.voiceURI)
            ? loaded.voiceURI
            : DEFAULT_KOKORO_VOICE_URI;

          this.preferences = {
            ...DEFAULT_VOICE_PREFERENCES,
            ...loaded,
            // FINAL SPEC: Groq Orpheus is the only TTS provider and Groq Whisper
            // is the only STT provider. Stale stored values written by old
            // builds (kokoro/native/local/browser) are migrated to Groq here so
            // the user never has to reselect after a code fix.
            primaryProvider: 'groq',
            fallbackProvider: 'none',
            preferLocalTts: false,
            voiceURI: cleanVoice,
            sttMode: 'groq',
            enabled: loaded.mode !== 'OFF',
            mode: loaded.mode === 'OFF' ? 'OFF' : 'LIVE_AGENT'
          };
          this.voiceQueue.updatePreferences(this.preferences);
          this.narrationManager.updatePreferences(this.preferences);
          await this.savePreferences();
          this.playSessionGreeting();
        } else {
          this.playSessionGreeting();
        }
      } else {
        this.playSessionGreeting();
      }
    } catch (err) {
      console.warn('[VoiceController] Error loading preferences from storage:', err);
      this.playSessionGreeting();
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
