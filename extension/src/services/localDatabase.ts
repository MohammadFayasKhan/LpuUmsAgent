/*
 * Local-First IndexedDB Storage for ONEE.
 *
 * Why we use IndexedDB instead of window.localStorage:
 * 1. Extension Security: If a content script writes to window.localStorage, those
 *    items are stored in the host page's origin (ums.lpu.in) and can be inspected
 *    by page scripts. IndexedDB in the extension origin is 100% private to ONEE.
 * 2. Storage Capacity: localStorage is capped at 5MB and blocks the main thread with
 *    synchronous string serialization. IndexedDB is asynchronous and handles
 *    structured records (like chat history and course lists) with indexes.
 *
 * We partition records by student registration number (accountId) so switching
 * accounts on a shared laptop never leaks another student's attendance records.
 */

export interface ConversationRecord {
  id: string;
  accountId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview?: string;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  accountId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  createdAt: number;
  executionId?: string;
  model?: string;
  sources?: string[];
  activities?: any[];
  isError?: boolean;
}

export interface AgentExecutionRecord {
  executionId: string;
  conversationId?: string;
  accountId: string;
  objective: string;
  startedAt: number;
  completedAt: number;
  status: 'completed' | 'failed' | 'stopped';
  url?: string;
  steps: any[];
  observations?: any[];
  actions: any[];
  verification?: any;
  result?: any;
}

export interface VerifiedAttendanceRecord {
  id: string; // e.g. latest_${accountId} or executionId
  accountId: string;
  executionId: string;
  capturedAt: number;
  source: 'UMS_DOM';
  verified: boolean;
  subjects: {
    code: string;
    percentage: number;
    delivered: number;
    attended: number;
    lastAttended?: string;
    dutyLeave?: number;
  }[];
  aggregate: {
    percentage: number;
    delivered: number;
    attended: number;
    totalCourses: number;
  };
}

export interface StorageMetrics {
  conversationCount: number;
  messageCount: number;
  executionCount: number;
  datasetCount: number;
}

import { PersonalizationProfile } from './personalizationStore';

const DB_NAME = 'ONEE_LOCAL_DB';
const DB_VERSION = 2;

const STORES = {
  CONVERSATIONS: 'conversations',
  MESSAGES: 'messages',
  EXECUTIONS: 'agentExecutions',
  VERIFIED_ATTENDANCE: 'verifiedAttendance',
  PERSONALIZATION: 'personalization'
} as const;

