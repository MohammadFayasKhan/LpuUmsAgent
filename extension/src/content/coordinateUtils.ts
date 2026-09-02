/*
 * Coordinate & Viewport Utilities for ONEE Computer Use.
 *
 * When an agent interacts with a webpage, it deals with three different coordinate spaces:
 * 1. Document Space: Absolute coordinates relative to the top-left of the entire HTML document.
 * 2. Viewport Space: Coordinates relative to what is currently visible on the screen.
 * 3. Vision Space: Pixel coordinates derived from tab screenshots (which can differ due to devicePixelRatio).
 *
 * It also calculates the "Safe Zone" on UMS:
 * LPU UMS uses a fixed top navbar (~70px tall). If an element is scrolled behind that navbar,
 * a click at its coordinates will hit the navbar instead of the button. This module detects
 * the navbar height and computes safe scroll deltas so the target is always brought into the
 * clear middle area before clicking.
 */

import { BoundingBox } from '../shared/types';

export interface SafeViewportBounds {
  safeTop: number;
  safeBottom: number;
  safeHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}

/*
 * Converts document-relative coordinates into current viewport coordinates
 * by subtracting current window scroll offsets.
 */
export function documentToViewport(docX: number, docY: number): { x: number; y: number } {
  const scrollX = window.scrollX || window.pageXOffset || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;
  return {
    x: Math.round(docX - scrollX),
    y: Math.round(docY - scrollY)
  };
}

/*
 * Converts viewport coordinates into document coordinates
 * by adding current window scroll offsets.
 */
export function viewportToDocument(vpX: number, vpY: number): { x: number; y: number } {
  const scrollX = window.scrollX || window.pageXOffset || 0;
  const scrollY = window.scrollY || window.pageYOffset || 0;
  return {
    x: Math.round(vpX + scrollX),
    y: Math.round(vpY + scrollY)
  };
}

/*
 * Rescales bounding boxes returned by multimodal vision models
 * from screenshot resolution to the browser's current CSS viewport dimensions.
 */
export function visionToViewport(
  bbox: BoundingBox,
  screenshotWidth: number,
  screenshotHeight: number,
  viewportWidth: number = window.innerWidth,
  viewportHeight: number = window.innerHeight
): BoundingBox {
  if (!screenshotWidth || !screenshotHeight) return bbox;

  const scaleX = viewportWidth / screenshotWidth;
  const scaleY = viewportHeight / screenshotHeight;

  return {
    x: Math.round(bbox.x * scaleX),
    y: Math.round(bbox.y * scaleY),
    width: Math.round(bbox.width * scaleX),
    height: Math.round(bbox.height * scaleY)
  };
}

/*
 * Measures the fixed UMS header height and calculates the safe vertical band
 * where elements can be clicked without being obstructed.
 */
export function getSafeViewportBounds(): SafeViewportBounds {
  const vpWidth = window.innerWidth || 1200;
  const vpHeight = window.innerHeight || 800;

  let headerHeight = 70; // Standard UMS navbar height
  try {
    const nav = document.querySelector('.navbar, #header, header, .top-header, .navbar-fixed-top');
    if (nav) {
      const rect = nav.getBoundingClientRect();
      if (rect.height > 30 && rect.height < 200) {
        headerHeight = Math.round(rect.height);
      }
    }
  } catch {}

  const safeTop = headerHeight + 20; // Safe margin below the navbar
  const safeBottom = Math.max(safeTop + 150, vpHeight - 100); // Safe margin above bottom edge
  const safeHeight = safeBottom - safeTop;

  return {
    safeTop,
    safeBottom,
    safeHeight,
    viewportWidth: vpWidth,
    viewportHeight: vpHeight
  };
}

/*
 * Checks whether an element's bounding box is fully inside the safe interaction band.
 */
export function isTargetInSafeViewport(element: HTMLElement): boolean {
  if (!element || !element.ownerDocument) return false;
  const rect = element.getBoundingClientRect();
  const { safeTop, safeBottom } = getSafeViewportBounds();

  return rect.top >= safeTop && rect.bottom <= safeBottom && rect.height > 0 && rect.width > 0;
}

/*
 * Computes how many pixels the window needs to scroll to bring an element
 * comfortably into the center (45% from top) of the safe zone.
 * Returns 0 if the element is already well-positioned.
 */
export function calculateSafeScrollDelta(element: HTMLElement): number {
  if (!element || !element.ownerDocument) return 0;
  const rect = element.getBoundingClientRect();
  const { safeTop, safeHeight } = getSafeViewportBounds();

  if (isTargetInSafeViewport(element)) {
    return 0; // No scroll needed
  }

  const targetCenterY = rect.top + rect.height / 2;
  const desiredY = safeTop + safeHeight * 0.45;

  return Math.round(targetCenterY - desiredY);
}
