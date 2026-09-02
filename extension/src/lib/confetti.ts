/*
 * Success Confetti Celebration for ONEE.
 *
 * When an attendance table is verified or a Computer Use goal completes,
 * we trigger a brief, subtle micro-burst of confetti to give positive feedback.
 *
 * It checks prefers-reduced-motion first so students who have reduced motion
 * enabled in their operating system never see abrupt particle effects.
 */

import confetti from 'canvas-confetti';

export function triggerSuccessConfetti() {
  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReduced) return;

  try {
    confetti({
      particleCount: 25,
      spread: 60,
      origin: { y: 0.2, x: 0.5 },
      colors: ['#7C3AED', '#A78BFA', '#34C759', '#60A5FA'],
      disableForReducedMotion: true,
      ticks: 120,
      scalar: 0.8
    });
  } catch {}
}
