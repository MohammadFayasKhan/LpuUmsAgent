/*
 * Native Web Speech API SpeechSynthesis Provider for ONEE.
 *
 * Provides instant, zero-latency, local on-device speech synthesis
 * for real-time semantic agent narration and responses.
 */

import {
  ISpeechSynthesisProvider,
  SpeechSynthesisOptions,
  AvailableVoice
} from '../VoiceTypes';
import { transformSpeechIdentity, chunkSpeechText } from '../VoiceProvider';

export class NativeSpeechSynthesisProvider implements ISpeechSynthesisProvider {
  public readonly name = 'native-speech-synthesis';
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private isCurrentlySpeaking: boolean = false;
  private watchdogInterval: any = null;
  private cachedVoices: AvailableVoice[] = [];
  private cancelled: boolean = false;

  public getCurrentUtterance(): SpeechSynthesisUtterance | null {
    return this.currentUtterance;
  }

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.loadVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        this.loadVoices();
      };
    }
  }

  public isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  private loadVoices(): AvailableVoice[] {
    if (!this.isSupported()) return [];
    try {
      const voices = window.speechSynthesis.getVoices();
      this.cachedVoices = voices.map((v) => ({
        name: v.name,
        lang: v.lang,
        voiceURI: v.voiceURI,
        default: v.default,
        localService: v.localService
      }));
      return this.cachedVoices;
    } catch {
      return [];
    }
  }

  public async getAvailableVoices(): Promise<AvailableVoice[]> {
    if (this.cachedVoices.length > 0) {
      return this.cachedVoices;
    }
    return this.loadVoices();
  }

  private findBestVoice(voiceURI?: string): SpeechSynthesisVoice | null {
    if (!this.isSupported()) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return null;

    if (voiceURI) {
      const match = voices.find((v) => v.voiceURI === voiceURI);
      if (match) return match;
    }

    // Preferred high-quality English natural voices
    const preferredNames = [
      'Google US English',
      'Samantha',
      'Karen',
      'Victoria',
      'Moira',
      'Alex',
      'Microsoft Zira',
      'Natural'
    ];

    for (const name of preferredNames) {
      const found = voices.find((v) => v.name.includes(name) && v.lang.startsWith('en'));
      if (found) return found;
    }

    // Fallback: any English voice
    const englishVoice = voices.find((v) => v.lang.startsWith('en'));
    return englishVoice || voices[0] || null;
  }

  public async speak(text: string, options?: SpeechSynthesisOptions): Promise<void> {
    if (!this.isSupported()) {
      const err = new Error('SpeechSynthesis is not supported in this browser environment');
      options?.onError?.(err);
      throw err;
    }

    const sanitized = transformSpeechIdentity(text);
    const trimmed = sanitized.trim();
    if (!trimmed) {
      options?.onEnd?.();
      return;
    }

    this.stop();
    this.cancelled = false;
    this.isCurrentlySpeaking = true;

    // Chunk text <= 170 characters so Chrome never stalls or silences mid-sentence
    const chunks = chunkSpeechText(trimmed, 170);
    const bestVoice = this.findBestVoice(options?.voiceURI);
    let started = false;

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (this.cancelled) break;
        const chunk = chunks[i];

        await new Promise<void>((resolve) => {
          if (this.cancelled) {
            resolve();
            return;
          }

          if (typeof window !== 'undefined' && window.speechSynthesis?.paused) {
            window.speechSynthesis.resume();
          }

          const utterance = new SpeechSynthesisUtterance(chunk);
          this.currentUtterance = utterance;

          if (bestVoice) {
            utterance.voice = bestVoice;
          }

          utterance.rate = options?.rate ?? 1.05;
          utterance.pitch = options?.pitch ?? 1.0;
          utterance.volume = options?.volume ?? 1.0;

          utterance.onstart = () => {
            if (!started) {
              started = true;
              options?.onStart?.();
            }
            this.startWatchdog();
          };

          utterance.onend = () => {
            this.stopWatchdog();
            this.currentUtterance = null;
            resolve();
          };

          utterance.onerror = (event: any) => {
            this.stopWatchdog();
            this.currentUtterance = null;
            if (event.error === 'canceled' || event.error === 'interrupted' || this.cancelled) {
              resolve();
              return;
            }
            console.warn('[NativeSpeechSynthesis] Utterance error:', event.error);
            resolve();
          };

          window.speechSynthesis.speak(utterance);
          if (typeof window !== 'undefined' && window.speechSynthesis?.paused) {
            window.speechSynthesis.resume();
          }
        });
      }
    } finally {
      this.isCurrentlySpeaking = false;
      this.stopWatchdog();
      this.currentUtterance = null;
      if (!this.cancelled) {
        options?.onEnd?.();
      }
    }
  }

  public stop(): void {
    this.cancelled = true;
    if (this.isSupported()) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
    this.isCurrentlySpeaking = false;
    this.stopWatchdog();
    this.currentUtterance = null;
  }

  public pause(): void {
    if (this.isSupported()) {
      try {
        window.speechSynthesis.pause();
      } catch {}
    }
  }

  public resume(): void {
    if (this.isSupported()) {
      try {
        window.speechSynthesis.resume();
      } catch {}
    }
  }

  public isSpeaking(): boolean {
    if (!this.isSupported()) return false;
    return this.isCurrentlySpeaking || window.speechSynthesis.speaking;
  }

  /**
   * Chrome bug workaround: speechSynthesis can stall after 15s.
   * Periodically calling resume keeps long speech flowing.
   */
  private startWatchdog() {
    this.stopWatchdog();
    this.watchdogInterval = setInterval(() => {
      if (this.isCurrentlySpeaking && typeof window !== 'undefined' && window.speechSynthesis) {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      }
    }, 4000);
  }

  private stopWatchdog() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }
}

export const nativeSpeechSynthesisProvider = new NativeSpeechSynthesisProvider();
