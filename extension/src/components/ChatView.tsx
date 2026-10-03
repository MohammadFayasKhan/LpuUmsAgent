/*
 * Chat View Component for ONEE.
 *
 * This component handles the student's conversation feed, the dynamic suggestion rail,
 * and the floating ONEE companion avatar.
 *
 * Design choices & engineering details:
 * 1. On initial mount, we do NOT automatically scroll to the bottom of the chat.
 *    This keeps the initial viewport centered on the Computer Use / browser agent area
 *    so the student can see what the agent is doing.
 * 2. Dynamic suggestions are derived from verified attendance and examination data.
 * 3. The suggestion rail is a smooth, high-fidelity horizontal interaction surface:
 *    - Trackpad 2-finger horizontal scrolling
 *    - Mouse wheel conversion (vertical wheel -> horizontal scroll) via non-passive listener
 *      with preventDefault() to strictly isolate from sidepanel vertical scroll
 *    - Click-and-drag / pointer dragging with drag distance threshold
 *    - Touch swipe with momentum (-webkit-overflow-scrolling: touch; touch-action: pan-x)
 *    - Keyboard navigation (ArrowLeft / ArrowRight) when focused
 *    - ResizeObserver overflow detection for edge fades
 *    - Preserves horizontal scroll position without re-rendering during streaming
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ChatMessage as ChatMessageType, AgentState, AttendanceSummary, ExaminationSummary } from '../shared/types';
import { ChatMessage } from './ChatMessage';
import { OneeCompanion } from './OneeCompanion';
import { generateContextualSuggestions } from '../services/suggestionGenerator';
import { useVoiceAgent } from '../voice';
import styles from './ChatView.module.css';

interface ChatViewProps {
  messages: ChatMessageType[];
  isTyping: boolean;
  onSendMessage: (text: string) => void;
  suggestions?: string[];
  agentState?: AgentState;
  attendance?: AttendanceSummary | null;
  examination?: ExaminationSummary | null;
  scrollContainerRef?: React.RefObject<HTMLElement | null>;
}

export const ChatView: React.FC<ChatViewProps> = ({
  messages,
  isTyping,
  onSendMessage,
  suggestions = [],
  agentState,
  attendance,
  examination,
  scrollContainerRef
}) => {
  const [inputText, setInputText] = useState<string>('');
  const [canScrollLeft, setCanScrollLeft] = useState<boolean>(false);
  const [canScrollRight, setCanScrollRight] = useState<boolean>(false);

  const {
    interimTranscript,
    isListening,
    isSpeaking,
    toggleListening
  } = useVoiceAgent();

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const suggestionRailRef = useRef<HTMLDivElement>(null);

  // We track whether the student manually scrolled up so we don't yank their view back
  const isUserScrolledUpRef = useRef<boolean>(false);

  // Guard to preserve the initial viewport at the browser-agent panel on load
  const isInitialMountRef = useRef<boolean>(true);

  // Pointer drag state for suggestions rail
  const isPointerDownRef = useRef<boolean>(false);
  const pointerStartXRef = useRef<number>(0);
  const pointerStartScrollLeftRef = useRef<number>(0);
  const hasDraggedRef = useRef<boolean>(false);

  /*
   * Find the last user message text so the suggestion generator can offer
   * relevant follow-up questions (e.g. if the user just asked about a specific exam/course).
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
   * Compute dynamic suggestions from verified attendance and examination dataset.
   */
  const activeSuggestions = useMemo(() => {
    if (suggestions && suggestions.length > 0) {
      return suggestions;
    }
    return generateContextualSuggestions(attendance || null, lastUserQuery, examination || null);
  }, [suggestions, attendance, lastUserQuery, examination]);


  const getScrollContainer = useCallback(() => {
    return (
      scrollContainerRef?.current ||
      messagesEndRef.current?.closest('main') ||
      (document.querySelector('main') as HTMLElement | null)
    );
  }, [scrollContainerRef]);

  /*
   * Track user scroll intent.
   * If the student actively wheels or drags upwards, pause auto-scrolling so they
   * can read older messages without viewport fighting.
   * When they scroll back down near bottom (<50px) or when a new message/question begins,
   * re-engage auto-scrolling.
   */
  useEffect(() => {
    const container = getScrollContainer();
    if (!container) return;

    let isUserInteracting = false;
    let interactionTimer: ReturnType<typeof setTimeout>;

    const markUserInteraction = () => {
      isUserInteracting = true;
      clearTimeout(interactionTimer);
      interactionTimer = setTimeout(() => {
        isUserInteracting = false;
      }, 400);
    };

    const onWheel = (e: WheelEvent) => {
      markUserInteraction();
      if (e.deltaY < -2) {
        // User explicitly wheeled up
        isUserScrolledUpRef.current = true;
      } else if (e.deltaY > 2) {
        const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (distanceToBottom < 60) {
          isUserScrolledUpRef.current = false;
        }
      }
    };

    const onTouchMove = () => {
      markUserInteraction();
    };

    const onScroll = () => {
      const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (distanceToBottom < 45) {
        isUserScrolledUpRef.current = false;
      } else if (isUserInteracting && distanceToBottom > 80) {
        isUserScrolledUpRef.current = true;
      }
    };

    container.addEventListener('wheel', onWheel, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: true });
    container.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('scroll', onScroll);
      clearTimeout(interactionTimer);
    };
  }, [getScrollContainer]);

  /*
   * Re-engage auto-scroll lock whenever typing begins or a new user message is dispatched.
   */
  useEffect(() => {
    if (isTyping) {
      isUserScrolledUpRef.current = false;
    }
  }, [isTyping]);

  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && (lastMsg.sender === 'user' || lastMsg.isStreaming)) {
      isUserScrolledUpRef.current = false;
    }
  }, [messages]);

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      if (isUserScrolledUpRef.current) return;
      const container = getScrollContainer();
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior });
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
      }
    },
    [getScrollContainer]
  );

  /*
   * Fluid critically-damped spring follow-through while ONEE is generating a response.
   * Runs at 60 FPS in requestAnimationFrame:
   *  - Rapidly glides down to the chatbot from anywhere on the page when asked.
   *  - Continuously follows every line/paragraph of text as it unfolds in real time.
   *  - Pauses gently if the user manually wheels up, and re-engages seamlessly.
   */
  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }

    if (!isTyping) {
      // Once typing finishes, perform a gentle smooth settle
      if (!isUserScrolledUpRef.current) {
        requestAnimationFrame(() => scrollToBottom('smooth'));
      }
      return;
    }

    let animId: number;

    const followStream = () => {
      if (!isUserScrolledUpRef.current) {
        const container = getScrollContainer();
        if (container) {
          const current = container.scrollTop;
          const target = container.scrollHeight - container.clientHeight;
          const diff = target - current;

          if (diff > 1) {
            // Apple critically-damped spring step:
            // Fast glide down when far, smooth line-by-line follow when close
            const step = Math.max(1, Math.ceil(diff * 0.18));
            container.scrollTop = current + step;
          }
        }
      }
      animId = requestAnimationFrame(followStream);
    };

    animId = requestAnimationFrame(followStream);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isTyping, getScrollContainer, scrollToBottom]);

  /*
   * Check whether the suggestion rail can be scrolled further left or right.
   * Drives the edge fade indicators so the student knows more chips exist.
   */
  const updateScrollIndicators = useCallback(() => {
    const rail = suggestionRailRef.current;
    if (!rail) return;
    const { scrollLeft, scrollWidth, clientWidth } = rail;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 4);
  }, []);

  /*
   * ResizeObserver to observe rail dimensions and child changes for overflow detection.
   */
  useEffect(() => {
    const rail = suggestionRailRef.current;
    if (!rail) return;

    updateScrollIndicators();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        updateScrollIndicators();
      });
      observer.observe(rail);
      return () => observer.disconnect();
    }
  }, [updateScrollIndicators, activeSuggestions]);

  /*
   * Translates vertical mouse wheel scrolling into horizontal scrolling when
   * hovering over the suggestion rail, using a non-passive native listener.
   * Prevents hijacking the main sidepanel vertical scroll.
   */
  useEffect(() => {
    const rail = suggestionRailRef.current;
    if (!rail) return;

    const onWheel = (e: WheelEvent) => {
      // If native horizontal trackpad scroll (deltaX) is active, let it scroll naturally
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        updateScrollIndicators();
        return;
      }

      if (e.deltaY !== 0) {
        const canScrollLeftMore = rail.scrollLeft > 2;
        const canScrollRightMore = rail.scrollLeft < rail.scrollWidth - rail.clientWidth - 2;

        if ((e.deltaY > 0 && canScrollRightMore) || (e.deltaY < 0 && canScrollLeftMore)) {
          e.preventDefault();
          e.stopPropagation();
          rail.scrollLeft += e.deltaY * 0.9;
          updateScrollIndicators();
        }
      }
    };

    rail.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      rail.removeEventListener('wheel', onWheel);
    };
  }, [updateScrollIndicators]);

  /*
   * Pointer Drag Interaction (Click-and-drag horizontal panning)
   */
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const rail = suggestionRailRef.current;
    if (!rail) return;
    isPointerDownRef.current = true;
    hasDraggedRef.current = false;
    pointerStartXRef.current = e.clientX;
    pointerStartScrollLeftRef.current = rail.scrollLeft;
    try {
      rail.setPointerCapture(e.pointerId);
    } catch {}
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current) return;
    const rail = suggestionRailRef.current;
    if (!rail) return;
    const dx = e.clientX - pointerStartXRef.current;
    if (Math.abs(dx) > 5) {
      hasDraggedRef.current = true;
    }
    rail.scrollLeft = pointerStartScrollLeftRef.current - dx;
    updateScrollIndicators();
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current) return;
    isPointerDownRef.current = false;
    const rail = suggestionRailRef.current;
    if (rail) {
      try {
        rail.releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    isPointerDownRef.current = false;
    const rail = suggestionRailRef.current;
    if (rail) {
      try {
        rail.releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  /*
   * Keyboard Arrow navigation when rail is focused
   */
  const handleRailKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const rail = suggestionRailRef.current;
    if (!rail) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      rail.scrollBy({ left: 140, behavior: 'smooth' });
      setTimeout(updateScrollIndicators, 180);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      rail.scrollBy({ left: -140, behavior: 'smooth' });
      setTimeout(updateScrollIndicators, 180);
    }
  };

  /*
   * Submitting a message from the composer.
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
   * Clicking a suggestion chip behaves like submitting a typed message,
   * but ignores clicks if the user was performing a drag-scroll gesture.
   */
  const handleSuggestionClick = (chipText: string) => {
    if (hasDraggedRef.current) {
      hasDraggedRef.current = false;
      return;
    }
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
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                onKeyDown={handleRailKeyDown}
                tabIndex={0}
                role="region"
                aria-label="Suggested questions"
              >
                {activeSuggestions.map((sug, idx) => (
                  <button
                    key={`${sug}-${idx}`}
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
        {(isListening || isSpeaking || interimTranscript) && (
          <div className={styles.voiceBar}>
            <div className={styles.voiceWave}>
              <span className={styles.voiceBarDot} />
              <span className={styles.voiceBarDot} />
              <span className={styles.voiceBarDot} />
            </div>
            <span className={styles.voiceStatusText}>
              {interimTranscript ? interimTranscript : isSpeaking ? 'ONEE is speaking... (click mic to interrupt)' : 'Listening... speak naturally'}
            </span>
          </div>
        )}

        <div className={styles.composer}>
          <textarea
            ref={textareaRef}
            className={styles.input}
            placeholder={isListening ? 'Listening to your voice...' : 'Ask ONEE anything or speak...'}
            value={inputText}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isTyping}
            aria-label="Message input"
          />

          {/* Voice Input & Barge-in Control */}
          <button
            className={`${styles.micButton} ${isListening ? styles.micListening : isSpeaking ? styles.micSpeaking : ''}`}
            onClick={toggleListening}
            title={isListening ? 'Stop listening' : isSpeaking ? 'Stop speaking (Barge-in)' : 'Speak with ONEE (Voice Agent)'}
            aria-label={isListening ? 'Stop listening' : 'Voice input'}
            type="button"
          >
            {isListening ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : isSpeaking ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            )}
          </button>

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
