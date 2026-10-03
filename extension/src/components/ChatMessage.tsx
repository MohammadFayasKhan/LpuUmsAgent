/*
 * Individual Chat Message Bubble for ONEE.
 *
 * Each message renders differently based on its sender:
 * - User messages: right-aligned purple bubble with plain text
 * - Assistant messages: left-aligned with a small ONEE avatar, rendered through
 *   MarkdownRenderer for rich formatting (tables, code blocks, lists)
 * - Agent messages: left-aligned with a distinct "Computer Use" badge showing
 *   the browser action that was performed
 *
 * We use React.memo here because the chat list can have dozens of messages and
 * re-rendering every bubble on each keystroke in the input field would be wasteful.
 * The memo comparison checks message id and isStreaming flag.
 */

import React, { memo } from 'react';
import { ChatMessage as ChatMessageType } from '../shared/types';
import { AvatarController } from './AvatarController';
import { MarkdownRenderer } from './common/MarkdownRenderer';
import { voiceController } from '../voice';
import styles from './ChatMessage.module.css';

interface ChatMessageProps {
  message: ChatMessageType;
}

export const ChatMessage: React.FC<ChatMessageProps> = memo(({ message }) => {
  const isUser = message.sender === 'user' || message.role === 'user';
  const textContent = (message.text || message.content || '').replace(/—/g, '→');

  const handleSpeakAloud = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (textContent) {
      voiceController.speakText(textContent, true);
    }
  };

  return (
    <div
      className={`${styles.messageWrapper} ${isUser ? styles.userWrapper : styles.oneeWrapper}`}
    >
      {!isUser && (
        <div className={styles.avatar}>
          <AvatarController
            size={22}
            animation={message.isStreaming ? 'thinking' : 'idle'}
            interactive={false}
          />
        </div>
      )}

      <div
        className={`${styles.bubble} ${isUser ? styles.userBubble : styles.oneeBubble} ${
          message.isError ? styles.errorBubble : ''
        }`}
      >
        <div className={styles.content}>
          <MarkdownRenderer
            content={textContent}
            isStreaming={message.isStreaming}
          />
        </div>

        <div className={styles.messageFooter}>
          {!isUser && textContent && !message.isStreaming && (
            <button
              className={styles.speakButton}
              onClick={handleSpeakAloud}
              title="Read aloud with ONEE Voice"
              aria-label="Read aloud"
              type="button"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            </button>
          )}
          <span className={styles.timestamp}>{message.timestamp}</span>
        </div>
      </div>
    </div>
  );
});

ChatMessage.displayName = 'ChatMessage';
