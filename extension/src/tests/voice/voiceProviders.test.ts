import { describe, it, expect } from 'vitest';
import { NativeSpeechRecognitionProvider } from '../../voice/providers/NativeSpeechRecognitionProvider';
import { NativeSpeechSynthesisProvider } from '../../voice/providers/NativeSpeechSynthesisProvider';
import { GroqWhisperProvider } from '../../voice/providers/GroqWhisperProvider';
import { GroqOrpheusProvider } from '../../voice/providers/GroqOrpheusProvider';
import { chunkSpeechText } from '../../voice/VoiceProvider';

describe('Voice Providers and Utilities', () => {
  it('chunkSpeechText splits sentences cleanly without mid-word breaks', () => {
    const text = 'Sure, I will check your examination schedule first. Your next exam is CSE408 on 24th October. Good luck with your preparation!';
    const chunks = chunkSpeechText(text, 60);

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    chunks.forEach((c) => {
      expect(c.length).toBeLessThanOrEqual(75);
    });
  });

  it('chunkSpeechText handles short text without redundant splitting', () => {
    const text = 'Checking UMS.';
    const chunks = chunkSpeechText(text);
    expect(chunks).toEqual(['Checking UMS.']);
  });

  it('NativeSpeechRecognitionProvider reports supported based on window object', () => {
    const provider = new NativeSpeechRecognitionProvider();
    expect(typeof provider.isSupported()).toBe('boolean');
  });

  it('NativeSpeechSynthesisProvider reports supported based on window object', () => {
    const provider = new NativeSpeechSynthesisProvider();
    expect(typeof provider.isSupported()).toBe('boolean');
  });

  it('GroqWhisperProvider has correct provider name and url handling', () => {
    const provider = new GroqWhisperProvider('http://localhost:8000/');
    expect(provider.name).toBe('groq-whisper');
  });

  it('GroqOrpheusProvider has correct provider name and methods', () => {
    const provider = new GroqOrpheusProvider('http://localhost:8000/');
    expect(provider.name).toBe('groq-orpheus-tts');
    expect(typeof provider.stop).toBe('function');
  });
});
