/*
 * AI Cursor and Visual Grounding Overlay for UMS.
 *
 * We inject this floating overlay directly into the UMS page so the student can
 * watch ONEE move and click in real time.
 *
 * It consists of three visual layers:
 * 1. An SVG cursor pointer with an attached action label pill.
 * 2. A bounding box highlight around the targeted element or table.
 * 3. A ripple / pulse ring when a click is executed.
 *
 * We use fixed positioning with `pointer-events: none` so the overlay never blocks
 * the student's normal clicks on the page.
 */

import {
  agentMotion,
  calculateBezierPoint,
  calculatePrecisionEasing
} from './agentMotion';

let cursorContainer: HTMLDivElement | null = null;
let cursorPointer: HTMLDivElement | null = null;
let statusPill: HTMLDivElement | null = null;
let highlightBox: HTMLDivElement | null = null;
let targetBadge: HTMLDivElement | null = null;

// Floating-point sub-pixel cursor coordinates
let currentX = window.innerWidth / 2;
let currentY = window.innerHeight / 2;

// Active animation frame handle
let activeAnimationId: number | null = null;
let activeTargetElement: HTMLElement | null = null;
let scrollTrackingListener: (() => void) | null = null;

export type TargetHighlightState = 'discovered' | 'approaching' | 'verified' | 'clicked' | 'hidden';

export function getCurrentCursorPos(): { x: number; y: number } {
  return { x: currentX, y: currentY };
}

/*
 * Mounts the cursor overlay DOM elements into document.body if not already present.
 * We attach it to document.body and use a high z-index so it floats cleanly above
 * all UMS elements without modifying the university's stylesheet.
 */
export function initAiCursorOverlay(): void {
  if (document.getElementById('onee-ai-cursor-root')) {
    return;
  }

  cursorContainer = document.createElement('div');
  cursorContainer.id = 'onee-ai-cursor-root';
  cursorContainer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    pointer-events: none;
    z-index: 2147483647;
    display: none;
    opacity: 0;
    transition: opacity 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  `;

  // LAYER 2: Target Highlight Box (surrounds real DOM target)
  highlightBox = document.createElement('div');
  highlightBox.id = 'onee-ai-highlight-box';
  highlightBox.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    border: 2px solid #7c3aed;
    border-radius: 6px;
    background: rgba(124, 58, 237, 0.10);
    box-shadow: 0 0 16px rgba(124, 58, 237, 0.35);
    display: none;
    pointer-events: none;
    will-change: transform, width, height;
    transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), width 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), height 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
  `;

  targetBadge = document.createElement('div');
  targetBadge.id = 'onee-ai-target-badge';
  targetBadge.style.cssText = `
    position: absolute;
    top: -20px;
    left: 0;
    background: #7c3aed;
    color: #ffffff;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 1px 6px;
    border-radius: 3px;
    white-space: nowrap;
    opacity: 0;
    transition: opacity 0.2s ease;
  `;
  targetBadge.textContent = 'TARGET VERIFIED';
  highlightBox.appendChild(targetBadge);

  // LAYER 1: Cursor Pointer (SVG)
  cursorPointer = document.createElement('div');
  cursorPointer.id = 'onee-ai-pointer';
  cursorPointer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 32px;
    height: 32px;
    pointer-events: none;
    will-change: transform;
    display: flex;
    align-items: center;
    justify-content: center;
    transform: translate3d(${currentX}px, ${currentY}px, 0);
  `;

  cursorPointer.innerHTML = `
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 4px 12px rgba(124, 58, 237, 0.45)) drop-shadow(0 2px 6px rgba(0,0,0,0.5));">
      <path d="M4.5 3.5L18.5 11.5L12 14L9.5 20.5L4.5 3.5Z" fill="#7C3AED" stroke="#FFFFFF" stroke-width="1.8" stroke-linejoin="round"/>
      <circle cx="12" cy="14" r="2.2" fill="#F97316" stroke="#FFFFFF" stroke-width="0.8" />
    </svg>
  `;

  // LAYER 3: Action Annotation Pill (smoothly tracks cursor with automatic edge flipping)
  statusPill = document.createElement('div');
  statusPill.id = 'onee-ai-status-pill';
  statusPill.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    background: #09090b;
    color: #f4f4f5;
    border: 1px solid rgba(124, 58, 237, 0.4);
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    box-shadow: 0 4px 14px rgba(0,0,0,0.5);
    opacity: 0;
    transition: opacity 0.2s ease;
    display: flex;
    align-items: center;
    gap: 5px;
    pointer-events: none;
    will-change: transform;
    z-index: 2147483647;
  `;
  statusPill.innerHTML = `
    <span style="color: #a78bfa; font-weight: 700;">ONEE</span>
    <span style="color: #52525b;">•</span>
    <span id="onee-ai-action-text">Operating...</span>
  `;

  cursorContainer.appendChild(highlightBox);
  cursorContainer.appendChild(cursorPointer);
  cursorContainer.appendChild(statusPill);
  document.body.appendChild(cursorContainer);

  // Setup viewport synchronization listener
  setupViewportTracking();
}

