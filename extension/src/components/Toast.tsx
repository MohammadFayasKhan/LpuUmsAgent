/*
 * Toast Notification Component for ONEE.
 *
 * Shows brief, non-blocking notifications at the bottom of the side panel:
 * - "Copied to clipboard" after copying a Computer Use result
 * - "Reconnected to UMS" after a service worker restart
 * - "Attendance data refreshed" after a fresh extraction
 *
 * Each toast auto-dismisses after a configurable duration (default 3s).
 * Multiple toasts stack vertically with a small gap between them.
 */

import React, { useEffect } from 'react';
import styles from './Toast.module.css';

export interface ToastMessage {
  id: string;
  text: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className={styles.toastContainer} aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ toast: ToastMessage; onDismiss: (id: string) => void }> = ({
  toast,
  onDismiss
}) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, toast.duration || 3000);

    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  const typeClass =
    toast.type === 'success'
      ? styles.success
      : toast.type === 'warning'
      ? styles.warning
      : toast.type === 'error'
      ? styles.error
      : styles.info;

  return (
    <div className={`${styles.toast} ${typeClass}`}>
      <span className={styles.toastText}>{toast.text}</span>
      <button
        className={styles.closeBtn}
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  );
};

export function useToasts() {
  const [toasts, setToasts] = React.useState<ToastMessage[]>([]);

  const addToast = React.useCallback((text: string, type: ToastMessage['type'] = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    setToasts((prev) => [...prev, { id, text, type }]);
  }, []);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, dismissToast };
}
