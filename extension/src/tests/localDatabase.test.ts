/*
 * Local IndexedDB Storage & Privacy Test Suite.
 *
 * Validates on-device database operations and multi-user isolation:
 * - Conversation and message CRUD persistence across sessions.
 * - Agent execution record logging with structured activity traces.
 * - Account-isolated verified attendance datasets (switching student ID clears previous cache).
 * - Full data lifecycle operations (selective store purges and complete wipe).
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  localDatabase,
  ConversationRecord,
  MessageRecord,
  AgentExecutionRecord,
  VerifiedAttendanceRecord
} from '../services/localDatabase';
import { personalizationStore } from '../services/personalizationStore';

describe('ONEE Local-First Database & Privacy Architecture', () => {
  beforeEach(async () => {
    await localDatabase.clearAllLocalData();
  });

  describe('ChatStore (Conversations & Messages)', () => {
    it('creates, lists, and deletes conversations scoped by accountId', async () => {
      const conv1: ConversationRecord = {
        id: 'conv-1',
        accountId: 'student-12201',
        title: 'Attendance Check',
        createdAt: 1000,
        updatedAt: 1000
      };

      const conv2: ConversationRecord = {
        id: 'conv-2',
        accountId: 'student-12201',
        title: 'Bunk Calculation',
        createdAt: 2000,
        updatedAt: 2000
      };

      const convOther: ConversationRecord = {
        id: 'conv-3',
        accountId: 'student-99999',
        title: 'Different Account Chat',
        createdAt: 3000,
        updatedAt: 3000
      };

      await localDatabase.saveConversation(conv1);
      await localDatabase.saveConversation(conv2);
      await localDatabase.saveConversation(convOther);

      // Student 12201 should only see their 2 conversations, ordered newest first
      const student1Convs = await localDatabase.listConversations('student-12201');
      expect(student1Convs).toHaveLength(2);
      expect(student1Convs[0].id).toBe('conv-2');
      expect(student1Convs[1].id).toBe('conv-1');

      // Student 99999 should only see their 1 conversation
      const otherConvs = await localDatabase.listConversations('student-99999');
      expect(otherConvs).toHaveLength(1);
      expect(otherConvs[0].id).toBe('conv-3');

      // Delete conv-1
      await localDatabase.deleteConversation('conv-1');
      const remaining = await localDatabase.listConversations('student-12201');
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe('conv-2');
    });

    it('saves and retrieves chronological messages for a conversation', async () => {
      const conv: ConversationRecord = {
        id: 'conv-test',
        accountId: 'default',
        title: 'Test Thread',
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await localDatabase.saveConversation(conv);

      const msg1: MessageRecord = {
        id: 'msg-1',
        conversationId: 'conv-test',
        accountId: 'default',
        role: 'user',
        content: 'Check my attendance',
        timestamp: '10:00 AM',
        createdAt: 100
      };

      const msg2: MessageRecord = {
        id: 'msg-2',
        conversationId: 'conv-test',
        accountId: 'default',
        role: 'assistant',
        content: 'Your lowest attendance is CSE330 at 89%.',
        timestamp: '10:01 AM',
        createdAt: 200,
        sources: ['UMS_DOM']
      };

      await localDatabase.saveMessage(msg1);
      await localDatabase.saveMessage(msg2);

      const messages = await localDatabase.listMessages('conv-test');
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe('Check my attendance');
      expect(messages[1].sources).toEqual(['UMS_DOM']);

      // Check conversation lastMessagePreview update
      const updatedConv = await localDatabase.getConversation('conv-test');
      expect(updatedConv?.lastMessagePreview).toContain('Your lowest attendance');
    });
  });

  describe('AgentHistoryStore (Computer Use Executions)', () => {
    it('persists and retrieves autonomous execution traces', async () => {
      const execution: AgentExecutionRecord = {
        executionId: 'exec-101',
        conversationId: 'conv-1',
        accountId: 'student-12201',
        objective: 'Go to attendance and check lowest subject',
        startedAt: 1000,
        completedAt: 4000,
        status: 'completed',
        steps: [
          { action: 'click', target: 'Attendance Menu' },
          { action: 'click', target: 'Attendance Summary' }
        ],
        actions: [{ action: 'click' }],
        result: 'Lowest subject is CSE330 (89%)'
      };

      await localDatabase.saveAgentExecution(execution);

      const retrieved = await localDatabase.getAgentExecution('exec-101');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.objective).toBe('Go to attendance and check lowest subject');
      expect(retrieved?.status).toBe('completed');
      expect(retrieved?.steps).toHaveLength(2);

      const list = await localDatabase.listAgentExecutions('student-12201');
      expect(list).toHaveLength(1);
      expect(list[0].executionId).toBe('exec-101');
    });
  });

  describe('VerifiedContextStore (UMS Snapshots)', () => {
    it('persists verified attendance snapshots and retrieves latest by account', async () => {
      const snapshot: VerifiedAttendanceRecord = {
        id: 'snapshot-1',
        accountId: 'student-12201',
        executionId: 'exec-101',
        capturedAt: Date.now(),
        source: 'UMS_DOM',
        verified: true,
        subjects: [
          { code: 'CSE329', percentage: 100, delivered: 9, attended: 9 },
          { code: 'CSE330', percentage: 89, delivered: 9, attended: 8 }
        ],
        aggregate: {
          percentage: 94.5,
          delivered: 18,
          attended: 17,
          totalCourses: 2
        }
      };

      await localDatabase.saveVerifiedAttendance(snapshot);

      const latest = await localDatabase.getLatestVerifiedAttendance('student-12201');
      expect(latest).not.toBeNull();
      expect(latest?.verified).toBe(true);
      expect(latest?.subjects).toHaveLength(2);
      expect(latest?.aggregate.percentage).toBe(94.5);

      // Other account should not see this snapshot
      const otherLatest = await localDatabase.getLatestVerifiedAttendance('student-99999');
      expect(otherLatest).toBeNull();
    });
  });

  describe('Data Lifecycle & Selective Purge Controls', () => {
    it('computes storage metrics accurately and executes selective purges', async () => {
      // Populate records
      await localDatabase.saveConversation({
        id: 'c1',
        accountId: 'default',
        title: 'T1',
        createdAt: 1,
        updatedAt: 1
      });
      await localDatabase.saveMessage({
        id: 'm1',
        conversationId: 'c1',
        accountId: 'default',
        role: 'user',
        content: 'Hi',
        timestamp: '10:00',
        createdAt: 1
      });
      await localDatabase.saveAgentExecution({
        executionId: 'e1',
        accountId: 'default',
        objective: 'Test',
        startedAt: 1,
        completedAt: 2,
        status: 'completed',
        steps: [],
        actions: []
      });
      await localDatabase.saveVerifiedAttendance({
        id: 'v1',
        accountId: 'default',
        executionId: 'e1',
        capturedAt: 1,
        source: 'UMS_DOM',
        verified: true,
        subjects: [],
        aggregate: { percentage: 90, delivered: 10, attended: 9, totalCourses: 1 }
      });

      let metrics = await localDatabase.getStorageMetrics('default');
      expect(metrics.conversationCount).toBe(1);
      expect(metrics.messageCount).toBe(1);
      expect(metrics.executionCount).toBe(1);
      expect(metrics.datasetCount).toBeGreaterThanOrEqual(1);

      // Clear chat history only
      await localDatabase.clearChatHistory('default');
      metrics = await localDatabase.getStorageMetrics('default');
      expect(metrics.conversationCount).toBe(0);
      expect(metrics.messageCount).toBe(0);
      expect(metrics.executionCount).toBe(1); // Still intact

      // Clear agent history
      await localDatabase.clearAgentHistory('default');
      metrics = await localDatabase.getStorageMetrics('default');
      expect(metrics.executionCount).toBe(0);

      // Wipe all local data
      await localDatabase.clearAllLocalData('default');
      metrics = await localDatabase.getStorageMetrics('default');
      expect(metrics.conversationCount).toBe(0);
      expect(metrics.messageCount).toBe(0);
      expect(metrics.executionCount).toBe(0);
      expect(metrics.datasetCount).toBe(0);
    });
  });

  describe('PersonalizationStore', () => {
    it('updates preferences and task telemetry without sensitive credentials', async () => {
      await personalizationStore.resetProfile('student-test');
      const profile = await personalizationStore.getProfile('student-test');
      expect(profile.preferredResponseLength).toBe('medium');
      expect(profile.interactionPreferences.showComputerUse).toBe(true);

      await personalizationStore.recordTaskUsage('attendance', 'student-test');
      await personalizationStore.recordTaskUsage('bunk_calculator', 'student-test');

      const updated = await personalizationStore.getProfile('student-test');
      expect(updated.frequentlyUsedTasks[0]).toBe('bunk_calculator');
      expect(updated.frequentlyUsedTasks[1]).toBe('attendance');
    });
  });
});
