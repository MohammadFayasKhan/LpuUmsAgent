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
import { ChatMessage as ChatMessageType, AgentState, AttendanceSummary, ExaminationSummary, TimetableSummary } from '../shared/types';
import { ChatMessage } from './ChatMessage';
import { AvatarController } from './AvatarController';
import { OneeCompanion } from './OneeCompanion';
import { generateContextualSuggestions } from '../services/suggestionGenerator';
import { useVoiceAgent, audioController } from '../voice';
import styles from './ChatView.module.css';

/**
 * Aesthetic pre-response reasoning phrases shown in the thinking bar while
 * the pipeline resolves intent / runs the browser agent / composes the
 * verified answer. Visual only — these states are never spoken and never
 * contain internal diagnostics.
 */
const THINKING_PHRASES = [
  'Understanding your question…',
  'Reasoning through the details…',
  'Gathering verified results…',
  'Composing your response…'
];

interface ChatViewProps {
  messages: ChatMessageType[];
  isTyping: boolean;
  onSendMessage: (text: string) => void;
  suggestions?: string[];
  agentState?: AgentState;
  attendance?: AttendanceSummary | null;
  examination?: ExaminationSummary | null;
  timetable?: TimetableSummary | null;
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
  timetable,
  scrollContainerRef
}) => {
  const [inputText, setInputText] = useState<string>('');
  const [canScrollLeft, setCanScrollLeft] = useState<boolean>(false);
  const [canScrollRight, setCanScrollRight] = useState<boolean>(false);
  const [thinkPhraseIdx, setThinkPhraseIdx] = useState<number>(0);

  // Thinking bar is visible while ONEE is working on a reply that has not
  // produced its first character yet.
  const showThinkingBar =
    isTyping && (messages.length === 0 || (messages[messages.length - 1]?.text || '') === '');

  useEffect(() => {
    if (!showThinkingBar) return;
    setThinkPhraseIdx(0);
    const timer = setInterval(() => {
      setThinkPhraseIdx((i) => (i + 1) % THINKING_PHRASES.length);
    }, 1700);
    return () => clearInterval(timer);
  }, [showThinkingBar]);

  const {
    voiceState,
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
   * Find the last assistant response text so the suggestion generator can offer
   * relevant next actions (e.g. after leave simulation or critical course alerts).
   */
  const lastAssistantResponse = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender === 'onee' && messages[i].text) {
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
    return generateContextualSuggestions(
      attendance || null,
      lastUserQuery,
      examination || null,
      timetable || null,
      lastAssistantResponse
    );
  }, [suggestions, attendance, lastUserQuery, examination, timetable, lastAssistantResponse]);


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
    const clientX = typeof e.clientX === 'number' ? e.clientX : (e as any).pageX || 0;
    pointerStartXRef.current = clientX;
    pointerStartScrollLeftRef.current = rail.scrollLeft || 0;
    // NOTE: DO NOT call setPointerCapture here! Calling setPointerCapture on the container
    // during pointerdown retargets subsequent pointerup/click events to the container,
    // which completely breaks React onClick handlers on child suggestion chip buttons!
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current) return;
    const rail = suggestionRailRef.current;
    if (!rail) return;
    const clientX = typeof e.clientX === 'number' ? e.clientX : (e as any).pageX || 0;
    const dx = clientX - pointerStartXRef.current;
    // Require at least 8px intentional horizontal movement before treating as drag gesture
    if (Math.abs(dx) > 8) {
      if (!hasDraggedRef.current) {
        hasDraggedRef.current = true;
        try {
          if (typeof rail.hasPointerCapture === 'function' && !rail.hasPointerCapture(e.pointerId)) {
            rail.setPointerCapture(e.pointerId);
          }
        } catch {}
      }
      rail.scrollLeft = pointerStartScrollLeftRef.current - dx;
      updateScrollIndicators();
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current) return;
    isPointerDownRef.current = false;
    const rail = suggestionRailRef.current;
    if (rail) {
      try {
        if (typeof rail.hasPointerCapture === 'function' && rail.hasPointerCapture(e.pointerId)) {
          rail.releasePointerCapture(e.pointerId);
        }
      } catch {}
    }
    // If the user performed an intentional drag, keep hasDraggedRef true briefly to swallow the synthetic click
    if (hasDraggedRef.current) {
      setTimeout(() => {
        hasDraggedRef.current = false;
      }, 100);
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    isPointerDownRef.current = false;
    const rail = suggestionRailRef.current;
    if (rail) {
      try {
        if (typeof rail.hasPointerCapture === 'function' && rail.hasPointerCapture(e.pointerId)) {
          rail.releasePointerCapture(e.pointerId);
        }
      } catch {}
    }
    hasDraggedRef.current = false;
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
   * Smooth horizontal scrolling for chevron arrow controls
   */
  const scrollRail = useCallback(
    (direction: 'left' | 'right') => {
      const rail = suggestionRailRef.current;
      if (!rail) return;
      const scrollAmount = Math.max(140, Math.floor(rail.clientWidth * 0.75));
      rail.scrollBy({ left: direction === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' });
      setTimeout(updateScrollIndicators, 220);
    },
    [updateScrollIndicators]
  );

  /*
   * Mic activation must NEVER yank the student's reading position.
   *
   * The old one-shot restore ran a single frame AFTER `await toggleListening()`
   * and was skipped entirely when parked at the bottom — so any layout commit,
   * focus scroll, or voice-bar insertion that landed after that frame yanked the
   * panel to the top with nothing to correct it. The pin below:
   *  - starts BEFORE the async activation begins,
   *  - re-resolves the live container each tick (survives re-renders),
   *  - keeps restoring for a short window that covers delayed layout commits,
   *  - releases early the moment the student scrolls themselves.
   */
  const handleMicPress = useCallback(async () => {
    const container = getScrollContainer();
    const prevTop = container ? container.scrollTop : null;
    const nearBottom = container
      ? container.scrollHeight - container.scrollTop - container.clientHeight < 80
      : true;

    if (prevTop === null) {
      await toggleListening();
      return;
    }

    if (!nearBottom) {
      isUserScrolledUpRef.current = true;
    }

    let pinned = true;
    const releasePin = () => {
      pinned = false;
    };
    const restore = () => {
      if (!pinned) return;
      const live = getScrollContainer();
      if (live && Math.abs(live.scrollTop - prevTop) > 1) {
        live.scrollTop = prevTop;
      }
    };

    // The student always wins: any wheel/drag scroll releases the pin at once.
    const liveForEvents = getScrollContainer();
    liveForEvents?.addEventListener('wheel', releasePin, { passive: true });
    liveForEvents?.addEventListener('touchmove', releasePin, { passive: true });

    restore();
    const restoreInterval = setInterval(restore, 120);
    const restoreFrame = requestAnimationFrame(restore);

    try {
      await toggleListening();
    } finally {
      // Keep pinning briefly AFTER activation: voice-bar mount, focus changes,
      // and interim-transcript growth all land in this window. Then stand down.
      setTimeout(() => {
        pinned = false;
        clearInterval(restoreInterval);
        cancelAnimationFrame(restoreFrame);
        const live = getScrollContainer();
        live?.removeEventListener('wheel', releasePin);
        live?.removeEventListener('touchmove', releasePin);
      }, 900);
    }
  }, [getScrollContainer, toggleListening]);

  /*
   * Submitting a message from the composer.
   */
  const handleSend = () => {
    if (!inputText.trim() || isTyping) return;
    audioController.unlockAudio().catch(() => {});
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
      return;
    }
    if (isTyping) return;
    audioController.unlockAudio().catch(() => {});
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

        {showThinkingBar && (
          <div
            className={styles.thinkingRow}
            role="status"
            aria-live="polite"
            aria-label="ONEE is thinking"
          >
            {/* Cute little ONEE bot, alive while reasoning */}
            <div className={styles.thinkingBot}>
              <AvatarController size={26} animation="thinking" interactive={false} />
            </div>

            <div className={styles.thinkingPanel}>
              <div className={styles.thinkingTextRow}>
                <span key={thinkPhraseIdx} className={styles.thinkingPhrase}>
                  {THINKING_PHRASES[thinkPhraseIdx]}
                </span>
                <span className={styles.thinkingDots} aria-hidden="true">
                  <span className={styles.thinkingDot} />
                  <span className={styles.thinkingDot} />
                  <span className={styles.thinkingDot} />
                </span>
              </div>
              <div className={styles.thinkingShimmerTrack} aria-hidden="true">
                <div className={styles.thinkingShimmer} />
              </div>
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

              {canScrollLeft && (
                <button
                  type="button"
                  className={styles.railScrollButtonLeft}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    scrollRail('left');
                  }}
                  aria-label="Scroll suggestions left"
                  title="Scroll suggestions left"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              )}

              {canScrollRight && (
                <button
                  type="button"
                  className={styles.railScrollButtonRight}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    scrollRail('right');
                  }}
                  aria-label="Scroll suggestions right"
                  title="Scroll suggestions right"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              )}

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
                    type="button"
                    className={styles.suggestionChip}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleSuggestionClick(sug);
                    }}
                    disabled={isTyping}
                    title={sug}
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
            size={activeSuggestions.length > 0 ? 44 : 56}
            showCaption={activeSuggestions.length === 0}
            onTapInteract={() => textareaRef.current?.focus()}
          />
        </div>
      </div>

      {/* Composer */}
      <div className={styles.composerWrapper}>
        {/*
          The voice bar is ALWAYS mounted and floats as an overlay above the
          composer. It used to mount/unmount above the composer, changing the
          whole composer height on every mic press and yanking the scroll
          position — the "flicker" seen on the second voice question. Overlay
          + CSS transition = zero layout shift on press 1, 2, or N.
        */}
        <div
          className={`${styles.voiceBar} ${
            isListening || isSpeaking || interimTranscript || voiceState === 'TRANSCRIBING'
              ? ''
              : styles.voiceBarHidden
          }`}
        >
          <div className={styles.voiceWave}>
            <span className={styles.voiceBarDot} />
            <span className={styles.voiceBarDot} />
            <span className={styles.voiceBarDot} />
          </div>
          <span className={styles.voiceStatusText}>
            {interimTranscript
              ? interimTranscript
              : isSpeaking
              ? 'Speaking... (click mic to interrupt)'
              : voiceState === 'TRANSCRIBING'
              ? 'Processing your speech...'
              : 'Listening... speak naturally'}
          </span>
        </div>

        <div className={styles.composer}>
          <textarea
            ref={textareaRef}
            className={styles.input}
            placeholder={
              voiceState === 'TRANSCRIBING'
                ? 'Processing your speech...'
                : isListening
                ? 'Listening to your voice...'
                : 'Ask ONEE anything or speak...'
            }
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
            onClick={handleMicPress}
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
