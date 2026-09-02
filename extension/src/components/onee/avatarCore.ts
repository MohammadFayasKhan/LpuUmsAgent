/*
 * Procedural Avatar Geometry Engine for ONEE.
 *
 * Rather than bundling heavy 3D GLTF models or looping GIF files, ONEE renders
 * a lightweight procedural avatar directly onto an HTML Canvas using mathematical
 * bezier curves, eye tracking, and natural ambient breathing motion.
 *
 * CSP Safety Note:
 * Standard schema validation libraries (like Ajv) compile dynamic validation functions
 * using `new Function()` or `eval()`, which Chrome Manifest V3 strictly blocks under
 * its Content Security Policy. We import only the pure-math geometry submodules
 * and use native TypeScript guards so the extension never triggers CSP eval errors.
 */

import {
  applyAmbientMotion
} from '@bible-strong/avatar-core/ambient-motion';

import {
  MAX_BODY_NODES
} from '@bible-strong/avatar-core/body';

import {
  interpolatePose,
  poseFromExpression,
  renderAvatar as renderAvatarGeometry
} from '@bible-strong/avatar-core/geometry';

export { MAX_BODY_NODES };

export interface PlaybackEnv {
  random: () => number;
  reduceMotion: boolean;
}

export interface AvatarPlaybackState {
  status: 'playing' | 'paused' | 'stopped';
  activeAnimation?: string;
  activeExpression: string;
  phase: 'hold' | 'transition';
  phaseStartedAt: number;
  stepIndex: number;
  direction: 1 | -1;
  transitionFrom?: string;
  pausedAt?: number;
  blinkDueAt?: number;
  blinkStartedAt?: number;
  directTransition?: {
    from: any;
    fromColors: { body: string; eyes: string };
    startedAt: number;
    durationMs: number;
    transition: string;
  };
}

export function createAvatarPlaybackState(): AvatarPlaybackState {
  return {
    status: 'stopped',
    activeExpression: 'neutral',
    phase: 'hold',
    phaseStartedAt: 0,
    stepIndex: 0,
    direction: 1
  };
}

export function resolveExpression(definition: any, exprName: string) {
  const expr = definition.expressions?.[exprName];
  if (!expr) {
    return { ok: false, error: new Error(`Expression "${exprName}" not found.`) };
  }
  return { ok: true, value: expr };
}

export function resolveAnimation(definition: any, animName: string) {
  const anim = definition.animations?.[animName];
  if (!anim) {
    return { ok: false, error: new Error(`Animation "${animName}" not found.`) };
  }
  return { ok: true, value: anim };
}

export const getColors = (definition: any, expr: any) => ({
  body: expr?.colors?.body ?? definition.colors?.body ?? '#dbe2f5',
  eyes: expr?.colors?.eyes ?? definition.colors?.eyes ?? '#111316'
});

export const toExpression = (id: string, expr: any) => ({
  id,
  headX: expr?.head?.x ?? 0,
  headY: expr?.head?.y ?? 0,
  headZ: expr?.head?.z ?? 0,
  widthLeft: expr?.eyes?.left?.width ?? 14,
  widthRight: expr?.eyes?.right?.width ?? 14,
  heightLeft: expr?.eyes?.left?.height ?? 44,
  heightRight: expr?.eyes?.right?.height ?? 44,
  spacing: expr?.eyes?.spacing ?? 0,
  positionXLeft: expr?.eyes?.left?.x ?? 0,
  positionXRight: expr?.eyes?.right?.x ?? 0,
  positionYLeft: expr?.eyes?.left?.y ?? 18,
  positionYRight: expr?.eyes?.right?.y ?? 18,
  leftAngle: expr?.eyes?.left?.angle ?? 7,
  rightAngle: expr?.eyes?.right?.angle ?? -7,
  perspective: expr?.perspective ?? 0,
  eyeMotion: expr?.eyeMotion ?? 'none',
  bodyMotion: expr?.bodyMotion ?? 'none',
  bodyColor: expr?.colors?.body,
  eyeColor: expr?.colors?.eyes
});

const interpolateHexColor = (c1: string, c2: string, t: number) => {
  const parse = (h: string) => {
    const raw = h.slice(1);
    const expanded = raw.length === 3 ? [...raw].map((c) => `${c}${c}`).join('') : raw;
    return [0, 2, 4].map((i) => parseInt(expanded.slice(i, i + 2), 16));
  };
  const rgb1 = parse(c1);
  const rgb2 = parse(c2);
  if (rgb1.some(isNaN) || rgb2.some(isNaN)) return t < 1 ? c1 : c2;
  return `#${rgb1
    .map((v, idx) => Math.round(v + (rgb2[idx] - v) * t))
    .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
    .join('')}`;
};

