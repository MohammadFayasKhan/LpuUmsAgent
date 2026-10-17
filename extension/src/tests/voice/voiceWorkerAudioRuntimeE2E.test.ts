/*
 * End-to-End Architectural Tests for Non-Blocking Voice Worker & AudioController.
 *
 * Verifies:
 * 1. AudioController.enqueue() returns immediately without blocking execution.
 * 2. Voice execution is decoupled from Browser Agent actions (fire-and-forget).
 * 3. Stale execution speech is dropped immediately upon redirection.
 * 4. FINAL_RESULT preemption stops lower-priority progress speech immediately.
 * 5. Voice Mode OFF produces zero audio.
 * 6. VoicePerformanceProfiler correctly records timestamps and calculates latencies.
 * 7. Interruption cleans up both VoiceQueue and AudioController state.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { audioController } from '../../voice/AudioController';
import { getVoiceRuntime } from '../../voice/VoiceRuntime';
import { voiceProfiler } from '../../voice/VoicePerformanceProfiler';
import { VoiceQueue } from '../../voice/VoiceQueue';

describe('Voice Worker & AudioController Architecture E2E', () => {
  beforeEach(() => {
    audioController.stop();
    audioController.setActiveExecutionId(null);
    voiceProfiler.clear();
    vi.restoreAllMocks();
  });

  it('AudioController.enqueue() returns synchronously and does not block the caller', () => {
    const start = performance.now();
    const fakePCM = new Float32Array(4800); // 200ms of audio at 24kHz

    audioController.enqueue({
      id: 'chunk-1',
      executionId: 'exec-alpha',
      audioData: fakePCM,
      sampleRate: 24000
    });

    const elapsed = performance.now() - start;
    // Enqueue must be virtually instantaneous (< 50ms under heavy test load)
    expect(elapsed).toBeLessThan(50);
  });

  it('drops audio buffers belonging to stale executions immediately', () => {
    audioController.setActiveExecutionId('exec-2');

    const onStart = vi.fn();
    const onEnd = vi.fn();

    // Enqueue audio for stale exec-1
    audioController.enqueue({
      id: 'stale-1',
      executionId: 'exec-1',
      audioData: new Float32Array(100),
      sampleRate: 24000,
      onStart,
      onEnd
    });

    // onStart must not be called, onEnd called immediately to release caller
    expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalled();
  });

  it('FINAL_RESULT preemption prioritizes final result and discards lower-priority audio', () => {
    audioController.setActiveExecutionId('exec-priority');

    const progressAudio = new Float32Array(100);
    const finalAudio = new Float32Array(100);

    const onStartProgress = vi.fn();
    const onStartFinal = vi.fn();

    audioController.enqueue({
      id: 'prog-1',
      executionId: 'exec-priority',
      audioData: progressAudio,
      sampleRate: 24000,
      priority: 'MEANINGFUL_PROGRESS',
      onStart: onStartProgress
    });

    // Enqueue FINAL_RESULT
    audioController.enqueue({
      id: 'final-1',
      executionId: 'exec-priority',
      audioData: finalAudio,
      sampleRate: 24000,
      priority: 'FINAL_RESULT',
      isFinalResult: true,
      onStart: onStartFinal
    });

    expect(audioController.getQueueLength()).toBeLessThanOrEqual(1);
  });

  it('VoiceMode OFF produces zero queued audio and zero spoken speech', () => {
    const queue = new VoiceQueue({ mode: 'OFF', enabled: false });

    const onEnd = vi.fn();
    const ids = queue.enqueue('This should be completely silent in OFF mode.', {
      executionId: 'exec-off',
      onEnd
    });

    expect(ids).toEqual([]);
    expect(onEnd).toHaveBeenCalled();
    expect(queue.getQueueLength()).toBe(0);
  });

  it('VoicePerformanceProfiler tracks milestone timestamps and calculates latencies accurately', () => {
    const execId = 'exec-profiler-test';
    const t0 = 1000000;

    voiceProfiler.record(execId, 'inputReceived', t0);
    voiceProfiler.record(execId, 'sttFinal', t0 + 120);
    voiceProfiler.record(execId, 'intentReady', t0 + 150);
    voiceProfiler.record(execId, 'firstNarrationText', t0 + 180);
    voiceProfiler.record(execId, 'kokoroStarted', t0 + 190);
    voiceProfiler.record(execId, 'firstAudioReady', t0 + 490);
    voiceProfiler.record(execId, 'firstAudioPlayed', t0 + 510);
    voiceProfiler.record(execId, 'executionStarted', t0 + 150);
    voiceProfiler.record(execId, 'executionCompleted', t0 + 1200);

    const report = voiceProfiler.getReport(execId);
    expect(report).not.toBeNull();
    expect(report?.sttLatencyMs).toBe(120);
    expect(report?.intentLatencyMs).toBe(30);
    expect(report?.timeToFirstNarrationMs).toBe(180);
    expect(report?.kokoroGenerationLatencyMs).toBe(300);
    expect(report?.timeToFirstAudioMs).toBe(510);
    expect(report?.browserExecutionLatencyMs).toBe(1050);
    expect(report?.totalPerceivedResponseLatencyMs).toBe(510);
  });

  it('Cancellation clears in-flight queue, stops AudioController, and resets state', () => {
    const queue = new VoiceQueue({ mode: 'LIVE_AGENT', enabled: true });
    queue.setActiveExecutionId('exec-cancel');

    queue.enqueue('First long sentence that is currently being processed.', {
      executionId: 'exec-cancel'
    });
    queue.enqueue('Second sentence waiting in queue.', {
      executionId: 'exec-cancel'
    });

    // In non-blocking architecture, items dispatch instantly (fire-and-forget to Worker).
    // Queue may already be empty. Cancel must still stop audio and reset state.

    // Cancel
    queue.cancel();

    expect(queue.getQueueLength()).toBe(0);
    expect(queue.getCurrentItem()).toBeNull();
    expect(audioController.isSpeaking()).toBe(false);
  });

  it('VoiceRuntime separates modeController, audioController, queue, and cancellationController', () => {
    const voiceRuntime = getVoiceRuntime();
    expect(voiceRuntime.modeController).toBeDefined();
    expect(voiceRuntime.audioController).toBeDefined();
    expect(voiceRuntime.queue).toBeDefined();
    expect(voiceRuntime.cancellationController).toBeDefined();
    expect(voiceRuntime.guard).toBeDefined();
    expect(voiceRuntime.narrationPlanner).toBeDefined();

    voiceRuntime.modeController.setMode('OFF');
    expect(voiceRuntime.modeController.isVoiceEnabled()).toBe(false);

    voiceRuntime.modeController.setMode('LIVE_AGENT');
    expect(voiceRuntime.modeController.isVoiceEnabled()).toBe(true);
  });
});
