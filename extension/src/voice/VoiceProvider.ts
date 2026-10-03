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
  preferLocalTts: true
};

/**
 * Splits text into natural sentence chunks for streaming voice synthesis.
 * The first sentence can play with near-zero latency while subsequent
 * sentences are queued smoothly.
 */
export function chunkSpeechText(text: string, maxChunkLength: number = 180): string[] {
  const cleaned = text.trim().replace(/\s+/g, ' ');
  if (!cleaned) return [];

  // Match sentences ending in . ! ? : or end of string
  const sentenceRegex = /[^.!?:]+[.!?:]+(?:\s+|$)|[^.!?:]+$/g;
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
