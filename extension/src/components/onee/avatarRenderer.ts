/*
 * Procedural Avatar SVG Renderer for ONEE.
 *
 * This module creates and manages the SVG nodes for ONEE's companion avatar:
 * 1. Generates SVG paths for the avatar's body nodes, eyes, mouth, and blush accents.
 * 2. Runs a 60fps requestAnimationFrame loop to smoothly interpolate between expressions
 *    (such as transitioning from 'curious' to 'celebrate').
 * 3. Respects system performance by pausing the rendering loop when the side panel is
 *    minimized or when prefers-reduced-motion is active.
 */

import {
  MAX_BODY_NODES,
  AvatarPlaybackState,
  advanceAvatarPlayback,
  createAvatarPlaybackState,
  pauseAvatarPlayback,
  playAvatarAnimation,
  renderAvatarDefinition,
  renderAvatarFrame,
  resolveAnimation,
  resolveExpression,
  resumeAvatarPlayback,
  sampleAvatarFrame
} from './avatarCore';

const SVG_NS = 'http://www.w3.org/2000/svg';
const TRANSITION_DURATION_MS = 420;
const NODE_COUNT = MAX_BODY_NODES + 2;
let instanceCounter = 0;

const formatSize = (s: number | string) => (typeof s === 'number' ? `${s}px` : s);

const createSvgElement = (name: string) => document.createElementNS(SVG_NS, name);

const getPlaybackEnv = () => ({
  random: Math.random,
  reduceMotion:
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
});

export interface AvatarOptions {
  definition: any;
  defaultAnimation?: string;
  defaultExpression?: string;
  autoplay?: boolean;
  size?: number | string;
  ariaLabel?: string;
  className?: string;
  onError?: (err: any) => void;
  onAnimationEnd?: (animName: string) => void;
  onExpressionChange?: (exprName: string) => void;
}

export interface AvatarWebInstance {
  play: (animName: string) => { ok: boolean; error?: any };
  setExpression: (exprName: string) => { ok: boolean; error?: any };
  pause: () => void;
  stop: () => void;
  getState: () => { activeAnimation?: string; activeExpression?: string; status: string };
  destroy: () => void;
}

/**
 * Creates a high-performance procedural SVG avatar without any AJV eval/new Function.
 */
