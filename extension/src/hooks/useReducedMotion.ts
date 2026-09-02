/*
 * Accessibility Hook: Prefers Reduced Motion.
 *
 * Some students experience motion sickness or vestibular discomfort from rapid
 * UI transitions and continuous 3D avatar animations.
 *
 * This hook listens to the system-level `prefers-reduced-motion` media query.
 * When enabled, components use instant transitions, disable pulsing glow rings,
 * and keep the avatar in its resting neutral stance.
 */

import { useState, useEffect } from 'react';

export function useReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return prefersReducedMotion;
}

export default useReducedMotion;
