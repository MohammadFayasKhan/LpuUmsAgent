/*
 * Central Runtime State Manager for ONEE.
 *
 * The reason we have this single store is to keep the browser agent,
 * the chat view, the 3D avatar, and the speech popup completely in sync.
 *
 * Earlier we had separate event emitters for the avatar, the connection manager,
 * and the agent controller. That caused race conditions where the avatar would
 * celebrate "Verified!" while the agent was still on step 2 locating the table.
 *
 * Now all components report their status here, and we compute a single
 * derived state for the avatar and speech bubble using clear priorities:
 * ERROR > RECONNECTING > VERIFYING > EXTRACTING > ACTING > MOVING > LOCATING > PLANNING > THINKING > USER_TYPING > LISTENING > IDLE.
 */

import { AnimationKey, ExpressionKey } from '../types/avatar';
import { AgentState, AttendanceSummary } from '../shared/types';
import { RuntimeConnectionState } from '../services/connectionManager';

export type OneeSemanticState =
  | 'IDLE'
  | 'LISTENING'
  | 'USER_TYPING'
  | 'THINKING'
  | 'OBSERVING'
  | 'PLANNING'
  | 'LOCATING'
  | 'MOVING'
  | 'ACTING'
  | 'WAITING'
  | 'EXTRACTING'
  | 'VERIFYING'
  | 'SUCCESS'
  | 'WARNING'
  | 'ERROR'
  | 'RECONNECTING'
  | 'CANCELLED';

export interface DerivedOneeState {
  semanticState: OneeSemanticState;
  animation: AnimationKey;
  expression: ExpressionKey;
  popupMessage: string | null;
  showTapAffordance: boolean;
  isBusy: boolean;
}

export interface OneeRuntimeState {
  connectionState: RuntimeConnectionState;
  agentState: AgentState | null;
  attendance: AttendanceSummary | null;
  isUserTyping: boolean;
  isChatStreaming: boolean;
  lastUserMessage: string | null;
  lastExplicitInteractionAt: number;
}

type StateListener = (state: DerivedOneeState, raw: OneeRuntimeState) => void;

class RuntimeStateManager {
  private static instance: RuntimeStateManager;

  private state: OneeRuntimeState = {
    connectionState: 'CONNECTED',
    agentState: null,
    attendance: null,
    isUserTyping: false,
    isChatStreaming: false,
    lastUserMessage: null,
    lastExplicitInteractionAt: Date.now()
  };

  private listeners: Set<StateListener> = new Set();
  private derivedState: DerivedOneeState;

  private constructor() {
    this.derivedState = this.computeDerivedState();
  }

  public static getInstance(): RuntimeStateManager {
    if (!RuntimeStateManager.instance) {
      RuntimeStateManager.instance = new RuntimeStateManager();
    }
    return RuntimeStateManager.instance;
  }

  /*
   * Components subscribe here so React components (like OneeCompanion)
   * can re-render whenever the central state changes.
   */
  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.derivedState, this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getDerivedState(): DerivedOneeState {
    return this.derivedState;
  }

  public getRawState(): OneeRuntimeState {
    return this.state;
  }

  /*
   * Whenever a slice of state changes, we update the master record and
   * recalculate the derived state.
   */
  public update(patch: Partial<OneeRuntimeState>) {
    this.state = { ...this.state, ...patch };
    this.derivedState = this.computeDerivedState();
    this.notify();
  }

  public recordInteraction() {
    this.state.lastExplicitInteractionAt = Date.now();
    this.derivedState = this.computeDerivedState();
    this.notify();
  }

  private notify() {
    this.listeners.forEach((listener) => {
      try {
        listener(this.derivedState, this.state);
      } catch (err) {
        console.warn('[RuntimeState] Error in listener callback:', err);
      }
    });
  }

