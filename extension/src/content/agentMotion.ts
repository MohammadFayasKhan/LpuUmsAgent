/*
 * Motion & Trajectory Controller for ONEE Computer Use.
 *
 * When an AI clicks elements on a page, teleporting the pointer instantly from point A
 * to point B looks robotic and makes it hard for the student to follow what the agent is doing.
 *
 * This controller models human-like mouse movement:
 * 1. Cubic Bézier curves so the cursor curves slightly rather than moving in a dead-straight line.
 * 2. Cosine smoothstep easing so the cursor starts slowly, accelerates in the middle, and decelerates gently as it arrives at the target.
 * 3. Distance-calibrated travel times:
 *    - Short jumps (<200px): 400 to 550ms
 *    - Medium jumps (200 to 600px): 600 to 850ms
 *    - Long jumps (600 to 1200px): 850 to 1200ms
 */

export type MotionMode = 'natural' | 'fast';

export interface MotionTimingConfig {
  observationDelay: number;
  thinkingDelay: number;
  targetHoverDelay: number;
  preClickHighlightDelay: number;
  clickPulseDuration: number;
  postClickStabilization: number;
  scrollSettleDelay: number;
  preClickSettleDelay: number;
}

export const NATURAL_MOTION_TIMINGS: MotionTimingConfig = {
  observationDelay: 500,
  thinkingDelay: 600,
  targetHoverDelay: 450,
  preClickHighlightDelay: 450,
  clickPulseDuration: 220,
  postClickStabilization: 850,
  scrollSettleDelay: 650,
  preClickSettleDelay: 450
};

export const FAST_MOTION_TIMINGS: MotionTimingConfig = {
  observationDelay: 200,
  thinkingDelay: 250,
  targetHoverDelay: 180,
  preClickHighlightDelay: 200,
  clickPulseDuration: 150,
  postClickStabilization: 450,
  scrollSettleDelay: 350,
  preClickSettleDelay: 200
};

/*
 * Evaluates a cubic Bézier curve at interpolation factor t (0 to 1).
 * We add slight perpendicular offsets to control points p1 and p2 during movement
 * so the pointer follows a gentle, natural arc across the screen.
 */
export function calculateBezierPoint(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  t: number
): { x: number; y: number } {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;

  const x = uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x;
  const y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;

  return { x, y };
}

/*
 * Cosine S-curve easing.
 * Provides zero starting velocity and zero landing velocity so the cursor
 * settles into the target smoothly without bouncing.
 */
export function calculatePrecisionEasing(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  return 0.5 * (1 - Math.cos(Math.PI * progress));
}

export class AgentMotionController {
  private mode: MotionMode = 'natural';

  constructor(mode: MotionMode = 'natural') {
    this.mode = mode;
  }

  public setMode(mode: MotionMode): void {
    this.mode = mode;
  }

  public getMode(): MotionMode {
    return this.mode;
  }

  public getTimings(): MotionTimingConfig {
    return this.mode === 'fast' ? FAST_MOTION_TIMINGS : NATURAL_MOTION_TIMINGS;
  }

  /*
   * Computes the movement duration based on pixel distance.
   * Longer paths take more time so the cursor never appears to jump unnaturally.
   */
  public getCursorTravelDuration(fromX: number, fromY: number, toX: number, toY: number): number {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (this.mode === 'fast') {
      if (distance < 200) return 250;
      if (distance < 600) return 380;
      if (distance < 1200) return 500;
      return 650;
    }

    if (distance < 200) {
      return Math.round(400 + (distance / 200) * 150);
    }
    if (distance < 600) {
      return Math.round(600 + ((distance - 200) / 400) * 250);
    }
    if (distance < 1200) {
      return Math.round(850 + ((distance - 600) / 600) * 350);
    }
    return Math.min(1450, Math.round(1200 + ((distance - 1200) / 800) * 250));
  }

  public async wait(durationMs: number, checkCancelled?: () => boolean): Promise<void> {
    if (checkCancelled && checkCancelled()) return;
    if (durationMs <= 0) return;
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
      return new Promise((resolve) => setTimeout(resolve, Math.min(durationMs, 10)));
    }
    if (!checkCancelled) {
      return new Promise((resolve) => setTimeout(resolve, durationMs));
    }
    return new Promise((resolve) => {
      const start = performance.now();
      const interval = setInterval(() => {
        if (checkCancelled()) {
          clearInterval(interval);
          resolve();
          return;
        }
        if (performance.now() - start >= durationMs) {
          clearInterval(interval);
          resolve();
        }
      }, 20);
    });
  }
}

export const agentMotion = new AgentMotionController('natural');
