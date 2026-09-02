/*
 * UMS Connection Status Indicator for ONEE.
 *
 * This small component shows the student whether ONEE can currently read their
 * UMS page. The status dot and label change based on ConnectionStatus:
 *
 * - Green "Connected": A UMS tab is open and the content script is active
 * - Yellow "Connecting": The content script was just injected and is waiting for DOM
 * - Orange "Login Page": UMS is on the sign-in screen, so no attendance data yet
 * - Orange "Human Verification": Cloudflare challenge is active, student needs to solve it
 * - Red "Disconnected": No UMS tab found or the content script failed to inject
 *
 * The indicator sits in the header bar and updates reactively via useUmsConnection.
 */

import React from 'react';
import { ConnectionStatus } from '../shared/types';
import styles from './ConnectionState.module.css';

interface ConnectionStateProps {
  status: ConnectionStatus;
  errorMessage?: string | null;
  hasAttendanceLink?: boolean;
  onOpenUms: () => void;
  onRefresh: () => void;
  onNavigateToAttendance?: () => void;
}

export const ConnectionState: React.FC<ConnectionStateProps> = ({
  status,
  errorMessage,
  onOpenUms,
  onRefresh,
  onNavigateToAttendance
}) => {
  const renderContent = () => {
    switch (status) {
      case 'HUMAN_VERIFICATION':
        return {
          icon: (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          ),
          badge: 'Verification Required',
          title: 'Complete Verification in UMS Tab',
          description:
            'Complete the Cloudflare or human challenge in your UMS tab. ONEE will resume reading your attendance automatically as soon as the page loads.',
          actionText: 'I completed it',
          action: onRefresh,
          isPrimary: true
        };

      case 'LOGIN_PAGE':
        return {
          icon: (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          ),
          badge: 'SIGN IN REQUIRED',
          title: 'Sign In Required',
          description:
            'ONEE is connected to your browser, but no active UMS account is available. Sign in to UMS to continue.',
          footerNote: 'Your previous Computer Use task has been cleared for this session.',
          actionText: 'Open UMS / Sign In',
          action: onOpenUms,
          secondaryActionText: 'Refresh Connection',
          secondaryAction: onRefresh,
          isPrimary: true
        };

      case 'UMS_DETECTED':
      case 'NO_ATTENDANCE_ON_PAGE':
      case 'READY':
        return {
          icon: (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          ),
          badge: 'Connected to LPU UMS',
          title: 'Attendance not scanned yet',
          description: 'Ask ONEE to check your attendance or click below to start.',
          actionText: 'Check attendance',
          action: onNavigateToAttendance || onRefresh,
          secondaryActionText: 'Refresh tab',
          secondaryAction: onRefresh,
          isPrimary: true
        };

      case 'READING':
        return {
          icon: (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="2" x2="12" y2="6" />
              <line x1="12" y1="18" x2="12" y2="22" />
              <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
              <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
              <line x1="2" y1="12" x2="6" y2="12" />
              <line x1="18" y1="12" x2="22" y2="12" />
              <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
              <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
            </svg>
          ),
          badge: 'Reading',
          title: 'Reading attendance data...',
          description: 'Inspecting UMS structure and extracting subject attendance counts.',
          actionText: null,
          action: null,
          isPrimary: false
        };

      case 'ERROR':
        return {
          icon: (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          ),
          badge: 'Status Notice',
          title: 'Unable to Read Attendance',
          description:
            errorMessage ||
            'ONEE could not parse the attendance information on this page. Make sure you are on the Attendance section.',
          actionText: 'Retry Scan',
          action: onRefresh,
          isPrimary: true
        };

      case 'NOT_CONNECTED':
      default:
        return {
          icon: (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
          ),
          badge: 'Not Connected',
          title: 'Connect to your LPU UMS account',
          description:
            'Open LPU UMS in this tab and sign in normally. Once your UMS dashboard is open, ONEE will read the available attendance data.',
          actionText: 'Open LPU UMS',
          action: onOpenUms,
          isPrimary: true
        };
    }
  };

  const c = renderContent();

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.iconWrapper}>{c.icon}</div>
        <span className={styles.badge}>{c.badge}</span>
        <h2 className={styles.title}>{c.title}</h2>
        <p className={styles.description}>{c.description}</p>

        <div className={styles.buttonGroup}>
          {c.action && (
            <button className={styles.primaryButton} onClick={c.action}>
              {c.actionText}
            </button>
          )}

          {c.secondaryAction && (
            <button className={styles.secondaryButton} onClick={c.secondaryAction}>
              {c.secondaryActionText}
            </button>
          )}
        </div>

        {c.footerNote && (
          <div className={styles.clearedNotice}>
            {c.footerNote}
          </div>
        )}
      </div>

      <div className={styles.privacyNote}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <span>Zero password storage · No session cookies collected</span>
      </div>
    </div>
  );
};
