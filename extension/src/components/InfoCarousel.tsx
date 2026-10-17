/*
 * ONEE Launch Info Carousel — the upgraded multi-card info sheet.
 *
 * Replaces the single launch modal with a series of three interactive cards:
 *  - ONEE's live companion avatar rides along on every card and tapping it
 *    (or Next, dots, swipe, or arrow keys) advances the flow,
 *  - each transition is a spring-eased slide/fade (iOS sheet motion),
 *  - card copy is dynamic where it can be (time-aware session greeting),
 *  - the final "Get started" card lands the student on the main chat page,
 *    with the full Privacy & Data panel one tap away.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { OneeCompanion } from './OneeCompanion';
import { sessionGreetingLine } from '../lib/greeting';
import { voiceController } from '../voice';
import styles from './InfoCarousel.module.css';

interface InfoCarouselProps {
  /** Called when the student lands on the main page (optionally opening privacy). */
  onClose: (openPrivacy?: boolean) => void;
}

const CARD_COUNT = 3;

const CAPABILITIES: Array<{ icon: string; label: string; hint: string }> = [
  { icon: '📅', label: 'Class timetable', hint: 'Times, rooms & blocks' },
  { icon: '📊', label: 'Attendance & safe bunks', hint: 'Stay above 75%' },
  { icon: '📝', label: 'Exams & datesheet', hint: 'Dates & reporting time' },
  { icon: '🪑', label: 'Seating plan', hint: 'Hall, room & seat' },
  { icon: '📄', label: 'Sample papers', hint: 'Fetched for you' },
  { icon: '👨‍🏫', label: 'Faculty cabins', hint: 'Teachers & cabin details' }
];

