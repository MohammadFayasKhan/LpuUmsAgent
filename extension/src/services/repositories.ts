/*
 * Storage Repositories for ONEE.
 *
 * We split extension storage into three distinct tiers:
 * 1. IndexedDB: For large, structured data like chat history, agent execution logs,
 *    and verified UMS attendance tables.
 * 2. chrome.storage.local: For small persistent settings, such as whether the
 *    student has dismissed the privacy notice.
 * 3. chrome.storage.session: For ephemeral runtime flags (like the active execution ID),
 *    which reset automatically when the browser closes.
 *
 * We intentionally avoid window.localStorage so that content scripts running on
 * ums.lpu.in never share a storage context with the university's scripts.
 */

import {
  localDatabase,
  ConversationRecord,
  MessageRecord,
  AgentExecutionRecord,
  VerifiedAttendanceRecord,
  VerifiedExaminationRecord
} from './localDatabase';
import { PersonalizationProfile } from './personalizationStore';

/*
 * We wrap the low-level IndexedDB chat calls into a clean repository interface.
 * This makes it much easier to test the chat UI without mocking IndexedDB everywhere,
 * and keeps the message saving logic in one place.
 */
export interface IChatRepository {
  createConversation(accountId?: string, title?: string): Promise<ConversationRecord>;
  getConversation(id: string): Promise<ConversationRecord | null>;
  listConversations(accountId?: string): Promise<ConversationRecord[]>;
  deleteConversation(id: string): Promise<void>;
  saveMessage(message: MessageRecord): Promise<void>;
  listMessages(conversationId: string): Promise<MessageRecord[]>;
  clearHistory(accountId?: string): Promise<void>;
}

export class ChatRepository implements IChatRepository {
  public async createConversation(accountId: string = 'default', title: string = 'New Conversation'): Promise<ConversationRecord> {
    return localDatabase.createConversation(accountId, title);
  }

  public async getConversation(id: string): Promise<ConversationRecord | null> {
    return localDatabase.getConversation(id);
  }

  public async listConversations(accountId: string = 'default'): Promise<ConversationRecord[]> {
    return localDatabase.listConversations(accountId);
  }

  public async deleteConversation(id: string): Promise<void> {
    return localDatabase.deleteConversation(id);
  }

  public async saveMessage(message: MessageRecord): Promise<void> {
    return localDatabase.saveMessage(message);
  }

  public async listMessages(conversationId: string): Promise<MessageRecord[]> {
    return localDatabase.listMessages(conversationId);
  }

  public async clearHistory(accountId?: string): Promise<void> {
    return localDatabase.clearChatHistory(accountId);
  }
}

/*
 * Stores the step-by-step browser agent action trace.
 * This is useful when the student wants to see what the agent clicked or read,
 * and helps us debug when an element on UMS wasn't found.
 */
export interface IAgentHistoryRepository {
  saveExecution(execution: AgentExecutionRecord): Promise<void>;
  getExecution(executionId: string): Promise<AgentExecutionRecord | null>;
  listExecutions(accountId?: string, limit?: number): Promise<AgentExecutionRecord[]>;
  clearHistory(accountId?: string): Promise<void>;
}

export class AgentHistoryRepository implements IAgentHistoryRepository {
  public async saveExecution(execution: AgentExecutionRecord): Promise<void> {
    return localDatabase.saveAgentExecution(execution);
  }

  public async getExecution(executionId: string): Promise<AgentExecutionRecord | null> {
    return localDatabase.getAgentExecution(executionId);
  }

  public async listExecutions(accountId: string = 'default', limit: number = 30): Promise<AgentExecutionRecord[]> {
    return localDatabase.listAgentExecutions(accountId, limit);
  }

  public async clearHistory(accountId?: string): Promise<void> {
    return localDatabase.clearAgentHistory(accountId);
  }
}

/*
 * Keeps the latest verified attendance table parsed from UMS.
 * We store this so follow-up chat messages (like "show subjects below 75%") can
 * answer instantly from local data without re-running the whole browser automation.
 */
export interface IVerifiedContextRepository {
  saveVerifiedAttendance(record: VerifiedAttendanceRecord): Promise<void>;
  getLatestVerifiedAttendance(accountId?: string): Promise<VerifiedAttendanceRecord | null>;
  clearContext(accountId?: string): Promise<void>;
}

export class VerifiedContextRepository implements IVerifiedContextRepository {
  public async saveVerifiedAttendance(record: VerifiedAttendanceRecord): Promise<void> {
    return localDatabase.saveVerifiedAttendance(record);
  }

  public async getLatestVerifiedAttendance(accountId: string = 'default'): Promise<VerifiedAttendanceRecord | null> {
    return localDatabase.getLatestVerifiedAttendance(accountId);
  }

