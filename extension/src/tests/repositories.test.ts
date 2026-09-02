/*
 * Storage Repository Layer Test Suite.
 *
 * Validates the repository interfaces over IndexedDB and Chrome Storage APIs:
 * - chatRepo: Conversation and message management.
 * - agentHistoryRepo: Computer Use execution logs and action traces.
 * - verifiedContextRepo: Grounded UMS attendance context caching.
 * - settingsRepo & sessionRepo: Lightweight settings and ephemeral session flags.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  chatRepo,
  agentHistoryRepo,
  verifiedContextRepo,
  settingsRepo,
  sessionRepo
} from '../services/repositories';
import { localDatabase } from '../services/localDatabase';

describe('Storage Repositories Architecture', () => {
  beforeEach(async () => {
    await localDatabase.clearAllLocalData();
  });

  describe('ChatRepository (IndexedDB)', () => {
    it('creates a conversation and saves messages', async () => {
      const conv = await chatRepo.createConversation('test_student', 'Attendance Check');
      expect(conv.id).toBeDefined();
      expect(conv.title).toBe('Attendance Check');

      await chatRepo.saveMessage({
        id: 'msg-1',
        conversationId: conv.id,
        accountId: 'test_student',
        role: 'user',
        content: 'Check my attendance',
        timestamp: '10:00 AM',
        createdAt: Date.now()
      });

      await chatRepo.saveMessage({
        id: 'msg-2',
        conversationId: conv.id,
        accountId: 'test_student',
        role: 'assistant',
        content: 'Your overall attendance is 92%.',
        timestamp: '10:01 AM',
        createdAt: Date.now() + 1000
      });

      const messages = await chatRepo.listMessages(conv.id);
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe('Check my attendance');
      expect(messages[1].role).toBe('assistant');
    });
  });

  describe('AgentHistoryRepository (IndexedDB & Retention Policy)', () => {
    it('saves and retrieves execution traces', async () => {
      await agentHistoryRepo.saveExecution({
        executionId: 'exec-101',
        accountId: 'test_student',
        objective: 'Read attendance summary',
        startedAt: Date.now(),
        completedAt: Date.now() + 2000,
        status: 'completed',
        steps: [{ step: 1, action: 'click' }],
        actions: [{ action: 'click', reason: 'Open attendance' }]
      });

      const retrieved = await agentHistoryRepo.getExecution('exec-101');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.objective).toBe('Read attendance summary');
    });

    it('enforces retention limit by keeping maximum 30 historical executions', async () => {
      for (let i = 1; i <= 35; i++) {
        await agentHistoryRepo.saveExecution({
          executionId: `exec-${i}`,
          accountId: 'retention_user',
          objective: `Goal ${i}`,
          startedAt: 1000000 + i * 100,
          completedAt: 1000000 + i * 100 + 50,
          status: 'completed',
          steps: [],
          actions: []
        });
      }

      const list = await agentHistoryRepo.listExecutions('retention_user', 50);
      expect(list.length).toBeLessThanOrEqual(30);
    });
  });

  describe('VerifiedContextRepository (IndexedDB)', () => {
    it('saves and retrieves latest verified UMS dataset', async () => {
      await verifiedContextRepo.saveVerifiedAttendance({
        id: 'latest_student_01',
        accountId: 'student_01',
        executionId: 'exec-v1',
        capturedAt: Date.now(),
        source: 'UMS_DOM',
        verified: true,
        subjects: [
          { code: 'CSE330', percentage: 89, delivered: 9, attended: 8 }
        ],
        aggregate: {
          percentage: 89,
          delivered: 9,
          attended: 8,
          totalCourses: 1
        }
      });

      const latest = await verifiedContextRepo.getLatestVerifiedAttendance('student_01');
      expect(latest).not.toBeNull();
      expect(latest?.verified).toBe(true);
      expect(latest?.subjects[0].code).toBe('CSE330');
    });
  });

  describe('SettingsRepository (chrome.storage.local)', () => {
    it('persists and retrieves privacy notice status and user preferences', async () => {
      expect(await settingsRepo.hasSeenPrivacyNotice()).toBe(false);
      await settingsRepo.markPrivacyNoticeSeen();
      expect(await settingsRepo.hasSeenPrivacyNotice()).toBe(true);

      const prefs = await settingsRepo.getPreferences();
      expect(prefs.theme).toBe('dark');

      const updated = await settingsRepo.savePreferences({ theme: 'light', motionMode: 'fast' });
      expect(updated.theme).toBe('light');
      expect(updated.motionMode).toBe('fast');
    });
  });

  describe('SessionRepository (chrome.storage.session)', () => {
    it('manages ephemeral execution state and connection state', async () => {
      await sessionRepo.setActiveExecution({
        executionId: 'exec-active-1',
        objective: 'Reading lowest subject',
        status: 'executing'
      });

      const active = await sessionRepo.getActiveExecution();
      expect(active?.executionId).toBe('exec-active-1');
      expect(active?.status).toBe('executing');

      await sessionRepo.setConnectionState('CONNECTED');
      expect(await sessionRepo.getConnectionState()).toBe('CONNECTED');

      await sessionRepo.setActiveExecution(null);
      expect(await sessionRepo.getActiveExecution()).toBeNull();
    });
  });
});