class LocalDatabase {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB is not supported in this environment.');
    }

    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 1. Conversations store
        if (!db.objectStoreNames.contains(STORES.CONVERSATIONS)) {
          const store = db.createObjectStore(STORES.CONVERSATIONS, { keyPath: 'id' });
          store.createIndex('accountId', 'accountId', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // 2. Messages store
        if (!db.objectStoreNames.contains(STORES.MESSAGES)) {
          const store = db.createObjectStore(STORES.MESSAGES, { keyPath: 'id' });
          store.createIndex('conversationId', 'conversationId', { unique: false });
          store.createIndex('accountId', 'accountId', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // 3. Agent Executions store
        if (!db.objectStoreNames.contains(STORES.EXECUTIONS)) {
          const store = db.createObjectStore(STORES.EXECUTIONS, { keyPath: 'executionId' });
          store.createIndex('conversationId', 'conversationId', { unique: false });
          store.createIndex('accountId', 'accountId', { unique: false });
          store.createIndex('startedAt', 'startedAt', { unique: false });
        }

        // 4. Verified Attendance store
        if (!db.objectStoreNames.contains(STORES.VERIFIED_ATTENDANCE)) {
          const store = db.createObjectStore(STORES.VERIFIED_ATTENDANCE, { keyPath: 'id' });
          store.createIndex('accountId', 'accountId', { unique: false });
          store.createIndex('capturedAt', 'capturedAt', { unique: false });
        }

        // 5. Personalization Profile store
        if (!db.objectStoreNames.contains(STORES.PERSONALIZATION)) {
          db.createObjectStore(STORES.PERSONALIZATION, { keyPath: 'activeAccountId' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error);
      };
    });

    return this.dbPromise;
  }

  /*
   * We keep conversation threads and individual chat messages in IndexedDB so
   * the student can close the side panel or refresh without losing their
   * current questions.
   *
   * Each message has an accountId attached so if another student logs in on the
   * same browser, their chat history doesn't mix together.
   */
  public async createConversation(
    accountId: string = 'default',
    title: string = 'New Conversation'
  ): Promise<ConversationRecord> {
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `conv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();
    const conv: ConversationRecord = {
      id,
      accountId,
      title,
      createdAt: now,
      updatedAt: now
    };
    await this.saveConversation(conv);
    return conv;
  }

  public async saveConversation(conversation: ConversationRecord): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.CONVERSATIONS, 'readwrite');
      const store = tx.objectStore(STORES.CONVERSATIONS);
      const req = store.put(conversation);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  public async getConversation(id: string): Promise<ConversationRecord | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.CONVERSATIONS, 'readonly');
      const store = tx.objectStore(STORES.CONVERSATIONS);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  public async listConversations(accountId: string = 'default'): Promise<ConversationRecord[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.CONVERSATIONS, 'readonly');
      const store = tx.objectStore(STORES.CONVERSATIONS);
      const index = store.index('accountId');
      const req = index.getAll(accountId);
      req.onsuccess = () => {
        const results: ConversationRecord[] = req.result || [];
        results.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(results);
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async deleteConversation(id: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.CONVERSATIONS, STORES.MESSAGES], 'readwrite');
      tx.objectStore(STORES.CONVERSATIONS).delete(id);

      const msgStore = tx.objectStore(STORES.MESSAGES);
      const index = msgStore.index('conversationId');
      const req = index.getAll(id);
      req.onsuccess = () => {
        const msgs: MessageRecord[] = req.result || [];
        for (const m of msgs) {
          msgStore.delete(m.id);
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async saveMessage(message: MessageRecord): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.MESSAGES, STORES.CONVERSATIONS], 'readwrite');
      tx.objectStore(STORES.MESSAGES).put(message);

      // Update parent conversation timestamp and preview
      const convStore = tx.objectStore(STORES.CONVERSATIONS);
      const convReq = convStore.get(message.conversationId);
      convReq.onsuccess = () => {
        const conv: ConversationRecord | undefined = convReq.result;
        if (conv) {
          conv.updatedAt = message.createdAt;
          conv.lastMessagePreview = message.content.slice(0, 80);
          convStore.put(conv);
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async listMessages(conversationId: string): Promise<MessageRecord[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.MESSAGES, 'readonly');
      const store = tx.objectStore(STORES.MESSAGES);
      const index = store.index('conversationId');
      const req = index.getAll(conversationId);
      req.onsuccess = () => {
        const results: MessageRecord[] = req.result || [];
        results.sort((a, b) => a.createdAt - b.createdAt);
        resolve(results);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /*
   * The agent execution history stores the step-by-step trace of what the
   * browser agent did on the UMS page (like click coordinates and observations).
   *
   * We cap this at 30 recent runs per student account. Older executions get
   * pruned automatically because we only need recent history for debugging or
   * reviewing recent actions, and we do not want IndexedDB filling up over time.
   */
  public async saveAgentExecution(execution: AgentExecutionRecord): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.EXECUTIONS, 'readwrite');
      const store = tx.objectStore(STORES.EXECUTIONS);
      store.put(execution);

      // Automated retention policy: retain maximum 30 recent executions per account namespace
      const index = store.index('accountId');
      const req = index.getAll(execution.accountId);
      req.onsuccess = () => {
        const records: AgentExecutionRecord[] = req.result || [];
        if (records.length > 30) {
          records.sort((a, b) => a.startedAt - b.startedAt); // oldest first
          const toDelete = records.slice(0, records.length - 30);
          for (const item of toDelete) {
            store.delete(item.executionId);
          }
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async getAgentExecution(executionId: string): Promise<AgentExecutionRecord | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.EXECUTIONS, 'readonly');
      const store = tx.objectStore(STORES.EXECUTIONS);
      const req = store.get(executionId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  public async listAgentExecutions(accountId: string = 'default', limit: number = 30): Promise<AgentExecutionRecord[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.EXECUTIONS, 'readonly');
      const store = tx.objectStore(STORES.EXECUTIONS);
      const index = store.index('accountId');
      const req = index.getAll(accountId);
      req.onsuccess = () => {
        const results: AgentExecutionRecord[] = req.result || [];
        results.sort((a, b) => b.startedAt - a.startedAt);
        resolve(results.slice(0, limit));
      };
      req.onerror = () => reject(req.error);
    });
  }

  /*
   * When the agent finishes reading the attendance table from UMS, we save a
   * clean copy of the parsed data here.
   *
   * This verified snapshot is what powers fast answers to follow-up questions
   * like "which subject has the lowest attendance?" without needing to reopen
   * the attendance modal on UMS every single time.
   */
  public async saveVerifiedAttendance(record: VerifiedAttendanceRecord): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.VERIFIED_ATTENDANCE, 'readwrite');
      const store = tx.objectStore(STORES.VERIFIED_ATTENDANCE);
      // Save specific execution record AND update latest record for this account
      store.put(record);
      store.put({
        ...record,
        id: `latest_${record.accountId}`
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async getLatestVerifiedAttendance(accountId: string = 'default'): Promise<VerifiedAttendanceRecord | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.VERIFIED_ATTENDANCE, 'readonly');
      const store = tx.objectStore(STORES.VERIFIED_ATTENDANCE);
      const req = store.get(`latest_${accountId}`);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  /*
   * ONEE keeps a small amount of personalization data locally so that the
   * chatbot does not have to start from zero in every conversation.
   *
   * This can include things like frequently used tasks or UI preferences.
   * We should not store passwords, authentication cookies, or other login
   * information here. The purpose of this store is only to make normal
   * interactions more useful.
   *
   * The data is kept on the user's device and only the small amount that is
   * actually relevant to a request should be included when building model
   * context.
   */
  public async getPersonalization(accountId: string = 'default'): Promise<PersonalizationProfile> {
    const defaultProfile: PersonalizationProfile = {
      activeAccountId: accountId,
      preferredResponseLength: 'medium',
      interactionPreferences: {
        showComputerUse: true,
        showFollowUps: true
      },
      frequentlyUsedTasks: ['attendance', 'lowest_subject', 'bunk_planner'],
      recentTopics: ['attendance'],
      lastActiveAt: Date.now()
    };

    try {
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORES.PERSONALIZATION, 'readonly');
        const store = tx.objectStore(STORES.PERSONALIZATION);
        const req = store.get(accountId);
        req.onsuccess = () => {
          if (req.result) {
            resolve({ ...defaultProfile, ...req.result, activeAccountId: accountId });
          } else {
            resolve(defaultProfile);
          }
        };
        req.onerror = () => resolve(defaultProfile);
      });
    } catch {
      return defaultProfile;
    }
  }

  public async savePersonalization(
    updates: Partial<PersonalizationProfile>,
    accountId: string = 'default'
  ): Promise<PersonalizationProfile> {
    const current = await this.getPersonalization(accountId);
    const updated: PersonalizationProfile = {
      ...current,
      ...updates,
      activeAccountId: accountId,
      lastActiveAt: Date.now()
    };

    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.PERSONALIZATION, 'readwrite');
      const store = tx.objectStore(STORES.PERSONALIZATION);
      store.put(updated);
      tx.oncomplete = () => resolve(updated);
      tx.onerror = () => reject(tx.error);
    });
  }

  public async clearPersonalization(accountId?: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.PERSONALIZATION, 'readwrite');
      const store = tx.objectStore(STORES.PERSONALIZATION);
      if (accountId) {
        store.delete(accountId);
      } else {
        store.clear();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /*
   * Students should always have full control over what is saved on their machine.
   * These helper functions let the settings panel wipe chat history, agent runs,
   * or do a complete factory reset of the local database.
   */
  public async getStorageMetrics(accountId?: string): Promise<StorageMetrics> {
    try {
      const db = await this.getDB();
      const countStore = (storeName: string, indexName?: string, query?: any): Promise<number> => {
        return new Promise((resolve) => {
          const tx = db.transaction(storeName, 'readonly');
          const store = tx.objectStore(storeName);
          const target = indexName && query ? store.index(indexName) : store;
          const req = query ? target.count(query) : target.count();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(0);
        });
      };

      const [conversationCount, messageCount, executionCount, datasetCount] = await Promise.all([
        countStore(STORES.CONVERSATIONS, accountId ? 'accountId' : undefined, accountId),
        countStore(STORES.MESSAGES, accountId ? 'accountId' : undefined, accountId),
        countStore(STORES.EXECUTIONS, accountId ? 'accountId' : undefined, accountId),
        countStore(STORES.VERIFIED_ATTENDANCE, accountId ? 'accountId' : undefined, accountId)
      ]);

      return { conversationCount, messageCount, executionCount, datasetCount };
    } catch {
      return { conversationCount: 0, messageCount: 0, executionCount: 0, datasetCount: 0 };
    }
  }

  public async clearChatHistory(accountId?: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORES.CONVERSATIONS, STORES.MESSAGES], 'readwrite');
      if (accountId) {
        const convStore = tx.objectStore(STORES.CONVERSATIONS);
        const convIndex = convStore.index('accountId');
        const convReq = convIndex.getAll(accountId);
        convReq.onsuccess = () => {
          for (const c of convReq.result || []) convStore.delete(c.id);
        };

        const msgStore = tx.objectStore(STORES.MESSAGES);
        const msgIndex = msgStore.index('accountId');
        const msgReq = msgIndex.getAll(accountId);
        msgReq.onsuccess = () => {
          for (const m of msgReq.result || []) msgStore.delete(m.id);
        };
      } else {
        tx.objectStore(STORES.CONVERSATIONS).clear();
        tx.objectStore(STORES.MESSAGES).clear();
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async clearAgentHistory(accountId?: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORES.EXECUTIONS, 'readwrite');
      if (accountId) {
        const store = tx.objectStore(STORES.EXECUTIONS);
        const index = store.index('accountId');
        const req = index.getAll(accountId);
        req.onsuccess = () => {
          for (const e of req.result || []) store.delete(e.executionId);
        };
      } else {
        tx.objectStore(STORES.EXECUTIONS).clear();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  public async clearAllLocalData(accountId?: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [STORES.CONVERSATIONS, STORES.MESSAGES, STORES.EXECUTIONS, STORES.VERIFIED_ATTENDANCE, STORES.PERSONALIZATION],
        'readwrite'
      );

      if (accountId) {
        const convStore = tx.objectStore(STORES.CONVERSATIONS);
        const convReq = convStore.index('accountId').getAll(accountId);
        convReq.onsuccess = () => {
          for (const c of convReq.result || []) convStore.delete(c.id);
        };

        const msgStore = tx.objectStore(STORES.MESSAGES);
        const msgReq = msgStore.index('accountId').getAll(accountId);
        msgReq.onsuccess = () => {
          for (const m of msgReq.result || []) msgStore.delete(m.id);
        };

        const execStore = tx.objectStore(STORES.EXECUTIONS);
        const execReq = execStore.index('accountId').getAll(accountId);
        execReq.onsuccess = () => {
          for (const e of execReq.result || []) execStore.delete(e.executionId);
        };

        const attStore = tx.objectStore(STORES.VERIFIED_ATTENDANCE);
        const attReq = attStore.index('accountId').getAll(accountId);
        attReq.onsuccess = () => {
          for (const a of attReq.result || []) attStore.delete(a.id);
          attStore.delete(`latest_${accountId}`);
        };

        const persStore = tx.objectStore(STORES.PERSONALIZATION);
        persStore.delete(accountId);
      } else {
        tx.objectStore(STORES.CONVERSATIONS).clear();
        tx.objectStore(STORES.MESSAGES).clear();
        tx.objectStore(STORES.EXECUTIONS).clear();
        tx.objectStore(STORES.VERIFIED_ATTENDANCE).clear();
        tx.objectStore(STORES.PERSONALIZATION).clear();
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export const localDatabase = new LocalDatabase();
