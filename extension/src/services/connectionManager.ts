/*
 * Chrome Extension Connection & Port Lifecycle Manager.
 *
 * In Chrome Manifest V3, the background service worker can terminate when idle (SW Terminated).
 * This class ensures the side panel maintains a live communication port with the background worker:
 * 1. Automatic Reconnection: When onDisconnect fires, it enters the RECONNECTING state
 *    and uses exponential backoff up to 10 attempts to re-establish the port.
 * 2. Keep-Alive Heartbeats: Sends periodic PING messages every 25 seconds to keep the
 *    message channel responsive during long-running tasks.
 * 3. State Subscription: UI components subscribe to connection status changes
 *    (INITIAL → CONNECTING → CONNECTED → DISCONNECTED → RECONNECTING).
 */

import { MESSAGE_TYPES } from '../shared/messages';
import { sessionRepo } from './repositories';

export type RuntimeConnectionState =
  | 'INITIAL'
  | 'CONNECTING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'RECONNECTING';

export type ConnectionStateListener = (state: RuntimeConnectionState) => void;

class ConnectionManager {
  private static instance: ConnectionManager;
  private port: chrome.runtime.Port | null = null;
  private state: RuntimeConnectionState = 'INITIAL';
  private listeners: Set<ConnectionStateListener> = new Set();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: any = null;
  private keepAliveTimer: any = null;
  private isDestroyed = false;

  private constructor() {
    this.connect();
    this.setupStorageWatch();
  }

  public static getInstance(): ConnectionManager {
    if (!ConnectionManager.instance) {
      ConnectionManager.instance = new ConnectionManager();
    }
    return ConnectionManager.instance;
  }

  public getState(): RuntimeConnectionState {
    return this.state;
  }

  public subscribe(listener: ConnectionStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setState(newState: RuntimeConnectionState) {
    if (this.state === newState) return;
    this.state = newState;
    sessionRepo.setConnectionState(newState).catch(() => {});
    this.listeners.forEach((listener) => {
      try {
        listener(newState);
      } catch (err) {
        console.warn('[ONEE ConnectionManager] Listener error:', err);
      }
    });
  }

  public connect() {
    if (this.isDestroyed || typeof chrome === 'undefined' || !chrome.runtime?.connect) {
      return;
    }

    this.setState(this.reconnectAttempts > 0 ? 'RECONNECTING' : 'CONNECTING');

    try {
      this.port = chrome.runtime.connect({ name: 'onee-sidepanel-port' });

      this.port.onMessage.addListener((msg) => {
        if (msg.type === MESSAGE_TYPES.DEV_RELOAD) {
          console.info('[ONEE Dev] Received hot rebuild signal. Reloading sidepanel view...');
          window.location.reload();
        }
      });

      this.port.onDisconnect.addListener(() => {
        const lastErr = chrome.runtime.lastError?.message;
        console.debug('[ONEE ConnectionManager] Service worker port idle/disconnected:', lastErr || 'SW Terminated');
        this.port = null;
        this.stopKeepAlive();
        this.setState('DISCONNECTED');
        this.scheduleReconnect();
      });

      // Handshake
      this.port.postMessage({ type: MESSAGE_TYPES.HANDSHAKE, client: 'sidepanel', timestamp: Date.now() });
      this.setState('CONNECTED');
      this.reconnectAttempts = 0;
      this.startKeepAlive();
    } catch (err: any) {
      console.warn('[ONEE ConnectionManager] Connection error:', err.message);
      this.setState('DISCONNECTED');
      this.scheduleReconnect();
    }
  }

  private startKeepAlive() {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (this.port && this.state === 'CONNECTED') {
        try {
          this.port.postMessage({ type: MESSAGE_TYPES.KEEP_ALIVE, timestamp: Date.now() });
        } catch {
          this.scheduleReconnect();
        }
      }
    }, 15000);
  }

  private stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.isDestroyed || this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[ONEE ConnectionManager] Max reconnect attempts reached.');
      return;
    }

    this.reconnectAttempts++;
    // Exponential backoff with jitter: 500ms, 1000ms, 2000ms... up to 6000ms
    const baseDelay = Math.min(6000, 500 * Math.pow(1.8, this.reconnectAttempts));
    const jitter = Math.random() * 300;
    const delay = Math.round(baseDelay + jitter);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /**
   * Watches storage changes for dev-mode hot reloads without needing to reload the extension
   */
  private setupStorageWatch() {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;

    try {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes['__onee_dev_build_hash__']) {
          console.info('[ONEE Dev] Detected asset rebuild from storage. Refreshing sidepanel...');
          window.location.reload();
        }
      });
    } catch {}
  }

  public destroy() {
    this.isDestroyed = true;
    this.stopKeepAlive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.port) {
      try {
        this.port.disconnect();
      } catch {}
      this.port = null;
    }
    this.listeners.clear();
  }
}

export const connectionManager = ConnectionManager.getInstance();