  public async clearContext(accountId?: string): Promise<void> {
    // Purge verified attendance records for the given account namespace
    const db = await (localDatabase as any).getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('verifiedAttendance', 'readwrite');
      const store = tx.objectStore('verifiedAttendance');
      if (accountId) {
        const req = store.index('accountId').getAll(accountId);
        req.onsuccess = () => {
          for (const item of req.result || []) store.delete(item.id);
          store.delete(`latest_${accountId}`);
        };
      } else {
        store.clear();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

/*
 * Keeps the latest verified examination date sheet / seating plan parsed from UMS.
 */
export interface IVerifiedExaminationRepository {
  saveVerifiedExamination(record: VerifiedExaminationRecord): Promise<void>;
  getLatestVerifiedExamination(accountId?: string): Promise<VerifiedExaminationRecord | null>;
  clearContext(accountId?: string): Promise<void>;
}

export class VerifiedExaminationRepository implements IVerifiedExaminationRepository {
  public async saveVerifiedExamination(record: VerifiedExaminationRecord): Promise<void> {
    return localDatabase.saveVerifiedExamination(record);
  }

  public async getLatestVerifiedExamination(accountId: string = 'default'): Promise<VerifiedExaminationRecord | null> {
    return localDatabase.getLatestVerifiedExamination(accountId);
  }

  public async clearContext(accountId?: string): Promise<void> {
    const db = await (localDatabase as any).getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('verifiedExamination', 'readwrite');
      const store = tx.objectStore('verifiedExamination');
      if (accountId) {
        const req = store.index('accountId').getAll(accountId);
        req.onsuccess = () => {
          for (const item of req.result || []) store.delete(item.id);
          store.delete(`latest_${accountId}`);
        };
      } else {
        store.clear();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

/*
 * Personalization stores minor preferences like whether the student wants quick
 * summaries or full breakdown tables, plus their most frequently asked tasks.
 * We keep this local to the device so we don't send their full profile to any server.
 */
export interface IPersonalizationRepository {
  getProfile(accountId?: string): Promise<PersonalizationProfile>;
  updateProfile(updates: Partial<PersonalizationProfile>, accountId?: string): Promise<PersonalizationProfile>;
  resetProfile(accountId?: string): Promise<void>;
}

export class PersonalizationRepository implements IPersonalizationRepository {
  public async getProfile(accountId: string = 'default'): Promise<PersonalizationProfile> {
    return localDatabase.getPersonalization(accountId);
  }

  public async updateProfile(updates: Partial<PersonalizationProfile>, accountId: string = 'default'): Promise<PersonalizationProfile> {
    return localDatabase.savePersonalization(updates, accountId);
  }

  public async resetProfile(accountId?: string): Promise<void> {
    return localDatabase.clearPersonalization(accountId);
  }
}

/*
 * Settings that need to survive browser restarts (like whether the student has seen
 * the privacy notice or custom UI options) go into chrome.storage.local.
 *
 * We also keep an in-memory Map fallback here so tests running under Vitest/Node
 * don't crash when chrome.storage is undefined.
 */

export interface UserPreferences {
  theme: 'dark' | 'light' | 'system';
  motionMode: 'natural' | 'fast';
  showComputerUse: boolean;
  autoScrollChat: boolean;
}

export interface ISettingsRepository {
  hasSeenPrivacyNotice(): Promise<boolean>;
  markPrivacyNoticeSeen(): Promise<void>;
  getActiveAccountId(): Promise<string>;
  setActiveAccountId(accountId: string): Promise<void>;
  getPreferences(): Promise<UserPreferences>;
  savePreferences(updates: Partial<UserPreferences>): Promise<UserPreferences>;
}

const SETTINGS_KEYS = {
  PRIVACY_DISMISSED: 'onee_privacy_dismissed_v1',
  ACTIVE_ACCOUNT: 'onee_active_account_id',
  USER_PREFERENCES: 'onee_user_preferences'
} as const;

const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'dark',
  motionMode: 'natural',
  showComputerUse: true,
  autoScrollChat: true
};

export class SettingsRepository implements ISettingsRepository {
  // In-memory fallback for headless test environments where chrome.storage is not polyfilled
  private memStore: Map<string, any> = new Map();

  public async hasSeenPrivacyNotice(): Promise<boolean> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const data = await chrome.storage.local.get(SETTINGS_KEYS.PRIVACY_DISMISSED);
        return Boolean(data[SETTINGS_KEYS.PRIVACY_DISMISSED]);
      }
      return Boolean(this.memStore.get(SETTINGS_KEYS.PRIVACY_DISMISSED));
    } catch {
      return false;
    }
  }

  public async markPrivacyNoticeSeen(): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({ [SETTINGS_KEYS.PRIVACY_DISMISSED]: true });
      } else {
        this.memStore.set(SETTINGS_KEYS.PRIVACY_DISMISSED, true);
      }
    } catch (err) {
      console.warn('[SettingsRepository] Error marking privacy notice:', err);
    }
  }

  public async getActiveAccountId(): Promise<string> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const data = await chrome.storage.local.get(SETTINGS_KEYS.ACTIVE_ACCOUNT);
        return data[SETTINGS_KEYS.ACTIVE_ACCOUNT] || 'default';
      }
      return this.memStore.get(SETTINGS_KEYS.ACTIVE_ACCOUNT) || 'default';
    } catch {
      return 'default';
    }
  }

  public async setActiveAccountId(accountId: string): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({ [SETTINGS_KEYS.ACTIVE_ACCOUNT]: accountId });
      } else {
        this.memStore.set(SETTINGS_KEYS.ACTIVE_ACCOUNT, accountId);
      }
    } catch (err) {
      console.warn('[SettingsRepository] Error setting active account:', err);
    }
  }

  public async getPreferences(): Promise<UserPreferences> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const data = await chrome.storage.local.get(SETTINGS_KEYS.USER_PREFERENCES);
        return { ...DEFAULT_PREFERENCES, ...(data[SETTINGS_KEYS.USER_PREFERENCES] || {}) };
      }
      return { ...DEFAULT_PREFERENCES, ...(this.memStore.get(SETTINGS_KEYS.USER_PREFERENCES) || {}) };
    } catch {
      return DEFAULT_PREFERENCES;
    }
  }

  public async savePreferences(updates: Partial<UserPreferences>): Promise<UserPreferences> {
    const current = await this.getPreferences();
    const merged: UserPreferences = { ...current, ...updates };
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.set({ [SETTINGS_KEYS.USER_PREFERENCES]: merged });
      } else {
        this.memStore.set(SETTINGS_KEYS.USER_PREFERENCES, merged);
      }
    } catch (err) {
      console.warn('[SettingsRepository] Error saving preferences:', err);
    }
    return merged;
  }
}

