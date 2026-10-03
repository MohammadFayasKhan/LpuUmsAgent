/*
 * Voice Module Type Definitions for ONEE.
 *
 * Defines the core types, interfaces, and state structures for the
 * Voice + Agentic Computer Use layer:
 * - VoiceMode: OFF (silent), ASSIST (concise narration + verified result), LIVE_AGENT (full real-time narration).
 * - VoiceState: High-level state machine representing voice lifecycle.
 * - NarrationPolicy: Mapping of semantic agent events to spoken updates.
 * - Provider Interfaces: SpeechRecognitionProvider & SpeechSynthesisProvider.
 */

export type VoiceMode = 'OFF' | 'ASSIST' | 'LIVE_AGENT';

export type VoiceState =
  | 'IDLE'
  | 'LISTENING'
  | 'TRANSCRIBING'
  | 'UNDERSTANDING'
  | 'PLANNING'
  | 'NARRATING'
  | 'SPEAKING'
  | 'CANCELLED'
  | 'ERROR';

export type NarrationLevel = 'IMPORTANT' | 'DETAILED' | 'FINAL_ONLY';

export type SpeechPriority = 'HIGH' | 'NORMAL' | 'LOW';

export interface VoicePreferences {
  enabled: boolean;
  mode: VoiceMode;
  speechRate: number; // 0.8 - 1.4, default 1.05
  speechPitch: number; // 0.9 - 1.2, default 1.0
  speechVolume: number; // 0.1 - 1.0, default 1.0
  voiceURI?: string;
  narrationLevel: NarrationLevel;
  bargeInEnabled: boolean;
  preferLocalTts: boolean;
}

export interface VoiceQueueItem {
  id: string;
  text: string;
  priority: SpeechPriority;
  executionId?: string;
  isFinalResult?: boolean;
  providerPreference?: 'native' | 'groq' | 'auto';
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
}

export interface AvailableVoice {
  name: string;
  lang: string;
  voiceURI: string;
  default?: boolean;
  localService?: boolean;
}

export interface ISpeechRecognitionProvider {
  readonly name: string;
  isSupported: () => boolean;
  start: (
    onInterim: (text: string) => void,
    onFinal: (text: string) => void,
    onError: (err: Error) => void,
    onEnd?: () => void
  ) => Promise<void>;
  stop: () => void;
  abort: () => void;
  isListening: () => boolean;
}

export interface SpeechSynthesisOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
  voiceURI?: string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
}

export interface ISpeechSynthesisProvider {
  readonly name: string;
  isSupported: () => boolean;
  speak: (text: string, options?: SpeechSynthesisOptions) => Promise<void>;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  isSpeaking: () => boolean;
  getAvailableVoices: () => Promise<AvailableVoice[]>;
}

export interface VoiceEventPayload {
  state: VoiceState;
  transcript?: string;
  interimTranscript?: string;
  spokenText?: string;
  error?: string;
  executionId?: string;
}

export type VoiceStateListener = (state: VoiceState, payload?: VoiceEventPayload) => void;