/**
 * Keeps target highlight synchronized with real DOM element during scroll/resize.
 */
function setupViewportTracking(): void {
  if (scrollTrackingListener) return;

  scrollTrackingListener = () => {
    if (activeTargetElement && highlightBox && highlightBox.style.display !== 'none') {
      const rect = activeTargetElement.getBoundingClientRect();
      highlightBox.style.transform = `translate3d(${rect.left - 4}px, ${rect.top - 4}px, 0)`;
      highlightBox.style.width = `${rect.width + 8}px`;
      highlightBox.style.height = `${rect.height + 8}px`;
    }
  };

  window.addEventListener('scroll', scrollTrackingListener, { passive: true });
  window.addEventListener('resize', scrollTrackingListener, { passive: true });
}

/**
 * Shows the AI cursor overlay with smooth fade-in.
 * If initial coordinates are provided (e.g. from the right sidepanel edge),
 * it originates directly from there.
 */
export function showCursor(
  initialX?: number,
  initialY?: number,
  initialLabel?: string
): void {
  initAiCursorOverlay();

  // Position at specified origin or default right-edge dock (beside sidepanel)
  if (typeof initialX === 'number' && typeof initialY === 'number') {
    currentX = initialX;
    currentY = initialY;
    if (cursorPointer) {
      cursorPointer.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
    }
    updatePillPosition(currentX, currentY);
  } else if (currentX === window.innerWidth / 2 && currentY === window.innerHeight / 2) {
    currentX = Math.max(10, window.innerWidth - 30);
    currentY = 220;
    if (cursorPointer) {
      cursorPointer.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
    }
    updatePillPosition(currentX, currentY);
  }

  if (initialLabel) {
    setCursorStatus(initialLabel);
  }

  if (cursorContainer) {
    cursorContainer.style.display = 'block';
    requestAnimationFrame(() => {
      if (cursorContainer) {
        cursorContainer.style.opacity = '1';
      }
    });
  }
}

/**
 * Hides the AI cursor overlay gracefully with smooth fade-out.
 */
export function hideCursor(): void {
  if (activeAnimationId !== null) {
    cancelAnimationFrame(activeAnimationId);
    activeAnimationId = null;
  }
  if (cursorContainer) {
    cursorContainer.style.opacity = '0';
    setTimeout(() => {
      if (cursorContainer && cursorContainer.style.opacity === '0') {
        cursorContainer.style.display = 'none';
      }
    }, 240);
  }
  hideHighlight();
}

/**
 * Updates contextual action label attached to the cursor.
 */
