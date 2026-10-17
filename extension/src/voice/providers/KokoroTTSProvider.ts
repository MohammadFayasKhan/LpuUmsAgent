/*
 * Kokoro-82M Local In-Browser TTS Provider for ONEE.
 *
 * Runs on-device model inference inside a dedicated Web Worker (kokoro.worker.ts),
 * keeping the extension main UI thread completely responsive (60fps scrolling,
 * typing, React rendering, and Browser Agent execution).
 *
 * ARCHITECTURE: Fully non-blocking fire-and-forget pipeline.
 * speak() dispatches to the Worker and returns IMMEDIATELY.
 * Worker responses are handled asynchronously via message callbacks
 * that directly enqueue PCM audio into AudioController.
 *
 * Audio playback is handled independently by AudioController.
 */

import {
  ISpeechSynthesisProvider,
  SpeechSynthesisOptions,
  AvailableVoice,
  SpeechPriority
} from '../VoiceTypes';
import { audioController } from '../AudioController';
import { logVoiceDiagnostic } from '../VoiceDiagnostics';
import { voiceProfiler } from '../VoicePerformanceProfiler';
import { oneeBridge } from '../../lib/oneeEvents';
import { transformSpeechIdentity } from '../VoiceProvider';

export interface KokoroSpeakOptions extends SpeechSynthesisOptions {
  executionId?: string;
  priority?: SpeechPriority;
  isFinalResult?: boolean;
}

export class KokoroTTSProvider implements ISpeechSynthesisProvider {
  public name: string = 'kokoro-82m-tts';

  private worker: Worker | null = null;
  private workerInitPromise: Promise<void> | null = null;
  private lifecycleState: 'idle' | 'initializing' | 'ready' | 'generating' | 'playing' | 'error' = 'idle';
  private lastError: Error | null = null;
  private currentRequestId: number = 0;

  // Pending requests for generateAudio() (the rare synchronous path)
  private pendingRequests: Map<
    string,
    {
      resolve: (val: { audioData: Float32Array; sampleRate: number }) => void;
      reject: (err: Error) => void;
      executionId?: string;
    }
  > = new Map();

  // Fire-and-forget speech callbacks: Worker response → AudioController enqueue
  private fireAndForgetCallbacks: Map<
    string,
    {
      executionId?: string;
      priority?: SpeechPriority;
      isFinalResult?: boolean;
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (err: Error) => void;
      resolve?: () => void;
      reject?: (err: Error) => void;
    }
  > = new Map();

  constructor() {
    this.ensureWorker();
  }

  public getLifecycleState(): 'idle' | 'initializing' | 'ready' | 'generating' | 'playing' | 'error' {
    if (audioController.isSpeaking()) {
      return 'playing';
    }
    return this.lifecycleState;
  }

  public isSupported(): boolean {
    return typeof WebAssembly !== 'undefined';
  }

  private ensureWorker(): void {
    if (this.worker || typeof Worker === 'undefined') return;

    try {
      this.worker = new Worker(new URL('../kokoro.worker.ts', import.meta.url), {
        type: 'module'
      });

      this.worker.onmessage = (event: MessageEvent) => {
        this.handleWorkerMessage(event.data);
      };

      this.worker.onerror = (err) => {
        console.warn('[KokoroTTSProvider] Worker error:', err);
        this.lifecycleState = 'error';
        this.lastError = new Error('Kokoro Web Worker execution failed');
      };
    } catch (e: any) {
      console.warn('[KokoroTTSProvider] Could not spawn Web Worker:', e);
      this.worker = null;
    }
  }