const interpolateColors = (colors1: any, colors2: any, t: number) => ({
  body: interpolateHexColor(colors1.body, colors2.body, t),
  eyes: interpolateHexColor(colors1.eyes, colors2.eyes, t)
});

const computeEasing = (transition: string, progress: number) => {
  const p = Math.max(0, Math.min(1, progress));
  if (transition === 'smooth') return p * p * (3 - 2 * p);
  if (transition === 'snappy') return 1 - Math.pow(1 - p, 3);
  return p;
};

const getBlinkOpacity = (anim: any, state: AvatarPlaybackState, time: number) => {
  if (!anim?.blink?.enabled || state.blinkStartedAt === undefined) return 1;
  const elapsed = (time - state.blinkStartedAt) / (anim.blink.durationMs || 150);
  if (elapsed < 0 || elapsed >= 1) return 1;
  return Math.abs(elapsed * 2 - 1);
};

export function sampleAvatarFrame(
  definition: any,
  state: AvatarPlaybackState,
  time: number,
  env: PlaybackEnv
) {
  const sampleTime = state.status === 'paused' && state.pausedAt !== undefined ? state.pausedAt : time;
  const rawExpr = definition.expressions?.[state.activeExpression] ?? definition.expressions?.neutral;
  const baseExpr = toExpression(state.activeExpression, rawExpr);
  let finalExpr: any = baseExpr;
  let finalColors = getColors(definition, rawExpr);
  let blinkOpacity = 1;

  if (state.directTransition && !env.reduceMotion) {
    const dur = Math.max(state.directTransition.durationMs, 1);
    const progress = computeEasing(state.directTransition.transition, (sampleTime - state.directTransition.startedAt) / dur);
    finalExpr = (interpolatePose(poseFromExpression(state.directTransition.from), poseFromExpression(finalExpr), progress) as any).expression;
    finalColors = interpolateColors(state.directTransition.fromColors, finalColors, progress);
  } else if (state.activeAnimation) {
    const animRes = resolveAnimation(definition, state.activeAnimation);
    if (animRes.ok) {
      const anim = animRes.value;
      const step = anim.steps?.[state.stepIndex];
      if (state.phase === 'transition' && step && !env.reduceMotion) {
        const prevRaw = definition.expressions?.[state.transitionFrom || 'neutral'];
        const prevExpr = toExpression(state.transitionFrom || 'neutral', prevRaw);
        const prevColors = getColors(definition, prevRaw);
        const dur = Math.max(step.transitionMs || 300, 1);
        const progress = computeEasing(step.transition || 'smooth', (sampleTime - state.phaseStartedAt) / dur);
        finalExpr = (interpolatePose(poseFromExpression(prevExpr), poseFromExpression(finalExpr), progress) as any).expression;
        finalColors = interpolateColors(prevColors, finalColors, progress);
      }
      blinkOpacity = getBlinkOpacity(anim, state, sampleTime);
    }
  }

  return {
    expression: finalExpr,
    colors: finalColors,
    blink: blinkOpacity,
    sampledAt: sampleTime
  };
}

export function renderAvatarFrame(
  definition: any,
  state: AvatarPlaybackState,
  time: number,
  env: PlaybackEnv
) {
  const sampled = sampleAvatarFrame(definition, state, time, env);
  const activeExpression = env.reduceMotion ? sampled.expression : applyAmbientMotion(sampled.expression, sampled.sampledAt);
  const pose = poseFromExpression(activeExpression);
  const geometry = renderAvatarGeometry(pose, definition.body.primary, sampled.blink, {
    bodyNodes: definition.body?.nodes || []
  });
  return { geometry, colors: sampled.colors };
}

export function renderAvatarDefinition(definition: any) {
  const rawExpr = definition.expressions?.neutral;
  const expr = toExpression('neutral', rawExpr);
  const colors = getColors(definition, rawExpr);
  const pose = poseFromExpression(expr);
  const geometry = renderAvatarGeometry(pose, definition.body.primary, 1, {
    bodyNodes: definition.body?.nodes || []
  });
  return { geometry, colors };
}

export function playAvatarAnimation(
  definition: any,
  animName: string,
  time: number,
  currentPose?: any
): { ok: boolean; value?: AvatarPlaybackState; error?: any } {
  const animRes = resolveAnimation(definition, animName);
  if (!animRes.ok || !animRes.value.steps?.length) {
    return { ok: false, error: animRes.error };
  }
  const anim = animRes.value;
  const firstStep = anim.steps[0];
  const newState: AvatarPlaybackState = {
    status: 'playing',
    activeAnimation: animName,
    stepIndex: 0,
    direction: 1,
    phase: 'transition',
    phaseStartedAt: time,
    transitionFrom: currentPose?.expression?.id || 'neutral',
    activeExpression: firstStep.expression,
    blinkDueAt: anim.blink?.enabled
      ? time + (anim.blink.minIntervalMs || 2000)
      : undefined
  };
  return { ok: true, value: newState };
}

