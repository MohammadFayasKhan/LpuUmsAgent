/*
 * Groq Whisper STT Provider for ONEE.
 *
 * Records audio using MediaRecorder and sends it to the backend Groq Whisper
 * endpoint (/api/voice/transcribe-json) using whisper-large-v3-turbo.
 */

import { ISpeechRecognitionProvider } from '../VoiceTypes';

export class GroqWhisperProvider implements ISpeechRecognitionProvider {
  public readonly name = 'groq-whisper';
  private mediaRecorder: MediaRecorder | null = null;
  private audioStream: MediaStream | null = null;
  private audioChunks: Blob[] = [];
  private listening: boolean = false;
  private silenceTimer: any = null;
  private maxDurationTimer: any = null;
  private finalCallback?: (text: string) => void;
  private errorCallback?: (err: Error) => void;
  private endCallback?: () => void;
  private backendBaseUrl: string = 'http://localhost:8000';

  constructor(backendUrl?: string) {
    if (backendUrl) {
      this.backendBaseUrl = backendUrl.replace(/\/$/, '');
    }
  }

  public isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) &&
      typeof MediaRecorder !== 'undefined'
    );
  }

  public async start(
    onInterim: (text: string) => void,
    onFinal: (text: string) => void,
    onError: (err: Error) => void,
    onEnd?: () => void
  ): Promise<void> {
    if (!this.isSupported()) {
      const err = new Error('Audio recording (MediaRecorder) is not supported in this browser');
      onError(err);
      throw err;
    }

    if (this.listening) {
      this.abort();
    }

    this.finalCallback = onFinal;
    this.errorCallback = onError;
    this.endCallback = onEnd;
    this.audioChunks = [];

    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      this.mediaRecorder = new MediaRecorder(this.audioStream, { mimeType });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstart = () => {
        this.listening = true;
        onInterim('Listening...');

        // Maximum 15 seconds per single voice command
        this.maxDurationTimer = setTimeout(() => {
          if (this.listening) {
            this.stop();
          }
        }, 15000);
      };

      this.mediaRecorder.onerror = (event: any) => {
        this.cleanup();
        const err = new Error(`MediaRecorder error: ${event.error?.name || 'Unknown'}`);
        onError(err);
        onEnd?.();
      };

      this.mediaRecorder.onstop = async () => {
        this.listening = false;
        this.clearTimers();

        if (this.audioChunks.length === 0) {
          onEnd?.();
          return;
        }

        const audioBlob = new Blob(this.audioChunks, { type: mimeType });
        this.audioChunks = [];

        onInterim('Transcribing speech...');

        try {
          const base64Data = await this.blobToBase64(audioBlob);
          const response = await fetch(`${this.backendBaseUrl}/api/voice/transcribe-json`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              audio_base64: base64Data,
              content_type: mimeType,
              filename: 'student_voice.webm'
            })
          });

          if (!response.ok) {
            throw new Error(`Whisper transcription failed with HTTP ${response.status}`);
          }

          const data = await response.json();
          const transcript = (data.text || '').trim();
          if (transcript && this.finalCallback) {
            this.finalCallback(transcript);
          }
        } catch (err: any) {
          console.warn('[GroqWhisperProvider] Transcription request failed:', err);
          this.errorCallback?.(err);
        } finally {
          this.endCallback?.();
        }
      };

      this.mediaRecorder.start(250);
    } catch (err: any) {
      this.cleanup();
      onError(err);
      onEnd?.();
      throw err;
    }
  }

  public stop(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {}
    }
    this.cleanupStream();
    this.listening = false;
  }

  public abort(): void {
    this.audioChunks = [];
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch {}
    }
    this.cleanup();
  }

  public isListening(): boolean {
    return this.listening;
  }

  private cleanupStream() {
    if (this.audioStream) {
      this.audioStream.getTracks().forEach((track) => track.stop());
      this.audioStream = null;
    }
  }

  private cleanup() {
    this.listening = false;
    this.clearTimers();
    this.cleanupStream();
    this.mediaRecorder = null;
    this.audioChunks = [];
  }

  private clearTimers() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    if (this.maxDurationTimer) clearTimeout(this.maxDurationTimer);
    this.silenceTimer = null;
    this.maxDurationTimer = null;
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}

export const groqWhisperProvider = new GroqWhisperProvider();
