import { describe, it, expect, vi } from 'vitest';
import {
  generateVerifiedResponse,
  resolveSemanticIntent,
  ConversationState
} from '../services/semanticRouter';
import { NarrationManager } from '../voice/NarrationManager';
import { VoiceQueue } from '../voice/VoiceQueue';
import { DEFAULT_VOICE_PREFERENCES } from '../voice/VoiceProvider';

vi.setConfig({ testTimeout: 15000 });

describe('Unified Interaction Pipeline & Canonical Response', () => {
  describe('SemanticRouter.resolveSemanticIntent with ConversationState', () => {
    it('resolves elliptical follow-up "What about Tuesday?" within timetable context', async () => {
      const convState: ConversationState = {
        currentIntent: 'timetable_query',
        currentCapability: 'timetable',
        activeTask: 'query_classes',
        activeEntity: { day: 'Monday' }
      };

      const result = await resolveSemanticIntent({
        query: 'What about Tuesday?',
        executionId: 'test-exec-tuesday',
        conversationState: convState
      });

      expect(result.capability).toBe('timetable');
      expect(result.intent).toBe('timetable_query');
      expect(result.entities?.day).toBe('Tuesday');
      expect(result.requiresBrowserAction).toBe(true);
    });

    it('resolves attendance follow-up e.g. "What about 5?" within attendance context', async () => {
      const convState: ConversationState = {
        currentIntent: 'attendance_query',
        currentCapability: 'attendance',
        activeTask: 'calculate_bunks',
        activeEntity: { courseCode: 'CSE329' }
      };

      const result = await resolveSemanticIntent({
        query: 'What about 5?',
        executionId: 'test-exec-attendance-followup',
        conversationState: convState
      });

      expect(result.capability).toBe('attendance');
      expect(result.intent).toBe('attendance_query');
      expect(result.entities?.targetBunks).toBe(5);
    });

    it('strictly isolates identity query with zero browser action', async () => {
      const result = await resolveSemanticIntent({
        query: 'who are you',
        executionId: 'test-exec-identity'
      });

      expect(result.capability).toBe('onee_identity');
      expect(result.requiresBrowserAction).toBe(false);
      expect(result.action).toBe('respond');
    });
  });

  describe('SemanticRouter.generateVerifiedResponse (One Canonical Response)', () => {
    it('produces canonical reply and clean <=195 char ttsChunks with zero capability bleed', async () => {
      const result = await generateVerifiedResponse({
        executionId: 'test-exec-canonical',
        query: 'which classes do I have on Monday?',
        intent: 'timetable_query',
        capability: 'timetable',
        verifiedResult: {
          day: 'Monday',
          classes: [
            { courseCode: 'CSE329', time: '9:30 AM - 10:20 AM', room: 'R-38-917' },
            { courseCode: 'CSE472', time: '10:20 AM - 11:10 AM', room: 'R-33-301' },
            { courseCode: 'CSE472', time: '11:10 AM - 12:00 PM', room: 'R-33-502' },
            { courseCode: 'CSE330', time: '1:40 PM - 2:30 PM', room: 'R-37-911' }
          ]
        },
        taskOutcome: 'success'
      });

      expect(result.cardType).toBe('TIMETABLE_RESULT');
      expect(result.reply.toLowerCase()).not.toContain('attendance');
      expect(result.spokenSummary.toLowerCase()).not.toContain('attendance');
      expect(result.ttsChunks.length).toBeGreaterThan(0);

      // Verify strict <=195 character constraint on every chunk for Groq Orpheus limit
      for (const chunk of result.ttsChunks) {
        expect(chunk.length).toBeLessThanOrEqual(195);
        expect(chunk).not.toContain('[');
        expect(chunk).not.toContain('*');
      }
    });

    it('handles data_unavailable outcome truthfully without hallucinating or mentioning attendance', async () => {
      const result = await generateVerifiedResponse({
        executionId: 'test-exec-unavailable',
        query: 'download the CSE408 sample paper',
        intent: 'sample_paper_query',
        capability: 'sample_papers',
        verifiedResult: {},
        taskOutcome: 'data_unavailable'
      });

      expect(result.reply.toLowerCase()).not.toContain('attendance');
      expect(result.reply.toLowerCase()).toContain('sample');
      for (const chunk of result.ttsChunks) {
        expect(chunk.length).toBeLessThanOrEqual(195);
      }
    });

    it('resolves Tuesday timetable correctly from raw slots without repeating Monday', async () => {
      const result = await generateVerifiedResponse({
        executionId: 'test-exec-tuesday-raw',
        query: 'Can you tell me which classes I have on Tuesday?',
        intent: 'timetable_query',
        capability: 'timetable',
        conversationState: {
          currentCapability: 'timetable',
          currentIntent: 'timetable_query',
          activeEntity: { day: 'Monday' }
        },
        verifiedResult: {
          slots: [
            { day: 'Monday', courseCode: 'CSE329', time: '9:30 AM - 10:20 AM', room: 'R-38-917', slotType: 'Theory' },
            { day: 'Monday', courseCode: 'CSE472', time: '10:20 AM - 11:10 AM', room: 'R-33-301', slotType: 'Theory' },
            { day: 'Tuesday', courseCode: 'CSE408', time: '9:00 AM - 10:00 AM', room: '34-601', slotType: 'Theory' },
            { day: 'Tuesday', courseCode: 'INT219', time: '10:00 AM - 11:00 AM', room: '33-204', slotType: 'Theory' },
            { day: 'Tuesday', courseCode: 'CSE320', time: '11:00 AM - 12:00 PM', room: '34-501', slotType: 'Practical' }
          ],
          byDay: {
            Monday: [
              { day: 'Monday', courseCode: 'CSE329', time: '9:30 AM - 10:20 AM', room: 'R-38-917', slotType: 'Theory' },
              { day: 'Monday', courseCode: 'CSE472', time: '10:20 AM - 11:10 AM', room: 'R-33-301', slotType: 'Theory' }
            ],
            Tuesday: [
              { day: 'Tuesday', courseCode: 'CSE408', time: '9:00 AM - 10:00 AM', room: '34-601', slotType: 'Theory' },
              { day: 'Tuesday', courseCode: 'INT219', time: '10:00 AM - 11:00 AM', room: '33-204', slotType: 'Theory' },
              { day: 'Tuesday', courseCode: 'CSE320', time: '11:00 AM - 12:00 PM', room: '34-501', slotType: 'Practical' }
            ]
          }
        },
        taskOutcome: 'success'
      });

      const reply = result.reply.toLowerCase();
      expect(reply).toContain('tuesday');
      expect(reply).not.toContain('no classes');
      expect(reply).toMatch(/cse408|int219|cse320/i);
    });

    it('resolves practical follow-up question accurately', async () => {
      const result = await generateVerifiedResponse({
        executionId: 'test-exec-practical',
        query: 'Which one is practical?',
        intent: 'timetable_query',
        capability: 'timetable',
        conversationState: {
          currentCapability: 'timetable',
          currentIntent: 'timetable_query',
          activeEntity: { day: 'Tuesday' }
        },
        verifiedResult: {
          day: 'Tuesday',
          classes: [
            { day: 'Tuesday', courseCode: 'CSE408', time: '9:00 AM - 10:00 AM', room: '34-601', slotType: 'Theory' },
            { day: 'Tuesday', courseCode: 'INT219', time: '10:00 AM - 11:00 AM', room: '33-204', slotType: 'Theory' },
            { day: 'Tuesday', courseCode: 'CSE320', time: '11:00 AM - 12:00 PM', room: '34-501', slotType: 'Practical' }
          ]
        },
        taskOutcome: 'success'
      });

      const reply = result.reply.toLowerCase();
      expect(reply).toContain('cse320');
      expect(reply).toContain('practical');
    });
  });

  describe('Pre-Automation Sofia Greeting (Requirement 2 & 4)', () => {
    it('speaks ONE short intent-specific acknowledgement BEFORE browser automation', () => {
      const queue = new VoiceQueue(DEFAULT_VOICE_PREFERENCES);
      const enqueueSpy = vi.spyOn(queue, 'enqueue');
      const manager = new NarrationManager(queue, DEFAULT_VOICE_PREFERENCES);

      manager.acknowledgeGoal('Which subject has the lowest attendance?', 'exec-greet-1');

      // The greeting is spoken through the normal VoiceQueue provider hierarchy
      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      const [greeting, options] = enqueueSpy.mock.calls[0];
      expect(typeof greeting).toBe('string');
      expect(greeting.length).toBeGreaterThan(0);
      expect(greeting.length).toBeLessThan(120);
      expect(options?.executionId).toBe('exec-greet-1');
      expect(options?.providerPreference).toBe('auto');

      // Wording is derived from the actual intent (attendance), not generic
      expect(greeting.toLowerCase()).toContain('attendance');

      // No technical narration of browser internals
      expect(greeting).not.toMatch(/dom|element|browser agent|page structure/i);
    });

    it('names the specific course in the acknowledgement when the student asked about one', () => {
      const queue = new VoiceQueue(DEFAULT_VOICE_PREFERENCES);
      const enqueueSpy = vi.spyOn(queue, 'enqueue');
      const manager = new NarrationManager(queue, DEFAULT_VOICE_PREFERENCES);

      manager.acknowledgeGoal('How many classes can I miss in CSE330?', 'exec-greet-2');

      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      const [greeting] = enqueueSpy.mock.calls[0];
      expect(greeting).toContain('CSE330');
      // A "how many can I miss" request greets about the bunk margin, the actual intent.
      expect(greeting.toLowerCase()).toContain('bunk');
    });

    it('acknowledgements vary naturally between different requests', () => {
      const queueA = new VoiceQueue(DEFAULT_VOICE_PREFERENCES);
      const spyA = vi.spyOn(queueA, 'enqueue');
      new NarrationManager(queueA, DEFAULT_VOICE_PREFERENCES).acknowledgeGoal('Check my attendance', 'exec-var-a');

      const queueB = new VoiceQueue(DEFAULT_VOICE_PREFERENCES);
      const spyB = vi.spyOn(queueB, 'enqueue');
      new NarrationManager(queueB, DEFAULT_VOICE_PREFERENCES).acknowledgeGoal('Show my timetable for tomorrow', 'exec-var-b');

      expect(spyA.mock.calls[0][0].toLowerCase()).toContain('attendance');
      expect(spyB.mock.calls[0][0].toLowerCase()).toContain('tomorrow');
    });

    it('speakVerifiedResult remains silent: the canonical response is spoken via the unified pipeline', () => {
      const queue = new VoiceQueue(DEFAULT_VOICE_PREFERENCES);
      const enqueueSpy = vi.spyOn(queue, 'enqueue');
      const manager = new NarrationManager(queue, DEFAULT_VOICE_PREFERENCES);

      manager.speakVerifiedResult({
        status: 'READY',
        type: 'timetable',
        title: 'Timetable',
        capability: 'TIMETABLE',
        verification: {
          verified: true,
          source: 'UMS_DOM',
          timestamp: 'now',
          executionStatus: 'COMPLETED'
        }
      });
      expect(enqueueSpy).not.toHaveBeenCalled();
    });
  });
});
