/*
 * Groq Orpheus / Cloud TTS Provider for ONEE.
 *
 * Calls the backend /api/voice/speak endpoint for natural, expressive speech
 * using canopylabs/orpheus-v1-english.
 */

import {
  ISpeechSynthesisProvider,
  SpeechSynthesisOptions,
  AvailableVoice
} from '../VoiceTypes';

export class GroqOrpheusProvider implements ISpeechSynthesisProvider {
  public readonly name = 'groq-orpheus-tts';
  private currentAudio: HTMLAudioElement | null = null;
  private isCurrentlyPlaying: boolean = false;
  private backendBaseUrl: string = 'http://localhost:8000';

  constructor(backendUrl?: string) {
    if (backendUrl) {
      this.backendBaseUrl = backendUrl.replace(/\/$/, '');
    }
  }

  public isSupported(): boolean {
    return typeof Audio !== 'undefined' && typeof window !== 'undefined';
  }

  public async getAvailableVoices(): Promise<AvailableVoice[]> {
    return [
      { name: 'Groq Orpheus English Expressive', lang: 'en-US', voiceURI: 'orpheus-v1-english', default: true },
      { name: 'Groq Alloy', lang: 'en-US', voiceURI: 'alloy' },
      { name: 'Groq Echo', lang: 'en-US', voiceURI: 'echo' },
      { name: 'Groq Fable', lang: 'en-US', voiceURI: 'fable' }
    ];
  }

  public async speak(text: string, options?: SpeechSynthesisOptions): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) {
      options?.onEnd?.();
      return;
    }

    this.stop();

    try {
      options?.onStart?.();
      this.isCurrentlyPlaying = true;

      const response = await fetch(`${this.backendBaseUrl}/api/voice/speak`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: trimmed,
          voice: options?.voiceURI || 'alloy',
          response_format: 'mp3'
        })
      });

      if (!response.ok) {
        throw new Error(`Groq TTS speak request failed with status ${response.status}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      return new Promise((resolve) => {
        const audio = new Audio(audioUrl);
        this.currentAudio = audio;

        if (options?.volume !== undefined) {
          audio.volume = Math.max(0, Math.min(1, options.volume));
        }
        if (options?.rate !== undefined) {
          audio.playbackRate = Math.max(0.5, Math.min(2.0, options.rate));
        }

        audio.onended = () => {
          this.isCurrentlyPlaying = false;
          this.currentAudio = null;
          URL.revokeObjectURL(audioUrl);
          options?.onEnd?.();
          resolve();
        };

        audio.onerror = (err) => {
          this.isCurrentlyPlaying = false;
          this.currentAudio = null;
          URL.revokeObjectURL(audioUrl);
          console.warn('[GroqOrpheusProvider] Audio playback error:', err);
          options?.onError?.(new Error('Audio playback failed'));
          resolve();
        };

        audio.play().catch((err) => {
          this.isCurrentlyPlaying = false;
          this.currentAudio = null;
          URL.revokeObjectURL(audioUrl);
          // Interruption or autoplay policy
          options?.onError?.(err);
          resolve();
        });
      });
    } catch (err: any) {
      this.isCurrentlyPlaying = false;
      this.currentAudio = null;
      console.warn('[GroqOrpheusProvider] Speech synthesis error:', err);
      options?.onError?.(err);
    }
  }

  public stop(): void {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
      } catch {}
      this.currentAudio = null;
    }
    this.isCurrentlyPlaying = false;
  }

  public pause(): void {
    if (this.currentAudio) {
      try {
        this.currentAudio.pause();
      } catch {}
    }
  }

  public resume(): void {
    if (this.currentAudio) {
      try {
        this.currentAudio.play();
      } catch {}
    }
  }

  public isSpeaking(): boolean {
    return this.isCurrentlyPlaying;
  }
}

export const groqOrpheusProvider = new GroqOrpheusProvider();
