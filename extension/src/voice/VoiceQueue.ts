/*
 * Voice Queue & Speech Synchronizer for ONEE.
 *
 * Coordinates spoken utterances, sentence chunking, prioritization,
 * pipelined asynchronous worker synthesis, and strict execution ID validation.
 */

import {
  VoiceQueueItem,
  VoicePreferences,
  ISpeechSynthesisProvider,
  SpeechPriority
} from './VoiceTypes';
import {
  chunkSpeechText,
  transformSpeechIdentity,
  DEFAULT_VOICE_PREFERENCES
} from './VoiceProvider';
import { groqOrpheusProvider } from './providers/GroqOrpheusProvider';
import { audioController } from './AudioController';
import { logVoiceDiagnostic } from './VoiceDiagnostics';

// FINAL SPEC: Groq Orpheus is the only TTS provider. Local Kokoro and native
// browser SpeechSynthesis were removed from the runtime chain — a Groq failure
// yields an honest text-only outcome, never a local or browser voice.

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

  constructor(
    preferences?: Partial<VoicePreferences>,
    onStateChange?: (isSpeaking: boolean, item: VoiceQueueItem | null) => void
  ) {
    this.preferences = {
      ...DEFAULT_VOICE_PREFERENCES,
      ...preferences
    };
    this.onStateChange = onStateChange;

    // Connect AudioController state changes
    audioController.subscribe((isPlaying, activeAudioItem) => {
      if (isPlaying && activeAudioItem) {
        this.onStateChange?.(true, {
          id: activeAudioItem.id,
          text: '',
          priority: activeAudioItem.priority || 'NORMAL',
          executionId: activeAudioItem.executionId
        });
      } else if (!isPlaying && !this.isProcessing && this.queue.length === 0) {
        this.onStateChange?.(false, null);
      }
    });
  }

  public updatePreferences(prefs: Partial<VoicePreferences>) {
    this.preferences = { ...this.preferences, ...prefs };
    if (prefs.speechVolume !== undefined) {
      audioController.setVolume(prefs.speechVolume);
    }
  }

  public setActiveExecutionId(executionId: string | null) {
    if (this.activeExecutionId !== executionId) {
      this.activeExecutionId = executionId;
      audioController.setActiveExecutionId(executionId);

      // Prune queued items belonging to older executions
      if (executionId !== null) {
        this.queue = this.queue.filter(
          (item) => !item.executionId || item.executionId === executionId
        );
        if (this.currentItem?.executionId && this.currentItem.executionId !== executionId) {
          this.stopCurrent();
        }
      }
    }
  }

  public getActiveExecutionId(): string | null {
    return this.activeExecutionId;
  }

  /**
   * Enqueues speech text with sentence-level chunking and priority ranking.
   * If priority is FINAL_RESULT or HIGH, interrupts lower-priority progress narration.
   */
  public enqueue(
    text: string,
    options: {
      priority?: SpeechPriority;
      executionId?: string;
      isFinalResult?: boolean;
      providerPreference?: 'groq' | 'auto';
      force?: boolean;
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (err: Error) => void;
    } = {}
  ): string[] {
    if (!options.force && (!this.preferences.enabled || this.preferences.mode === 'OFF')) {
      options.onEnd?.();
      return [];
    }

    const trimmed = text.trim();
    if (!trimmed) {
      options.onEnd?.();
      return [];
    }

    const speechText = transformSpeechIdentity(trimmed);
    if (!speechText) {
      options.onEnd?.();
      return [];
    }

    // Discard immediately if execution ID belongs to an older/stale execution (unless forced)
    if (
      !options.force &&
      options.executionId &&
      this.activeExecutionId &&
      options.executionId !== this.activeExecutionId
    ) {
      options.onEnd?.();
      return [];
    }

    const itemPriority: SpeechPriority = options.priority || 'NORMAL';
    const itemRank = this.getPriorityRank(itemPriority);

    // Preemption: FINAL_RESULT supersedes lower-priority progress narration immediately
    if (itemPriority === 'FINAL_RESULT') {
      this.queue = this.queue.filter((qItem) => this.getPriorityRank(qItem.priority) >= 90);
      if (this.currentItem && this.getPriorityRank(this.currentItem.priority) < 70) {
        this.stopCurrent();
      }
    } else if (itemPriority === 'HIGH' || itemPriority === 'BLOCKER') {
      this.stopCurrent();
      this.clear();
    }

    // For final results or complete summaries, deliver ONE unified response rather than choppy micro-chunks
    const isSingleComplete = Boolean(options.isFinalResult || itemPriority === 'FINAL_RESULT');
    const chunks = isSingleComplete ? [speechText] : chunkSpeechText(speechText);
    const itemIds: string[] = [];
    const newItems: VoiceQueueItem[] = [];

    chunks.forEach((chunkText, idx) => {
      const id = `speech-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      itemIds.push(id);

      const item: VoiceQueueItem = {
        id,
        text: chunkText,
        priority: itemPriority,
        executionId: options.executionId ?? (this.activeExecutionId || undefined),
        isFinalResult: Boolean(options.isFinalResult && idx === chunks.length - 1),
        force: options.force,
        providerPreference: options.providerPreference || 'auto',
        onStart: idx === 0 ? options.onStart : undefined,
        onEnd: idx === chunks.length - 1 ? options.onEnd : undefined,
        onError: options.onError
      };

      newItems.push(item);
    });

    if (itemPriority === 'FINAL_RESULT' || itemPriority === 'HIGH' || itemPriority === 'BLOCKER') {
      this.queue.unshift(...newItems);
    } else {
      let insertIndex = this.queue.length;
      for (let i = 0; i < this.queue.length; i++) {
        if (itemRank > this.getPriorityRank(this.queue[i].priority)) {
          insertIndex = i;
          break;
        }
      }
      this.queue.splice(insertIndex, 0, ...newItems);
    }

    this.processNext();
    return itemIds;
  }

  private getPriorityRank(priority?: SpeechPriority): number {
    switch (priority) {
      case 'FINAL_RESULT':
        return 100;
      case 'BLOCKER':
        return 90;
      case 'HIGH':
        return 80;
      case 'USER_RELEVANT_DISCOVERY':
        return 70;
      case 'MEANINGFUL_PROGRESS':
        return 50;
      case 'NORMAL':
        return 40;
      case 'ACKNOWLEDGEMENT':
        return 30;
      case 'LOW':
      default:
        return 10;
    }
  }

  /**
   * NON-BLOCKING pipelined processing loop.
   *
   * Dispatches speech items to providers WITHOUT awaiting generation or playback.
   * GroqOrpheusProvider.speak() synthesizes segments and pipelines them into
   * AudioController's sequential playback queue.
   *
   * The queue drains as fast as it can dispatch. Audio ordering is maintained by
   * AudioController's sequential playback queue.
   */
  private processNext() {
    if (this.isProcessing) return;

    if (this.queue.length === 0) {
      this.currentItem = null;
      if (!audioController.isSpeaking()) {
        this.onStateChange?.(false, null);
      }
      return;
    }

    const nextItem = this.queue.shift();
    if (!nextItem) return;

    // Check execution validity before dispatching
    if (
      nextItem.executionId &&
      this.activeExecutionId &&
      nextItem.executionId !== this.activeExecutionId
    ) {
      this.processNext();
      return;
    }

    this.isProcessing = true;
    this.currentItem = nextItem;
    this.onStateChange?.(true, nextItem);

    const speakPromise = this.speakWithCascade(nextItem);

    // Pipelining strategy:
    // Groq Orpheus pipelines its generated audio buffers into AudioController's
    // sequential playback queue, so the next item may be dispatched as soon as
    // generation for the current one has been awaited.
    const advanceQueue = () => {
      this.isProcessing = false;
      this.currentItem = null;
      this.processNext();
    };

    speakPromise.finally(advanceQueue);
  }

  private async speakWithCascade(item: VoiceQueueItem): Promise<void> {
    const spokeChain = this.getProviderChain(item);
    const attempted: string[] = [];
    logVoiceDiagnostic('TTS_REQUEST', 'VoiceQueue', {
      itemId: item.id,
      priority: item.priority,
      textLength: item.text.length,
      executionId: item.executionId
    }, item.executionId);

    for (const provider of spokeChain) {
      if (!this.isItemCurrent(item)) return;
      if (!provider.isSupported()) {
        logVoiceDiagnostic('TTS_ERROR', provider.name, { itemId: item.id, reason: 'UNSUPPORTED' }, item.executionId, 'UNSUPPORTED');
        continue;
      }
      attempted.push(provider.name);
      logVoiceDiagnostic('TTS_PROVIDER_SELECTED', provider.name, {
        itemId: item.id,
        attemptedProviders: [...attempted],
        isPrimary: attempted.length === 1
      }, item.executionId);

      try {
        // Groq is the only provider: no local Kokoro/native fallback exists.
        const attempt = provider.speak(item.text, {
          rate: this.preferences.speechRate,
          pitch: this.preferences.speechPitch,
          volume: this.preferences.speechVolume,
          voiceURI: provider === groqOrpheusProvider ? this.preferences.voiceURI : undefined,
          onStart: item.onStart,
          onEnd: item.onEnd,
          onError: item.onError,
          executionId: item.executionId,
          priority: item.priority,
          isFinalResult: item.isFinalResult,
          force: item.force
        } as any);
        await this.withTimeout(attempt, 0, `${provider.name} synthesis timed out`);
        if (!this.isItemCurrent(item)) return;
        logVoiceDiagnostic('TTS_READY', provider.name, { itemId: item.id, finalProvider: provider.name }, item.executionId);

        console.info(
          `[ONEE][TTS] TTS_PROVIDER=groq TTS_MODEL=canopylabs/orpheus-v1-english — spoke with Groq Orpheus (canonical voice).`
        );
        return;
      } catch (err: any) {
        if (!this.isItemCurrent(item)) return;
        const timedOut = /timed out/i.test(err?.message || '');
        logVoiceDiagnostic('TTS_ERROR', provider.name, {
          itemId: item.id,
          attemptedProviders: [...attempted],
          reason: timedOut ? 'TIMEOUT' : 'SYNTHESIS_FAILED',
          error: err?.message || String(err)
        }, item.executionId, err?.message || String(err));
        // Make late worker/network results harmless before trying the next provider.
        provider.stop();
      }
    }

    if (this.isItemCurrent(item)) {
      const error = new Error('All speech providers failed; keeping the textual response available.');
      item.onError?.(error);
      logVoiceDiagnostic('TTS_ERROR', 'VoiceQueue', { itemId: item.id, attemptedProviders: attempted, finalOutcome: 'TEXT_ONLY' }, item.executionId, error.message);
    }
  }

  /**
   * FINAL SPEC: one canonical TTS chain — Groq Orpheus only.
   * Local Kokoro and native browser SpeechSynthesis are not in the chain at
   * all; preference values (including stale stored ones) cannot select them.
   */
  private getProviderChain(_item?: VoiceQueueItem): ISpeechSynthesisProvider[] {
    return [groqOrpheusProvider];
  }

  private isItemCurrent(item: VoiceQueueItem): boolean {
    return this.currentItem === item && (Boolean(item.force) || !item.executionId || !this.activeExecutionId || item.executionId === this.activeExecutionId);
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    if (!timeoutMs) return promise;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      promise.then((value) => { clearTimeout(timer); resolve(value); }, (err) => { clearTimeout(timer); reject(err); });
    });
  }

  public stopCurrent() {
    try {
      groqOrpheusProvider.stop();
      audioController.stop();
    } catch {}
    this.isProcessing = false;
    this.currentItem = null;
  }

  public cancel() {
    this.queue = [];
    this.stopCurrent();
    this.onStateChange?.(false, null);
  }

  public clear() {
    this.queue = [];
  }

  public isBusy(): boolean {
    return this.isProcessing || this.queue.length > 0 || audioController.isSpeaking();
  }

  public getQueueLength(): number {
    return this.queue.length;
  }
}
