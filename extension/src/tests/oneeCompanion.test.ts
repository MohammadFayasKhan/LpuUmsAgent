/*
 * Companion Mascot Event Bridge Test Suite.
 *
 * Validates event-driven visual state transitions:
 * - Subscribing to agent lifecycle events (observing, thinking, moving, success, error).
 * - Correct mapping to avatar expression keys and caption messages.
 * - Cleanup on unsubscription without memory leaks.
 */

import { describe, it, expect } from 'vitest';
import { oneeBridge, OneeReaction } from '../lib/oneeEvents';

describe('oneeEvents and Companion Bridge', () => {
  it('emits and receives agent lifecycle events correctly', () => {
    const received: OneeReaction[] = [];
    const unsubscribe = oneeBridge.subscribe((reaction) => {
      received.push(reaction);
    });

    oneeBridge.emit('agent_observing');
    oneeBridge.emit('agent_thinking');
    oneeBridge.emit('agent_moving');
    oneeBridge.emit('agent_success');
    oneeBridge.emit('agent_error');

    expect(received.length).toBe(5);
    expect(received[0].animation).toBe('searching');
    expect(received[1].animation).toBe('thinking');
    expect(received[2].animation).toBe('working');
    expect(received[3].animation).toBe('celebrate');
    expect(received[4].animation).toBe('confused');

    unsubscribe();
  });

  it('unsubscribes listeners cleanly', () => {
    let callCount = 0;
    const unsubscribe = oneeBridge.subscribe(() => {
      callCount++;
    });

    oneeBridge.emit('agent_idle');
    expect(callCount).toBe(1);

    unsubscribe();
    oneeBridge.emit('agent_idle');
    expect(callCount).toBe(1);
  });
});