export function setCursorStatus(text: string): void {
  initAiCursorOverlay();
  showCursor();
  if (statusPill) {
    const textSpan = statusPill.querySelector('#onee-ai-action-text');
    if (textSpan) {
      let icon = '✦';
      const textLower = text.toLowerCase();
      if (textLower.includes('verif') || textLower.includes('matched') || textLower.includes('confirm')) {
        icon = '✓';
      } else if (textLower.includes('open') || textLower.includes('click') || textLower.includes('select')) {
        icon = '↗';
      } else if (textLower.includes('scroll') || textLower.includes('bring')) {
        icon = '↕';
      }
      textSpan.innerHTML = `<span style="color: #a78bfa; font-weight: 700; margin-right: 4px;">${icon}</span>${text}`;
    }
    statusPill.style.opacity = '1';
    updatePillPosition(currentX, currentY);
  }
}

/**
 * Positions status pill with automatic viewport-edge avoidance.
 */
function updatePillPosition(x: number, y: number): void {
  if (!statusPill) return;

  const pillWidth = statusPill.offsetWidth || 140;
  const pillHeight = statusPill.offsetHeight || 26;

  let pillX = x + 20;
  let pillY = y + 16;

  // Auto-flip if overflowing right edge
  if (pillX + pillWidth > window.innerWidth - 16) {
    pillX = x - pillWidth - 12;
  }

  // Auto-flip if overflowing bottom edge
  if (pillY + pillHeight > window.innerHeight - 16) {
    pillY = y - pillHeight - 10;
  }

  statusPill.style.transform = `translate3d(${pillX}px, ${pillY}px, 0)`;
}

/**
 * Updates visual state of target highlight box.
 */
export function setHighlightState(state: TargetHighlightState): void {
  if (!highlightBox || !targetBadge) return;

  switch (state) {
    case 'discovered':
      highlightBox.style.display = 'block';
      highlightBox.style.borderColor = 'rgba(124, 58, 237, 0.4)';
      highlightBox.style.background = 'rgba(124, 58, 237, 0.06)';
      highlightBox.style.boxShadow = '0 0 10px rgba(124, 58, 237, 0.2)';
      targetBadge.style.opacity = '0';
      break;

    case 'approaching':
      highlightBox.style.display = 'block';
      highlightBox.style.borderColor = '#7c3aed';
      highlightBox.style.background = 'rgba(124, 58, 237, 0.12)';
      highlightBox.style.boxShadow = '0 0 18px rgba(124, 58, 237, 0.4)';
      targetBadge.style.opacity = '0';
      break;

    case 'verified':
      highlightBox.style.display = 'block';
      highlightBox.style.borderColor = '#10b981';
      highlightBox.style.background = 'rgba(16, 185, 129, 0.10)';
      highlightBox.style.boxShadow = '0 0 20px rgba(16, 185, 129, 0.45)';
      targetBadge.style.background = '#10b981';
      targetBadge.style.opacity = '1';
      break;

    case 'clicked':
      highlightBox.style.borderColor = '#a78bfa';
      highlightBox.style.boxShadow = '0 0 24px rgba(167, 139, 250, 0.6)';
      break;

    case 'hidden':
      highlightBox.style.display = 'none';
      targetBadge.style.opacity = '0';
      break;
  }
}

/**
 * Highlights a target DOM element with live bounding box tracking.
 */
export function highlightElement(el: HTMLElement, label?: string, state: TargetHighlightState = 'discovered'): void {
  initAiCursorOverlay();
  showCursor();

  activeTargetElement = el;
  const rect = el.getBoundingClientRect();

  if (highlightBox) {
    highlightBox.style.transform = `translate3d(${rect.left - 4}px, ${rect.top - 4}px, 0)`;
    highlightBox.style.width = `${rect.width + 8}px`;
    highlightBox.style.height = `${rect.height + 8}px`;
    setHighlightState(state);
  }

  if (label) {
    setCursorStatus(label);
  }
}

/**
 * Removes target highlight.
 */
export function hideHighlight(): void {
  activeTargetElement = null;
  setHighlightState('hidden');
  if (statusPill) {
    statusPill.style.opacity = '0';
  }
}

