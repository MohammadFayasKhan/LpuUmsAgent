/*
 * Conversation History Drawer for ONEE.
 *
 * This is a slide-out panel that shows the student's past conversations stored
 * in IndexedDB. Each item shows the conversation title (auto-generated from the
 * first message), a timestamp, and a preview of the last message.
 *
 * Tapping a conversation restores it into the chat view. The "New Chat" button
 * creates a fresh conversationId so previous context doesn't bleed into a new topic.
 *
 * We also show a "Clear All" option that calls localDatabase.clearHistory() to
 * let the student wipe their local data whenever they want.
 */

import React from 'react';
import styles from './ConversationDrawer.module.css';
import { ConversationRecord } from '../services/localDatabase';

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
            return (
              <div
                key={c.id}
                className={`${styles.convItem} ${isActive ? styles.active : ''}`}
                onClick={() => {
                  onSelectConversation(c.id);
                  onClose();
                }}
              >
                <div className={styles.convContent}>
                  <span className={styles.convTitle}>{c.title || 'Untitled Chat'}</span>
                  {c.lastMessagePreview && (
                    <span className={styles.convPreview}>{c.lastMessagePreview}</span>
                  )}
                </div>
                <button
                  className={styles.deleteBtn}
                  title="Delete chat"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(c.id);
                  }}
                >
                  ✕
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
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.drawerHeader}>
          <h3 className={styles.drawerTitle}>Conversations</h3>
          <button className={styles.closeBtn} onClick={onClose}>
            ✕
          </button>
        </div>

        <button
          className={styles.newChatBtn}
          onClick={() => {
            onNewConversation();
            onClose();
          }}
        >
          <span>＋</span>
          <span>New Chat</span>
        </button>

        <div className={styles.convContainer}>
          {conversations.length === 0 ? (
            <div className={styles.emptyNotice}>No saved conversations yet.</div>
          ) : (
            <>
              {renderGroup('Today', todayList)}
              {renderGroup('Yesterday', yesterdayList)}
              {renderGroup('Earlier', earlierList)}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
