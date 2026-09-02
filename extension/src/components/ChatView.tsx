/*
 * Chat View Component for ONEE.
 *
 * This component handles the student's conversation feed, the dynamic suggestion rail,
 * and the floating ONEE companion avatar.
 *
 * A few important design decisions we made here:
 * 1. On initial mount, we do NOT automatically scroll to the bottom of the chat.
 *    This keeps the initial viewport centered on the Computer Use / browser agent area
 *    so the student can see what the agent is doing.
 * 2. Suggestions are generated dynamically from the verified attendance table
 *    instead of showing static dummy chips.
 * 3. The suggestion rail scrolls horizontally. We capture vertical mouse wheel
 *    events over the rail and convert them into horizontal scrolls so trackpads
 *    and standard mice feel natural without scrolling the chat feed behind it.
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ChatMessage as ChatMessageType, AgentState, AttendanceSummary } from '../shared/types';
import { ChatMessage } from './ChatMessage';
import { OneeCompanion } from './OneeCompanion';
import { generateContextualSuggestions } from '../services/suggestionGenerator';
import styles from './ChatView.module.css';

interface ChatViewProps {
  messages: ChatMessageType[];
  isTyping: boolean;
  onSendMessage: (text: string) => void;
  suggestions?: string[];
  agentState?: AgentState;
  attendance?: AttendanceSummary | null;
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  isTyping,
  onSendMessage,
  suggestions = [],
  agentState,
  attendance
}) => {
  const [inputText, setInputText] = useState<string>('');
  const [canScrollLeft, setCanScrollLeft] = useState<boolean>(false);
  const [canScrollRight, setCanScrollRight] = useState<boolean>(false);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionRailRef = useRef<HTMLDivElement>(null);

  // We track whether the student manually scrolled up so we don't yank their view back
  const isUserScrolledUpRef = useRef<boolean>(false);

  // Guard to preserve the initial viewport at the browser-agent panel on load
  const isInitialMountRef = useRef<boolean>(true);

  /*
   * Find the last user message text so the suggestion generator can offer
   * relevant follow-up questions (e.g. if the user just asked about CSE330).
   */
  const lastUserQuery = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender === 'user') {
        return messages[i].text;
      }
    }
    return null;
  }, [messages]);

  /*
   * Compute dynamic suggestions. If the parent passed custom suggestions, we use them;
   * otherwise, we generate context-aware suggestions directly from the verified attendance data.
   */
  const activeSuggestions = useMemo(() => {
    if (suggestions && suggestions.length > 0) {
      return suggestions;
    }
    return generateContextualSuggestions(attendance || null, lastUserQuery);
  }, [suggestions, attendance, lastUserQuery]);

  /*
   * Track chat scroll position.
   * If the student scrolls up more than 45px, we assume they are reading older
   * messages and temporarily disable auto-scrolling to bottom.
   */
  const handleScroll = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isUserScrolledUpRef.current = distanceToBottom > 45;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    if (isUserScrolledUpRef.current) return;
    const el = messagesContainerRef.current;
    if (!el) return;
    if (behavior === 'smooth') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  /*
   * Only auto-scroll when new messages arrive or while typing, but NEVER on the
   * very first mount when the side panel opens.
   */
  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }

    if (isTyping) {
      requestAnimationFrame(() => scrollToBottom('auto'));
    } else {
      scrollToBottom('smooth');
    }
  }, [messages, isTyping, scrollToBottom]);

  /*
   * Check whether the suggestion rail can be scrolled further left or right.
   * This drives the subtle edge fade indicators so the student knows more chips exist.
   */
  const updateScrollIndicators = useCallback(() => {
    const rail = suggestionRailRef.current;
    if (!rail) return;
    const { scrollLeft, scrollWidth, clientWidth } = rail;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 4);
  }, []);

  useEffect(() => {
    updateScrollIndicators();
  }, [activeSuggestions, updateScrollIndicators]);

  /*
   * Translates vertical mouse wheel scrolling into horizontal scrolling when
   * the pointer is hovering over the suggestion rail.
   * We call preventDefault so the main chat feed doesn't scroll vertically at the same time.
   */
  const handleRailWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    const rail = suggestionRailRef.current;
    if (!rail) return;

    if (e.deltaY !== 0 && !e.shiftKey) {
      e.preventDefault();
      rail.scrollLeft += e.deltaY * 0.85;
      updateScrollIndicators();
    }
  }, [updateScrollIndicators]);

  /*
   * Submitting a message from the composer.
   * Re-enables auto-scroll to bottom since the user just took an explicit action.
   */
  const handleSend = () => {
    if (!inputText.trim() || isTyping) return;
    isUserScrolledUpRef.current = false;
    onSendMessage(inputText.trim());
    setInputText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  /*
   * Clicking a suggestion chip behaves exactly like submitting a typed message.
   */
  const handleSuggestionClick = (chipText: string) => {
    if (isTyping) return;
    isUserScrolledUpRef.current = false;
    onSendMessage(chipText);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 100)}px`;
  };

  return (
    <div className={styles.container}>
      {/* Messages Feed */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className={styles.messagesList}
      >
        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {isTyping && messages[messages.length - 1]?.text === '' && (
          <div className={styles.typingIndicator}>
            <div className={styles.avatar}>
              <span className={styles.avatarInner} />
            </div>
            <div className={styles.typingBubble}>
              <span className={styles.typingDot} />
              <span className={styles.typingDot} />
              <span className={styles.typingDot} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Dynamic Suggestions Rail & Live ONEE Companion Bar */}
      <div className={styles.bottomBar}>
        {activeSuggestions.length > 0 && (
          <div className={styles.suggestionRailContainer}>
            <div className={styles.railHeader}>
              <span className={styles.railLabel}>SUGGESTED</span>
            </div>

            <div className={styles.railWrapper}>
              {/* Left & right edge fade indicators */}
              <div
                className={`${styles.fadeLeft} ${canScrollLeft ? styles.showFade : ''}`}
                aria-hidden="true"
              />
              <div
                className={`${styles.fadeRight} ${canScrollRight ? styles.showFade : ''}`}
                aria-hidden="true"
              />

              <div
                ref={suggestionRailRef}
                className={styles.suggestionRail}
                onScroll={updateScrollIndicators}
                onWheel={handleRailWheel}
                role="region"
                aria-label="Suggested questions"
              >
                {activeSuggestions.map((sug, idx) => (
                  <button
                    key={idx}
                    className={styles.suggestionChip}
                    onClick={() => handleSuggestionClick(sug)}
                    disabled={isTyping}
                  >
                    {sug}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 3D Animated ONEE Interactive Mascot */}
        <div className={styles.companionSlot} title="ONEE Live Companion (Tap to chat)">
          <OneeCompanion
            agentState={agentState}
            attendance={attendance}
            isChatTyping={isTyping || Boolean(inputText.trim())}
            onTapInteract={() => textareaRef.current?.focus()}
          />
        </div>
      </div>

      {/* Composer */}
      <div className={styles.composerWrapper}>
        <div className={styles.composer}>
          <textarea
            ref={textareaRef}
            className={styles.input}
            placeholder="Ask ONEE anything..."
            value={inputText}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isTyping}
            aria-label="Message input"
          />
          <button
            className={`${styles.sendButton} ${inputText.trim() ? styles.sendActive : ''}`}
            onClick={handleSend}
            disabled={!inputText.trim() || isTyping}
            aria-label="Send message"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};
