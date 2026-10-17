/*
 * Side Panel Header Bar for ONEE.
 *
 * The header sits at the top of the side panel and contains:
 * 1. The ONEE companion avatar (OneeCompanion) with its speech bubble
 * 2. The UMS connection status indicator
 * 3. A conversation history toggle button
 * 4. A privacy/settings gear button
 *
 * The header adapts to sidebar width using responsive sizing. The ONEE avatar
 * scales via clamp() values defined in OneeCompanion.module.css so it looks
 * proportional whether the panel is 320px or 600px wide.
 */

import React from 'react';
import { ConnectionStatus, AgentState } from '../shared/types';
import { RuntimeConnectionState } from '../services/connectionManager';
import { OneeCompanion } from './OneeCompanion';
import { useVoiceAgent, audioController, voiceController } from '../voice';
import styles from './Header.module.css';

interface HeaderProps {
  status: ConnectionStatus;
  runtimeState?: RuntimeConnectionState;
  agentState?: AgentState;
  isChatTyping?: boolean;
  onOpenPrivacy: () => void;
  onOpenHistory?: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  runtimeState,
  agentState,
  isChatTyping,
  onOpenPrivacy,
  onOpenHistory,
  onRefresh,
  isRefreshing
}) => {
  const getStatusBadge = () => {
    if (runtimeState === 'RECONNECTING') {
      return { label: 'Reconnecting...', dotClass: styles.dotWarning };
    }
    switch (status) {
      case 'READY':
        return { label: 'Connected', dotClass: styles.dotReady };
      case 'READING':
        return { label: 'Reading...', dotClass: styles.dotReading };
      case 'HUMAN_VERIFICATION':
        return { label: 'Verification', dotClass: styles.dotWarning };
      case 'LOGIN_PAGE':
        return { label: 'Sign in required', dotClass: styles.dotWarning };
      case 'UMS_DETECTED':
        return { label: 'UMS detected', dotClass: styles.dotReading };
      case 'NO_ATTENDANCE_ON_PAGE':
        return { label: 'UMS active', dotClass: styles.dotReading };
      case 'ERROR':
        return { label: 'Error', dotClass: styles.dotError };
      case 'NOT_CONNECTED':
      default:
        return { label: 'Disconnected', dotClass: styles.dotOff };
    }
  };

  const { voiceMode, setVoiceMode } = useVoiceAgent();

  const getVoiceModeDetails = () => {
    if (voiceMode === 'LIVE_AGENT') {
      return {
        label: 'Live Voice',
        pillClass: styles.voicePillLive,
        icon: '🗣️'
      };
    }
    return {
      label: 'Voice Off',
      pillClass: styles.voicePillOff,
      icon: '🔇'
    };
  };

  const voiceDetails = getVoiceModeDetails();
  const badge = getStatusBadge();

  return (
    <header className={styles.header}>
      <div className={styles.brandGroup}>
        {onOpenHistory && (
          <button
            className={styles.iconButton}
            onClick={onOpenHistory}
            title="Conversation History"
            aria-label="Conversation History"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        )}
        <OneeCompanion
          agentState={agentState}
          isChatTyping={isChatTyping}
          size={28}
          showCaption={false}
        />
        <div className={styles.brandTitle}>
          <span className={styles.name}>ONEE</span>
          <span className={styles.sub}>LPU Agent</span>
        </div>
      </div>

      <div className={styles.actions}>
        {/* Voice Mode Selector Pill: Exactly two user-facing modes */}
        <button
          className={`${styles.voicePill} ${voiceDetails.pillClass}`}
          onClick={() => {
            const nextMode = voiceMode === 'LIVE_AGENT' ? 'OFF' : 'LIVE_AGENT';
            // Switch the mode FIRST: VoiceQueue.updatePreferences runs synchronously
            // inside setMode, so the confirmation utterance below is never enqueued
            // against the previous (still disabled) queue and silently dropped.
            setVoiceMode(nextMode);
            if (nextMode === 'LIVE_AGENT') {
              audioController.unlockAudio().catch(() => {});
              voiceController.speakText("Live Voice is active.", true, undefined, true);
            }
          }}
          title={`Voice Mode: ${
            voiceMode === 'LIVE_AGENT'
              ? 'Ultimate Live AI Voice Mode. Tap for Voice Off.'
              : 'Voice Off. Tap for Ultimate Live AI Voice Mode.'
          }`}
          aria-label="Toggle voice mode"
          type="button"
        >
          <span style={{ fontSize: '11px', lineHeight: 1 }}>{voiceDetails.icon}</span>
          <div className={styles.voiceTextGroup}>
            <span className={styles.voiceTop}>{voiceMode === 'LIVE_AGENT' ? 'Ultimate' : 'Voice'}</span>
            <span className={styles.voiceBottom}>{voiceMode === 'LIVE_AGENT' ? 'Live Voice' : 'Off'}</span>
          </div>
        </button>

        <div className={styles.statusPill} title={`Status: ${badge.label}`}>
          <span className={`${styles.dot} ${badge.dotClass}`} />
          <span className={styles.statusLabel}>{badge.label}</span>
        </div>

        <button
          className={`${styles.iconButton} ${isRefreshing ? styles.spinning : ''}`}
          onClick={onRefresh}
          title="Refresh attendance"
          aria-label="Refresh attendance"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
          </svg>
        </button>

        <button
          className={styles.iconButton}
          onClick={onOpenPrivacy}
          title="Privacy and Local Data Management"
          aria-label="Privacy Info"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </button>
      </div>
    </header>
  );
};