export function createOneeAvatar(
  target: HTMLElement | string,
  options: AvatarOptions
): AvatarWebInstance {
  const container = typeof target === 'string' ? document.querySelector(target) : target;
  if (!container) throw new Error(`Avatar target '${target}' not found.`);

  const definition = options.definition;
  const size = options.size ?? 240;
  const ariaLabel = options.ariaLabel ?? 'ONEE procedural avatar';

  const wrapper = document.createElement('span');
  wrapper.className = ['onee-avatar-web', options.className ?? ''].filter(Boolean).join(' ');
  wrapper.style.display = 'inline-block';
  wrapper.style.width = formatSize(size);
  wrapper.style.height = formatSize(size);
  wrapper.setAttribute('role', 'img');
  wrapper.setAttribute('aria-label', ariaLabel);

  const svg = createSvgElement('svg');
  svg.setAttribute('viewBox', '-150 -150 300 300');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.display = 'block';
  svg.style.width = '100%';
  svg.style.height = '100%';

  const defs = createSvgElement('defs');
  const clipPath = createSvgElement('clipPath');
  const clipId = `onee-avatar-clip-${++instanceCounter}`;
  clipPath.id = clipId;

  const clipHead = createSvgElement('path');
  clipPath.append(clipHead);
  defs.append(clipPath);
  svg.append(defs);

  const backPaths = Array.from({ length: NODE_COUNT }, () => createSvgElement('path'));
  const headPath = createSvgElement('path');
  const eyesGroup = createSvgElement('g');
  eyesGroup.setAttribute('clip-path', `url(#${clipId})`);

  const leftEye = createSvgElement('path');
  const rightEye = createSvgElement('path');
  eyesGroup.append(leftEye, rightEye);

  const frontPaths = Array.from({ length: NODE_COUNT }, () => createSvgElement('path'));

  svg.append(...backPaths, headPath, eyesGroup, ...frontPaths);
  wrapper.append(svg);
  container.append(wrapper);

  const applyGeometry = (frame: any) => {
    clipHead.setAttribute('d', frame.geometry.headPath);
    headPath.setAttribute('d', frame.geometry.headPath);
    headPath.setAttribute('fill', frame.colors.body);

    leftEye.setAttribute('d', frame.geometry.leftPath);
    leftEye.setAttribute('fill', frame.colors.eyes);
    leftEye.setAttribute('opacity', frame.geometry.leftVisible ? '1' : '0');

    rightEye.setAttribute('d', frame.geometry.rightPath);
    rightEye.setAttribute('fill', frame.colors.eyes);
    rightEye.setAttribute('opacity', frame.geometry.rightVisible ? '1' : '0');

    backPaths.forEach((p, idx) => {
      p.setAttribute('d', frame.geometry.backPaths[idx] ?? '');
      p.setAttribute('fill', frame.colors.body);
    });

    frontPaths.forEach((p, idx) => {
      p.setAttribute('d', frame.geometry.frontPaths[idx] ?? '');
      p.setAttribute('fill', frame.colors.body);
    });
  };

  let playbackState: AvatarPlaybackState = createAvatarPlaybackState();
  let animFrameId: number | null = null;
  let isDestroyed = false;
  let lastEndedAnim: string | undefined;
  let lastReportedExpr: string | undefined;
  let sampledPose: any;

  const notifyExpression = () => {
    if (lastReportedExpr !== playbackState.activeExpression) {
      lastReportedExpr = playbackState.activeExpression;
      options.onExpressionChange?.(playbackState.activeExpression);
    }
  };

  const renderCurrent = (time: number) => {
    const env = getPlaybackEnv();
    sampledPose = sampleAvatarFrame(definition, playbackState, time, env);
    applyGeometry(renderAvatarFrame(definition, playbackState, time, env));
    notifyExpression();
  };

  const tick = (time: number) => {
    animFrameId = null;
    if (isDestroyed) return;

    const prevAnim = playbackState.activeAnimation;
    const wasPlaying = playbackState.status === 'playing';

    playbackState = advanceAvatarPlayback(definition, playbackState, time, getPlaybackEnv());
    renderCurrent(time);

    if (wasPlaying && playbackState.status === 'stopped' && prevAnim) {
      if (lastEndedAnim !== prevAnim) {
        options.onAnimationEnd?.(prevAnim);
        lastEndedAnim = prevAnim;
      }
    }

    if (playbackState.status === 'playing') {
      animFrameId = requestAnimationFrame(tick);
    }
  };

  const ensureLoop = () => {
    if (animFrameId === null && !isDestroyed) {
      animFrameId = requestAnimationFrame(tick);
    }
  };

  const instance: AvatarWebInstance = {
    play(animName: string) {
      if (
        playbackState.status === 'paused' &&
        playbackState.activeAnimation === animName &&
        playbackState.pausedAt !== undefined
      ) {
        playbackState = resumeAvatarPlayback(playbackState, performance.now());
        ensureLoop();
        return { ok: true };
      }

      const now = performance.now();
      const currentPose = sampledPose ?? sampleAvatarFrame(definition, playbackState, now, getPlaybackEnv());
      const res = playAvatarAnimation(definition, animName, now, currentPose);

      if (res.ok && res.value) {
        lastEndedAnim = undefined;
        playbackState = res.value;
        renderCurrent(performance.now());
        ensureLoop();
        return { ok: true };
      }
      return { ok: false, error: res.error };
    },

    setExpression(exprName: string) {
      const res = resolveExpression(definition, exprName);
      if (!res.ok) return { ok: false, error: res.error };

      const now = performance.now();
      const currentPose = sampledPose ?? sampleAvatarFrame(definition, playbackState, now, getPlaybackEnv());

      playbackState = {
        ...createAvatarPlaybackState(),
        activeExpression: exprName,
        status: playbackState.activeExpression === exprName ? 'stopped' : 'playing',
        ...(playbackState.activeExpression === exprName
          ? {}
          : {
              directTransition: {
                from: currentPose.expression,
                fromColors: currentPose.colors,
                startedAt: now,
                durationMs: TRANSITION_DURATION_MS,
                transition: 'smooth'
              }
            })
      };

      renderCurrent(performance.now());
      if (playbackState.status === 'playing') ensureLoop();
      return { ok: true };
    },

    pause() {
      if (playbackState.status === 'playing') {
        playbackState = pauseAvatarPlayback(playbackState, performance.now());
        if (animFrameId !== null) cancelAnimationFrame(animFrameId);
        animFrameId = null;
      }
    },

    stop() {
      playbackState = createAvatarPlaybackState();
      if (animFrameId !== null) cancelAnimationFrame(animFrameId);
      animFrameId = null;
      applyGeometry(renderAvatarDefinition(definition));
      notifyExpression();
    },

    getState() {
      return {
        ...(playbackState.activeAnimation ? { activeAnimation: playbackState.activeAnimation } : {}),
        activeExpression: playbackState.activeExpression,
        status: playbackState.status
      };
    },

    destroy() {
      isDestroyed = true;
      if (animFrameId !== null) cancelAnimationFrame(animFrameId);
      animFrameId = null;
      wrapper.remove();
    }
  };

  // Initial setup
  if (options.defaultAnimation) {
    const res = resolveAnimation(definition, options.defaultAnimation);
    if (res.ok) {
      if (options.autoplay !== false) {
        instance.play(options.defaultAnimation);
      } else {
        playbackState = {
          ...createAvatarPlaybackState(),
          activeExpression: res.value.steps[0]?.expression ?? 'neutral'
        };
        renderCurrent(performance.now());
      }
    } else {
      options.onError?.(res.error);
    }
  } else if (options.defaultExpression) {
    const res = resolveExpression(definition, options.defaultExpression);
    if (res.ok) {
      playbackState = {
        ...createAvatarPlaybackState(),
        activeExpression: options.defaultExpression
      };
      renderCurrent(performance.now());
    } else {
      options.onError?.(res.error);
    }
  } else {
    applyGeometry(renderAvatarDefinition(definition));
    sampledPose = sampleAvatarFrame(definition, playbackState, performance.now(), getPlaybackEnv());
    notifyExpression();
  }

  return instance;
}
