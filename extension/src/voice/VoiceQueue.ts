/*
 * Voice Queue & Speech Synchronizer for ONEE.
 *
 * Coordinates spoken utterances, sentence chunking, prioritization,
 * and strict execution ID validation to prevent stale speech callbacks.
 */

import {
  VoiceQueueItem,
  VoicePreferences,
  ISpeechSynthesisProvider
} from './VoiceTypes';
import { chunkSpeechText } from './VoiceProvider';
import { nativeSpeechSynthesisProvider } from './providers/NativeSpeechSynthesisProvider';
import { groqOrpheusProvider } from './providers/GroqOrpheusProvider';

export class VoiceQueue {
  private queue: VoiceQueueItem[] = [];
  private isProcessing: boolean = false;
  private currentItem: VoiceQueueItem | null = null;
  private activeExecutionId: string | null = null;
  private preferences: VoicePreferences;
  private onStateChange?: (isSpeaking: boolean, currentItem: VoiceQueueItem | null) => void;

  public getCurrentItem(): VoiceQueueItem | null {
    return this.currentItem;
  }

  constructor(preferences: VoicePreferences, onStateChange?: (isSpeaking: boolean, item: VoiceQueueItem | null) => void) {
    this.preferences = preferences;
    this.onStateChange = onStateChange;
  }

  public updatePreferences(prefs: Partial<VoicePreferences>) {
    this.preferences = { ...this.preferences, ...prefs };
  }

  public setActiveExecutionId(executionId: string | null) {
    if (this.activeExecutionId !== executionId) {
      this.activeExecutionId = executionId;
      // Prune any queued items that belonged to a previous execution
      if (executionId !== null) {
        this.queue = this.queue.filter((item) => !item.executionId || item.executionId === executionId);
      }
    }
  }

  public getActiveExecutionId(): string | null {
    return this.activeExecutionId;
  }

  /**
   * Enqueues speech text with sentence-level chunking.
   * If priority is HIGH, interrupts immediately and prepends to queue.
   */
  public enqueue(
    text: string,
    options: {
      priority?: 'HIGH' | 'NORMAL' | 'LOW';
      executionId?: string;
      isFinalResult?: boolean;
      providerPreference?: 'native' | 'groq' | 'auto';
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (err: Error) => void;
    } = {}
  ): string[] {
    if (!this.preferences.enabled || this.preferences.mode === 'OFF') {
      options.onEnd?.();
      return [];
    }

    const trimmed = text.trim();
    if (!trimmed) {
      options.onEnd?.();
      return [];
    }

    // High priority (e.g. cancellation / stop) interrupts any active low/normal speech
    if (options.priority === 'HIGH') {
      this.stopCurrent();
      this.clear();
    }

    const chunks = chunkSpeechText(trimmed);
    const itemIds: string[] = [];

    chunks.forEach((chunkText, idx) => {
      const id = `speech-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      itemIds.push(id);

      const item: VoiceQueueItem = {
        id,
        text: chunkText,
        priority: options.priority || 'NORMAL',
        executionId: options.executionId ?? (this.activeExecutionId || undefined),
        isFinalResult: Boolean(options.isFinalResult && idx === chunks.length - 1),
        providerPreference: options.providerPreference || 'auto',
        onStart: idx === 0 ? options.onStart : undefined,
        onEnd: idx === chunks.length - 1 ? options.onEnd : undefined,
        onError: options.onError
      };

      if (options.priority === 'HIGH') {
        this.queue.unshift(item);
      } else {
        this.queue.push(item);
      }
    });

    this.processNext();
    return itemIds;
  }

  /**
   * Processes the next speech item from the queue.
   */
  private async processNext() {
    if (this.isProcessing) return;

    if (this.queue.length === 0) {
      this.currentItem = null;
      this.onStateChange?.(false, null);
      return;
    }

    const nextItem = this.queue.shift();
    if (!nextItem) return;

    // Check execution validity: if execution changed or was invalidated, drop stale item
    if (
      nextItem.executionId &&
      this.activeExecutionId &&
      nextItem.executionId !== this.activeExecutionId
    ) {
      // Discard stale execution narration
      this.processNext();
      return;
    }

    this.isProcessing = true;
    this.currentItem = nextItem;
    this.onStateChange?.(true, nextItem);

    try {
      const provider = this.selectProvider(nextItem);
      nextItem.onStart?.();

      await provider.speak(nextItem.text, {
        rate: this.preferences.speechRate,
        pitch: this.preferences.speechPitch,
        volume: this.preferences.speechVolume,
        voiceURI: this.preferences.voiceURI,
        onError: (err) => {
          console.warn('[VoiceQueue] Speech error on item:', nextItem.id, err);
          nextItem.onError?.(err);
        }
      });

      nextItem.onEnd?.();
    } catch (err: any) {
      console.warn('[VoiceQueue] Processing error:', err);
      nextItem.onError?.(err);
    } finally {
      this.isProcessing = false;
      this.currentItem = null;
      this.processNext();
    }
  }

  private selectProvider(item: VoiceQueueItem): ISpeechSynthesisProvider {
    // 1. For final results or explicit Groq preference, use Groq if online and not preferLocal
    if (
      !this.preferences.preferLocalTts &&
      (item.isFinalResult || item.providerPreference === 'groq') &&
      groqOrpheusProvider.isSupported()
    ) {
      return groqOrpheusProvider;
    }

    // 2. Default to native browser speech synthesis for instant zero-latency speech
    if (nativeSpeechSynthesisProvider.isSupported()) {
      return nativeSpeechSynthesisProvider;
    }

    // 3. Fallback
    return groqOrpheusProvider;
  }

  public stopCurrent() {
    try {
      nativeSpeechSynthesisProvider.stop();
      groqOrpheusProvider.stop();
    } catch {}
    this.isProcessing = false;
    this.currentItem = null;
  }

  /**
   * Complete flush of the queue and immediate stoppage of all speech.
   */
  public cancel() {
    this.queue = [];
    this.stopCurrent();
    this.onStateChange?.(false, null);
  }

  public clear() {
    this.queue = [];
  }

  public isBusy(): boolean {
    return this.isProcessing || this.queue.length > 0;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }
}