  /*
   * Priority resolution: We derive what the avatar looks like and what the speech
   * bubble says by evaluating states in order of importance.
   *
   * For example, an active network reconnect or an execution error must always
   * show immediately, even if the student was previously typing a question.
   */
  private computeDerivedState(): DerivedOneeState {
    const {
      connectionState,
      agentState,
      attendance,
      isUserTyping,
      isChatStreaming,
      lastExplicitInteractionAt
    } = this.state;

    // 1. Connection error or reconnecting
    if (connectionState === 'RECONNECTING') {
      return {
        semanticState: 'RECONNECTING',
        animation: 'searching',
        expression: 'curious-left',
        popupMessage: 'Reconnecting...',
        showTapAffordance: false,
        isBusy: true
      };
    }

    if (connectionState === 'DISCONNECTED') {
      return {
        semanticState: 'ERROR',
        animation: 'confused',
        expression: 'uneasy-left',
        popupMessage: 'Offline',
        showTapAffordance: false,
        isBusy: false
      };
    }

    // 2. Active Browser Agent Execution
    if (agentState && agentState.status !== 'idle') {
      const status = agentState.status;
      const currentReason = agentState.currentAction?.reason;

      if (status === 'error') {
        return {
          semanticState: 'ERROR',
          animation: 'confused',
          expression: 'skeptical-left',
          popupMessage: "Couldn't verify that yet",
          showTapAffordance: false,
          isBusy: false
        };
      }

      if (status === 'completed') {
        // Only show success if verified data is actually present
        const subjectCount = attendance?.totalCourses || 0;
        const msg = subjectCount > 0
          ? `Verified ${subjectCount} subjects`
          : 'Attendance verified';

        return {
          semanticState: 'SUCCESS',
          animation: 'celebrate',
          expression: 'joyful-wide',
          popupMessage: msg,
          showTapAffordance: false,
          isBusy: false
        };
      }

      if (status === 'verifying_result' || status === 'verifying_target') {
        return {
          semanticState: 'VERIFYING',
          animation: 'working',
          expression: 'attentive-left',
          popupMessage: 'Verifying numbers...',
          showTapAffordance: false,
          isBusy: true
        };
      }

      if (status === 'extracting') {
        const count = attendance?.totalCourses;
        const msg = count ? `Reading ${count} subjects...` : 'Reading table...';
        return {
          semanticState: 'EXTRACTING',
          animation: 'searching',
          expression: 'small-attentive',
          popupMessage: msg,
          showTapAffordance: false,
          isBusy: true
        };
      }

      if (status === 'executing') {
        const cleanMsg = currentReason ? currentReason.replace(/^→\s*/, '') : 'Interacting...';
        return {
          semanticState: 'ACTING',
          animation: 'working',
          expression: 'small-attentive',
          popupMessage: cleanMsg.length > 22 ? `${cleanMsg.slice(0, 20)}...` : cleanMsg,
          showTapAffordance: false,
          isBusy: true
        };
      }

      if (status === 'moving') {
        return {
          semanticState: 'MOVING',
          animation: 'working',
          expression: 'attentive-left',
          popupMessage: 'Navigating UMS...',
          showTapAffordance: false,
          isBusy: true
        };
      }

      if (status === 'locating') {
        return {
          semanticState: 'LOCATING',
          animation: 'searching',
          expression: 'far-right-glance',
          popupMessage: 'Locating target...',
          showTapAffordance: false,
          isBusy: true
        };
      }

      if (status === 'planning') {
        return {
          semanticState: 'PLANNING',
          animation: 'thinking',
          expression: 'upward-side-glance',
          popupMessage: 'Planning step...',
          showTapAffordance: false,
          isBusy: true
        };
      }

      if (status === 'observing') {
        return {
          semanticState: 'OBSERVING',
          animation: 'searching',
          expression: 'curious-left',
          popupMessage: 'Checking UMS...',
          showTapAffordance: false,
          isBusy: true
        };
      }
    }

    // 3. Chat Formulating / Streaming
    if (isChatStreaming) {
      return {
        semanticState: 'THINKING',
        animation: 'thinking',
        expression: 'upward-side-glance',
        popupMessage: 'Formulating...',
        showTapAffordance: false,
        isBusy: true
      };
    }

    // 4. User actively typing in composer
    if (isUserTyping) {
      return {
        semanticState: 'USER_TYPING',
        animation: 'listening',
        expression: 'small-attentive',
        popupMessage: 'Listening...',
        showTapAffordance: false,
        isBusy: false
      };
    }

    // 5. Idle State: Show subtle contextual hint if student has data, or tap hint
    const idleSeconds = (Date.now() - lastExplicitInteractionAt) / 1000;
    const showTapHint = idleSeconds > 6;

    let defaultIdleMessage: string | null = null;
    if (attendance && attendance.courses && attendance.courses.length > 0) {
      const danger = attendance.courses.find((c) => c.percentage < 75);
      if (danger) {
        defaultIdleMessage = `${danger.code}: ${Math.round(danger.percentage)}%`;
      } else if (attendance.overallPercentage) {
        defaultIdleMessage = `${Math.round(attendance.overallPercentage)}% overall`;
      }
    }

    return {
      semanticState: 'IDLE',
      animation: 'idle',
      expression: 'neutral',
      popupMessage: showTapHint ? 'Tap to chat' : defaultIdleMessage,
      showTapAffordance: showTapHint,
      isBusy: false
    };
  }
}

export const runtimeState = RuntimeStateManager.getInstance();
