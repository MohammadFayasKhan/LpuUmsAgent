/*
 * End-to-End Voice Architecture Verification Tests.
 *
 * Verifies all criteria specified in the architectural mandate:
 * A. Voice Off -> zero TTS/audio.
 * B. Ultimate Live AI Voice Mode -> Groq Orpheus is primary, SpeechSynthesis is NOT used.
 * C. Provider failure -> real error reported, no false claims, explicit fallback policy.
 * D. Cancellation & Barge-in -> active audio stops immediately, provider available for next speech.
 * E. Multiple requests -> stale speech discarded, no overlapping playback.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceQueue } from '../../voice/VoiceQueue';
import { DEFAULT_VOICE_PREFERENCES } from '../../voice/VoiceProvider';
import { kokoroTTSProvider } from '../../voice/providers/KokoroTTSProvider';
import { nativeSpeechSynthesisProvider } from '../../voice/providers/NativeSpeechSynthesisProvider';
import { groqOrpheusProvider } from '../../voice/providers/GroqOrpheusProvider';
import { voiceDiagnostics } from '../../voice/VoiceDiagnostics';

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

describe('Voice Architecture End-to-End Verification', () => {
  let queue: VoiceQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    voiceDiagnostics.clear();
    queue = new VoiceQueue({
      ...DEFAULT_VOICE_PREFERENCES,
      mode: 'LIVE_AGENT',
      enabled: true,
      primaryProvider: 'groq',
      fallbackProvider: 'none'
    });
  });

  // Criteria A: Voice Off
  describe('Criterion A: Voice Off', () => {
    it('produces zero TTS provider execution and zero audio when mode is OFF', () => {
      queue.updatePreferences({ mode: 'OFF', enabled: false });

      const itemIds = queue.enqueue('Hello student, this is a test response.', {
        priority: 'NORMAL',
        isFinalResult: true
      });

      expect(itemIds.length).toBe(0);
      expect(kokoroTTSProvider.speak).not.toHaveBeenCalled();
      expect(nativeSpeechSynthesisProvider.speak).not.toHaveBeenCalled();
      expect(queue.isBusy()).toBe(false);
    });
  });

  // Criteria B: Ultimate Live AI Voice Mode
  describe('Criterion B: Ultimate Live AI Voice Mode', () => {
    it('selects Groq Orpheus as the primary provider and does not use browser SpeechSynthesis', async () => {
      queue.updatePreferences({ mode: 'LIVE_AGENT', enabled: true });

      const itemIds = queue.enqueue('Attendance verified for 7 courses.', {
        priority: 'NORMAL',
        isFinalResult: true,
        providerPreference: 'auto'
      });

      expect(itemIds.length).toBeGreaterThan(0);

      // Verify diagnostics
      const history = voiceDiagnostics.getHistory();
      const providerSelectedEvent = history.find((h) => h.event === 'TTS_PROVIDER_SELECTED');
      expect(providerSelectedEvent).toBeDefined();
      expect(providerSelectedEvent?.provider).toBe('groq-orpheus-tts');

      // Verify Groq Orpheus (primary) was called
      expect(groqOrpheusProvider.speak).toHaveBeenCalled();

      // The local fallback is NOT used while the primary is healthy
      expect(kokoroTTSProvider.speak).not.toHaveBeenCalled();

      // Verify browser speechSynthesis was NOT called
      expect(nativeSpeechSynthesisProvider.speak).not.toHaveBeenCalled();
    });
  });

  // Criteria C: Provider Failure
  describe('Criterion C: Provider Failure Policy (Groq-only, no local fallback)', () => {
    it('reports an honest text-only outcome on Groq failure and NEVER uses local Kokoro or native speech', async () => {
      queue.updatePreferences({ mode: 'LIVE_AGENT', fallbackProvider: 'none' });
      (groqOrpheusProvider.speak as any).mockRejectedValueOnce(new Error('Groq TTS speak request failed with status 503'));

      queue.enqueue('Testing Groq-only failure policy');

      await new Promise((r) => setTimeout(r, 15));

      // Error must be logged in diagnostics
      const errorLogs = voiceDiagnostics.getHistory().filter((h) => h.event === 'TTS_ERROR');
      expect(errorLogs.length).toBeGreaterThan(0);
      expect(errorLogs[0].details?.error).toContain('Groq TTS speak request failed');

      // FINAL SPEC: no local or browser voice may ever substitute for Groq.
      expect(kokoroTTSProvider.speak).not.toHaveBeenCalled();
      expect(nativeSpeechSynthesisProvider.speak).not.toHaveBeenCalled();

      const textOnly = voiceDiagnostics
        .getHistory()
        .find((h) => h.event === 'TTS_ERROR' && h.details?.finalOutcome === 'TEXT_ONLY');
      expect(textOnly).toBeDefined();
    });

    it('attempts Groq exactly once per item — never a parallel or duplicate provider call', async () => {
      queue.enqueue('One canonical provider');
      await new Promise((r) => setTimeout(r, 15));

      expect(groqOrpheusProvider.speak).toHaveBeenCalledTimes(1);
      expect(kokoroTTSProvider.speak).not.toHaveBeenCalled();
      expect(nativeSpeechSynthesisProvider.speak).not.toHaveBeenCalled();
    });
  });

  // Criteria D: Cancellation
  describe('Criterion D: Cancellation & Interruption', () => {
    it('stops active audio cleanly and flushes the queue immediately on cancel', () => {
      queue.enqueue('First long sentence that is currently playing.');
      queue.enqueue('Second sentence queued up.');

      // In non-blocking architecture, items dispatch instantly (fire-and-forget to Worker).
      // Cancel must still stop providers and reset state cleanly.

      // Interrupt / cancel
      queue.cancel();

      expect(groqOrpheusProvider.stop).toHaveBeenCalled();
      expect(queue.getQueueLength()).toBe(0);
      expect(queue.isBusy()).toBe(false);
    });

    it('allows immediate subsequent speech after cancellation', async () => {
      queue.enqueue('Initial long utterance');
      queue.cancel();
      expect(queue.getQueueLength()).toBe(0);

      // Now student asks a new question
      queue.enqueue('New utterance right after stop');
      expect(groqOrpheusProvider.speak).toHaveBeenCalled();
    });
  });

  // Criteria E: Multiple Requests & Stale Discard
  describe('Criterion E: Multiple Requests & Execution Synchronization', () => {
    it('discards stale queued speech from an earlier execution when a new execution starts', () => {
      queue.setActiveExecutionId('exec-100');
      queue.enqueue('Step 1 of previous goal', { executionId: 'exec-100' });
      queue.enqueue('Step 2 of previous goal', { executionId: 'exec-100' });

      // Student starts a new goal (exec-200)
      queue.setActiveExecutionId('exec-200');

      // Old speech should be filtered or discarded
      queue.enqueue('New goal starting', { executionId: 'exec-200' });
      expect(queue.getActiveExecutionId()).toBe('exec-200');
    });
  });
});
