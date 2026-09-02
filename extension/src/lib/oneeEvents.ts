/*
 * ONEE Event Bus & Procedural Avatar Companion Bridge.
 *
 * We synchronize the companion mascot's visual expressions with what the agent is
 * actually doing in the browser tab. This event bus translates runtime lifecycle events
 * (e.g. agent_observing, agent_moving, attendance_verified) into visual expressions:
 *
 * - OBSERVING / PLANNING → curious expression, gentle breathing
 * - MOVING / ACTING → focused expression with eye tracking toward target
 * - EXTRACTING → reading expression with soft ambient glow
 * - SUCCESS → celebrate expression with micro-burst celebration
 * - ERROR → confused/concerned expression with retry suggestion
 */

import { ExpressionKey, AnimationKey } from '../types/avatar';

export type OneeVisualState =
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

export type OneeAgentEventType =
  | 'agent_idle'
  | 'agent_observing'
  | 'agent_thinking'
  | 'agent_grounding'
  | 'agent_moving'
  | 'agent_clicking'
  | 'agent_reading'
  | 'agent_success'
  | 'agent_error'
  | 'chat_thinking'
  | 'chat_responding'
  | 'chat_complete'
  | 'avatar_tap'
  | 'avatar_hover';

export interface OneeReaction {
  state?: OneeVisualState;
  animation: AnimationKey;
  expression: ExpressionKey;
  caption?: string;
  autoIdleDelayMs?: number;
}

type OneeEventListener = (reaction: OneeReaction, eventType: OneeAgentEventType | OneeVisualState) => void;

class OneeEventBridge {
  private listeners: Set<OneeEventListener> = new Set();
  private currentState: OneeVisualState = 'IDLE';

  public getCurrentState(): OneeVisualState {
    return this.currentState;
  }

