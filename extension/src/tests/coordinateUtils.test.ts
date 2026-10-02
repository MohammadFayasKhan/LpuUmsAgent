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
  calculateSafeScrollDelta,
  getTightBoundingBox
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

  it('calculates tight bounding box for attendance container with empty space on the left', () => {
    const container = document.createElement('div');
    container.className = 'col-xs-6 text-right';
    container.innerHTML = `
      <span class="lbl-attendance">ATTENDANCE : 91%</span>
      <a href="#"><i class="fa fa-info-circle"></i></a>
    `;
    container.getBoundingClientRect = () => ({
      top: 200,
      bottom: 232,
      left: 400,
      right: 660,
      width: 260,
      height: 32,
      x: 400,
      y: 200,
      toJSON: () => {}
    });

    const span = container.querySelector('span') as HTMLElement;
    span.getBoundingClientRect = () => ({
      top: 200,
      bottom: 232,
      left: 540,
      right: 635,
      width: 95,
      height: 32,
      x: 540,
      y: 200,
      toJSON: () => {}
    });

    const icon = container.querySelector('i') as HTMLElement;
    icon.getBoundingClientRect = () => ({
      top: 200,
      bottom: 232,
      left: 640,
      right: 660,
      width: 20,
      height: 32,
      x: 640,
      y: 200,
      toJSON: () => {}
    });

    document.body.appendChild(container);

    const tight = getTightBoundingBox(container);
    // Should trim the left whitespace from 400 to 540
    expect(tight.left).toBe(540);
    expect(tight.width).toBe(120);
    expect(tight.right).toBe(660);
  });

  it('preserves full width bounding box for table rows and data tables', () => {
    const tr = document.createElement('tr');
    tr.getBoundingClientRect = () => ({
      top: 150,
      bottom: 180,
      left: 50,
      right: 850,
      width: 800,
      height: 30,
      x: 50,
      y: 150,
      toJSON: () => {}
    });
    document.body.appendChild(tr);

    const tight = getTightBoundingBox(tr);
    expect(tight.left).toBe(50);
    expect(tight.width).toBe(800);
  });
});

