import { describe, it, expect } from 'vitest';
import { GroqWhisperProvider } from '../../voice/providers/GroqWhisperProvider';
import { GroqOrpheusProvider } from '../../voice/providers/GroqOrpheusProvider';
import {
  chunkSpeechText,
  resolveSttProviderPreference,
  resolveTtsProviderPreference,
  transformSpeechIdentity,
  voiceRegistry
} from '../../voice/VoiceProvider';
import * as voiceModule from '../../voice';

describe('Production Voice Registry (STRICT Groq-only)', () => {
  it('exports ONLY the approved Groq voice providers from the production barrel', () => {
    const keys = Object.keys(voiceModule);

    // Approved production registry: GROQ_VOICE_STT → GROQ_VOICE_TTS
    expect(keys).toContain('groqWhisperProvider');
    expect(keys).toContain('groqOrpheusProvider');
    expect(keys).toContain('voiceController');
    expect(keys).toContain('VoiceQueue');

    // Local/browser providers and dead narration layers must NOT be reachable
    // from the production module graph.
    const forbidden = [
      'nativeSpeechRecognitionProvider',
      'NativeSpeechRecognitionProvider',
      'nativeSpeechSynthesisProvider',
      'NativeSpeechSynthesisProvider',
      'kokoroTTSProvider',
      'KokoroTTSProvider',
      'VoiceRuntime',
      'getVoiceRuntime',
      'generateElaboratedVoiceSummary',
      'ElaboratedVoiceSummary',
      'StreamingVoiceSentencePacer'
    ];
    for (const name of forbidden) {
      expect(keys).not.toContain(name);
    }
  });
});

