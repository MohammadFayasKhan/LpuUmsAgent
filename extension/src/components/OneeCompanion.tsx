/*
 * ONEE Live Companion Component.
 *
 * This component renders our 3D interactive avatar and speech bubble beside the chat.
 * Instead of running its own mock timers or guessing what the agent is doing,
 * it derives its animation, facial expression, and speech popup directly from
 * runtimeState (the single source of truth for the extension).
 *
 * If the user taps ONEE while idle, we focus the chat input so they can start typing.
 * If they tap while an agent action is running, we show what it's currently doing
 * instead of accidentally starting a duplicate task.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AvatarController } from './AvatarController';
import { AvatarRefHandle, AnimationKey } from '../types/avatar';
import { AgentState, AttendanceSummary } from '../shared/types';
import { runtimeState, DerivedOneeState } from '../lib/runtimeState';
import styles from './OneeCompanion.module.css';

interface OneeCompanionProps {
  agentState?: AgentState;
  attendance?: AttendanceSummary | null;
  isChatTyping?: boolean;
  className?: string;
  size?: number;
  showCaption?: boolean;
  interactive?: boolean;
  onTapInteract?: () => void;
}

export const OneeCompanion: React.FC<OneeCompanionProps> = ({
  agentState,
  attendance,
  isChatTyping = false,
  className = '',
  size = 76,
  showCaption = true,
  interactive = true,
  onTapInteract
}) => {
  const avatarRef = useRef<AvatarRefHandle>(null);
  const [currentAnim, setCurrentAnim] = useState<AnimationKey>('idle');
  const [caption, setCaption] = useState<string | null>('Ready ✨');
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const explicitTimerRef = useRef<any>(null);

  /*
   * Keep runtimeState updated with the latest props from the parent view.
   * This pushes agent execution and attendance numbers into the central state.
   */
  useEffect(() => {
    runtimeState.update({
      agentState: agentState || null,
      attendance: attendance || null,
      isUserTyping: isChatTyping
    });
  }, [agentState, attendance, isChatTyping]);

  /*
   * Subscribe to the central state manager.
   * We get a clean derived state that tells us exactly which animation and
   * expression to play, avoiding contradictory states (like the avatar celebrating
   * while the agent is still searching for the table).
   */
  useEffect(() => {
    const unsubscribe = runtimeState.subscribe((derived: DerivedOneeState) => {
      setCurrentAnim(derived.animation);
      setIsBusy(derived.isBusy);

      if (avatarRef.current) {
        avatarRef.current.play(derived.animation);
        if (derived.expression) {
          avatarRef.current.setExpression(derived.expression);
        }
      }

      if (showCaption) {
        setCaption(derived.popupMessage);
      }
    });

    return () => {
      unsubscribe();
      if (explicitTimerRef.current) clearTimeout(explicitTimerRef.current);
    };
  }, [showCaption]);

  /*
   * Handle student tapping on the companion.
   * If an agent task is already running, we expose the current status so the
   * student knows ONEE is busy. If idle, we focus the chat input.
   */
  const handleTap = useCallback(() => {
    if (!interactive) return;

    runtimeState.recordInteraction();

    if (isBusy && agentState) {
      const activeReason = agentState.currentAction?.reason || 'Checking UMS...';
      const cleanReason = activeReason.replace(/^→\s*/, '').slice(0, 20);
      setCaption(cleanReason);

      if (explicitTimerRef.current) clearTimeout(explicitTimerRef.current);
      explicitTimerRef.current = setTimeout(() => {
        setCaption(runtimeState.getDerivedState().popupMessage);
      }, 2500);
      return;
    }

    // When idle, transition to listening and focus the chat composer
    if (avatarRef.current) {
      avatarRef.current.setExpression('attentive-left');
      avatarRef.current.play('listening', 3000);
    }

    setCaption('How can I help?');
    if (explicitTimerRef.current) clearTimeout(explicitTimerRef.current);
    explicitTimerRef.current = setTimeout(() => {
      setCaption(runtimeState.getDerivedState().popupMessage);
    }, 2800);

    onTapInteract?.();
  }, [interactive, isBusy, agentState, onTapInteract]);

  /*
   * Subtle hover affordance so students notice that ONEE is interactive.
   */
  const handleMouseEnter = useCallback(() => {
    if (!interactive || isBusy) return;
    if (avatarRef.current) {
      avatarRef.current.setExpression('curious-left');
    }
  }, [interactive, isBusy]);

  const handleMouseLeave = useCallback(() => {
    if (!interactive || isBusy) return;
    if (avatarRef.current) {
      avatarRef.current.setExpression('neutral');
    }
  }, [interactive, isBusy]);

  return (
    <div
      className={`${styles.companionContainer} ${className}`}
      style={{ width: `${size}px` }}
    >
      {showCaption && caption && (
        <div className={styles.captionBubble} role="status">
          <span className={styles.captionArrow} />
          <span className={styles.captionText}>{caption}</span>
        </div>
      )}

      <div
        className={styles.avatarWrapper}
        onClick={handleTap}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        title={isBusy ? 'ONEE is working...' : 'Tap to interact with ONEE'}
        style={{ width: `${size}px`, height: `${size}px` }}
      >
        <AvatarController
          ref={avatarRef}
          animation={currentAnim}
          size={size}
          interactive={interactive}
          className={styles.avatar}
        />
        <span className={styles.pulseRing} />
        <div className={styles.ambientGlow} />
      </div>
    </div>
  );
};
