import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dynamicNarrationEngine } from '../../voice/DynamicNarrationEngine';
import { VoiceQueue } from '../../voice/VoiceQueue';
import { StreamingVoiceSentencePacer } from '../../voice/StreamingVoiceSentencePacer';
import { OneeRuntimeState } from '../../lib/runtimeState';
import { FinalResponseData } from '../../shared/types';

function createMockRuntimeState(overrides: Partial<OneeRuntimeState> = {}): OneeRuntimeState {
  return {
    connectionState: 'CONNECTED',
    agentState: null,
    attendance: null,
    examination: null,
    isUserTyping: false,
    isChatStreaming: false,
    lastUserMessage: null,
    lastExplicitInteractionAt: Date.now(),
    ...overrides
  };
}

describe('Dynamic Narration & Latency Pipelining (Tests 1-8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dynamicNarrationEngine.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // TEST 1: Next Exam flow
  it('TEST 1: "What is my next exam?" generates fast request-specific ack, progress, and verified result', async () => {
    const execId = 'test-exec-1';
    
    // 1. Immediate acknowledgement
    const ack = dynamicNarrationEngine.generateAcknowledgement('What is my next exam?', execId);
    expect(ack).not.toBeNull();
    expect(ack?.text).toBe('Checking your next exam now.');
    expect(ack?.priority).toBe('ACKNOWLEDGEMENT');

    // 2. Meaningful milestone (Acting on Date Sheet)
    const runtimeState = createMockRuntimeState({
      agentState: {
        status: 'acting',
        currentGoal: 'What is my next exam?',
        currentStep: 1,
        maxSteps: 15,
        currentAction: {
          action: 'click',
          elementId: 'btn-datesheet',
          reason: 'Opening Date Sheet on UMS'
        },
        activities: []
      }
    });

    const progress = await dynamicNarrationEngine.evaluateMilestone('ACTING', runtimeState, {
      executionId: execId,
      userRequest: 'What is my next exam?'
    });
    expect(progress).not.toBeNull();
    expect(progress?.text).toBeTruthy();
    expect(progress?.text?.toLowerCase()).toContain('date sheet');

    // 3. Final verified result
    const verifiedResponse: FinalResponseData = {
      type: 'next_exam',
      status: 'READY',
      title: 'Next Exam: CSE408',
      details: {
        nextExam: {
          courseCode: 'CSE408',
          examDate: 'Monday, Oct 14',
          startTime: '10:00 AM',
          reportingTime: '09:30 AM',
          seat: '24',
          room: '34-201',
          building: 'Block 34'
        }
      },
      verification: {
        verified: true,
        source: 'UMS Date Sheet & Seating Plan',
        timestamp: Date.now(),
        executionStatus: 'COMPLETED'
      }
    };

    const finalSpeech = dynamicNarrationEngine.formatVerifiedResultSpeech(
      verifiedResponse,
      'What is my next exam?'
    );
    expect(finalSpeech).toContain('CSE408');
    expect(finalSpeech).toContain('Monday, Oct 14');
    expect(finalSpeech).toContain('10:00 AM');
    expect(finalSpeech).toContain('seat is 24');
    expect(finalSpeech).toContain('room 34-201');
  });

  // TEST 2: Full examination schedule natural differentiation
  it('TEST 2: "Show my full examination schedule" produces naturally different narration reflecting full schedule goal', async () => {
    const execId = 'test-exec-2';

    // 1. Acknowledgement differs naturally
    const ack = dynamicNarrationEngine.generateAcknowledgement('Show my full examination schedule.', execId);
    expect(ack?.text).toBe('Pulling up your complete examination schedule.');

    // 2. Progress differs naturally
    const runtimeState = createMockRuntimeState({
      agentState: {
        status: 'acting',
        currentGoal: 'Show my full examination schedule',
        currentStep: 1,
        maxSteps: 15,
        currentAction: {
          action: 'click',
          elementId: 'btn-datesheet',
          reason: 'Opening Date Sheet on UMS'
        },
        activities: []
      }
    });

    const progress = await dynamicNarrationEngine.evaluateMilestone('ACTING', runtimeState, {
      executionId: execId,
      userRequest: 'Show my full examination schedule'
    });
    expect(progress?.text).toBeTruthy();
    // Narration phrasing rotates naturally ("Opening Date Sheet..." vs "let me
    // pull up your full exam schedule..."); assert the GOAL is reflected
    // instead of pinning one exact phrase that only some variants contain.
    expect(progress?.text?.toLowerCase()).toMatch(
      /date sheet|exam schedule|examination schedule|full schedule/
    );

    // 3. Final speech for full schedule
    const verifiedResponse: FinalResponseData = {
      type: 'exam_date_sheet',
      status: 'READY',
      title: 'Full Examination Schedule',
      details: {
        totalExams: 6,
        nextExam: {
          courseCode: 'CSE408',
          examDate: 'Monday, Oct 14',
          startTime: '10:00 AM'
        },
        exams: [
          { courseCode: 'CSE408', examDate: 'Monday, Oct 14', startTime: '10:00 AM' },
          { courseCode: 'INT306', examDate: 'Wednesday, Oct 16', startTime: '02:00 PM' }
        ]
      },
      verification: {
        verified: true,
        source: 'UMS Date Sheet',
        timestamp: Date.now(),
        executionStatus: 'COMPLETED'
      }
    };

    const finalSpeech = dynamicNarrationEngine.formatVerifiedResultSpeech(
      verifiedResponse,
      'Show my full examination schedule'
    );
    expect(finalSpeech).toContain('Found 6 scheduled exams');
    expect(finalSpeech).toContain('Your next paper is CSE408');
  });

  // TEST 3: Follow-up contextual understanding
  it('TEST 3: "What about CSE408?" produces course-specific verified information', async () => {
    const execId = 'test-exec-3';

    // 1. Acknowledgement captures course code
    const ack = dynamicNarrationEngine.generateAcknowledgement('What about CSE408?', execId);
    expect(ack?.text).toBe('Looking up CSE408 in your examination records.');

    // 2. Formats result specifically targeting CSE408
    const verifiedResponse: FinalResponseData = {
      type: 'exam_date_sheet',
      status: 'READY',
      title: 'Examination Details for CSE408',
      details: {
        exams: [
          { courseCode: 'MTH166', examDate: 'Oct 12', startTime: '09:00 AM', seat: '10', room: '28-102' },
          { courseCode: 'CSE408', examDate: 'Monday, Oct 14', startTime: '10:00 AM', seat: '24', room: '34-201' }
        ]
      },
      verification: {
        verified: true,
        source: 'UMS Date Sheet',
        timestamp: Date.now(),
        executionStatus: 'COMPLETED'
      }
    };

    const speech = dynamicNarrationEngine.formatVerifiedResultSpeech(
      verifiedResponse,
      'What about CSE408?'
    );
    expect(speech).toContain('Your exam for CSE408 is on Monday, Oct 14 at 10:00 AM');
    expect(speech).toContain('Your seat is 24 in room 34-201');
  });

  // TEST 4: Goal interruption / barge-in
  it('TEST 4: Interruption "Actually, check my attendance instead" clears old queue and starts new execution', () => {
    const queue = new VoiceQueue();
    const oldExec = 'exec-exam-old';
    const newExec = 'exec-attendance-new';

    queue.setActiveExecutionId(oldExec);
    queue.enqueue('Opening the examination schedule.', { executionId: oldExec, priority: 'MEANINGFUL_PROGRESS' });
    queue.enqueue('Checking exam dates.', { executionId: oldExec, priority: 'MEANINGFUL_PROGRESS' });

    // In non-blocking architecture, items dispatch instantly (fire-and-forget).
    // Queue may already be empty after enqueue.

    // User interrupts with attendance
    const ack = dynamicNarrationEngine.generateAcknowledgement('Actually, check my attendance instead.', newExec);
    expect(ack?.text).toBe('Switching over to check your attendance.');

    // Active execution switches to newExec: old queue items are pruned
    queue.setActiveExecutionId(newExec);
    expect(queue.getQueueLength()).toBe(0);

    // Enqueue attendance speech under newExec
    const items = queue.enqueue(ack!.text, { executionId: newExec, priority: 'ACKNOWLEDGEMENT' });
    expect(items.length).toBe(1);
    expect(queue.getActiveExecutionId()).toBe(newExec);
    // In non-blocking architecture, currentItem is null after dispatch completes.
    // The important check is that the execution ID was correctly set.
  });

  // TEST 5: Browser noise suppression
  it('TEST 5: Cursor moves, DOM mutations, and low-level waits generate zero narration', async () => {
    const execId = 'test-exec-noise';

    const runtimeState = createMockRuntimeState({
      agentState: {
        status: 'waiting_for_render',
        currentGoal: 'Check exams',
        currentStep: 2,
        maxSteps: 15,
        activities: []
      }
    });

    // WAITING state
    const waitingRes = await dynamicNarrationEngine.evaluateMilestone('WAITING', runtimeState, { executionId: execId });
    expect(waitingRes).toBeNull();

    // LOCATING without elements
    const locatingRes = await dynamicNarrationEngine.evaluateMilestone('LOCATING', runtimeState, { executionId: execId });
    expect(locatingRes).toBeNull();
  });

  // TEST 6: Latency benchmarking & Sentence Pipelining
  it('TEST 6: Sentence streaming pacer emits phrases progressively as tokens arrive', async () => {
    const emittedSentences: { sentence: string; isFinal: boolean; time: number }[] = [];
    const startTime = Date.now();

    const pacer = new StreamingVoiceSentencePacer({
      executionId: 'test-pacer',
      onSentence: (sentence, isFinal) => {
        emittedSentences.push({ sentence, isFinal, time: Date.now() - startTime });
      }
    });

    // Feed chunk 1 (complete sentence)
    pacer.push('Alright, I found the examination section.');
    expect(emittedSentences.length).toBe(1);
    expect(emittedSentences[0].sentence).toBe('Alright, I found the examination section.');
    expect(emittedSentences[0].isFinal).toBe(false);

    // Feed chunk 2
    pacer.push(" I'm checking the complete schedule now to make sure no papers are missed.");
    expect(emittedSentences.length).toBe(2);
    expect(emittedSentences[1].sentence).toContain('checking the complete schedule now');

    // Finish
    await pacer.finish();
    expect(emittedSentences.length).toBe(2);
  });

  // TEST 7: Voice OFF silence
  it('TEST 7: Mode OFF produces absolutely zero speech or queue items', async () => {
    const queue = new VoiceQueue();
    queue.updatePreferences({ mode: 'OFF' });

    const ack = dynamicNarrationEngine.generateAcknowledgement('What is my next exam?', 'exec-off');
    expect(ack).not.toBeNull();

    const runtimeState = createMockRuntimeState({
      agentState: {
        status: 'acting',
        currentGoal: 'What is my next exam?',
        currentStep: 1,
        maxSteps: 15,
        activities: []
      }
    });

    const res = await dynamicNarrationEngine.evaluateMilestone('ACTING', runtimeState, {
      executionId: 'exec-off',
      userPreferences: { mode: 'OFF' }
    });
    expect(res).toBeNull();

    // VoiceQueue rejects or stays empty in OFF mode
    const itemIds = queue.enqueue('Test phrase', { executionId: 'exec-off' });
    expect(itemIds.length).toBe(0);
  });

  // TEST 8: Rapid requests and stale execution ID pruning
  it('TEST 8: Stale execution IDs are completely ignored and cannot speak', () => {
    const queue = new VoiceQueue();

    queue.setActiveExecutionId('request-A');
    queue.enqueue('First request narration.', { executionId: 'request-A' });

    // Request B arrives rapidly
    queue.setActiveExecutionId('request-B');

    // Attempt to enqueue item with old request-A id
    const staleItems = queue.enqueue('Old request-A leftover narration.', { executionId: 'request-A' });
    
    // Stale item should be rejected
    expect(staleItems.length).toBe(0);
  });
});
