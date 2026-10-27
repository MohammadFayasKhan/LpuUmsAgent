/*
 * Non-Blocking Audio Controller for ONEE.
 *
 * Decouples audio queueing, Web Audio API playback, volume control,
 * and execution cancellation from Browser Agent execution and VoiceQueue.
 *
 * Guarantees:
 * 1. Zero Blocking: enqueue() returns immediately without awaiting playback.
 * 2. Execution ID Isolation: Stale execution audio is dropped before or during playback.
 * 3. Preemption: FINAL_RESULT immediately stops lower-priority progress narration.
 * 4. Dual Engine: Web Audio API (primary) with HTMLAudioElement fallback.
 * 5. Barge-In: Clean and immediate audio stoppage on user interruption.
 */

import { SpeechPriority } from './VoiceTypes';
import { logVoiceDiagnostic } from './VoiceDiagnostics';
import { oneeBridge } from '../lib/oneeEvents';

export interface AudioPlaybackItem {
  id: string;
  executionId?: string;
  audioData: Float32Array;
  sampleRate: number;
  priority?: SpeechPriority;
  isFinalResult?: boolean;
  force?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
}

let sharedAudioContext: AudioContext | null = null;

export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return null;

  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new AudioCtx();
  }

  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume().catch(() => {});
  }

  return sharedAudioContext;
}

export class AudioController {
  private static instance: AudioController;

  private queue: AudioPlaybackItem[] = [];
  private currentItem: AudioPlaybackItem | null = null;
  private isCurrentlyPlaying: boolean = false;
  private activeExecutionId: string | null = null;
  private volume: number = 1.0;

  private currentSourceNode: AudioBufferSourceNode | null = null;
  private currentGainNode: GainNode | null = null;
  private currentAudioElement: HTMLAudioElement | null = null;

  private listeners: Set<(isPlaying: boolean, item: AudioPlaybackItem | null) => void> = new Set();

  private constructor() {}

  public static getInstance(): AudioController {
    if (!AudioController.instance) {
      AudioController.instance = new AudioController();
    }
    return AudioController.instance;
  }

