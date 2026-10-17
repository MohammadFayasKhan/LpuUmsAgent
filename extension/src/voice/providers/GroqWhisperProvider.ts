/*
 * Groq Whisper STT Provider for ONEE.
 *
 * One start() call owns exactly one capture session: one MediaStream, one
 * MediaRecorder, one audio Blob, and one transcription request. VAD silence
 * finalizes that clip. The recorder is never re-armed inside the same session,
 * so a finished utterance cannot steal the next microphone press.
 */

import { ISpeechRecognitionProvider, TranscriptionResult } from '../VoiceTypes';
import { getBackendUrl } from '../../services/api';
import { logVoiceDiagnostic } from '../VoiceDiagnostics';

/**
 * Whisper hallucination detector (deterministic, no LLM).
 *
 * Over noise/silence Whisper emits long runs of course-code-shaped tokens,
 * often primed by prompt vocabulary (e.g. "PEAS01 PEAS02 PEAS032 PEAS033 ...").
 * A transcript that is overwhelmingly course codes AND contains no ordinary
 * conversational words is not a request a student actually spoke — it must be
 * rejected with an honest retry error instead of being sent to the pipeline.
 */
const STT_CODE_TOKEN = /^[A-Za-z]{2,5}\d{2,4}[A-Za-z]?$/;
const DIGIT_TOKEN = /^\d{1,6}$/;
const CONVERSATIONAL_WORDS =
  /\b(i|my|me|we|what|which|when|where|why|how|today|tomorrow|yesterday|do|does|did|can|could|please|show|tell|give|check|classes|class|attendance|exam|exams|schedule|timetable|subjects|subject|have|has|is|are|the|a|an|in|on|for|of|and|to|my)\b/i;

/** Fixed phrases Whisper emits over silence — matched BEFORE conversational words. */
const STT_HALLUCINATION_PHRASES =
  /thank you for watching|thanks for watching|subscribe|subtitles? by|\[music\]|please stand by|see you next time|that's all for/i;

/**
 * The backend STT prompt's exact vocabulary. Over noise Whisper sometimes
 * echoes these words back verbatim ("UMS attendance examination timetable
 * date sheet") — a run made ONLY of prompt words, with no conversational glue
 * word a human would use, is an echo, not a request.
 */
const STT_PROMPT_ECHO_WORDS = new Set([
  'lpu', 'ums', 'attendance', 'examination', 'timetable', 'date', 'sheet',
  'sample', 'paper', 'duty', 'leave', 'class', 'schedule', 'bunk', 'skip',
  'percentage', 'semester', 'subject', 'result', 'repository'
]);

/** Fillers that can never stand alone as a student request. */
const STT_JUNK_WORDS = new Set([
  'you', 'uh', 'um', 'umm', 'hmm', 'hm', 'mmm', 'ok', 'okay', 'yeah', 'yep',
  'nope', 'huh', 'bye', 'hello?', 'lorem', 'ipsum'
]);

export function looksLikeSttHallucination(transcript: string): boolean {
  const trimmed = transcript.trim();
  if (!trimmed) return true;
  const tokens = trimmed.split(/\s+/).filter(Boolean);

  // 1. Deterministic Whisper hallucination phrases ("Thank you for watching.").
  if (STT_HALLUCINATION_PHRASES.test(trimmed)) return true;

  // 2. Short junk-only utterances ("you", "um") — not a request.
  if (tokens.length < 4 && tokens.every((t) => STT_JUNK_WORDS.has(t.toLowerCase().replace(/[.!?]+$/, '')))) {
    return true;
  }

  // 3. Prompt-echo over noise: only STT prompt vocabulary, no human glue words
  //    ("UMS attendance examination timetable date sheet"). Checked BEFORE the
  //    conversational whitelist, which contains words like "attendance".
  if (
    tokens.length >= 5 &&
    tokens.every((t) => STT_PROMPT_ECHO_WORDS.has(t.toLowerCase().replace(/[.,!?]+$/, '')))
  ) {
    return true;
  }

  // 4. A real conversational word means a human is asking something
  //    (checked BEFORE code-run so "class CSE329 CSE408 ..." still passes).
  if (CONVERSATIONAL_WORDS.test(trimmed)) return false;

  // 5. Course-code runs ("PEAS01 PEAS02 PEAS032 ...") with no human words.
  const codeLike = tokens.filter((t) => STT_CODE_TOKEN.test(t)).length;
  if (tokens.length >= 3 && codeLike === tokens.length) return true;
  if (codeLike >= 4 && codeLike / tokens.length >= 0.6) return true;
  if (tokens.length < 4) return false;

  // 6. Long runs of bare numbers are VAD/noise garbage, never a query.
  const digitLike = tokens.filter((t) => DIGIT_TOKEN.test(t)).length;
  return digitLike >= 6 && digitLike / tokens.length >= 0.6;
}