/**
 * Smoothly animates the AI cursor along a deterministic cubic Bézier trajectory
 * using requestAnimationFrame and high-precision elapsed time integration.
 */
export async function animateCursorTo(
  targetX: number,
  targetY: number,
  customDurationMs?: number
): Promise<void> {
  initAiCursorOverlay();
  showCursor();

  // Clamp within safe viewport bounds
  const destX = Math.max(12, Math.min(window.innerWidth - 24, targetX));
  const destY = Math.max(12, Math.min(window.innerHeight - 24, targetY));

  const startX = currentX;
  const startY = currentY;

  const dx = destX - startX;
  const dy = destY - startY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // If already virtually at target
  if (distance < 3) {
    currentX = destX;
    currentY = destY;
    if (cursorPointer) {
      cursorPointer.style.transform = `translate3d(${destX}px, ${destY}px, 0)`;
    }
    updatePillPosition(destX, destY);
    return;
  }

  const duration = customDurationMs ?? agentMotion.getCursorTravelDuration(startX, startY, destX, destY);

  // Small perpendicular offset proportional to distance (max 35px)
  const normX = -dy / (distance || 1);
  const normY = dx / (distance || 1);
  const curveFactor = Math.min(35, distance * 0.08);

  const p0 = { x: startX, y: startY };
  const p1 = { x: startX + dx * 0.25 + normX * curveFactor, y: startY + dy * 0.25 + normY * curveFactor };
  const p2 = { x: startX + dx * 0.75 + normX * (curveFactor * 0.5), y: startY + dy * 0.75 + normY * (curveFactor * 0.5) };
  const p3 = { x: destX, y: destY };

  return new Promise<void>((resolve) => {
    let startTime: number | null = null;

    if (activeAnimationId !== null) {
      cancelAnimationFrame(activeAnimationId);
      activeAnimationId = null;
    }

    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(1, elapsed / (duration || 1));

      // Precision easing: slow start, cruise, pronounced deceleration in final 20%
      const easedT = calculatePrecisionEasing(progress);
      const point = calculateBezierPoint(p0, p1, p2, p3, easedT);

      currentX = point.x;
      currentY = point.y;

      if (cursorPointer) {
        cursorPointer.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
      }

      updatePillPosition(point.x, point.y);

      if (progress < 1) {
        activeAnimationId = requestAnimationFrame(step);
      } else {
        // Land exactly at destination
        currentX = destX;
        currentY = destY;
        if (cursorPointer) {
          cursorPointer.style.transform = `translate3d(${destX}px, ${destY}px, 0)`;
        }
        updatePillPosition(destX, destY);
        activeAnimationId = null;
        resolve();
      }
    };

    activeAnimationId = requestAnimationFrame(step);
  });
}

/**
 * Visual click ripple animation on cursor upon real click event.
 */
export async function triggerClickRipple(): Promise<void> {
  if (!cursorPointer) return;

  setHighlightState('clicked');

  const ripple = document.createElement('div');
  ripple.style.cssText = `
    position: absolute;
    left: 6px;
    top: 6px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(124, 58, 237, 0.9);
    box-shadow: 0 0 12px rgba(124, 58, 237, 0.7);
    transform: translate(-50%, -50%) scale(1);
    animation: oneeRipple 0.38s cubic-bezier(0.22, 1, 0.36, 1) forwards;
    pointer-events: none;
  `;

  if (!document.getElementById('onee-ripple-style')) {
    const style = document.createElement('style');
    style.id = 'onee-ripple-style';
    style.textContent = `
      @keyframes oneeRipple {
        0% { transform: translate(-50%, -50%) scale(1); opacity: 0.95; }
        100% { transform: translate(-50%, -50%) scale(4.8); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }

  cursorPointer.appendChild(ripple);
  const pulseDuration = agentMotion.getTimings().clickPulseDuration;
  await new Promise((r) => setTimeout(r, pulseDuration));
  setTimeout(() => ripple.remove(), 300);
}