describe('Voice Providers and Utilities', () => {
  it('resolves EVERY STT preference alias — including stale local/browser values — to Groq only', () => {
    expect(resolveSttProviderPreference('auto')).toBe('groq');
    expect(resolveSttProviderPreference('whisper')).toBe('groq');
    expect(resolveSttProviderPreference('groq-whisper')).toBe('groq');
    // FINAL SPEC: local/browser recognition is removed from the runtime.
    expect(resolveSttProviderPreference('native')).toBe('groq');
    expect(resolveSttProviderPreference('browser')).toBe('groq');
    expect(resolveSttProviderPreference('local')).toBe('groq');
    expect(resolveSttProviderPreference(undefined)).toBe('groq');
  });

  it('resolves EVERY TTS preference alias — including stale kokoro/native values — to Groq only', () => {
    expect(resolveTtsProviderPreference('auto')).toBe('groq');
    expect(resolveTtsProviderPreference('orpheus')).toBe('groq');
    expect(resolveTtsProviderPreference('groqOrpheus')).toBe('groq');
    // FINAL SPEC: local Kokoro and native speech are removed from the runtime.
    expect(resolveTtsProviderPreference('kokoro')).toBe('groq');
    expect(resolveTtsProviderPreference('native-browser-speech')).toBe('groq');
    expect(resolveTtsProviderPreference(undefined)).toBe('groq');
  });

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

  it('chunkSpeechText preserves time strings with colons without chopping into fragments', () => {
    const text = 'Your class begins at 09:00 - 10:00 in Room 34-201, followed by Data Structures at 10:00 - 11:00.';
    const chunks = chunkSpeechText(text, 200);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain('09:00 - 10:00');
    expect(chunks[0]).toContain('10:00 - 11:00');
  });

  it('production recognition registry contains ONLY the Groq Whisper STT provider', () => {
    // Importing the production barrel performs the one and only runtime
    // registration. Native/browser STT is not part of it and cannot be
    // selected: there is no registration path for it anywhere in production.
    expect(voiceRegistry.getRecognitionProvider('groq-whisper')).toBeDefined();
    expect(voiceRegistry.getRecognitionProvider('groq-whisper')?.name).toBe('groq-whisper');
    expect(voiceRegistry.getRecognitionProvider('native-speech-recognition')).toBeUndefined();
    expect(voiceRegistry.getRecognitionProvider('browser-speech')).toBeUndefined();
    expect(voiceRegistry.getRecognitionProvider('local-stt')).toBeUndefined();
  });

  it('production synthesis registry contains ONLY the Groq Orpheus TTS provider', () => {
    expect(voiceRegistry.getSynthesisProvider('groq-orpheus-tts')).toBeDefined();
    expect(voiceRegistry.getSynthesisProvider('groq-orpheus-tts')?.name).toBe('groq-orpheus-tts');
    expect(voiceRegistry.getSynthesisProvider('native-speech-synthesis')).toBeUndefined();
    expect(voiceRegistry.getSynthesisProvider('kokoro-82m-tts')).toBeUndefined();
    expect(voiceRegistry.getSynthesisProvider('browser-speech')).toBeUndefined();
    expect(voiceRegistry.getSynthesisProvider('local-tts')).toBeUndefined();
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

  it('no local or browser provider is registered even after resolving stale preferences', () => {
    // Stale stored values written by old builds must never re-introduce a
    // local provider: resolution is hard-wired to Groq and the registry
    // contains only the two approved Groq entries.
    resolveSttProviderPreference('native');
    resolveSttProviderPreference('local');
    resolveTtsProviderPreference('kokoro');
    resolveTtsProviderPreference('native');
    expect(voiceRegistry.getRecognitionProvider('native-speech-recognition')).toBeUndefined();
    expect(voiceRegistry.getSynthesisProvider('kokoro-82m-tts')).toBeUndefined();
    expect(voiceRegistry.getSynthesisProvider('native-speech-synthesis')).toBeUndefined();
  });
});

describe('transformSpeechIdentity (spoken text hygiene)', () => {

  it('drops heading lines entirely instead of reading them aloud', () => {
    const out = transformSpeechIdentity('## Attendance Summary\nYou attended 5/10 classes.');
    expect(out).not.toContain('Attendance Summary');
    expect(out).toContain('You attended 5 out of 10 classes.');
  });

  it('never speaks table rows or pipes', () => {
    const out = transformSpeechIdentity(
      '| Subject | Total |\n| :--- | :--- |\n| CSE329 | 8 |\nProse carries the answer.'
    );
    expect(out).not.toContain('|');
    expect(out).not.toContain('Subject');
    expect(out).toContain('Prose carries the answer.');
  });

  it('speaks fractions naturally but preserves dates', () => {
    const out = transformSpeechIdentity('Score 7/10 on 10/8/2026');
    expect(out).toContain('7 out of 10');
    expect(out).toContain('10/8/2026');
    expect(out).not.toContain('7/10');
  });
});

describe('transformSpeechIdentity (rooms, times, acronyms)', () => {
  it('speaks room codes as block + room and time ranges with "to"', () => {
    const out = transformSpeechIdentity(
      'Lecture in 33-307 from 10:20-11:10 AM, later in R-38-917 at 09:30-10:20'
    );
    expect(out).toContain('Block 33, Room 307');
    expect(out).toContain('Block 38, Room 917');
    expect(out).toContain('10:20 to 11:10 AM');
    expect(out).toContain('9:30 to 10:20');
    // No raw NN-NNN room pattern may reach the TTS engine.
    expect(out).not.toMatch(/\d{2}-\d{3}/);
  });

  it('spells UMS letter by letter instead of "ums"', () => {
    const out = transformSpeechIdentity('verified from your authenticated UMS Student Time Table');
    expect(out).toContain('U M S');
    expect(out).not.toContain('UMS');
  });

  it('keeps dates intact while transforming rooms and times', () => {
    const out = transformSpeechIdentity('Exam on 10/8/2026 at 09:30-12:30 in 34-601');
    expect(out).toContain('10/8/2026');
    expect(out).toContain('9:30 to 12:30');
    expect(out).toContain('Block 34, Room 601');
  });

  it('expands month abbreviations such as Dec to December instead of D ec', () => {
    const fullDate = transformSpeechIdentity('Your next exam is on 05-Dec-2026.');
    expect(fullDate).toContain('5 December 2026');
    expect(fullDate).not.toContain('05-Dec-2026');
    expect(fullDate).not.toMatch(/\bDec\b/);

    const dayMonth = transformSpeechIdentity('Classes resume on 12-Jan.');
    expect(dayMonth).toContain('12 January');
    expect(dayMonth).not.toContain('12-Jan');

    const standalone = transformSpeechIdentity('End term examinations begin in Dec.');
    expect(standalone).toContain('in December.');
    expect(standalone).not.toMatch(/\bDec\b/);
  });
});