export class GroqWhisperProvider implements ISpeechRecognitionProvider {
  public readonly name = 'groq-whisper';
  private mediaRecorder: MediaRecorder | null = null;
  private audioStream: MediaStream | null = null;
  private audioChunks: Blob[] = [];
  private listening: boolean = false;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private vadInterval: ReturnType<typeof setInterval> | null = null;
  private vadAudioCtx: AudioContext | null = null;
  private finalCallback?: (text: string) => void;
  private errorCallback?: (err: Error) => void;
  private endCallback?: () => void;
  private onInterimCallback?: (text: string) => void;
  private backendBaseUrl: string = 'http://localhost:8000';
  private transcriptionAbortController: AbortController | null = null;
  private abortedByController = false;
  private stopRequested = false;
  private captureGeneration = 0;
  private recorderMimeType: string = 'audio/webm';
  /** True once the VAD analyser loop is actually running for this session. */
  private vadActive = false;
  /** True once real speech energy (not ambient noise) was seen this session. */
  private speechDetected = false;

  private static readonly TRANSCRIPTION_TIMEOUT_MS = 15000;
  // Accuracy-first production STT model (matches backend app/config.py default).
  // The backend sends the authoritative model on each request; this constant is
  // used for diagnostics only.
  public static readonly WHISPER_MODEL = 'whisper-large-v3';

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

  /**
   * Invalidates the current capture generation so stale onstop/ondata/transcribe
   * callbacks cannot mutate a newer utterance. Live microphone tracks stay open
   * so the next press does not have to re-request permission.
   */
  public abortUtterance(keepStream: boolean = true): void {
    this.abortedByController = true;
    this.stopRequested = true;
    this.captureGeneration += 1;
    this.cancelPendingWork();
    const recorder = this.mediaRecorder;
    if (recorder) {
      this.detachRecorder(recorder);
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {}
      }
    }
    this.listening = false;
    this.clearTimers();
    this.closeVad();
    this.audioChunks = [];
    if (!keepStream) {
      this.cleanupStream();
    }
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

    // Keep the granted MediaStream across utterances. Stopping tracks between
    // presses is what made the second microphone request hang in the sidepanel.
    this.abortUtterance(true);

    const generation = ++this.captureGeneration;
    this.finalCallback = onFinal;
    this.errorCallback = onError;
    this.endCallback = onEnd;
    this.onInterimCallback = onInterim;
    this.audioChunks = [];
    this.abortedByController = false;
    this.stopRequested = false;
    this.vadActive = false;
    this.speechDetected = false;

    logVoiceDiagnostic('groq_selected', this.name, {
      model: GroqWhisperProvider.WHISPER_MODEL,
      captureGeneration: generation
    });