/*
 * Active execution state lives in chrome.storage.session.
 *
 * The reason we use session storage instead of local storage is that if the student
 * closes the browser while an action is running, we do NOT want stale execution state
 * hanging around the next time Chrome opens. It also survives service worker idle
 * suspensions so the background script can reconnect and know what was running.
 */

export interface EphemeralExecutionState {
  executionId: string | null;
  objective: string | null;
  status: 'idle' | 'observing' | 'planning' | 'grounding' | 'executing' | 'completed' | 'error';
  startedAt?: number;
  currentStep?: number;
}

export interface ISessionRepository {
  getActiveExecution(): Promise<EphemeralExecutionState | null>;
  setActiveExecution(state: EphemeralExecutionState | null): Promise<void>;
  getConnectionState(): Promise<string>;
  setConnectionState(state: string): Promise<void>;
}

const SESSION_KEYS = {
  ACTIVE_EXECUTION: 'onee_session_active_execution',
  CONNECTION_STATE: 'onee_session_connection_state'
} as const;

export class SessionRepository implements ISessionRepository {
  // In-memory fallback for non-extension or worker contexts where chrome.storage.session is unavailable
  private memSession: Map<string, any> = new Map();

  public async getActiveExecution(): Promise<EphemeralExecutionState | null> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.session) {
        const data = await chrome.storage.session.get(SESSION_KEYS.ACTIVE_EXECUTION);
        return data[SESSION_KEYS.ACTIVE_EXECUTION] || null;
      }
      return this.memSession.get(SESSION_KEYS.ACTIVE_EXECUTION) || null;
    } catch {
      return null;
    }
  }

  public async setActiveExecution(state: EphemeralExecutionState | null): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.session) {
        if (state === null) {
          await chrome.storage.session.remove(SESSION_KEYS.ACTIVE_EXECUTION);
        } else {
          await chrome.storage.session.set({ [SESSION_KEYS.ACTIVE_EXECUTION]: state });
        }
      } else {
        if (state === null) {
          this.memSession.delete(SESSION_KEYS.ACTIVE_EXECUTION);
        } else {
          this.memSession.set(SESSION_KEYS.ACTIVE_EXECUTION, state);
        }
      }
    } catch (err) {
      console.warn('[SessionRepository] Error setting active execution:', err);
    }
  }

  public async getConnectionState(): Promise<string> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.session) {
        const data = await chrome.storage.session.get(SESSION_KEYS.CONNECTION_STATE);
        return data[SESSION_KEYS.CONNECTION_STATE] || 'DISCONNECTED';
      }
      return this.memSession.get(SESSION_KEYS.CONNECTION_STATE) || 'DISCONNECTED';
    } catch {
      return 'DISCONNECTED';
    }
  }

  public async setConnectionState(state: string): Promise<void> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.session) {
        await chrome.storage.session.set({ [SESSION_KEYS.CONNECTION_STATE]: state });
      } else {
        this.memSession.set(SESSION_KEYS.CONNECTION_STATE, state);
      }
    } catch (err) {
      console.warn('[SessionRepository] Error setting connection state:', err);
    }
  }
}

/*
 * Export ready-to-use repository instances so components can just import
 * what they need (e.g. `import { chatRepo } from './repositories'`).
 */

export const chatRepo = new ChatRepository();
export const agentHistoryRepo = new AgentHistoryRepository();
export const verifiedContextRepo = new VerifiedContextRepository();
export const verifiedExaminationRepo = new VerifiedExaminationRepository();
export const personalizationRepo = new PersonalizationRepository();
export const settingsRepo = new SettingsRepository();
export const sessionRepo = new SessionRepository();
