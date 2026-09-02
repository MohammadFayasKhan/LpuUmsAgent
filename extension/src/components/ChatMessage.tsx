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
import styles from './ChatMessage.module.css';

interface ChatMessageProps {
  message: ChatMessageType;
}

export const ChatMessage: React.FC<ChatMessageProps> = memo(({ message }) => {
  const isUser = message.sender === 'user' || message.role === 'user';
  const textContent = message.text || message.content || '';

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
        <span className={styles.timestamp}>{message.timestamp}</span>
      </div>
    </div>
  );
});

ChatMessage.displayName = 'ChatMessage';