  public subscribe(listener: OneeEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public emitState(state: OneeVisualState, customCaption?: string) {
    this.currentState = state;
    const reaction = this.getReactionForState(state, customCaption);
    this.listeners.forEach((listener) => listener(reaction, state));
  }

  public emit(
    eventType: OneeAgentEventType,
    customCaption?: string,
    customAnim?: AnimationKey,
    customExpr?: ExpressionKey
  ) {
    const reaction = this.getReactionForEvent(eventType, customCaption, customAnim, customExpr);
    if (reaction.state) {
      this.currentState = reaction.state;
    }
    this.listeners.forEach((listener) => listener(reaction, eventType));
  }

  public getReactionForState(state: OneeVisualState, customCaption?: string): OneeReaction {
    switch (state) {
      case 'LISTENING':
        return {
          state,
          animation: 'listening',
          expression: 'attentive-left',
          caption: customCaption || 'Listening 💬',
          autoIdleDelayMs: 0
        };
      case 'USER_TYPING':
        return {
          state,
          animation: 'listening',
          expression: 'small-attentive',
          caption: customCaption || 'Listening...',
          autoIdleDelayMs: 0
        };
      case 'THINKING':
      case 'PLANNING':
        return {
          state,
          animation: 'thinking',
          expression: 'upward-side-glance',
          caption: customCaption || 'Thinking ⏳',
          autoIdleDelayMs: 0
        };
      case 'OBSERVING':
        return {
          state,
          animation: 'searching',
          expression: 'curious-left',
          caption: customCaption || 'Observing UMS 👁️',
          autoIdleDelayMs: 0
        };
      case 'LOCATING':
        return {
          state,
          animation: 'searching',
          expression: 'far-right-glance',
          caption: customCaption || 'Locating target 🎯',
          autoIdleDelayMs: 0
        };
      case 'MOVING':
        return {
          state,
          animation: 'working',
          expression: 'attentive-left',
          caption: customCaption || 'Navigating 🚀',
          autoIdleDelayMs: 0
        };
      case 'ACTING':
        return {
          state,
          animation: 'working',
          expression: 'small-attentive',
          caption: customCaption || 'Interacting ⚡',
          autoIdleDelayMs: 0
        };
      case 'WAITING':
        return {
          state,
          animation: 'idle',
          expression: 'gentle-downward-gaze',
          caption: customCaption || 'Waiting...',
          autoIdleDelayMs: 0
        };
      case 'EXTRACTING':
        return {
          state,
          animation: 'searching',
          expression: 'small-attentive',
          caption: customCaption || 'Reading table 📚',
          autoIdleDelayMs: 0
        };
      case 'VERIFYING':
        return {
          state,
          animation: 'working',
          expression: 'attentive-left',
          caption: customCaption || 'Verifying data 🛡️',
          autoIdleDelayMs: 0
        };
      case 'SUCCESS':
        return {
          state,
          animation: 'celebrate',
          expression: 'joyful-wide',
          caption: customCaption || 'Verified! 🎉',
          autoIdleDelayMs: 4000
        };
      case 'WARNING':
        return {
          state,
          animation: 'suspicious',
          expression: 'skeptical-right',
          caption: customCaption || 'Caution ⚠️',
          autoIdleDelayMs: 3500
        };
      case 'ERROR':
        return {
          state,
          animation: 'confused',
          expression: 'uneasy-left',
          caption: customCaption || 'Needs attention',
          autoIdleDelayMs: 3500
        };
      case 'RECONNECTING':
        return {
          state,
          animation: 'searching',
          expression: 'curious-left',
          caption: customCaption || 'Reconnecting 🔄',
          autoIdleDelayMs: 0
        };
      case 'CANCELLED':
        return {
          state,
          animation: 'idle',
          expression: 'downward-gaze',
          caption: customCaption || 'Stopped',
          autoIdleDelayMs: 3000
        };
      case 'IDLE':
      default:
        return {
          state: 'IDLE',
          animation: 'idle',
          expression: 'neutral',
          caption: customCaption,
          autoIdleDelayMs: 0
        };
    }
  }

  private getReactionForEvent(
    eventType: OneeAgentEventType,
    customCaption?: string,
    customAnim?: AnimationKey,
    customExpr?: ExpressionKey
  ): OneeReaction {
    if (customAnim) {
      return {
        animation: customAnim,
        expression: customExpr || (customAnim === 'thinking' ? 'upward-side-glance' : customAnim === 'working' ? 'attentive-left' : 'curious-left'),
        caption: customCaption,
        autoIdleDelayMs: (customAnim === 'thinking' || customAnim === 'working' || customAnim === 'listening') ? 0 : 3500
      };
    }

    switch (eventType) {
      case 'agent_observing':
        return this.getReactionForState('OBSERVING', customCaption);
      case 'agent_thinking':
        return this.getReactionForState('PLANNING', customCaption);
      case 'agent_grounding':
        return this.getReactionForState('LOCATING', customCaption);
      case 'agent_moving':
      case 'agent_clicking':
        return this.getReactionForState('MOVING', customCaption);
      case 'agent_reading':
        return this.getReactionForState('EXTRACTING', customCaption);
      case 'agent_success':
        return this.getReactionForState('SUCCESS', customCaption);
      case 'agent_error':
        return this.getReactionForState('ERROR', customCaption);
      case 'chat_thinking':
        return this.getReactionForState('THINKING', customCaption);
      case 'chat_responding':
        return this.getReactionForState('USER_TYPING', customCaption);
      case 'chat_complete':
        return {
          animation: 'happy',
          expression: 'joyful-wide',
          caption: customCaption,
          autoIdleDelayMs: 3500
        };
      case 'avatar_tap':
        return {
          state: 'LISTENING',
          animation: 'excited',
          expression: 'joyful-wide',
          caption: customCaption || 'Ready! 🚀',
          autoIdleDelayMs: 3000
        };
      case 'avatar_hover':
        return {
          animation: 'playful',
          expression: 'curious-left',
          caption: customCaption,
          autoIdleDelayMs: 2000
        };
      case 'agent_idle':
      default:
        return this.getReactionForState('IDLE');
    }
  }
}

export const oneeBridge = new OneeEventBridge();
