/*
 * React Lifecycle Bridge for the ONEE Procedural Avatar.
 *
 * The avatar rendering engine (avatarRenderer.ts) works with raw DOM SVG nodes
 * and requestAnimationFrame loops, but the rest of the UI is React. This component
 * bridges the two worlds:
 *
 * 1. It creates a container ref and mounts the procedural avatar into it on first render.
 * 2. It watches for prop changes (animation, expression) and calls the avatar instance
 *    methods to transition smoothly between states.
 * 3. It cleans up the animation loop on unmount so we don't leak requestAnimationFrame
 *    callbacks when the side panel is closed.
 * 4. It exposes a ref handle (AvatarRefHandle) so parent components can imperatively
 *    trigger animations like "celebrate" or "confused" without re-rendering.
 *
 * The avatar definition JSON is sanitized before use because some edge values
 * (like morphRoundness outside 0-1) can cause NaN in the geometry calculations.
 */

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  useId
} from 'react';
import { createOneeAvatar as createAvatar, AvatarWebInstance as AvatarInstance } from './onee/avatarRenderer';
import rawAvatarData from '../assets/onee.avatar.json';
import {
  VALID_ANIMATIONS,
  VALID_EXPRESSIONS,
  AnimationKey,
  ExpressionKey,
  AvatarRefHandle
} from '../types/avatar';

export interface AvatarControllerProps {
  animation?: AnimationKey | string;
  expression?: ExpressionKey | string;
  size?: number | string;
  className?: string;
  containerId?: string;
  ariaLabel?: string;
  onClick?: () => void;
  interactive?: boolean;
}

const sanitizeDefinition = (data: any) => {
  try {
    const clone = JSON.parse(JSON.stringify(data));
    if (clone?.body?.primary) {
      if (typeof clone.body.primary.morphRoundness === 'number') {
        clone.body.primary.morphRoundness = Math.min(1, Math.max(0, clone.body.primary.morphRoundness));
      }
      if (typeof clone.body.primary.tipRoundness === 'number') {
        clone.body.primary.tipRoundness = Math.min(1, Math.max(0, clone.body.primary.tipRoundness));
      }
      if (typeof clone.body.primary.baseRoundness === 'number') {
        clone.body.primary.baseRoundness = Math.min(1, Math.max(0, clone.body.primary.baseRoundness));
      }
    }
    return clone;
  } catch {
    return data;
  }
};

const validAvatarData = sanitizeDefinition(rawAvatarData);

