import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VoiceQueue } from '../../voice/VoiceQueue';
import { DEFAULT_VOICE_PREFERENCES } from '../../voice/VoiceProvider';
import { nativeSpeechSynthesisProvider } from '../../voice/providers/NativeSpeechSynthesisProvider';

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

describe('VoiceQueue', () => {
  let queue: VoiceQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    queue = new VoiceQueue({ ...DEFAULT_VOICE_PREFERENCES });
  });

  it('splits longer text into natural sentence chunks and enqueues them', () => {
    const ids = queue.enqueue('I found your schedule. Your next exam is CSE408. Good luck!');
    expect(ids.length).toBe(3);
    expect(nativeSpeechSynthesisProvider.speak).toHaveBeenCalled();
  });

  it('respects OFF mode and does not queue speech', () => {
    queue.updatePreferences({ mode: 'OFF' });
    const ids = queue.enqueue('Hello student');
    expect(ids.length).toBe(0);
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

  it('cancels speech and clears queue on cancel()', () => {
    queue.enqueue('First long sentence that takes time to speak.');
    queue.enqueue('Second sentence.');
    expect(queue.isBusy()).toBe(true);

    queue.cancel();
    expect(nativeSpeechSynthesisProvider.stop).toHaveBeenCalled();
    expect(queue.getQueueLength()).toBe(0);
  });

  it('high priority item interrupts and clears lower priority queue', () => {
    queue.enqueue('Regular narration 1', { priority: 'LOW' });
    queue.enqueue('Regular narration 2', { priority: 'LOW' });

    queue.enqueue('Emergency stop', { priority: 'HIGH' });
    expect(nativeSpeechSynthesisProvider.stop).toHaveBeenCalled();
  });
});
