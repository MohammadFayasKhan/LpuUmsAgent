/*
 * Voice Provider Abstraction & Utilities for ONEE.
 *
 * Implements provider orchestration, sentence chunking, and preference defaults.
 */

import {
  VoicePreferences,
  ISpeechRecognitionProvider,
  ISpeechSynthesisProvider
} from './VoiceTypes';

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  enabled: true,
  mode: 'LIVE_AGENT',
  speechRate: 1.05,
  speechPitch: 1.0,
  speechVolume: 1.0,
  narrationLevel: 'IMPORTANT',
  bargeInEnabled: true,
  // FINAL SPEC: Groq Orpheus is the ONLY TTS provider. Local Kokoro and native
  // browser SpeechSynthesis are removed from the runtime chain entirely —
  // a Groq failure reports an honest text-only outcome, never a local voice.
  // Stale stored preferences (preferLocalTts etc.) are migrated to this
  // Groq-only configuration on load; they can never select a local provider.
  preferLocalTts: false,
  // FINAL SPEC: Groq is the ONLY speech provider. Local Kokoro and native
  // browser SpeechSynthesis are removed from the runtime chain entirely —
  // a Groq failure reports an honest text-only outcome, never a local voice.
  primaryProvider: 'groq',
  fallbackProvider: 'none',
  // STT: Groq Whisper is the only transcription path. Browser
  // SpeechRecognition is removed from the runtime entirely.
  sttMode: 'groq'
};

export type CanonicalSttProvider = 'groq' | 'local';
export type CanonicalTtsProvider = 'groq' | 'kokoro' | 'native';

/**
 * Single STT preference boundary. Groq Whisper is the ONLY STT provider at
 * runtime; every historical alias (including stored `local`/`browser` values
 * written by old builds) resolves to Groq. Local recognition is removed.
 */
export function resolveSttProviderPreference(_raw?: string | null): CanonicalSttProvider {
  return 'groq';
}

/**
 * Single TTS preference boundary. Groq Orpheus is the ONLY TTS provider at
 * runtime; every historical alias (including stored `kokoro`/`native` values
 * written by old builds) resolves to Groq. Local synthesis is removed.
 */
export function resolveTtsProviderPreference(_raw?: string | null): CanonicalTtsProvider {
  return 'groq';
}

/**
 * Voice URIs that belong to the local Kokoro-82M voice model.
 * Kept in one place so preference loading/validation never accepts a cloud-only
 * voice name (e.g. Orpheus names) as a Kokoro voice.
 */
export const KOKORO_VOICE_URIS = [
  'af_heart',
  'af_bella',
  'af_nicole',
  'af_sky',
  'af_sarah',
  'am_adam',
  'am_michael',
  'bf_emma',
  'bm_george'
] as const;

export const DEFAULT_KOKORO_VOICE_URI = 'af_heart';

/**
 * Splits text into natural sentence chunks for streaming voice synthesis.
 * The first sentence can play with near-zero latency while subsequent
 * sentences are queued smoothly.
 */
/**
 * Prepares canonical text for clean, natural speech synthesis by removing
 * markdown formatting, raw tables, code blocks, emojis, and symbols.
 * Preserves the student's canonical response while establishing Sofia identity for speech.
 */
