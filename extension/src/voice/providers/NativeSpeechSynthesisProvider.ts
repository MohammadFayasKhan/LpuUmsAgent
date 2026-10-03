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

export class NativeSpeechSynthesisProvider implements ISpeechSynthesisProvider {
  public readonly name = 'native-speech-synthesis';
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private isCurrentlySpeaking: boolean = false;
  private watchdogInterval: any = null;
  private cachedVoices: AvailableVoice[] = [];

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

  public speak(text: string, options?: SpeechSynthesisOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.isSupported()) {
        const err = new Error('SpeechSynthesis is not supported in this browser environment');
        options?.onError?.(err);
        return reject(err);
      }

      const trimmed = text.trim();
      if (!trimmed) {
        options?.onEnd?.();
        return resolve();
      }

      // Stop any active utterance before starting a new one
      this.stop();

      try {
        const utterance = new SpeechSynthesisUtterance(trimmed);
        this.currentUtterance = utterance;
        this.isCurrentlySpeaking = true;

        const bestVoice = this.findBestVoice(options?.voiceURI);
        if (bestVoice) {
          utterance.voice = bestVoice;
        }

        utterance.rate = options?.rate ?? 1.05;
        utterance.pitch = options?.pitch ?? 1.0;
        utterance.volume = options?.volume ?? 1.0;

        utterance.onstart = () => {
          this.isCurrentlySpeaking = true;
          this.startWatchdog();
          options?.onStart?.();
        };

        utterance.onend = () => {
          this.isCurrentlySpeaking = false;
          this.stopWatchdog();
          this.currentUtterance = null;
          options?.onEnd?.();
          resolve();
        };

        utterance.onerror = (event: any) => {
          this.isCurrentlySpeaking = false;
          this.stopWatchdog();
          this.currentUtterance = null;
          // 'canceled' or 'interrupted' is normal when user interrupts
          if (event.error === 'canceled' || event.error === 'interrupted') {
            options?.onEnd?.();
            resolve();
            return;
          }
          const err = new Error(`SpeechSynthesis error: ${event.error}`);
          options?.onError?.(err);
          resolve(); // Resolve rather than unhandled rejection so queues don't crash
        };

        window.speechSynthesis.speak(utterance);
      } catch (err: any) {
        this.isCurrentlySpeaking = false;
        this.stopWatchdog();
        this.currentUtterance = null;
        options?.onError?.(err);
        resolve();
      }
    });
  }

  public stop(): void {
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
