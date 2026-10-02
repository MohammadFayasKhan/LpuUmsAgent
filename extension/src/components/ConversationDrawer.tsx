/*
 * Conversation History Drawer for ONEE (Apple iOS Design System).
 *
 * Implements WWDC Human Interface Guidelines for iOS sidebars and grouped cards:
 * - Ultra-thin frosted glass materials with specular top-edge illumination.
 * - Non-clipping titles and sanitized preview snippets (no raw markdown or em dashes).
 * - Tactile spring interactions on tap/press (:active scale down).
 * - Instant delete action with accessible hit area.
 */

import React from 'react';
import styles from './ConversationDrawer.module.css';
import { ConversationRecord } from '../services/localDatabase';
import { cleanPreviewSnippet } from '../lib/scrollUtils';

interface ConversationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: ConversationRecord[];
  activeConversationId: string;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
}

export const ConversationDrawer: React.FC<ConversationDrawerProps> = ({
  isOpen,
  onClose,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation
}) => {
  if (!isOpen) return null;

  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;

  const todayList: ConversationRecord[] = [];
  const yesterdayList: ConversationRecord[] = [];
  const earlierList: ConversationRecord[] = [];

  for (const c of conversations) {
    const age = now - c.updatedAt;
    if (age < ONE_DAY) {
      todayList.push(c);
    } else if (age < 2 * ONE_DAY) {
      yesterdayList.push(c);
    } else {
      earlierList.push(c);
    }
  }

  const renderGroup = (title: string, list: ConversationRecord[]) => {
    if (list.length === 0) return null;
    return (
      <div className={styles.group}>
        <div className={styles.groupHeader}>{title}</div>
        <div className={styles.groupList}>
          {list.map((c) => {
            const isActive = c.id === activeConversationId;
            const cleanTitle = cleanPreviewSnippet(c.title || 'Untitled Chat', 60);
            const cleanSnippet = cleanPreviewSnippet(c.lastMessagePreview, 90);

            return (
              <div
                key={c.id}
                className={`${styles.convItem} ${isActive ? styles.active : ''}`}
                onClick={() => {
                  onSelectConversation(c.id);
                  onClose();
                }}
                role="button"
                tabIndex={0}
              >
                <div className={styles.convLeadIcon} aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div className={styles.convContent}>
                  <span className={styles.convTitle}>{cleanTitle}</span>
                  {cleanSnippet && (
                    <span className={styles.convPreview}>{cleanSnippet}</span>
                  )}
                </div>
                <button
                  className={styles.deleteBtn}
                  title="Delete chat"
                  aria-label="Delete chat"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(c.id);
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <aside className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.drawerHeader}>
          <div className={styles.titleRow}>
            <h3 className={styles.drawerTitle}>Conversations</h3>
            {conversations.length > 0 && (
              <span className={styles.countBadge}>{conversations.length}</span>
            )}
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close conversation drawer">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <button
          className={styles.newChatBtn}
          onClick={() => {
            onNewConversation();
            onClose();
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>New Chat</span>
        </button>

        <div className={styles.convContainer}>
          {conversations.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon} aria-hidden="true">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <strong className={styles.emptyTitle}>No Saved Conversations</strong>
              <p className={styles.emptyDesc}>Your chats and questions with ONEE will appear here.</p>
            </div>
          ) : (
            <>
              {renderGroup('Today', todayList)}
              {renderGroup('Yesterday', yesterdayList)}
              {renderGroup('Earlier', earlierList)}
            </>
          )}
        </div>
      </aside>
    </div>
  );
};