    try {
      const liveTracks = this.audioStream?.getAudioTracks().some((track) => track.readyState === 'live');
      if (!liveTracks) {
        this.cleanupStream();
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            sampleRate: 16000,
            echoCancellation: true,
            noiseSuppression: true
          }
        });
        if (generation !== this.captureGeneration) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        this.audioStream = stream;
      }

      if (generation !== this.captureGeneration) {
        return;
      }

      this.recorderMimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      this.armRecorder(generation);
    } catch (err: any) {
      if (generation !== this.captureGeneration) return;
      this.cleanup();
      const isPermError =
        err?.name === 'NotAllowedError' ||
        err?.name === 'PermissionDeniedError' ||
        err?.message?.includes('Permission dismissed') ||
        err?.message?.includes('Permission denied');

      if (isPermError) {
        if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
          try {
            chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
          } catch {}
        }
        const friendlyErr = new Error(
          'Microphone permission required. Please click "Allow" in the tab that just opened.'
        );
        onError(friendlyErr);
        onEnd?.();
        throw friendlyErr;
      }

      const friendlyErr = new Error(err?.message || 'Failed to initialize microphone.');
      onError(friendlyErr);
      onEnd?.();
      throw friendlyErr;
    }
  }

  private armRecorder(generation: number): void {
    if (!this.audioStream || typeof MediaRecorder === 'undefined') return;
    if (generation !== this.captureGeneration) return;

    try {
      this.mediaRecorder = new MediaRecorder(this.audioStream, { mimeType: this.recorderMimeType });
    } catch (err: any) {
      this.errorCallback?.(new Error(err?.message || 'Failed to create MediaRecorder.'));
      this.cleanup();
      this.endCallback?.();
      return;
    }

    const recorder = this.mediaRecorder;

    recorder.ondataavailable = (event) => {
      if (generation !== this.captureGeneration) return;
      if (event.data && event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    recorder.onstart = () => {
      if (generation !== this.captureGeneration) return;
      this.listening = true;
      this.onInterimCallback?.('Listening... Speak now');
      this.setupVAD(generation);
      this.maxDurationTimer = setTimeout(() => {
        if (generation === this.captureGeneration && this.listening) {
          this.stop();
        }
      }, 15000);
    };

    recorder.onerror = (event: any) => {
      if (generation !== this.captureGeneration) return;
      this.detachRecorder(recorder);
      this.cleanup();
      const err = new Error(`MediaRecorder error: ${event.error?.name || 'Unknown'}`);
      this.errorCallback?.(err);
      this.endCallback?.();
    };

    recorder.onstop = () => {
      this.detachRecorder(recorder);
      if (generation !== this.captureGeneration) return;
      void this.handleRecorderStop(generation);
    };

    if (recorder.state === 'inactive') {
      recorder.start(250);
    }
  }

  private detachRecorder(recorder: MediaRecorder): void {
    recorder.ondataavailable = null;
    recorder.onstart = null;
    recorder.onerror = null;
    recorder.onstop = null;
    if (this.mediaRecorder === recorder) {
      this.mediaRecorder = null;
    }
  }

  private async handleRecorderStop(generation: number): Promise<void> {
    this.listening = false;
    this.clearTimers();
    // Capture VAD outcomes BEFORE tearing the analyser down.
    const vadWasActive = this.vadActive;
    const speechWasDetected = this.speechDetected;
    this.closeVad();

    try {
      const chunks = this.audioChunks;
      this.audioChunks = [];

      if (generation !== this.captureGeneration || this.abortedByController) {
        return;
      }

      if (chunks.length === 0) {
        this.errorCallback?.(new Error('No speech was captured.'));
        this.endCallback?.();
        return;
      }

      const audioBlob = new Blob(chunks, { type: this.recorderMimeType });
      if (audioBlob.size < 64) {
        this.errorCallback?.(new Error('Captured audio was empty.'));
        this.endCallback?.();
        return;
      }

      /*
       * NO-SPEECH GATE: when the VAD ran but never observed speech energy, the
       * clip is ambient noise. Sending noise to Whisper provokes token-repetition
       * hallucinations ("PEAS01 PEAS02 PEAS032 ..."). Fail honestly instead of
       * transcribing — no STT request is made for silence.
       */
      if (vadWasActive && !speechWasDetected) {
        this.errorCallback?.(new Error('No speech was detected. Please try again.'));
        this.endCallback?.();
        return;
      }

      this.onInterimCallback?.('Transcribing speech...');

      const result = await this.transcribeBlob(audioBlob, generation);
      if (generation !== this.captureGeneration || this.abortedByController) {
        return;
      }

      if (result.error) {
        this.errorCallback?.(new Error(result.error));
        this.endCallback?.();
        return;
      }

      if (!result.transcript) {
        this.errorCallback?.(new Error('Groq Whisper returned an empty transcript.'));
        this.endCallback?.();
        return;
      }

      /*
       * HALLUCINATION GUARD: a run of course-code tokens with no conversational
       * words is Whisper noise, never a student request. Reject it with an honest
       * error so it can never reach chat, intent resolution, or verified data.
       */
      if (looksLikeSttHallucination(result.transcript)) {
        logVoiceDiagnostic(
          'stt_hallucination_suspected',
          this.name,
          {
            transcript: result.transcript,
            transcriptLength: result.transcript.length,
            model: result.model
          },
          undefined,
          'HALLUCINATION_GUARD'
        );
        this.errorCallback?.(
          new Error('That sounded like background noise rather than a clear request. Please try again.')
        );
        this.endCallback?.();
        return;
      }

      logVoiceDiagnostic('groq_transcript_received', this.name, {
        model: result.model,
        transcriptLength: result.transcript.length,
        duration: result.duration,
        requestId: result.requestId
      });
      this.finalCallback?.(result.transcript);
      this.endCallback?.();
    } finally {
      /*
       * Release the microphone at EVERY terminal point of a capture session so
       * the OS/Chrome mic indicator turns OFF while idle. The next press performs
       * a fresh getUserMedia (permission persists for the session).
       * Generation check: if a NEWER capture session started while this one was
       * transcribing, its stream must NOT be torn down by this stale session.
       */
      if (generation === this.captureGeneration) {
        this.cleanupStream();
      }
    }
  }

  private async transcribeBlob(audioBlob: Blob, generation: number): Promise<TranscriptionResult> {
    const mimeType = audioBlob.type || this.recorderMimeType;
    const requestId = `stt-${Date.now()}-${generation}-${Math.random().toString(36).slice(2, 6)}`;
    logVoiceDiagnostic('groq_stt_request_started', this.name, {
      requestId,
      byteLength: audioBlob.size,
      contentType: mimeType,
      model: GroqWhisperProvider.WHISPER_MODEL
    });

    let transcriptionTimeout: ReturnType<typeof setTimeout> | null = null;
    let transcriptionController: AbortController | null = null;
    try {
      const base64Data = await this.blobToBase64(audioBlob);
      if (generation !== this.captureGeneration) {
        return { transcript: '', provider: 'groq', model: GroqWhisperProvider.WHISPER_MODEL, error: 'stale' };
      }

      const baseUrl = getBackendUrl() || this.backendBaseUrl;
      transcriptionController = new AbortController();
      this.transcriptionAbortController = transcriptionController;
      transcriptionTimeout = setTimeout(
        () => transcriptionController?.abort(),
        GroqWhisperProvider.TRANSCRIPTION_TIMEOUT_MS
      );
      const response = await fetch(`${baseUrl}/api/voice/transcribe-json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          audio_base64: base64Data,
          content_type: mimeType,
          filename: mimeType.includes('wav') ? 'student_voice.wav' : 'student_voice.webm'
        }),
        signal: transcriptionController.signal
      });

      if (!response.ok) {
        throw new Error(`Whisper transcription failed with HTTP ${response.status}`);
      }

      const data = await response.json();
      const transcript = String(data.text || data.transcript || '').trim();
      logVoiceDiagnostic('groq_stt_request_succeeded', this.name, {
        requestId,
        provider: 'groq-whisper',
        model: data.model || GroqWhisperProvider.WHISPER_MODEL,
        byteLength: audioBlob.size,
        transcriptLength: transcript.length,
        transcript
      });
      return {
        transcript,
        provider: 'groq',
        model: data.model || GroqWhisperProvider.WHISPER_MODEL,
        duration: typeof data.duration === 'number' ? data.duration : undefined,
        requestId: data.requestId || data.request_id
      };
    } catch (err: any) {
      const wasTimeout = err?.name === 'AbortError';
      const message = wasTimeout
        ? 'Groq Whisper transcription timed out.'
        : err instanceof Error
        ? err.message
        : String(err || 'Groq Whisper transcription failed.');
      logVoiceDiagnostic('groq_stt_request_failed', this.name, { requestId, reason: wasTimeout ? 'TIMEOUT' : 'REQUEST_FAILED' }, undefined, message);
      return {
        transcript: '',
        provider: 'groq',
        model: GroqWhisperProvider.WHISPER_MODEL,
        error: message
      };
    } finally {
      if (transcriptionTimeout) clearTimeout(transcriptionTimeout);
      if (this.transcriptionAbortController === transcriptionController) {
        this.transcriptionAbortController = null;
      }
    }
  }

  private setupVAD(generation: number) {
    if (!this.audioStream || typeof window === 'undefined') return;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      this.vadAudioCtx = new AudioCtx();
      if (this.vadAudioCtx.state === 'suspended') {
        this.vadAudioCtx.resume().catch(() => {});
      }

      const source = this.vadAudioCtx.createMediaStreamSource(this.audioStream);
      const analyser = this.vadAudioCtx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const buffer = new Float32Array(analyser.fftSize);
      let hasSpoken = false;
      let silenceStartTime: number | null = null;

      // VAD loop is live for this session: the no-speech gate is now armed.
      this.vadActive = true;

      this.vadInterval = setInterval(() => {
        if (generation !== this.captureGeneration || !this.listening) return;

        analyser.getFloatTimeDomainData(buffer);
        let sumSq = 0;
        for (let i = 0; i < buffer.length; i++) {
          sumSq += buffer[i] * buffer[i];
        }
        const rms = Math.sqrt(sumSq / buffer.length);

        if (rms > 0.018) {
          if (!hasSpoken) {
            hasSpoken = true;
            this.speechDetected = true;
            this.onInterimCallback?.('Listening... (Speech detected)');
          }
          silenceStartTime = null;
        } else if (hasSpoken) {
          const now = Date.now();
          if (silenceStartTime === null) {
            silenceStartTime = now;
          } else if (now - silenceStartTime > 1700) {
            this.clearTimers();
            this.stop();
          }
        }
      }, 100);
    } catch (e) {
      console.warn('[GroqWhisperProvider] VAD initialization skipped:', e);
    }
  }

  public stop(): void {
    if (this.stopRequested) return;
    this.stopRequested = true;
    this.clearTimers();
    this.listening = false;
    const recorder = this.mediaRecorder;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        void this.handleRecorderStop(this.captureGeneration);
      }
    } else if (recorder && recorder.state === 'inactive') {
      // stop() was already delivered via onstop; do not transcribe twice.
      return;
    } else if (!this.abortedByController) {
      void this.handleRecorderStop(this.captureGeneration);
    }
  }

  public cancelPendingWork(): void {
    this.transcriptionAbortController?.abort();
    this.transcriptionAbortController = null;
  }

  public abort(): void {
    this.abortUtterance(false);
  }

  public isListening(): boolean {
    return this.listening;
  }

  private closeVad() {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
    if (this.vadAudioCtx && this.vadAudioCtx.state !== 'closed') {
      this.vadAudioCtx.close().catch(() => {});
      this.vadAudioCtx = null;
    }
  }

  private cleanupStream() {
    this.closeVad();
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
    this.transcriptionAbortController?.abort();
    this.transcriptionAbortController = null;
  }

  private clearTimers() {
    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
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
