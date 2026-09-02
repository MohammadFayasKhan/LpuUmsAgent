/*
 * Extension Messaging Protocol & Event Types.
 *
 * In Chrome extensions, scripts in different contexts (Side Panel, Background Service Worker,
 * and Page Content Script) communicate by posting structured message objects.
 *
 * This file defines the canonical message types and TypeScript payload interfaces.
 * Defining them centrally prevents typo bugs like 'REQUEST_STATUS' vs 'REQUEST_UMS_STATUS'
 * across different parts of the extension.
 */

import { AttendanceSummary, ConnectionStatus, PageObservation, AgentAction } from './types';

export const MESSAGE_TYPES = {
  REQUEST_UMS_STATUS: 'ONEE_REQUEST_UMS_STATUS',
  REQUEST_ATTENDANCE_DATA: 'ONEE_REQUEST_ATTENDANCE_DATA',
  UMS_STATUS_UPDATE: 'ONEE_UMS_STATUS_UPDATE',
  TRIGGER_PAGE_SCAN: 'ONEE_TRIGGER_PAGE_SCAN',
  NAVIGATE_TO_ATTENDANCE: 'ONEE_NAVIGATE_TO_ATTENDANCE',
  PING: 'ONEE_PING',
  HANDSHAKE: 'ONEE_HANDSHAKE',
  KEEP_ALIVE: 'ONEE_KEEP_ALIVE',
  REINJECT_CONTENT_SCRIPT: 'ONEE_REINJECT_CONTENT_SCRIPT',
  DEV_RELOAD: 'ONEE_DEV_RELOAD',

  // Computer Use Agent IPC Messages
  OBSERVE_PAGE: 'ONEE_OBSERVE_PAGE',
  EXECUTE_ACTION: 'ONEE_EXECUTE_ACTION',
  SHOW_CURSOR: 'ONEE_SHOW_CURSOR',
  HIDE_CURSOR: 'ONEE_HIDE_CURSOR',
  CAPTURE_VISIBLE_TAB: 'ONEE_CAPTURE_VISIBLE_TAB'
} as const;

export interface ShowCursorMessage {
  type: typeof MESSAGE_TYPES.SHOW_CURSOR;
  x?: number;
  y?: number;
  label?: string;
}

export interface RequestUmsStatusMessage {
  type: typeof MESSAGE_TYPES.REQUEST_UMS_STATUS;
}

export interface RequestAttendanceDataMessage {
  type: typeof MESSAGE_TYPES.REQUEST_ATTENDANCE_DATA;
}

export interface TriggerPageScanMessage {
  type: typeof MESSAGE_TYPES.TRIGGER_PAGE_SCAN;
}

export interface NavigateToAttendanceMessage {
  type: typeof MESSAGE_TYPES.NAVIGATE_TO_ATTENDANCE;
}

export interface PingMessage {
  type: typeof MESSAGE_TYPES.PING;
}

export interface UmsStatusUpdateMessage {
  type: typeof MESSAGE_TYPES.UMS_STATUS_UPDATE;
  payload: {
    status: ConnectionStatus;
    attendance?: AttendanceSummary;
    errorMessage?: string;
    pageTitle?: string;
    url?: string;
  };
}

export interface ObservePageMessage {
  type: typeof MESSAGE_TYPES.OBSERVE_PAGE;
}

export interface ExecuteActionMessage {
  type: typeof MESSAGE_TYPES.EXECUTE_ACTION;
  action: AgentAction;
}

export interface CaptureVisibleTabMessage {
  type: typeof MESSAGE_TYPES.CAPTURE_VISIBLE_TAB;
}

export interface ReinjectContentScriptMessage {
  type: typeof MESSAGE_TYPES.REINJECT_CONTENT_SCRIPT;
  tabId?: number;
}

export type ExtensionMessage =
  | RequestUmsStatusMessage
  | RequestAttendanceDataMessage
  | TriggerPageScanMessage
  | NavigateToAttendanceMessage
  | PingMessage
  | UmsStatusUpdateMessage
  | ObservePageMessage
  | ExecuteActionMessage
  | ShowCursorMessage
  | { type: typeof MESSAGE_TYPES.HIDE_CURSOR }
  | CaptureVisibleTabMessage
  | ReinjectContentScriptMessage
  | { type: typeof MESSAGE_TYPES.DEV_RELOAD };

export interface UmsResponsePayload {
  status: ConnectionStatus;
  attendance?: AttendanceSummary | null;
  errorMessage?: string | null;
  hasAttendanceLink?: boolean;
  observation?: PageObservation;
  actionResult?: {
    success: boolean;
    error?: string;
    attendance?: AttendanceSummary;
  };
  screenshot?: string;
}
