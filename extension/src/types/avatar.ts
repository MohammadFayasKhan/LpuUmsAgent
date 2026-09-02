/*
 * Procedural Avatar Type Definitions for ONEE.
 *
 * Defines the complete set of valid animation and expression keys:
 * - VALID_ANIMATIONS: High-level motion cycles (idle, thinking, searching, celebrate, etc.)
 * - VALID_EXPRESSIONS: Facial pose definitions (neutral, curious, concerned, excited, etc.)
 * - AvatarRefHandle: Imperative API methods exposed by AvatarController to trigger animations.
 */

export const VALID_ANIMATIONS = [
  'sleeping',
  'waking',
  'idle',
  'listening',
  'thinking',
  'searching',
  'working',
  'excited',
  'bored',
  'suspicious',
  'angry',
  'drowsy',
  'happy',
  'curious',
  'confused',
  'surprised',
  'proud',
  'shy',
  'sad',
  'laughing',
  'scared',
  'playful',
  'celebrate'
] as const;

export const VALID_EXPRESSIONS = [
  'neutral',
  'upward-side-glance',
  'downward-gaze',
  'skeptical-right',
  'small-attentive',
  'wide-downward-gaze',
  'surprised-left',
  'sleepy-squint',
  'angry-right',
  'curious-left',
  'asymmetric-down-right',
  'attentive-left',
  'joyful-wide',
  'eyes-closed',
  'joyful-down-right',
  'skeptical-left',
  'far-right-glance',
  'angry-left',
  'playful-right',
  'asymmetric-up-left',
  'gentle-downward-gaze',
  'wide-down-left',
  'surprised-wide-left',
  'drowsy-closed',
  'suspicious-right',
  'shy-downward',
  'angry-brows',
  'uneasy-left'
] as const;

export type AnimationKey = typeof VALID_ANIMATIONS[number];
export type ExpressionKey = typeof VALID_EXPRESSIONS[number];

export interface AvatarRefHandle {
  play: (animation: AnimationKey | string, autoReturnIdleMs?: number) => void;
  setExpression: (expression: ExpressionKey | string) => void;
  stop: () => void;
  getState: () => { activeAnimation: string; hasInstance: boolean };
}
