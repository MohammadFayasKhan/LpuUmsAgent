/*
 * Privacy & Data Management Modal for ONEE.
 *
 * This modal gives the student full visibility and control over what ONEE stores
 * on their device. It shows:
 * - Storage metrics: how much space conversations, agent executions, and
 *   verified attendance snapshots are using in IndexedDB
 * - Individual "Clear" buttons for each data category
 * - A "Clear All Local Data" nuclear option that wipes everything
 *
 * We show this modal the first time the student opens ONEE so they understand
 * what data is kept locally before they start using it. After dismissal, a
 * privacy acknowledgement flag is saved in chrome.storage.local so the modal
 * only appears once unless the student opens it from the settings gear.
 */

import React, { useState, useEffect } from 'react';
import styles from './PrivacyModal.module.css';
import { localDatabase, StorageMetrics } from '../services/localDatabase';
import { personalizationStore } from '../services/personalizationStore';

interface PrivacyModalProps {
  onClose: () => void;
  accountId?: string;
  onDataCleared?: () => void;
}

export const PrivacyModal: React.FC<PrivacyModalProps> = ({
  onClose,
  accountId = 'default',
  onDataCleared
}) => {
  const [metrics, setMetrics] = useState<StorageMetrics>({
    conversationCount: 0,
    messageCount: 0,
    executionCount: 0,
    datasetCount: 0
  });
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const loadMetrics = async () => {
    const data = await localDatabase.getStorageMetrics(accountId);
    setMetrics(data);
  };

  useEffect(() => {
    loadMetrics();
  }, [accountId]);

  const handleClearChat = async () => {
    if (isClearing) return;
    setIsClearing(true);
    try {
      await localDatabase.clearChatHistory(accountId);
      await loadMetrics();
      setActionNotice('Chat history cleared.');
      if (onDataCleared) onDataCleared();
      setTimeout(() => setActionNotice(null), 2500);
    } catch {
      setActionNotice('Failed to clear chat history.');
    } finally {
      setIsClearing(false);
    }
  };

  const handleClearAgent = async () => {
    if (isClearing) return;
    setIsClearing(true);
    try {
      await localDatabase.clearAgentHistory(accountId);
      await loadMetrics();
      setActionNotice('Agent execution history cleared.');
      if (onDataCleared) onDataCleared();
      setTimeout(() => setActionNotice(null), 2500);
    } catch {
      setActionNotice('Failed to clear agent history.');
    } finally {
      setIsClearing(false);
    }
  };

  const handleClearAll = async () => {
    if (isClearing) return;
    const confirmed = window.confirm(
      'Are you sure you want to permanently delete all local chat history, agent executions, and verified attendance datasets from this device?'
    );
    if (!confirmed) return;

    setIsClearing(true);
    try {
      await localDatabase.clearAllLocalData(accountId);
      await personalizationStore.resetProfile(accountId);
      await loadMetrics();
      setActionNotice('All local data permanently deleted.');
      if (onDataCleared) onDataCleared();
      setTimeout(() => setActionNotice(null), 2500);
    } catch {
      setActionNotice('Failed to clear local data.');
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.iconCircle}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <h2 className={styles.title}>ONEE Data & Privacy</h2>
          <p className={styles.subtitle}>
            Local-first storage on your device. UMS credentials and session tokens are never stored.
          </p>
        </div>

        {/* Local Storage Telemetry Grid */}
        <div className={styles.storageSection}>
          <div className={styles.sectionTitleRow}>
            <span className={styles.sectionTitle}>Local Memory Storage</span>
            <span className={styles.storageBadge}>IndexedDB</span>
          </div>

          <div className={styles.storageGrid}>
            <div className={styles.storageCard}>
              <span className={styles.cardLabel}>Chat History</span>
              <strong className={styles.cardValue}>
                {metrics.conversationCount} <small>threads</small>
              </strong>
              <span className={styles.cardDetail}>{metrics.messageCount} messages</span>
            </div>

            <div className={styles.storageCard}>
              <span className={styles.cardLabel}>Browser Agent</span>
              <strong className={styles.cardValue}>
                {metrics.executionCount} <small>runs</small>
              </strong>
              <span className={styles.cardDetail}>Computer Use traces</span>
            </div>

            <div className={styles.storageCard}>
              <span className={styles.cardLabel}>Saved Context</span>
              <strong className={styles.cardValue}>
                {metrics.datasetCount} <small>datasets</small>
              </strong>
              <span className={styles.cardDetail}>Verified UMS records</span>
            </div>
          </div>

          {/* Action Notification Pill */}
          {actionNotice && <div className={styles.actionNotice}>{actionNotice}</div>}

          {/* Selective Purge Buttons */}
          <div className={styles.dataActionRow}>
            <button
              className={styles.purgeBtn}
              onClick={handleClearChat}
              disabled={isClearing || metrics.conversationCount === 0}
            >
              Clear Chat
            </button>
            <button
              className={styles.purgeBtn}
              onClick={handleClearAgent}
              disabled={isClearing || metrics.executionCount === 0}
            >
              Clear Agent Runs
            </button>
            <button
              className={styles.dangerBtn}
              onClick={handleClearAll}
              disabled={isClearing}
            >
              Wipe All Local Data
            </button>
          </div>
        </div>

        {/* Privacy Principles Checklist */}
        <div className={styles.principles}>
          <div className={styles.principleItem}>
            <span className={styles.checkIcon}>✓</span>
            <div>
              <strong>Local-First Architecture</strong>
              <p>Chat threads, agent traces, and attendance datasets are stored on this device in IndexedDB.</p>
            </div>
          </div>

          <div className={styles.principleItem}>
            <span className={styles.checkIcon}>✓</span>
            <div>
              <strong>Zero Password & Token Storage</strong>
              <p>ONEE never stores, collects, or transmits your UMS password or session authentication cookies.</p>
            </div>
          </div>

          <div className={styles.principleItem}>
            <span className={styles.checkIcon}>✓</span>
            <div>
              <strong>Minimal LLM Request Context</strong>
              <p>Only the specific question and active verified attendance table leave your device for AI processing.</p>
            </div>
          </div>

          <div className={styles.principleItem}>
            <span className={styles.checkIcon}>✓</span>
            <div>
              <strong>Account / Session Boundaries</strong>
              <p>Storage is namespaced per student account. Logging out invalidates active runtime sessions immediately.</p>
            </div>
          </div>
        </div>

        <div className={styles.creatorNote}>
          <div className={styles.creatorTag}>Engineering</div>
          <p className={styles.creatorText}>
            Engineered by <strong>Mohammad Fayas Khan</strong> (CSE AI/ML @ LPU) as an autonomous browser agent and academic assistant.
          </p>
        </div>

        <div className={styles.footer}>
          <button className={styles.continueBtn} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