const computeNextStep = (anim: any, state: AvatarPlaybackState) => {
  const stepCount = anim.steps.length;
  let nextIdx = state.stepIndex + state.direction;

  if (anim.playback === 'once') {
    if (nextIdx >= stepCount || nextIdx < 0) {
      return { complete: true, stepIndex: state.stepIndex, direction: state.direction };
    }
    return { complete: false, stepIndex: nextIdx, direction: state.direction };
  }

  if (anim.playback === 'pingpong') {
    let nextDir = state.direction;
    if (nextIdx >= stepCount) {
      nextIdx = stepCount - 2;
      nextDir = -1;
    } else if (nextIdx < 0) {
      nextIdx = 1;
      nextDir = 1;
    }
    return { complete: false, stepIndex: Math.max(0, Math.min(stepCount - 1, nextIdx)), direction: nextDir };
  }

  if (nextIdx >= stepCount) nextIdx = 0;
  return { complete: false, stepIndex: nextIdx, direction: state.direction };
};

export function advanceAvatarPlayback(
  definition: any,
  state: AvatarPlaybackState,
  time: number,
  env: PlaybackEnv
): AvatarPlaybackState {
  if (state.directTransition) {
    if (time < state.directTransition.startedAt + state.directTransition.durationMs) {
      return { ...state };
    }
    const { directTransition, ...rest } = state;
    return { ...rest, status: 'stopped' };
  }

  if (state.status !== 'playing' || !state.activeAnimation) {
    return { ...state };
  }

  const animRes = resolveAnimation(definition, state.activeAnimation);
  if (!animRes.ok || !animRes.value.steps?.length) {
    return createAvatarPlaybackState();
  }

  const anim = animRes.value;
  const nextState = { ...state };

  if (anim.blink?.enabled && nextState.blinkDueAt !== undefined && time >= nextState.blinkDueAt) {
    const due = nextState.blinkDueAt;
    const interval = (anim.blink.minIntervalMs || 2000) + env.random() * ((anim.blink.maxIntervalMs || 5000) - (anim.blink.minIntervalMs || 2000));
    nextState.blinkStartedAt = due;
    nextState.blinkDueAt = due + (anim.blink.durationMs || 150) + interval;
  }

  let safety = anim.steps.length * 4 + 4;
  while (safety-- > 0) {
    const step = anim.steps[nextState.stepIndex];
    if (!step) break;
    const stepDuration = nextState.phase === 'transition' ? (step.transitionMs || 300) : (step.holdMs || 500);

    if (time < nextState.phaseStartedAt + stepDuration) break;

    nextState.phaseStartedAt += stepDuration;
    if (nextState.phase === 'transition') {
      nextState.phase = 'hold';
      nextState.activeExpression = step.expression;
      continue;
    }

    const nextStep = computeNextStep(anim, nextState);
    if (nextStep.complete) {
      nextState.status = 'stopped';
      delete nextState.activeAnimation;
      break;
    }

    nextState.stepIndex = nextStep.stepIndex;
    nextState.direction = nextStep.direction;
    nextState.phase = 'transition';
    nextState.transitionFrom = nextState.activeExpression;
    nextState.activeExpression = anim.steps[nextStep.stepIndex]?.expression || 'neutral';
  }

  return nextState;
}

export function pauseAvatarPlayback(state: AvatarPlaybackState, time: number): AvatarPlaybackState {
  if (state.status === 'playing') {
    return { ...state, status: 'paused', pausedAt: time };
  }
  return { ...state };
}

export function resumeAvatarPlayback(state: AvatarPlaybackState, time: number): AvatarPlaybackState {
  if (state.status !== 'paused' || state.pausedAt === undefined) return { ...state };
  const delta = time - state.pausedAt;
  return {
    ...state,
    status: 'playing',
    phaseStartedAt: state.phaseStartedAt + delta,
    ...(state.directTransition
      ? {
          directTransition: {
            ...state.directTransition,
            startedAt: state.directTransition.startedAt + delta
          }
        }
      : {}),
    ...(state.blinkDueAt !== undefined ? { blinkDueAt: state.blinkDueAt + delta } : {}),
    ...(state.blinkStartedAt !== undefined ? { blinkStartedAt: state.blinkStartedAt + delta } : {}),
    pausedAt: undefined
  };
}
