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

// Exactly two user-facing modes: 'LIVE_AGENT' (Ultimate Live AI Voice) and 'OFF' (Voice Off).
// 'ASSIST' is preserved as a deprecated backward-compatible alias that resolves to 'LIVE_AGENT'.
export type VoiceMode = 'OFF' | 'LIVE_AGENT' | 'ASSIST';

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

export type VoiceDiagnosticState =
  | 'VOICE_OFF'
  | 'VOICE_INITIALIZING'
  | 'MIC_REQUESTING'
  | 'MIC_READY'
  | 'LISTENING'
  | 'STT_PROCESSING'
  | 'TRANSCRIPT_READY'
  | 'THINKING'
  | 'RESPONSE_READY'
  | 'TTS_INITIALIZING'
  | 'TTS_READY'
  | 'TTS_GENERATING'
  | 'AUDIO_READY'
  | 'PLAYING'
  | 'STOPPING'
  | 'ERROR';

export interface VoiceDiagnosticEventRecord {
  executionId?: string;
  type: VoiceDiagnosticState;
  timestamp: number;
  provider: string;
  duration?: number;
  error?: string;
  details?: Record<string, any>;
}

export type NarrationLevel = 'IMPORTANT' | 'DETAILED' | 'FINAL_ONLY';

export type SpeechPriority =
  | 'FINAL_RESULT'
  | 'BLOCKER'
  | 'USER_RELEVANT_DISCOVERY'
  | 'MEANINGFUL_PROGRESS'
  | 'ACKNOWLEDGEMENT'
  | 'HIGH'
  | 'NORMAL'
  | 'LOW';

export type NarrationMilestoneType =
  | 'LOW_VALUE_EVENT'
  | 'ACKNOWLEDGEMENT'
  | 'MEANINGFUL_PROGRESS'
  | 'USER_RELEVANT_DISCOVERY'
  | 'BLOCKER'
  | 'ADAPTATION'
  | 'VERIFICATION'
  | 'FINAL_RESULT';

export interface NarrationContext {
  executionId?: string;
  userRequest?: string;
  intent?: string;
  goal?: string;
  phase?: string;
  currentAction?: string;
  browserObservation?: string;
  relevantFacts?: Record<string, any>;
  verifiedFacts?: Record<string, any>;
  previousNarrations?: string[];
  allowResultClaim?: boolean;
  urgency?: 'HIGH' | 'NORMAL' | 'LOW';
  userPreferences?: Partial<VoicePreferences>;
  mode?: VoiceMode;
  level?: NarrationLevel;
  lastSpokenPhrase?: string;
  lastSpokenTime?: number;
  activeExecutionId?: string | null;
}

export interface NarrationResult {
  text: string;
  purpose: string;
  executionId: string;
  priority: SpeechPriority;
  shouldSpeak: boolean;
  shouldStream?: boolean;
  interruptible?: boolean;
  semanticKey?: string;
}

export type TTSProviderLifecycleState = 'idle' | 'loading' | 'initializing' | 'ready' | 'generating' | 'playing' | 'error';

export interface VoicePreferences {
  enabled: boolean;
  mode: VoiceMode;
  speechRate: number; // 0.8 - 1.4, default 1.0
  speechPitch: number; // 0.9 - 1.2, default 1.0
  speechVolume: number; // 0.1 - 1.0, default 1.0
  voiceURI?: string;
  narrationLevel: NarrationLevel;
  bargeInEnabled: boolean;
  preferLocalTts: boolean;
  /** FINAL SPEC: only Groq Orpheus is selectable as the primary TTS provider. */
  primaryProvider?: 'groq';
  /** FINAL SPEC: no local voice fallback exists; only 'none' or 'groq'. */
  fallbackProvider?: 'none' | 'groq';
  /** STT selection. Every value — including legacy `local`/`browser` strings from old builds — resolves to Groq Whisper. */
  sttMode?: 'auto' | 'groq' | string;
}

export interface TranscriptionResult {
  transcript: string;
  provider: 'groq' | 'local';
  model: string;
  confidence?: number;
  duration?: number;
  requestId?: string;
  error?: string;
}

export interface VoiceQueueItem {
  id: string;
  text: string;
  priority: SpeechPriority;
  executionId?: string;
  isFinalResult?: boolean;
  force?: boolean;
  /** FINAL SPEC: only Groq Orpheus or 'auto' (which resolves to Groq) can be requested. */
  providerPreference?: 'groq' | 'auto';
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
  priority?: SpeechPriority;
  executionId?: string;
  isFinalResult?: boolean;
  force?: boolean;
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
  getLifecycleState?: () => TTSProviderLifecycleState;
  initialize?: () => Promise<any>;
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
