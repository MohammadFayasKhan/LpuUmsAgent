/*
 * Groq Orpheus Cloud TTS Provider for ONEE.
 *
 * Calls the backend /api/voice/speak endpoint for natural, ultra-low-latency speech
 * using canopylabs/orpheus-v1-english with voice 'hannah' in WAV format.
 * Decodes audio via Web Audio API and enqueues into AudioController for strictly
 * sequential, non-blocking, stutter-free playback with seamless volume and barge-in.
 */

import {
  ISpeechSynthesisProvider,
  SpeechSynthesisOptions,
  AvailableVoice,
  SpeechPriority
} from '../VoiceTypes';
import { audioController, getSharedAudioContext } from '../AudioController';
import { getBackendUrl } from '../../services/api';
import { chunkSpeechText, transformSpeechIdentity } from '../VoiceProvider';
import { logVoiceDiagnostic } from '../VoiceDiagnostics';

export interface GroqOrpheusOptions extends SpeechSynthesisOptions {
  executionId?: string;
  priority?: SpeechPriority;
  isFinalResult?: boolean;
}

export class GroqOrpheusProvider implements ISpeechSynthesisProvider {
  public readonly name = 'groq-orpheus-tts';
  private backendBaseUrl: string = 'http://localhost:8000';
  private activeExecutionId: string | null = null;
  private rateLimitedUntil: number = 0;
  private fetchAbort: AbortController | null = null;
  private static readonly SYNTH_TIMEOUT_MS = 12000;
  private static readonly ORPHEUS_MAX_CHARS = 195;

  public getActiveExecutionId(): string | null {
    return this.activeExecutionId;
  }

  public isAvailable(): boolean {
    return Date.now() > this.rateLimitedUntil;
  }

  public markRateLimited(cooldownMs: number = 30000): void {
    this.rateLimitedUntil = Date.now() + cooldownMs;
    console.warn(`[GroqOrpheusProvider] Rate limited. Cooldown active for ${cooldownMs / 1000}s.`);
  }

  constructor(backendUrl?: string) {
    if (backendUrl) {
      this.backendBaseUrl = backendUrl.replace(/\/$/, '');
    }
  }

  public isSupported(): boolean {
    return (typeof window !== 'undefined' || typeof AudioContext !== 'undefined') && this.isAvailable();
  }

  public async getAvailableVoices(): Promise<AvailableVoice[]> {
    return [
      { name: 'Groq Orpheus English (Hannah)', lang: 'en-US', voiceURI: 'hannah', default: true },
      { name: 'Groq Orpheus English (Diana)', lang: 'en-US', voiceURI: 'diana' },
      { name: 'Groq Orpheus English (Autumn)', lang: 'en-US', voiceURI: 'autumn' },
      { name: 'Groq Orpheus English (Austin)', lang: 'en-US', voiceURI: 'austin' },
      { name: 'Groq Orpheus English (Daniel)', lang: 'en-US', voiceURI: 'daniel' },
      { name: 'Groq Orpheus English (Troy)', lang: 'en-US', voiceURI: 'troy' }
    ];
  }

  public async speak(text: string, options?: GroqOrpheusOptions): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      options?.onEnd?.();
      return;
    }

    if (!this.isAvailable()) {
      throw new Error('Groq TTS rate limit cooldown active');
    }

    const executionId = options?.executionId || audioController.getActiveExecutionId() || undefined;
    this.activeExecutionId = executionId || null;
    const utterance = transformSpeechIdentity(trimmed);
    const segments = chunkSpeechText(utterance, GroqOrpheusProvider.ORPHEUS_MAX_CHARS);
    const chosenVoice =
      options?.voiceURI && ['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy'].includes(options.voiceURI)
        ? options.voiceURI
        : 'autumn';

    try {
      /*
       * PIPELINED playback: segment N+1 is synthesized WHILE segment N plays,
       * so speech starts after the FIRST segment (~1-2s) instead of waiting for
       * every segment to finish synthesizing first (the old all-then-play loop
       * made long responses sound silent for tens of seconds).
       * Playback order is still strictly sequential and generation-owned.
       */
      let playChain: Promise<unknown> = Promise.resolve();
      let index = 0;
      const total = segments.length;

      for (const segment of segments) {
        if (!this.isOwned(executionId)) return;
        const buffer = await this.synthesizeSegment(segment, chosenVoice, executionId);
        const i = index++;
        playChain = playChain.then(() => {
          if (!this.isOwned(executionId)) return;
          return audioController.enqueueAndWait({
            id: `orpheus-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            executionId,
            audioData: buffer.pcm,
            sampleRate: buffer.sampleRate,
            priority: options?.priority || 'NORMAL',
            isFinalResult: Boolean(options?.isFinalResult && i === total - 1),
            onStart: i === 0 ? options?.onStart : undefined,
            onEnd: i === total - 1 ? options?.onEnd : undefined,
            onError: options?.onError
          });
        });
      }

      await playChain;
    } catch (err: any) {
      if (String(err?.message || '').includes('429')) {
        this.markRateLimited(30000);
      }
      console.warn('[GroqOrpheusProvider] Speech synthesis error:', err.message);
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  private isOwned(executionId?: string): boolean {
    if (!executionId) return true;
    const active = audioController.getActiveExecutionId();
    return !active || active === executionId;
  }

  private async synthesizeSegment(
    text: string,
    voice: string,
    executionId?: string
  ): Promise<{ pcm: Float32Array; sampleRate: number }> {
    const baseUrl = getBackendUrl() || this.backendBaseUrl;
    const controller = new AbortController();
    this.fetchAbort = controller;
    const timer = setTimeout(() => controller.abort(), GroqOrpheusProvider.SYNTH_TIMEOUT_MS);
    try {
      logVoiceDiagnostic('groq_tts_request_started', this.name, {
        textLength: text.length,
        voice,
        model: 'canopylabs/orpheus-v1-english',
        format: 'wav'
      }, executionId);
      const response = await fetch(`${baseUrl}/api/voice/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice,
          response_format: 'wav'
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        if (response.status === 429) {
          this.markRateLimited(30000);
        }
        throw new Error(`Groq TTS speak request failed with status ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioCtx = getSharedAudioContext();
      if (!audioCtx) {
        throw new Error('Web Audio AudioContext unavailable');
      }

      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
      logVoiceDiagnostic('groq_tts_request_succeeded', this.name, {
        textLength: text.length,
        voice,
        model: 'canopylabs/orpheus-v1-english',
        audioDurationSec: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate
      }, executionId);
      return {
        pcm: new Float32Array(audioBuffer.getChannelData(0)),
        sampleRate: audioBuffer.sampleRate
      };
    } catch (err: any) {
      logVoiceDiagnostic('groq_tts_failed', this.name, {
        textLength: text.length,
        voice,
        model: 'canopylabs/orpheus-v1-english',
        error: err?.message || String(err)
      }, executionId, err?.message || String(err));
      if (err?.name === 'AbortError') {
        throw new Error('Groq Orpheus synthesis timed out.');
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (this.fetchAbort === controller) {
        this.fetchAbort = null;
      }
    }
  }

  public stop(): void {
    this.fetchAbort?.abort();
    this.fetchAbort = null;
    this.activeExecutionId = null;
  }

  public pause(): void {
    this.stop();
  }

  public resume(): void {
    // Sequential queue handles continuation automatically
  }

  public isSpeaking(): boolean {
    return audioController.isSpeaking();
  }
}

export const groqOrpheusProvider = new GroqOrpheusProvider();
