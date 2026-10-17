/*
 * Native Web Speech API SpeechRecognition Provider for ONEE.
 *
 * Provides ultra-low-latency, zero-cost, privacy-first on-device speech recognition
 * using the standard browser Web Speech API (webkitSpeechRecognition).
 */

import { ISpeechRecognitionProvider } from '../VoiceTypes';
import { logVoiceDiagnostic } from '../VoiceDiagnostics';

// Declarations for Web Speech API in TypeScript
type SpeechRecognitionType = any;

export class NativeSpeechRecognitionProvider implements ISpeechRecognitionProvider {
  public readonly name = 'native-speech-recognition';
  private recognition: SpeechRecognitionType | null = null;
  private listening: boolean = false;
  private silenceTimer: any = null;
  private interimCallback?: (text: string) => void;
  private finalCallback?: (text: string) => void;
  private errorCallback?: (err: Error) => void;
  private endCallback?: () => void;

  public isSupported(): boolean {
    return typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
  }

  public async start(
    onInterim: (text: string) => void,
    onFinal: (text: string) => void,
    onError: (err: Error) => void,
    onEnd?: () => void
  ): Promise<void> {
    if (!this.isSupported()) {
      const err = new Error('Browser SpeechRecognition API is not supported in this environment');
      logVoiceDiagnostic('ERROR', this.name, { error: err.message }, undefined, err.message);
      onError(err);
      throw err;
    }

    // If already listening, stop previous session cleanly first
    if (this.listening) {
      this.abort();
    }

    this.interimCallback = onInterim;
    this.finalCallback = onFinal;
    this.errorCallback = onError;
    this.endCallback = onEnd;

    try {
      const SpeechRecognitionConstructor =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      this.recognition = new SpeechRecognitionConstructor();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;
      this.recognition.lang = 'en-US';

      let accumulatedFinal = '';
      let emittedFinal = false;

      // Every final transcript from this recognizer routes through a single guarded
      // channel. If anything external (the controller) has already signalled that
      // this utterance's final was accepted or superseded, the browser recognizer
      // stays silent and never becomes the source of truth.
      const emitFinalSilently = (text: string) => {
        if (emittedFinal) return;
        if (this.finalCallback) {
          emittedFinal = true;
          this.finalCallback(text.trim());
        }
      };

      this.recognition.onstart = () => {
        this.listening = true;
        logVoiceDiagnostic('LISTENING', this.name);

        // Do not start the silence/cut-off timer until the student has actually
        // spoken some interim content. A slow first word must never be treated as
        // the end of the utterance.
      };

      this.recognition.onresult = (event: any) => {
        this.resetSilenceTimer();
        let interimText = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            accumulatedFinal += (accumulatedFinal ? ' ' : '') + transcript.trim();
          } else {
            interimText += transcript;
          }
        }

        if (interimText && this.interimCallback) {
          logVoiceDiagnostic('STT_PROCESSING', this.name, { interimText });
          this.interimCallback(interimText.trim());
        }

        // Do NOT pass any final text through the interim callback. Interim is for
        // in-flight partials only; finals go through the guarded channel and are
        // ultimately owned by the controller.
        if (accumulatedFinal) {
          emitFinalSilently(accumulatedFinal);
        }
      };

      this.recognition.onerror = (event: any) => {
        this.clearSilenceTimer();
        const errorMsg = event.error || 'Speech recognition error';
        logVoiceDiagnostic('ERROR', this.name, { error: errorMsg }, undefined, errorMsg);

        // 'no-speech' is non-fatal if user paused, but if no speech accumulated, report clean end
        if (event.error === 'no-speech') {
          this.listening = false;
          if (accumulatedFinal) {
            const finalText = accumulatedFinal;
            accumulatedFinal = '';
            emitFinalSilently(finalText);
          }
          return;
        }

        if (event.error === 'aborted') {
          this.listening = false;
          return;
        }

        const err = new Error(`SpeechRecognition error: ${errorMsg}`);
        this.listening = false;
        this.errorCallback?.(err);
        this.endCallback?.();
      };

      this.recognition.onend = () => {
        this.clearSilenceTimer();
        this.listening = false;

        // One recognition instance per start(). Never re-arm here: a leftover
        // recognizer would hold the microphone and block the next Groq capture.
        if (accumulatedFinal) {
          const finalText = accumulatedFinal;
          accumulatedFinal = '';
          emitFinalSilently(finalText);
        }
        this.endCallback?.();
      };

      this.recognition.start();
    } catch (err: any) {
      this.listening = false;
      this.clearSilenceTimer();
      this.errorCallback?.(err);
      this.endCallback?.();
      throw err;
    }
  }

  public stop(): void {
    this.clearSilenceTimer();
    if (this.recognition && this.listening) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore stop errors if already stopped
      }
    }
    this.listening = false;
  }

  public abort(): void {
    this.clearSilenceTimer();
    const recognition = this.recognition;
    this.recognition = null;
    this.listening = false;
    this.interimCallback = undefined;
    this.finalCallback = undefined;
    this.errorCallback = undefined;
    this.endCallback = undefined;
    if (recognition) {
      try {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.onstart = null;
        recognition.abort();
      } catch {
        // Ignore abort errors if already stopped
      }
    }
  }

  public isListening(): boolean {
    return this.listening;
  }

  private resetSilenceTimer() {
    this.clearSilenceTimer();
    // 2.2 seconds of silence after speech automatically stops recording and completes transcript
    this.silenceTimer = setTimeout(() => {
      if (this.listening) {
        this.stop();
      }
    }, 2200);
  }

  private clearSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }
}

export const nativeSpeechRecognitionProvider = new NativeSpeechRecognitionProvider();