export const InfoCarousel: React.FC<InfoCarouselProps> = ({ onClose }) => {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [dragOffset, setDragOffset] = useState(0);
  // Dynamic first-run line: time-aware + rotates per minute, never canned.
  const [greeting] = useState(() => sessionGreetingLine());
  const dragStartRef = useRef<number | null>(null);

  const isLast = index === CARD_COUNT - 1;

  const goTo = useCallback((next: number) => {
    setIndex((current) => {
      const clamped = Math.max(0, Math.min(next, CARD_COUNT - 1));
      if (clamped !== current) {
        setDirection(clamped > current ? 1 : -1);
      }
      return clamped;
    });
  }, []);

  const goNext = useCallback(() => setIndex((current) => {
    if (current < CARD_COUNT - 1) {
      setDirection(1);
      return current + 1;
    }
    return current;
  }), []);

  const goPrev = useCallback(() => setIndex((current) => {
    if (current > 0) {
      setDirection(-1);
      return current - 1;
    }
    return current;
  }), []);

  // Keyboard navigation: arrows move between cards.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev]);

  // Pointer swipe: drag left for next, right for back (iOS paging feel).
  const handlePointerDown = (e: React.PointerEvent) => {
    dragStartRef.current = e.clientX;
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (dragStartRef.current === null) return;
    setDragOffset(e.clientX - dragStartRef.current);
  };
  const handlePointerEnd = () => {
    if (dragStartRef.current !== null) {
      if (dragOffset > 64) goPrev();
      else if (dragOffset < -64) goNext();
    }
    dragStartRef.current = null;
    setDragOffset(0);
  };

  const cardLines: Record<number, string> = {
    0: greeting,
    1: 'Timetable, attendance, exams → just ask, by voice or text.',
    2: 'Your data stays on your device. Ready when you are.'
  };

  /*
   * TTS twin of each bubble — no arrows or symbols, reads as natural speech.
   * Card 1's greeting is already voiced once at launch by playSessionGreeting,
   * so the carousel speaks only on an actual card transition, never on mount.
   */
  const spokenLines: Record<number, string> = {
    0: greeting.replace(/\s*→\s*/g, '. '),
    1: 'Timetable, attendance, exams. Just ask, by voice or text.',
    2: 'Your data stays on your device. Ready when you are.'
  };

  const spokenIndexRef = useRef<number>(0);
  const hasSpokenRef = useRef<boolean>(false);

  useEffect(() => {
    if (spokenIndexRef.current === index) return;
    spokenIndexRef.current = index;
    hasSpokenRef.current = true;
    // Barge-in semantics: cut the previous card's line, voice the new one.
    voiceController.stopSpeaking();
    voiceController.speakText(spokenLines[index]);
  }, [index]);

  // Never let an intro line bleed into the main chat after the sheet closes.
  useEffect(() => () => {
    if (hasSpokenRef.current) voiceController.stopSpeaking();
  }, []);

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Welcome to ONEE">
      <div
        className={styles.sheet}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <button
          type="button"
          className={styles.skipButton}
          onClick={() => onClose(false)}
          aria-label="Skip introduction"
        >
          Skip
        </button>

        {/* ONEE rides along on every card — tapping the mascot advances. */}
        <div className={styles.avatarSlot}>
          <button
            type="button"
            className={styles.avatarButton}
            onClick={isLast ? () => onClose(false) : goNext}
            aria-label={isLast ? 'Get started with ONEE' : 'Next card'}
            title={isLast ? 'Get started' : 'Tap ONEE for next card'}
          >
            <OneeCompanion size={92} showCaption={false} interactive={false} />
          </button>
          <div className={styles.speechBubble} key={`bubble-${index}`}>
            <span className={styles.speechText}>{cardLines[index]}</span>
            <span className={styles.speechTail} aria-hidden="true" />
          </div>
        </div>

        {/* Card viewport — spring slide/fade between cards */}
        <div className={styles.cardViewport}>
          <div
            key={index}
            className={styles.cardTrack}
            style={
              {
                // Direction of the enter animation only — the track itself must
                // rest at translateX(0) or the card sits off-center and gets
                // clipped by the viewport's overflow: hidden.
                '--enter-x': `${direction * 24}px`,
                transform: dragOffset !== 0 ? `translateX(${dragOffset * 0.4}px)` : undefined,
                opacity: dragOffset !== 0 ? 0.85 : undefined
              } as React.CSSProperties
            }
          >
            {index === 0 && (
              <div className={styles.card}>
                <h2 className={styles.title}>Meet ONEE</h2>
                <p className={styles.body}>
                  Your LPU academic companion, connected to your UMS portal. Ask in
                  plain language or just speak → ONEE answers from verified records
                  only.
                </p>
              </div>
            )}

            {index === 1 && (
              <div className={styles.card}>
                <h2 className={styles.title}>Everything you need</h2>
                <div className={styles.chipGrid}>
                  {CAPABILITIES.map((cap, i) => (
                    <div
                      key={cap.label}
                      className={styles.chip}
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <span className={styles.chipIcon}>{cap.icon}</span>
                      <span className={styles.chipLabel}>{cap.label}</span>
                      <span className={styles.chipHint}>{cap.hint}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {index === 2 && (
              <div className={styles.card}>
                <h2 className={styles.title}>Private by design</h2>
                <p className={styles.body}>
                  Your conversation and metrics stay in local extension storage.
                  Clear them anytime → ONEE never sells or uploads your data.
                </p>
                <button
                  type="button"
                  className={styles.privacyLink}
                  onClick={() => onClose(true)}
                >
                  Review privacy &amp; local data →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Progress dots — clickable */}
        <div className={styles.dots} role="tablist" aria-label="Intro progress">
          {Array.from({ length: CARD_COUNT }).map((_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Card ${i + 1} of ${CARD_COUNT}`}
              className={`${styles.dot} ${i === index ? styles.dotActive : ''}`}
              onClick={() => goTo(i)}
            />
          ))}
        </div>

        {/* Actions */}
        <div className={styles.actions}>
          {index > 0 && (
            <button type="button" className={styles.backButton} onClick={goPrev}>
              Back
            </button>
          )}
          {!isLast ? (
            <button type="button" className={styles.nextButton} onClick={goNext}>
              Next
            </button>
          ) : (
            <button
              type="button"
              className={styles.nextButton}
              onClick={() => onClose(false)}
              autoFocus
            >
              Get started
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default InfoCarousel;