export const AvatarController = forwardRef<AvatarRefHandle, AvatarControllerProps>(
  (
    {
      animation = 'idle',
      expression: _expression,
      size = 300,
      className = '',
      containerId,
      ariaLabel = 'Onee procedural avatar',
      onClick,
      interactive = true
    },
    ref
  ) => {
    const autoId = useId();
    const containerRef = useRef<HTMLDivElement>(null);
    const instanceRef = useRef<AvatarInstance | null>(null);
    const activeAnimRef = useRef<string>('idle');
    const autoIdleTimerRef = useRef<any>(null);
    const [initError, setInitError] = useState<string | null>(null);

    // Validate animation key against schema
    const getSafeAnimation = (anim?: string): AnimationKey => {
      if (anim && VALID_ANIMATIONS.includes(anim as AnimationKey)) {
        return anim as AnimationKey;
      }
      return 'idle';
    };

    // Initialize Avatar instance once on mount with visibility culling
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      container.innerHTML = '';
      setInitError(null);

      let isVisible = true;
      let isTabActive = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;

      const syncPlayback = () => {
        if (!instanceRef.current) return;
        if (!isVisible || !isTabActive) {
          try {
            instanceRef.current.stop();
          } catch (e) {}
        } else {
          try {
            instanceRef.current.play(activeAnimRef.current || 'idle');
          } catch (e) {}
        }
      };

      try {
        const initialAnim = getSafeAnimation(animation);

        const instance = createAvatar(container, {
          definition: validAvatarData,
          defaultAnimation: initialAnim,
          size: '100%',
          ariaLabel,
          onError: (err: any) => {
            console.warn('[Onee Avatar Runtime Error]', err);
            try {
              instanceRef.current?.play('idle');
            } catch (e) {
              // ignore
            }
          },
          onAnimationEnd: (endedAnim: string) => {
            // If active animation is thinking, working, excited, curious, loop it
            if (['thinking', 'working', 'excited', 'curious', 'happy', 'searching'].includes(activeAnimRef.current)) {
              try {
                instanceRef.current?.play(activeAnimRef.current);
              } catch (e) {}
              return;
            }

            // When a one-shot animation finishes, smoothly resume idle
            if (endedAnim !== 'idle') {
              try {
                instanceRef.current?.play('idle');
                activeAnimRef.current = 'idle';
              } catch (e) {
                // ignore
              }
            }
          }
        });

        instanceRef.current = instance;
        activeAnimRef.current = initialAnim;
      } catch (err: any) {
        console.error('Failed to initialize Onee avatar instance:', err);
        setInitError(err?.message || 'Avatar init failed');
      }

      // Intersection Observer for viewport visibility culling
      const observer = new IntersectionObserver(
        ([entry]) => {
          isVisible = entry.isIntersecting;
          syncPlayback();
        },
        { threshold: 0.05 }
      );
      observer.observe(container);

      const handleVisibilityChange = () => {
        isTabActive = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
        syncPlayback();
      };
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', handleVisibilityChange);
      }

      return () => {
        observer.disconnect();
        if (typeof document !== 'undefined') {
          document.removeEventListener('visibilitychange', handleVisibilityChange);
        }
        if (autoIdleTimerRef.current) clearTimeout(autoIdleTimerRef.current);
        if (instanceRef.current) {
          try {
            instanceRef.current.destroy();
          } catch (e) {
            // ignore
          }
          instanceRef.current = null;
        }
      };
    }, [autoId]);

    // React to animation prop updates
    useEffect(() => {
      if (!instanceRef.current) return;
      const safeAnim = getSafeAnimation(animation);

      if (activeAnimRef.current === safeAnim) return;

      try {
        instanceRef.current.play(safeAnim);
        activeAnimRef.current = safeAnim;
      } catch (err) {
        console.warn('Error playing animation:', err);
      }
    }, [animation]);

    // Imperative ref methods
    useImperativeHandle(ref, () => ({
      play: (anim: AnimationKey | string, autoReturnIdleMs?: number) => {
        if (!instanceRef.current) return;
        const validKey = getSafeAnimation(anim);
        try {
          if (autoIdleTimerRef.current) {
            clearTimeout(autoIdleTimerRef.current);
            autoIdleTimerRef.current = null;
          }
          instanceRef.current.play(validKey);
          activeAnimRef.current = validKey;

          // Only set auto-return timer for transient one-shot reactions (e.g. celebrate, tap)
          const isContinuous = ['thinking', 'working', 'excited', 'curious', 'happy', 'searching', 'idle', 'listening'].includes(validKey);
          if (autoReturnIdleMs && autoReturnIdleMs > 0 && !isContinuous) {
            autoIdleTimerRef.current = setTimeout(() => {
              try {
                instanceRef.current?.play('idle');
                activeAnimRef.current = 'idle';
              } catch (e) {
                // ignore
              }
            }, autoReturnIdleMs);
          }
        } catch (e) {
          console.warn('Imperative play error:', e);
        }
      },
      setExpression: (expr: ExpressionKey | string) => {
        if (!instanceRef.current) return;
        const validKey = VALID_EXPRESSIONS.includes(expr as ExpressionKey) ? (expr as ExpressionKey) : 'neutral';
        try {
          instanceRef.current.setExpression(validKey);
        } catch (e) {
          console.warn('Imperative setExpression error:', e);
        }
      },
      stop: () => {
        try {
          instanceRef.current?.stop();
        } catch (e) {
          // ignore
        }
      },
      getState: () => {
        return {
          activeAnimation: activeAnimRef.current,
          hasInstance: !!instanceRef.current
        };
      }
    }));

    return (
      <div
        id={containerId}
        className={`relative flex items-center justify-center select-none overflow-visible ${className}`}
        style={{
          width: typeof size === 'number' ? `${size}px` : size,
          height: typeof size === 'number' ? `${size}px` : size,
          cursor: interactive && onClick ? 'pointer' : 'default'
        }}
        onClick={onClick}
        role={interactive ? 'button' : 'img'}
        aria-label={ariaLabel}
        tabIndex={interactive ? 0 : -1}
      >
        <div
          ref={containerRef}
          className="w-full h-full flex items-center justify-center pointer-events-none"
          style={{ width: '100%', height: '100%' }}
        />
        {initError && (
          <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-rose-600 bg-rose-50/90 rounded-2xl border border-rose-200">
            Onee Avatar: {initError}
          </div>
        )}
      </div>
    );
  }
);

AvatarController.displayName = 'AvatarController';

export default AvatarController;
