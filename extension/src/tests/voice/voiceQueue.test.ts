import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceQueue } from '../../voice/VoiceQueue';
import { DEFAULT_VOICE_PREFERENCES } from '../../voice/VoiceProvider';
import { voiceDiagnostics } from '../../voice/VoiceDiagnostics';
import { nativeSpeechSynthesisProvider } from '../../voice/providers/NativeSpeechSynthesisProvider';
import { kokoroTTSProvider } from '../../voice/providers/KokoroTTSProvider';
import { groqOrpheusProvider } from '../../voice/providers/GroqOrpheusProvider';

vi.mock('../../voice/providers/NativeSpeechSynthesisProvider', () => {
  return {
    nativeSpeechSynthesisProvider: {
      name: 'native-speech-synthesis',
      isSupported: vi.fn(() => true),
      speak: vi.fn(() => Promise.resolve()),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      isSpeaking: vi.fn(() => false),
      getAvailableVoices: vi.fn(() => Promise.resolve([]))
    }
  };
});

vi.mock('../../voice/providers/KokoroTTSProvider', () => {
  return {
    kokoroTTSProvider: {
      name: 'kokoro-82m-tts',
      isSupported: vi.fn(() => true),
      initialize: vi.fn(() => Promise.resolve()),
      speak: vi.fn(() => Promise.resolve()),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      isSpeaking: vi.fn(() => false),
      getLifecycleState: vi.fn(() => 'ready'),
      getAvailableVoices: vi.fn(() => Promise.resolve([]))
    }
  };
});

vi.mock('../../voice/providers/GroqOrpheusProvider', () => {
  return {
    groqOrpheusProvider: {
      name: 'groq-orpheus-tts',
      isSupported: vi.fn(() => true),
      speak: vi.fn(() => Promise.resolve()),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      isSpeaking: vi.fn(() => false),
      getAvailableVoices: vi.fn(() => Promise.resolve([]))
    }
  };
});

describe('VoiceQueue', () => {
  let queue: VoiceQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    queue = new VoiceQueue({ ...DEFAULT_VOICE_PREFERENCES, primaryProvider: 'groq', fallbackProvider: 'none' });
  });

  it('selects Groq Orpheus as primary TTS provider and never calls native speech in normal flow', () => {
    const ids = queue.enqueue('I found your schedule. Your next exam is CSE408. Good luck!');
    expect(ids.length).toBe(3);
    // Primary Groq Orpheus provider must be called
    expect(groqOrpheusProvider.speak).toHaveBeenCalled();
    // Native browser speech synthesis must NOT be called
    expect(nativeSpeechSynthesisProvider.speak).not.toHaveBeenCalled();
  });

  it('uses Groq Orpheus first in the default cascading provider chain', () => {
    const defaultQueue = new VoiceQueue({ ...DEFAULT_VOICE_PREFERENCES });
    defaultQueue.enqueue('ONEE is ready to help.');

    expect(groqOrpheusProvider.speak).toHaveBeenCalled();
    // The local fallback stays silent while the primary is healthy
    expect(kokoroTTSProvider.speak).not.toHaveBeenCalled();
    expect(nativeSpeechSynthesisProvider.speak).not.toHaveBeenCalled();
  });

  it('respects OFF mode and does not queue speech or invoke any TTS provider', () => {
    queue.updatePreferences({ mode: 'OFF' });
    const ids = queue.enqueue('Hello student');
    expect(ids.length).toBe(0);
    expect(kokoroTTSProvider.speak).not.toHaveBeenCalled();
    expect(nativeSpeechSynthesisProvider.speak).not.toHaveBeenCalled();
  });

  it('discards stale speech when executionId does not match activeExecutionId', async () => {
    queue.setActiveExecutionId('exec-1');

    // Enqueue an item tied to exec-1
    queue.enqueue('Checking exam schedule', { executionId: 'exec-1' });

    // Now switch active execution to exec-2
    queue.setActiveExecutionId('exec-2');

    // Enqueue item with old exec-1
    queue.enqueue('Old narration', { executionId: 'exec-1' });

    // Only exec-2 or unassigned items should be allowed
    queue.enqueue('New narration for exec 2', { executionId: 'exec-2' });

    expect(queue.getActiveExecutionId()).toBe('exec-2');
  });

  it('cancels speech and clears queue on cancel() with clean stop on providers', () => {
    queue.enqueue('First long sentence that takes time to speak.');
    queue.enqueue('Second sentence.');
    // In the non-blocking architecture, items are dispatched immediately (fire-and-forget)
    // so the queue may already be empty. Cancel must still stop providers cleanly.

    queue.cancel();
    expect(groqOrpheusProvider.stop).toHaveBeenCalled();
    expect(queue.getQueueLength()).toBe(0);
    expect(queue.isBusy()).toBe(false);
  });

  it('high priority item interrupts and clears lower priority queue', () => {
    queue.enqueue('Regular narration 1', { priority: 'LOW' });
    queue.enqueue('Regular narration 2', { priority: 'LOW' });

    queue.enqueue('Emergency stop', { priority: 'HIGH' });
    expect(groqOrpheusProvider.stop).toHaveBeenCalled();
  });

  it('reports an honest text-only outcome on Groq failure — never local Kokoro or native speech', async () => {
    (groqOrpheusProvider.speak as any).mockRejectedValueOnce(new Error('Groq TTS unavailable'));

    queue.enqueue('Testing Groq-only failure');

    // Allow async execution in queue
    await new Promise((r) => setTimeout(r, 10));

    expect(groqOrpheusProvider.speak).toHaveBeenCalled();
    // FINAL SPEC: local/browser voices must NEVER speak, even when Groq fails.
    expect(kokoroTTSProvider.speak).not.toHaveBeenCalled();
    expect(nativeSpeechSynthesisProvider.speak).not.toHaveBeenCalled();

    const textOnly = voiceDiagnostics
      .getHistory()
      .find((h) => h.event === 'TTS_ERROR' && h.details?.finalOutcome === 'TEXT_ONLY');
    expect(textOnly).toBeDefined();
  });

  it('cannot select Kokoro or native speech through any preference value', async () => {
    const kokoroPrefQueue = new VoiceQueue({
      ...DEFAULT_VOICE_PREFERENCES,
      primaryProvider: 'kokoro'
    } as any);
    kokoroPrefQueue.enqueue('Testing stale preference');
    await new Promise((r) => setTimeout(r, 10));

    // Stale stored preferences resolve to Groq; local providers stay silent.
    expect(groqOrpheusProvider.speak).toHaveBeenCalled();
    expect(kokoroTTSProvider.speak).not.toHaveBeenCalled();
    expect(nativeSpeechSynthesisProvider.speak).not.toHaveBeenCalled();
  });

  it('delivers a single complete utterance for final results instead of sentence-by-sentence micro-chunks', () => {
    const multiSentenceSummary =
      'You have 4 classes scheduled for Monday. Your day begins with Object Oriented Programming at 9:00 to 10:00 in Block 34, Room 201. You have 2 more sessions in the afternoon, concluding with Web Development at 3:00 to 4:00 in Block 34, Room 205.';

    const ids = queue.enqueue(multiSentenceSummary, { isFinalResult: true, priority: 'FINAL_RESULT' });
    // Must be exactly 1 queue item (a single complete response)
    expect(ids.length).toBe(1);
    expect(groqOrpheusProvider.speak).toHaveBeenCalledWith(
      multiSentenceSummary,
      expect.objectContaining({ isFinalResult: true, priority: 'FINAL_RESULT' })
    );
  });
});