  private handleWorkerMessage(data: any): void {
    if (!data || !data.type) return;

    switch (data.type) {
      case 'READY':
        this.lifecycleState = 'ready';
        this.lastError = null;
        logVoiceDiagnostic('TTS_READY', this.name, { model: data.model });
        break;

      case 'AUDIO_CHUNK': {
        const { id, audioData, sampleRate, executionId } = data;
        logVoiceDiagnostic('AUDIO_READY', this.name, {
          sampleRate,
          samples: audioData ? audioData.length : 0,
          durationSec: audioData ? (audioData.length / sampleRate).toFixed(2) : 0
        }, executionId);
        if (executionId) {
          voiceProfiler.record(executionId, 'firstAudioReady');
        }

        // Handle synchronous generateAudio() requests
        const pending = this.pendingRequests.get(id);
        if (pending) {
          this.pendingRequests.delete(id);
          this.lifecycleState = 'ready';
          pending.resolve({ audioData, sampleRate });
          break;
        }

        // Handle fire-and-forget speak() requests → enqueue directly into AudioController
        const callbacks = this.fireAndForgetCallbacks.get(id);
        if (callbacks) {
          this.fireAndForgetCallbacks.delete(id);
          this.lifecycleState = 'ready';

          if (audioData.length === 0) {
            callbacks.onEnd?.();
            callbacks.reject?.(new Error('Kokoro returned empty audio'));
            break;
          }

          audioController.enqueue({
            id: `audio-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            executionId: callbacks.executionId,
            audioData,
            sampleRate,
            priority: callbacks.priority,
            isFinalResult: callbacks.isFinalResult,
            onStart: () => {
              if (callbacks.executionId) {
                voiceProfiler.record(callbacks.executionId, 'firstAudioPlayed');
              }
              callbacks.onStart?.();
            },
            onEnd: () => {
              if (callbacks.executionId && callbacks.isFinalResult) {
                voiceProfiler.record(callbacks.executionId, 'finalAudioPlayed');
              }
              callbacks.onEnd?.();
            },
            onError: (err) => {
              callbacks.onError?.(err);
            }
          });
          // A successful provider attempt means audio has been generated and
          // accepted by the shared AudioController, not merely dispatched.
          callbacks.resolve?.();
        }
        break;
      }

      case 'GENERATE_ERROR': {
        const { id, error } = data;

        // Handle synchronous path
        const pending = this.pendingRequests.get(id);
        if (pending) {
          this.pendingRequests.delete(id);
          this.lifecycleState = 'ready';
          pending.reject(new Error(error));
          break;
        }

        // Handle fire-and-forget path
        const callbacks = this.fireAndForgetCallbacks.get(id);
        if (callbacks) {
          this.fireAndForgetCallbacks.delete(id);
          this.lifecycleState = 'ready';
          logVoiceDiagnostic('TTS_ERROR', this.name, { error, requestId: id });
          callbacks.onError?.(new Error(error));
          callbacks.reject?.(new Error(error));
        }
        break;
      }

      case 'CANCELLED': {
        const { id } = data;
        const pending = this.pendingRequests.get(id);
        if (pending) {
          this.pendingRequests.delete(id);
          this.lifecycleState = 'ready';
        }
        const callbacks = this.fireAndForgetCallbacks.get(id);
        if (callbacks) {
          this.fireAndForgetCallbacks.delete(id);
          this.lifecycleState = 'ready';
          callbacks.reject?.(new Error('Kokoro synthesis cancelled'));
        }
        break;
      }

      case 'ERROR': {
        this.lifecycleState = 'error';
        this.lastError = new Error(data.error);
        logVoiceDiagnostic('TTS_ERROR', this.name, { error: data.error });
        break;
      }

      default:
        break;
    }
  }

  public async initialize(): Promise<void> {
    if (this.lifecycleState === 'ready') return;
    if (this.workerInitPromise) return this.workerInitPromise;

    this.ensureWorker();
    this.lifecycleState = 'initializing';
    logVoiceDiagnostic('TTS_INITIALIZING', this.name, { model: 'Kokoro-82M-v1.0-ONNX' });

    this.workerInitPromise = new Promise((resolve, reject) => {
      if (!this.worker) {
        // Fallback for non-worker environments (e.g., node / vitest test runners)
        this.lifecycleState = 'ready';
        logVoiceDiagnostic('TTS_READY', this.name, { environment: 'mock_worker_fallback' });
        resolve();
        return;
      }

      let wasmBase: string | undefined;
      let voicesBase: string | undefined;

      if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
        wasmBase = chrome.runtime.getURL('wasm/');
        voicesBase = chrome.runtime.getURL('voices/');
      }

      const timeout = setTimeout(() => {
        if (this.lifecycleState === 'initializing') {
          this.lifecycleState = 'error';
          this.lastError = new Error('Kokoro model initialization timed out after 12 seconds');
          logVoiceDiagnostic('TTS_ERROR', this.name, { error: this.lastError.message });
          reject(this.lastError);
        }
      }, 12000);

      const onReady = (event: MessageEvent) => {
        if (event.data?.type === 'READY') {
          clearTimeout(timeout);
          this.worker?.removeEventListener('message', onReady);
          this.lifecycleState = 'ready';
          this.lastError = null;
          logVoiceDiagnostic('TTS_READY', this.name, { model: event.data.model });
          resolve();
        } else if (event.data?.type === 'ERROR') {
          clearTimeout(timeout);
          this.worker?.removeEventListener('message', onReady);
          this.lifecycleState = 'error';
          this.lastError = new Error(event.data.error);
          logVoiceDiagnostic('TTS_ERROR', this.name, { error: event.data.error });
          reject(this.lastError);
        }
      };

      this.worker.addEventListener('message', onReady);
      this.worker.postMessage({ type: 'INIT', wasmBase, voicesBase });
    });

    return this.workerInitPromise;
  }

  public async getAvailableVoices(): Promise<AvailableVoice[]> {
    return [
      { name: 'Kokoro Heart (US Female - Default)', lang: 'en-US', voiceURI: 'af_heart', default: true },
      { name: 'Kokoro Bella (US Female)', lang: 'en-US', voiceURI: 'af_bella' },
      { name: 'Kokoro Nicole (US Female)', lang: 'en-US', voiceURI: 'af_nicole' },
      { name: 'Kokoro Sky (US Female)', lang: 'en-US', voiceURI: 'af_sky' },
      { name: 'Kokoro Sarah (US Female)', lang: 'en-US', voiceURI: 'af_sarah' },
      { name: 'Kokoro Adam (US Male)', lang: 'en-US', voiceURI: 'am_adam' },
      { name: 'Kokoro Michael (US Male)', lang: 'en-US', voiceURI: 'am_michael' },
      { name: 'Kokoro Emma (UK Female)', lang: 'en-GB', voiceURI: 'bf_emma' },
      { name: 'Kokoro George (UK Male)', lang: 'en-GB', voiceURI: 'bm_george' }
    ];
  }

  /**
   * Generates audio for text via the dedicated Web Worker off the main UI thread.
   * This is the SYNCHRONOUS path that awaits audio data. Used only when the caller
   * explicitly needs the raw PCM buffer (e.g., for testing or advanced use cases).
   *
   * For normal speech, use speak() which is fully fire-and-forget.
   */
  public async generateAudio(
    text: string,
    options?: SpeechSynthesisOptions,
    executionId?: string
  ): Promise<{ audioData: Float32Array; sampleRate: number }> {
    await this.initialize();

    const trimmed = text.trim();
    if (!trimmed) {
      return { audioData: new Float32Array(0), sampleRate: 24000 };
    }

    const reqId = `gen-${Date.now()}-${++this.currentRequestId}`;
    this.lifecycleState = 'generating';

    if (executionId) {
      voiceProfiler.record(executionId, 'kokoroStarted');
    }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(reqId, { resolve, reject, executionId });

      if (!this.worker) {
        // Fallback for mock/test environments
        const mockAudio = new Float32Array(2400);
        this.pendingRequests.delete(reqId);
        this.lifecycleState = 'ready';
        resolve({ audioData: mockAudio, sampleRate: 24000 });
        return;
      }

      let wasmBase: string | undefined;
      let voicesBase: string | undefined;

      if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
        wasmBase = chrome.runtime.getURL('wasm/');
        voicesBase = chrome.runtime.getURL('voices/');
      }

      this.worker.postMessage({
        type: 'GENERATE',
        id: reqId,
        text: trimmed,
        voice: options?.voiceURI || 'af_heart',
        speed: options?.rate ?? 1.0,
        executionId,
        wasmBase,
        voicesBase
      });
    });
  }

  /**
   * FULLY NON-BLOCKING speech synthesis.
   *
   * Dispatches text to the Kokoro Worker and returns IMMEDIATELY.
   * The Worker will generate audio asynchronously and the response handler
   * will enqueue the resulting PCM buffer into AudioController.
   *
   * The caller (VoiceQueue) NEVER waits for generation or playback.
   * This is the critical architectural change that prevents UI freezes.
   */
  public async speak(
    text: string,
    options?: KokoroSpeakOptions
  ): Promise<void> {
    const sanitized = transformSpeechIdentity(text);
    const trimmed = sanitized.trim();
    if (!trimmed) {
      options?.onEnd?.();
      return;
    }

    // Ensure worker is initialized (this is the only potentially slow part,
    // but it only happens once per session and the init promise is cached)
    await this.initialize();

    const executionId = options?.executionId;
    const reqId = `speak-${Date.now()}-${++this.currentRequestId}`;

    logVoiceDiagnostic('TTS_GENERATING', this.name, {
      textLength: trimmed.length,
      voice: options?.voiceURI || 'af_heart',
      executionId,
      requestId: reqId
    }, executionId);

    if (executionId) {
      voiceProfiler.record(executionId, 'kokoroStarted');
    }

    // Resolve only after the worker has produced valid audio and it has been
    // handed to AudioController. This lets VoiceQueue safely fall back when
    // worker generation fails or hangs.
    const audioAccepted = new Promise<void>((resolve, reject) => {
      this.fireAndForgetCallbacks.set(reqId, {
        executionId,
        priority: options?.priority,
        isFinalResult: options?.isFinalResult,
        onStart: options?.onStart,
        onEnd: options?.onEnd,
        onError: options?.onError,
        resolve,
        reject
      });
    });

    if (!this.worker) {
      // Test/mock environment: simulate immediate response
      const mockAudio = new Float32Array(2400);
      const callbacks = this.fireAndForgetCallbacks.get(reqId);
      this.fireAndForgetCallbacks.delete(reqId);
      audioController.enqueue({
        id: `audio-mock-${Date.now()}`,
        executionId,
        audioData: mockAudio,
        sampleRate: 24000,
        priority: options?.priority,
        isFinalResult: options?.isFinalResult,
        onStart: options?.onStart,
        onEnd: options?.onEnd,
        onError: options?.onError
      });
      callbacks?.resolve?.();
      return audioAccepted;
    }

    let wasmBase: string | undefined;
    let voicesBase: string | undefined;

    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      wasmBase = chrome.runtime.getURL('wasm/');
      voicesBase = chrome.runtime.getURL('voices/');
    }

    // FIRE AND FORGET: dispatch to Worker and return immediately
    this.worker.postMessage({
      type: 'GENERATE',
      id: reqId,
      text: trimmed,
      voice: options?.voiceURI || 'af_heart',
      speed: options?.rate ?? 1.0,
      executionId,
      wasmBase,
      voicesBase
    });

    return audioAccepted;
  }

  /**
   * Immediately stops active speech and cancels worker inference.
   */
  public stop(): void {
    this.currentRequestId++;
    audioController.stop();

    if (this.worker) {
      this.worker.postMessage({ type: 'CLEAR_CANCELLATIONS' });
    }

    // Reject all synchronous pending requests
    this.pendingRequests.forEach((req) => {
      req.reject(new Error('TTS cancelled by user'));
    });
    this.pendingRequests.clear();

    // Reject all pending provider attempts so the queue can discard cancelled
    // work rather than wait for a worker response that will never be used.
    this.fireAndForgetCallbacks.forEach((callbacks) => {
      callbacks.reject?.(new Error('Kokoro synthesis cancelled'));
    });
    this.fireAndForgetCallbacks.clear();

    this.lifecycleState = 'ready';
    oneeBridge.emitState('IDLE');
    logVoiceDiagnostic('STOPPING', this.name, { reason: 'user_stop' });
  }

  public pause(): void {
    audioController.pause();
  }

  public resume(): void {
    audioController.resume();
  }

  public isSpeaking(): boolean {
    return audioController.isSpeaking();
  }
}

export const kokoroTTSProvider = new KokoroTTSProvider();