  public subscribe(listener: (isPlaying: boolean, item: AudioPlaybackItem | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.isCurrentlyPlaying, this.currentItem);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setActiveExecutionId(executionId: string | null): void {
    if (this.activeExecutionId !== executionId) {
      this.activeExecutionId = executionId;

      if (executionId !== null) {
        // Discard any queued items from older executions (unless forced)
        this.queue = this.queue.filter(
          (item) => Boolean(item.force) || !item.executionId || item.executionId === executionId
        );

        // If currently playing item belongs to an older execution, stop it immediately (unless forced)
        if (this.currentItem?.executionId && this.currentItem.executionId !== executionId && !this.currentItem.force) {
          logVoiceDiagnostic('AUDIO_STOPPED', 'AudioController', {
            reason: 'execution_id_mismatch',
            stoppedExecId: this.currentItem.executionId,
            newExecId: executionId
          });
          this.stopCurrentPlayback();
        }
      }
    }
  }

  public getActiveExecutionId(): string | null {
    return this.activeExecutionId;
  }

  /**
   * Explicitly resumes the AudioContext and unlocks browser autoplay restrictions
   * on the first user interaction (button click, voice toggle, mic press).
   */
  public async unlockAudio(): Promise<void> {
    const audioCtx = getSharedAudioContext();
    if (!audioCtx) return;

    try {
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }
      // Play a 1-sample silent node to activate hardware output pipeline
      const silentBuffer = audioCtx.createBuffer(1, 1, 24000);
      const source = audioCtx.createBufferSource();
      source.buffer = silentBuffer;
      source.connect(audioCtx.destination);
      source.start(0);

      logVoiceDiagnostic('AUDIO_READY', 'AudioController', {
        state: audioCtx.state,
        sampleRate: audioCtx.sampleRate
      });
    } catch (err: any) {
      console.warn('[AudioController] Error unlocking audio context:', err);
    }
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.currentGainNode && sharedAudioContext) {
      try {
        this.currentGainNode.gain.setValueAtTime(this.volume, sharedAudioContext.currentTime);
      } catch {}
    }
    if (this.currentAudioElement) {
      this.currentAudioElement.volume = this.volume;
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  /**
   * Enqueues audio and resolves only after that item has finished playing,
   * been dropped as stale, or been intentionally stopped.
   */
  public enqueueAndWait(item: AudioPlaybackItem): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const originalEnd = item.onEnd;
      const originalErr = item.onError;
      item.onEnd = () => {
        originalEnd?.();
        finish();
      };
      item.onError = (err) => {
        originalErr?.(err);
        finish();
      };
      this.enqueue(item);
    });
  }

  /**
   * Enqueues an audio buffer for immediate playback.
   * Completely fire-and-forget: returns immediately without blocking caller!
   */
  public enqueue(item: AudioPlaybackItem): void {
    // Drop immediately if execution is stale
    if (
      item.executionId &&
      this.activeExecutionId &&
      item.executionId !== this.activeExecutionId
    ) {
      logVoiceDiagnostic('AUDIO_STOPPED', 'AudioController', {
        reason: 'dropped_stale_item_on_enqueue',
        itemExecId: item.executionId,
        activeExecId: this.activeExecutionId
      });
      item.onEnd?.();
      return;
    }

    // Preemption: FINAL_RESULT clears lower-priority queued items and interrupts progress speech
    if (item.priority === 'FINAL_RESULT') {
      this.queue = this.queue.filter((q) => q.priority === 'FINAL_RESULT');
      if (this.currentItem && this.currentItem.priority !== 'FINAL_RESULT') {
        this.stopCurrentPlayback();
      }
      this.queue.push(item);
    } else {
      this.queue.push(item);
    }

    if (!this.isCurrentlyPlaying) {
      this.playNext();
    }
  }

  /**
   * Non-blocking playback loop.
   */
  private playNext(): void {
    if (this.queue.length === 0) {
      this.isCurrentlyPlaying = false;
      this.currentItem = null;
      this.notifyListeners();
      oneeBridge.emitState('IDLE');
      return;
    }

    const nextItem = this.queue.shift();
    if (!nextItem) return;

    // Check execution validity before playing (unless forced)
    if (
      !nextItem.force &&
      nextItem.executionId &&
      this.activeExecutionId &&
      nextItem.executionId !== this.activeExecutionId
    ) {
      logVoiceDiagnostic('AUDIO_STOPPED', 'AudioController', {
        reason: 'dropped_stale_item_before_play',
        itemExecId: nextItem.executionId,
        activeExecId: this.activeExecutionId
      });
      nextItem.onEnd?.();
      this.playNext();
      return;
    }

    this.currentItem = nextItem;
    this.isCurrentlyPlaying = true;
    this.notifyListeners();
    oneeBridge.emitState('SPEAKING', 'Speaking 🔊');

    logVoiceDiagnostic('AUDIO_PLAYING', 'AudioController', {
      itemId: nextItem.id,
      executionId: nextItem.executionId,
      sampleRate: nextItem.sampleRate,
      audioLength: nextItem.audioData.length
    });

    try {
      this.playViaWebAudio(nextItem);
    } catch (err: any) {
      logVoiceDiagnostic('TTS_ERROR', 'AudioController', {
        error: 'WebAudio failed, attempting fallback to HTMLAudioElement',
        details: err?.message
      });
      this.playViaAudioElement(nextItem);
    }
  }

  private async playViaWebAudio(item: AudioPlaybackItem): Promise<void> {
    const audioCtx = getSharedAudioContext();
    if (!audioCtx) {
      this.playViaAudioElement(item);
      return;
    }

    if (audioCtx.state === 'suspended') {
      try {
        await audioCtx.resume();
      } catch (e) {
        console.warn('[AudioController] Error resuming AudioContext:', e);
      }
      // If still suspended after resume attempt, fallback to HTMLAudioElement
      if (audioCtx.state === 'suspended') {
        this.playViaAudioElement(item);
        return;
      }
    }

    const buffer = audioCtx.createBuffer(1, item.audioData.length, item.sampleRate);
    buffer.getChannelData(0).set(item.audioData);

    const source = audioCtx.createBufferSource();
    source.buffer = buffer;

    const gainNode = audioCtx.createGain();
    gainNode.gain.setValueAtTime(this.volume, audioCtx.currentTime);

    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    this.currentSourceNode = source;
    this.currentGainNode = gainNode;

    logVoiceDiagnostic('PLAYING', 'AudioController', {
      itemId: item.id,
      sampleRate: item.sampleRate,
      samples: item.audioData.length,
      durationSec: (item.audioData.length / item.sampleRate).toFixed(2),
      audioContextState: audioCtx.state
    }, item.executionId);

    item.onStart?.();

    const durationMs = (item.audioData.length / item.sampleRate) * 1000;
    let didEnd = false;

    const finalize = () => {
      if (didEnd) return;
      didEnd = true;
      if (this.currentSourceNode === source) {
        this.currentSourceNode = null;
        this.currentGainNode = null;
        item.onEnd?.();
        this.playNext();
      }
    };

    // Safety watchdog: ensure queue never hangs if browser event is delayed
    const watchdog = setTimeout(finalize, durationMs + 800);

    source.onended = () => {
      clearTimeout(watchdog);
      finalize();
    };

    source.start(0);
  }

  private playViaAudioElement(item: AudioPlaybackItem): void {
    try {
      const wavBlob = this.encodeWAV(item.audioData, item.sampleRate);
      const url = URL.createObjectURL(wavBlob);
      const audio = new Audio(url);
      audio.volume = this.volume;

      this.currentAudioElement = audio;
      item.onStart?.();

      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (this.currentAudioElement === audio) {
          this.currentAudioElement = null;
          item.onEnd?.();
          this.playNext();
        }
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (this.currentAudioElement === audio) {
          this.currentAudioElement = null;
          item.onError?.(new Error('Audio element playback error'));
          this.playNext();
        }
      };

      audio.play().catch((err) => {
        URL.revokeObjectURL(url);
        if (this.currentAudioElement === audio) {
          this.currentAudioElement = null;
          item.onError?.(err);
          this.playNext();
        }
      });
    } catch (err: any) {
      item.onError?.(err);
      this.playNext();
    }
  }

  private stopCurrentPlayback(): void {
    if (this.currentSourceNode) {
      try {
        this.currentSourceNode.stop();
        this.currentSourceNode.disconnect();
      } catch {}
      this.currentSourceNode = null;
    }
    if (this.currentGainNode) {
      try {
        this.currentGainNode.disconnect();
      } catch {}
      this.currentGainNode = null;
    }
    if (this.currentAudioElement) {
      try {
        this.currentAudioElement.pause();
        this.currentAudioElement.currentTime = 0;
      } catch {}
      this.currentAudioElement = null;
    }
  }

  /**
   * Immediately stops all current audio and clears the playback queue.
   */
  public stop(reason: string = 'manual_stop'): void {
    const current = this.currentItem;
    const pending = [...this.queue];
    this.stopCurrentPlayback();
    this.queue = [];
    this.isCurrentlyPlaying = false;
    this.currentItem = null;
    current?.onEnd?.();
    pending.forEach((item) => item.onEnd?.());
    this.notifyListeners();
    oneeBridge.emitState('IDLE');
    logVoiceDiagnostic('AUDIO_STOPPED', 'AudioController', { reason });
  }

  /**
   * Cancels all audio playback and queue items for a given executionId.
   */
  public cancelExecution(executionId: string): void {
    this.queue = this.queue.filter((item) => item.executionId !== executionId);
    if (this.currentItem?.executionId === executionId) {
      this.stopCurrentPlayback();
      this.playNext();
    }
  }

  public pause(): void {
    if (sharedAudioContext && sharedAudioContext.state === 'running') {
      sharedAudioContext.suspend().catch(() => {});
    }
    if (this.currentAudioElement) {
      this.currentAudioElement.pause();
    }
  }

  public resume(): void {
    if (sharedAudioContext && sharedAudioContext.state === 'suspended') {
      sharedAudioContext.resume().catch(() => {});
    }
    if (this.currentAudioElement) {
      this.currentAudioElement.play().catch(() => {});
    }
  }

  public isSpeaking(): boolean {
    return this.isCurrentlyPlaying;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener(this.isCurrentlyPlaying, this.currentItem);
      } catch {}
    });
  }

  /**
   * Converts Float32Array PCM to standard 16-bit PCM WAV Blob for fallback audio element.
   */
  private encodeWAV(samples: Float32Array, sampleRate: number): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    // RIFF chunk descriptor
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');

    // FMT sub-chunk
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // Byte rate
    view.setUint16(32, 2, true); // Block align
    view.setUint16(34, 16, true); // 16-bit

    // Data sub-chunk
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);

    // Write samples
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return new Blob([view], { type: 'audio/wav' });
  }
}

export const audioController = AudioController.getInstance();

// Auto-unlock WebAudio context upon first student gesture in the extension UI
if (typeof window !== 'undefined') {
  const unlock = () => {
    audioController.unlockAudio().catch(() => {});
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
  window.addEventListener('click', unlock, { passive: true });
}
