/*
 * Coordinate Utilities & Spatial Math Test Suite.
 *
 * Validates coordinate transformation accuracy across coordinate spaces:
 * - Document to viewport and viewport to document translation with scroll offsets.
 * - Vision 0-1000 normalized space to CSS pixel coordinate mapping.
 * - Safe viewport detection accounting for fixed headers and navigation bars.
 */

import { describe, it, expect } from 'vitest';
import {
  documentToViewport,
  viewportToDocument,
  visionToViewport,
  isTargetInSafeViewport,
  calculateSafeScrollDelta
} from '../content/coordinateUtils';

describe('coordinateUtils', () => {
  it('converts between document and viewport coordinates', () => {
    Object.defineProperty(window, 'scrollX', { value: 50, writable: true });
    Object.defineProperty(window, 'scrollY', { value: 200, writable: true });

    const vp = documentToViewport(150, 400);
    expect(vp.x).toBe(100);
    expect(vp.y).toBe(200);

    const doc = viewportToDocument(100, 200);
    expect(doc.x).toBe(150);
    expect(doc.y).toBe(400);
  });

  it('transforms vision bounding box to viewport space', () => {
    const bbox = { x: 100, y: 200, width: 300, height: 100 };
    const scaled = visionToViewport(bbox, 1920, 1080, 960, 540);
    expect(scaled.x).toBe(50);
    expect(scaled.y).toBe(100);
    expect(scaled.width).toBe(150);
    expect(scaled.height).toBe(50);
  });

  it('determines safe viewport position and scroll deltas', () => {
    Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true });

    // Element comfortably in center (top: 300, bottom: 350)
    const elSafe = document.createElement('div');
    elSafe.getBoundingClientRect = () => ({
      top: 300,
      bottom: 350,
      left: 100,
      right: 200,
      width: 100,
      height: 50,
      x: 100,
      y: 300,
      toJSON: () => {}
    });
    document.body.appendChild(elSafe);

    expect(isTargetInSafeViewport(elSafe)).toBe(true);
    expect(calculateSafeScrollDelta(elSafe)).toBe(0);

    // Element below viewport (top: 900, bottom: 950)
    const elBelow = document.createElement('div');
    elBelow.getBoundingClientRect = () => ({
      top: 900,
      bottom: 950,
      left: 100,
      right: 200,
      width: 100,
      height: 50,
      x: 100,
      y: 900,
      toJSON: () => {}
    });
    document.body.appendChild(elBelow);

    expect(isTargetInSafeViewport(elBelow)).toBe(false);
    const delta = calculateSafeScrollDelta(elBelow);
    expect(delta).toBeGreaterThan(0);
  });
});