export function transformSpeechIdentity(text: string): string {
  if (!text) return text;
  let out = text;
  // Clean markdown code blocks and inline code
  out = out.replace(/```[\s\S]*?```/g, '');
  out = out.replace(/`([^`]+)`/g, '$1');
  // Clean markdown links [text](url) -> text
  out = out.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
  // Clean bold / italic / strike. Underscores become spaces (word separators
  // in filenames/keys), never glue: "CSE408_Sample_Paper" reads as words.
  out = out.replace(/[*~]+/g, '');
  out = out.replace(/_+/g, ' ');
  // Clean blockquotes
  out = out.replace(/^>\s*/gm, '');
  // Clean markdown headers — drop ENTIRE heading lines: headings are visual
  // scaffolding for chat, the prose that follows carries the spoken answer.
  out = out.replace(/^#+\s+.*$/gm, '');
  // Markdown tables are visual layout, not speech. Drop table rows and divider
  // lines entirely so the spoken response never reads table headers or pipes
  // aloud. The prose of the canonical response already carries the answer.
  out = out.split('\n').filter((line) => !/^\s*\|/.test(line)).join('\n');
  out = out.replace(/\|/g, ' ');
  // Remove horizontal rules and separator lines
  out = out.replace(/^\s*[-*_]{3,}\s*$/gm, ' ');
  // Clean leading headers, emojis, bullets, and symbols. The → arrow (the
  // display convention everywhere in chat) is dropped exactly like the —
  // em-dash it replaced so TTS never vocalizes "arrow".
  out = out.replace(/[👋🔊ℹ️⚠️💡🎓✨🚨📊📚📈📉📅📋📄🛡️🎯🪑👨‍🏫🔬📍🌟🤖✅•*—–→🚩]/g, ' ');
  out = out.replace(/^[#\s\-]+/gm, '');
  // Clean double spaces or duplicate punctuation
  out = out.replace(/\s+/g, ' ').replace(/!\s*!/g, '!').replace(/,\s*,/g, ',').replace(/\.\s*\./g, '.').trim();
  // Never leave empty/meaningless fragments behind
  out = out.replace(/^[\s.,:;]*$/, '');
  // Time ranges spoken with "to": "10:20-11:10" / "09:30 AM - 10:00 AM"
  // (the optional AM/PM group carries its own leading space so the replacement
  // never produces a double space).
  out = out.replace(
    /(\d{1,2}:\d{2})((?:\s+(?:A\.?M\.?|P\.?M\.?))?)\s*[-–—]\s*(\d{1,2}:\d{2})/g,
    '$1$2 to $3'
  );
  // Natural clock speech: "09:30" -> "9:30".
  out = out.replace(/(?<!\d)0(\d:\d{2})/g, '$1');
  // Classroom codes spoken as block + room: "in Room 34-201" -> "in Block 34,
  // Room 201" (consume the leading "Room" word so it cannot duplicate), then
  // bare "33-307" / "R-38-917" forms. Guards keep dates/times untouched.
  out = out.replace(/\broom\s+(?:r[:\-]\s*)?(\d{2})-(\d{3})(?!\d)/gi, 'Block $1, Room $2');
  out = out.replace(/(?<![\d:])(?:R[:\-]\s*)?(\d{2})-(\d{3})(?!\d)/g, 'Block $1, Room $2');
  // UMS is three letters, never the word "ums": spell it out for speech.
  out = out.replace(/\bUMS\b/g, 'U M S');
  // Fractions for natural speech: "5/10" -> "5 out of 10".
  // Date forms like 10/8/2026 and "711 / S" patterns are never touched.
  out = out.replace(/(?<![\d/])(\d{1,3})\s*\/\s*(\d{1,3})(?![\d/])/g, '$1 out of $2');
  // Keep AI assistant name as Sofia only for voice agent
  out = out
    .replace(/\bI am ONEE\b/gi, 'I am Sofia')
    .replace(/\bI'm ONEE\b/gi, "I'm Sofia")
    .replace(/\bIm ONEE\b/gi, "I'm Sofia")
    .replace(/\bmy name is ONEE\b/gi, 'my name is Sofia')
    .replace(/\bThis is ONEE\b/gi, 'This is Sofia')
    .replace(/\bONEE here\b/gi, 'Sofia here')
    .replace(/\bONEE\b/g, 'Sofia')
    .replace(/\bOnee\b/g, 'Sofia');
  return out;
}

export function chunkSpeechText(text: string, maxChunkLength: number = 180): string[] {
  const cleaned = text.trim().replace(/\s+/g, ' ');
  if (!cleaned) return [];

  // Match sentences ending in . ! ? or end of string (never split on colons in timestamps like 09:00)
  const sentenceRegex = /[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g;
  const matches = cleaned.match(sentenceRegex) || [cleaned];

  const chunks: string[] = [];

  for (const part of matches) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.length <= maxChunkLength) {
      chunks.push(trimmed);
    } else {
      // If a single sentence exceeds maxChunkLength, split by commas or clause boundaries
      const subParts = trimmed.split(/,\s+/);
      let subChunk = '';
      for (const sp of subParts) {
        if (subChunk.length + sp.length + 2 <= maxChunkLength) {
          subChunk = subChunk ? `${subChunk}, ${sp}` : sp;
        } else {
          if (subChunk) chunks.push(subChunk);
          subChunk = sp;
        }
      }
      if (subChunk) chunks.push(subChunk);
    }
  }

  return chunks.length > 0 ? chunks : [cleaned];
}

export class VoiceRegistry {
  private static instance: VoiceRegistry;
  private recognitionProviders: Map<string, ISpeechRecognitionProvider> = new Map();
  private synthesisProviders: Map<string, ISpeechSynthesisProvider> = new Map();

  private constructor() {}

  public static getInstance(): VoiceRegistry {
    if (!VoiceRegistry.instance) {
      VoiceRegistry.instance = new VoiceRegistry();
    }
    return VoiceRegistry.instance;
  }

  public registerRecognitionProvider(provider: ISpeechRecognitionProvider) {
    this.recognitionProviders.set(provider.name, provider);
  }

  public registerSynthesisProvider(provider: ISpeechSynthesisProvider) {
    this.synthesisProviders.set(provider.name, provider);
  }

  public getRecognitionProvider(name: string): ISpeechRecognitionProvider | undefined {
    return this.recognitionProviders.get(name);
  }

  public getSynthesisProvider(name: string): ISpeechSynthesisProvider | undefined {
    return this.synthesisProviders.get(name);
  }
}

export const voiceRegistry = VoiceRegistry.getInstance();
