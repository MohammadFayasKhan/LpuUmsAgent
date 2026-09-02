/*
 * Hybrid Vision-DOM Grounding Test Suite.
 *
 * Validates cross-modal target element matching:
 * - 2D Intersection-over-Union (IoU) box overlap calculations.
 * - Text similarity scoring (fuzzy string matching against action descriptions).
 * - Clickable ancestor resolution for inner span/icon targets.
 */

import { describe, it, expect } from 'vitest';
import {
  computeIoU,
  hybridGrounding
} from '../content/hybridGrounding';
import { resolveClickableAncestor } from '../content/pageObserver';
import { PageElement, BoundingBox, VisionTargetCandidate, AgentAction } from '../shared/types';

describe('hybridGrounding', () => {
  it('calculates exact 2D Intersection-over-Union (IoU)', () => {
    const boxA: BoundingBox = { x: 100, y: 100, width: 100, height: 100 };
    const boxB: BoundingBox = { x: 100, y: 100, width: 100, height: 100 };
    expect(computeIoU(boxA, boxB)).toBeCloseTo(1.0, 2);

    const boxC: BoundingBox = { x: 150, y: 100, width: 100, height: 100 };
    // Intersection = 50 * 100 = 5000; Union = 10000 + 10000 - 5000 = 15000; IoU = 5000 / 15000 = 0.333
    expect(computeIoU(boxA, boxC)).toBeCloseTo(0.333, 2);

    const boxD: BoundingBox = { x: 300, y: 300, width: 50, height: 50 };
    expect(computeIoU(boxA, boxD)).toBe(0);
  });

  it('resolves clickable ancestor through DOM hierarchy', () => {
    document.body.innerHTML = `
      <div id="wrapper">
        <a id="navLink" href="/attendance">
          <span id="innerSpan">Academics</span>
        </a>
        <button id="btnAction">
          <i id="innerIcon" class="fa fa-info"></i>
        </button>
      </div>
    `;

    const span = document.getElementById('innerSpan')!;
    const resolvedLink = resolveClickableAncestor(span);
    expect(resolvedLink.id).toBe('navLink');

    const icon = document.getElementById('innerIcon')!;
    const resolvedBtn = resolveClickableAncestor(icon);
    expect(resolvedBtn.id).toBe('btnAction');
  });

  it('disambiguates duplicate text elements using vision spatial coordinates', () => {
    // Example from architecture specification:
    // Candidate A: text = "Academics", bbox = (120, 400, 130, 45) -> Real top navbar
    // Candidate B: text = "Academics", bbox = (120, 400, 130, 45) -> hidden
    // Candidate C: text = "Academics", bbox = (800, 700, 130, 45) -> irrelevant footer
    const candidates: PageElement[] = [
      {
        id: 'onee-001',
        tag: 'a',
        role: 'link',
        text: 'Academics',
        visible: true,
        enabled: true,
        x: 120,
        y: 400,
        width: 130,
        height: 45,
        centerX: 185,
        centerY: 422
      },
      {
        id: 'onee-002',
        tag: 'a',
        role: 'link',
        text: 'Academics',
        visible: false,
        enabled: true,
        x: 120,
        y: 400,
        width: 130,
        height: 45,
        centerX: 185,
        centerY: 422
      },
      {
        id: 'onee-003',
        tag: 'a',
        role: 'link',
        text: 'Academics',
        visible: true,
        enabled: true,
        x: 800,
        y: 700,
        width: 130,
        height: 45,
        centerX: 865,
        centerY: 722
      }
    ];

    const visionTarget: VisionTargetCandidate = {
      targetDescription: 'Academics navigation menu',
      bbox: { x: 118, y: 398, width: 135, height: 50 },
      confidence: 0.92
    };

    const action: AgentAction = {
      action: 'click',
      reason: 'Opening Academics menu'
    };

    const result = hybridGrounding(action, visionTarget, candidates);

    expect(result.isConfident).toBe(true);
    expect(result.bestCandidate).toBeDefined();
    // Must select Candidate A (onee-001) over Candidate C (onee-003) and hidden Candidate B (onee-002)
    expect(result.bestCandidate?.element.id).toBe('onee-001');
    expect(result.bestCandidate?.breakdown.spatialScore).toBeGreaterThan(0.7);
  });
});
