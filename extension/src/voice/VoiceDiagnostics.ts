/*
 * Voice Subsystem Diagnostics & Event Logger for ONEE.
 * Provides transparent tracking of voice requests, provider selection,
 * model inference, and audio playback without exposing secrets or sensitive data.
 */

import { VoiceDiagnosticState } from './VoiceTypes';

export type VoiceDiagnosticEvent =
  | VoiceDiagnosticState
  | 'TTS_REQUEST'
  | 'TTS_PROVIDER_SELECTED'
  | 'KOKORO_INITIALIZING'
  | 'KOKORO_READY'
  | 'KOKORO_GENERATING'
  | 'AUDIO_READY'
  | 'AUDIO_PLAYING'
  | 'AUDIO_STOPPED'
  | 'TTS_ERROR'
  | 'groq_selected'
  | 'groq_stt_request_started'
  | 'groq_stt_request_succeeded'
  | 'groq_transcript_received'
  | 'groq_stt_request_failed'
  | 'stt_hallucination_suspected'
  | 'groq_tts_request_started'
  | 'groq_tts_request_succeeded'
  | 'groq_tts_failed'
  | 'fallback_selected'
  | 'fallback_completed'
  // End-to-end pipeline lifecycle events (emitted at real boundaries so
  // "selected" can never be confused with "actually invoked").
  | 'voice_request_created'
  | 'transcript_finalized'
  | 'capability_resolved'
  | 'browser_execution_started'
  | 'browser_execution_completed'
  | 'response_composed'
  | 'execution_completed';

export interface VoiceDiagnosticRecord {
  id: string;
  event: VoiceDiagnosticEvent;
  provider: string;
  timestamp: number;
  executionId?: string;
  duration?: number;
  error?: string;
  details?: Record<string, any>;
}

export type VoiceDiagnosticListener = (record: VoiceDiagnosticRecord) => void;

class VoiceDiagnosticsManager {
  private static instance: VoiceDiagnosticsManager;
  private history: VoiceDiagnosticRecord[] = [];
  private listeners: Set<VoiceDiagnosticListener> = new Set();
  private maxHistory: number = 100;
  private lastStateTimestamps: Map<string, number> = new Map();

  private constructor() {}

  public static getInstance(): VoiceDiagnosticsManager {
    if (!VoiceDiagnosticsManager.instance) {
      VoiceDiagnosticsManager.instance = new VoiceDiagnosticsManager();
    }
    return VoiceDiagnosticsManager.instance;
  }

  public log(
    event: VoiceDiagnosticEvent,
    provider: string,
    details?: Record<string, any>,
    executionId?: string,
    error?: string
  ): VoiceDiagnosticRecord {
    // Sanitize details: ensure no sensitive data or credentials are logged
    const sanitizedDetails: Record<string, any> = {};
    if (details) {
      for (const [key, value] of Object.entries(details)) {
        if (
          typeof value === 'string' &&
          (key.toLowerCase().includes('pass') ||
            key.toLowerCase().includes('token') ||
            key.toLowerCase().includes('secret'))
        ) {
          sanitizedDetails[key] = '[REDACTED]';
        } else {
          sanitizedDetails[key] = value;
        }
      }
    }

    const now = Date.now();
    const prevTime = this.lastStateTimestamps.get(provider);
    const duration = prevTime ? now - prevTime : undefined;
    this.lastStateTimestamps.set(provider, now);

    const record: VoiceDiagnosticRecord = {
      id: `diag-${now}-${Math.random().toString(36).slice(2, 6)}`,
      event,
      provider,
      timestamp: now,
      executionId: executionId || (details?.executionId as string | undefined),
      duration: duration || (details?.duration as number | undefined),
      error: error || (details?.error as string | undefined),
      details: sanitizedDetails
    };

    this.history.push(record);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Development & diagnostic console output
    const execTag = record.executionId ? `[${record.executionId}]` : '';
    const errTag = record.error ? ` [ERROR: ${record.error}]` : '';
    console.info(`[ONEE_VOICE][${event}]${execTag} [${provider}]${errTag}`, sanitizedDetails);

    this.listeners.forEach((listener) => {
      try {
        listener(record);
      } catch (err) {
        console.warn('[VoiceDiagnostics] Listener error:', err);
      }
    });

    return record;
  }

  public logEvent(event: {
    executionId?: string;
    type: VoiceDiagnosticState;
    provider: string;
    duration?: number;
    error?: string;
    details?: Record<string, any>;
  }): VoiceDiagnosticRecord {
    return this.log(
      event.type,
      event.provider,
      { ...event.details, duration: event.duration },
      event.executionId,
      event.error
    );
  }

  public subscribe(listener: VoiceDiagnosticListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getHistory(): VoiceDiagnosticRecord[] {
    return [...this.history];
  }

  public getRecent(count: number = 10): VoiceDiagnosticRecord[] {
    return this.history.slice(-count);
  }

  public clear(): void {
    this.history = [];
    this.lastStateTimestamps.clear();
  }
}

export const voiceDiagnostics = VoiceDiagnosticsManager.getInstance();

export function logVoiceDiagnostic(
  event: VoiceDiagnosticEvent,
  provider: string,
  details?: Record<string, any>,
  executionId?: string,
  error?: string
): VoiceDiagnosticRecord {
  return voiceDiagnostics.log(event, provider, details, executionId, error);
}
