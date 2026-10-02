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

export interface TightElementRect {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

/**
 * Calculates a tight, visually accurate bounding box for an element.
 * 
 * For block containers or right-aligned links (e.g. Bootstrap col-xs-6 text-right
 * containing "ATTENDANCE : 91% ⓘ"), el.getBoundingClientRect() includes wide
 * empty padding/margins on the left.
 * This function detects when the inner content/text/children occupy a tighter,
 * more compact area and returns the tight content rect so the highlight box
 * and cursor interaction point are positioned efficiently without trailing
 * empty space on the left.
 */
export function getTightBoundingBox(el: HTMLElement): TightElementRect {
  const baseRect = el.getBoundingClientRect();
  const fallback: TightElementRect = {
    left: baseRect.left,
    top: baseRect.top,
    width: baseRect.width,
    height: baseRect.height,
    right: baseRect.right ?? baseRect.left + baseRect.width,
    bottom: baseRect.bottom ?? baseRect.top + baseRect.height
  };

  if (!el || !el.ownerDocument || !el.isConnected || baseRect.width <= 0 || baseRect.height <= 0) {
    return fallback;
  }

  // Never shrink full-width data tables or table rows
  const tag = el.tagName.toLowerCase();
  if (tag === 'table' || tag === 'tr' || tag === 'tbody' || tag === 'thead') {
    return fallback;
  }

  try {
    const doc = el.ownerDocument || document;
    const text = (el.textContent || '').trim();
    const isAttendance = text.toUpperCase().includes('ATTENDANCE');
    const isAcademics = text.toUpperCase().includes('ACADEMICS');

    // If element is a dropdown wrapper container (e.g. li.dropdown, .nav-item),
    // delegate to its direct trigger link so the highlight box wraps the button only!
    const isDropdownContainer =
      (el.classList.contains('dropdown') ||
       el.classList.contains('nav-item') ||
       el.classList.contains('dropdown-submenu') ||
       el.tagName.toLowerCase() === 'li') &&
      !isAttendance;

    if (isDropdownContainer) {
      const trigger = el.querySelector<HTMLElement>('a.dropdown-toggle, a, button, [role="button"]');
      if (trigger && trigger !== el) {
        const trRect = trigger.getBoundingClientRect();
        if (trRect.width > 0 && trRect.height > 0) {
          return getTightBoundingBox(trigger);
        }
      }
    }

    // 1. Attempt Range-based measurement of actual rendered text & inline content
    try {
      if (typeof doc.createRange === 'function') {
        let range: Range | null = null;

        if (isAttendance && typeof doc.createTreeWalker === 'function') {
          const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let curr: Node | null;
          while ((curr = walker.nextNode())) {
            if (curr.textContent && curr.textContent.toUpperCase().includes('ATTENDANCE')) {
              range = doc.createRange();
              range.setStart(curr, 0);
              const lastNode = el.lastElementChild || el.lastChild || curr;
              if (lastNode instanceof Element) {
                range.setEndAfter(lastNode);
              } else {
                range.setEnd(curr, curr.textContent.length);
              }
              break;
            }
          }
        }

        if (!range) {
          range = doc.createRange();
          range.selectNodeContents(el);
        }

        if (range && typeof range.getBoundingClientRect === 'function') {
          const rRect = range.getBoundingClientRect();
          if (rRect && rRect.width > 0 && rRect.height > 0) {
            const hasLeftGap = rRect.left > baseRect.left + 8;
            const isSignificantlyTighter = rRect.width < baseRect.width * 0.92;
            const isSignificantlyTighterHeight = rRect.height < baseRect.height * 0.85;

            if (isAttendance) {
              return {
                left: rRect.left,
                top: rRect.top,
                width: rRect.width,
                height: rRect.height,
                right: rRect.right ?? rRect.left + rRect.width,
                bottom: rRect.bottom ?? rRect.top + rRect.height
              };
            }

            if (isAcademics || isSignificantlyTighterHeight || (hasLeftGap && isSignificantlyTighter)) {
              const padX = isAcademics ? 6 : 4;
              const padY = isAcademics ? 4 : 2;
              const tLeft = Math.max(baseRect.left, rRect.left - padX);
              const tTop = Math.max(baseRect.top, rRect.top - padY);
              const tRight = Math.min(baseRect.right ?? baseRect.left + baseRect.width, (rRect.right ?? rRect.left + rRect.width) + padX);
              const tBottom = Math.min(baseRect.bottom ?? baseRect.top + baseRect.height, (rRect.bottom ?? rRect.top + rRect.height) + padY);

              return {
                left: tLeft,
                top: tTop,
                width: Math.max(10, tRight - tLeft),
                height: Math.max(10, tBottom - tTop),
                right: tRight,
                bottom: tBottom
              };
            }
          }
        }
      }
    } catch {}

    // 2. Child Union Fallback: check bounding boxes of child elements (e.g. spans, icons, links)
    try {
      const children = Array.from(el.querySelectorAll<HTMLElement>('*')).filter((c) => {
        if (!c.isConnected) return false;
        const cr = c.getBoundingClientRect();
        return cr && cr.width > 0 && cr.height > 0;
      });

      if (children.length > 0) {
        const relevantChildren = isAttendance
          ? children.filter(
              (c) =>
                (c.textContent || '').toUpperCase().includes('ATTENDANCE') ||
                c.tagName.toLowerCase() === 'a' ||
                c.tagName.toLowerCase() === 'button' ||
                c.tagName.toLowerCase() === 'i' ||
                c.tagName.toLowerCase() === 'svg' ||
                c.classList.contains('fa-info-circle') ||
                c.querySelector('i, svg') !== null ||
                c.getAttribute('onclick')?.toLowerCase().includes('attendance') ||
                c.id?.toLowerCase().includes('att')
            )
          : children;

        const targetChildren = relevantChildren.length > 0 ? relevantChildren : children;

        let minLeft = Infinity;
        let minTop = Infinity;
        let maxRight = -Infinity;
        let maxBottom = -Infinity;

        for (const child of targetChildren) {
          const cr = child.getBoundingClientRect();
          if (cr && cr.width > 0 && cr.height > 0) {
            minLeft = Math.min(minLeft, cr.left);
            minTop = Math.min(minTop, cr.top);
            maxRight = Math.max(maxRight, cr.right ?? cr.left + cr.width);
            maxBottom = Math.max(maxBottom, cr.bottom ?? cr.top + cr.height);
          }
        }

        if (minLeft < maxRight && minTop < maxBottom) {
          const uWidth = maxRight - minLeft;
          const uHeight = maxBottom - minTop;
          const hasLeftGap = minLeft > baseRect.left + 8;

          if (isAttendance || (hasLeftGap && uWidth < baseRect.width * 0.92)) {
            return {
              left: minLeft,
              top: minTop,
              width: uWidth,
              height: uHeight,
              right: maxRight,
              bottom: maxBottom
            };
          }
        }
      }
    } catch {}
  } catch {}

  return fallback;
}

