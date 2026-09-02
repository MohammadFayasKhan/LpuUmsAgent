/*
 * Hybrid Grounding Engine for ONEE Computer Use.
 *
 * Grounding is how the agent takes an intent like "Click View Attendance"
 * and maps it to an exact physical pixel coordinate on the student's screen.
 *
 * Why we use a hybrid DOM + Vision approach:
 * 1. Pure Vision (predicting coordinates directly from screenshots) often clicks
 *    a few pixels off, missing small icons or clicking the wrong row.
 * 2. Pure DOM (matching text in HTML) can get confused by hidden accordion headers
 *    or duplicate navigation links.
 *
 * By cross-referencing both:
 * - We find DOM elements that match the text/role semantically (35% weight).
 * - We check if the vision model saw the button in that area (30% weight).
 * - We compute 2D Intersection-over-Union (IoU) to confirm the bounding boxes match (20% weight).
 *
 * If overall confidence is below 0.65, we don't click blindly. We ask the observer
 * for a fresh view or scroll into the safe zone.
 */

import {
  PageElement,
  BoundingBox,
  VisionTargetCandidate,
  ConfidenceBreakdown,
  GroundedCandidate,
  GroundedTarget,
  HybridGroundingResult,
  AgentAction
} from '../shared/types';

export interface GroundingWeights {
  semantic: number;
  visual: number;
  spatial: number;
  visibility: number;
  interaction: number;
}

export const DEFAULT_GROUNDING_WEIGHTS: GroundingWeights = {
  semantic: 0.35,
  visual: 0.30,
  spatial: 0.20,
  visibility: 0.10,
  interaction: 0.05
};

export const MIN_ACTION_CONFIDENCE = 0.65;

/**
 * Calculates 2D Intersection-over-Union (IoU) between two bounding boxes.
 */
export function computeIoU(a: BoundingBox, b: BoundingBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);

  const intersectionWidth = Math.max(0, x2 - x1);
  const intersectionHeight = Math.max(0, y2 - y1);
  const intersectionArea = intersectionWidth * intersectionHeight;

  const areaA = Math.max(1, a.width * a.height);
  const areaB = Math.max(1, b.width * b.height);
  const unionArea = areaA + areaB - intersectionArea;

  return unionArea > 0 ? intersectionArea / unionArea : 0;
}

/**
 * Computes normalized spatial proximity score (0.0 to 1.0) based on IoU and center distance.
 */
export function calculateSpatialScore(element: PageElement, targetBbox?: BoundingBox): number {
  if (!targetBbox) {
    const inViewport = element.x >= 0 && element.y >= 0 && element.width > 0 && element.height > 0;
    return inViewport ? 0.9 : 0.4;
  }

  const domBox: BoundingBox = {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height
  };

  const iou = computeIoU(domBox, targetBbox);

  const targetCenterX = targetBbox.x + targetBbox.width / 2;
  const targetCenterY = targetBbox.y + targetBbox.height / 2;
  const dx = element.centerX - targetCenterX;
  const dy = element.centerY - targetCenterY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const maxDim = Math.max(1200, 800);
  const distanceScore = Math.max(0, 1 - dist / (maxDim * 0.5));

  return Math.min(1.0, iou * 0.7 + distanceScore * 0.3);
}

/**
 * Computes semantic relevance score between element text/role and target intent.
 */
export function calculateSemanticScore(element: PageElement, intentText: string): number {
  if (!intentText) return 0.5;

  const textLower = (element.text + ' ' + (element.ariaLabel || '') + ' ' + (element.placeholder || '')).toLowerCase().trim();
  const intentLower = intentText.toLowerCase().trim();

  // If element text is contained in intent or vice versa
  const cleanElementText = element.text.toLowerCase().trim();
  if (cleanElementText.length > 2 && intentLower.includes(cleanElementText)) {
    return 0.98;
  }
  if (textLower.includes(intentLower) || intentLower.includes(textLower)) {
    return 0.98;
  }

  // Token overlap matching
  const intentTokens = intentLower.split(/\s+/).filter((t) => t.length > 2);
  const elementTokens = textLower.split(/\s+/).filter((t) => t.length > 2);
  if (intentTokens.length === 0 || elementTokens.length === 0) return 0.5;

  let matched = 0;
  for (const et of elementTokens) {
    if (intentTokens.includes(et) || intentLower.includes(et)) {
      matched++;
    }
  }

  const matchRatio = matched / elementTokens.length;
  return Math.max(0.2, Math.min(1.0, 0.4 + matchRatio * 0.58));
}

/**
 * Computes visual description match score.
 */
export function calculateVisualScore(element: PageElement, visionTarget?: VisionTargetCandidate): number {
  if (!visionTarget || !visionTarget.targetDescription) {
    return 0.85;
  }

  const descLower = (element.visualDescription || '' + ' ' + element.text).toLowerCase();
  const targetDescLower = visionTarget.targetDescription.toLowerCase();

  if (descLower.includes(targetDescLower) || targetDescLower.includes(descLower)) {
    return 0.95;
  }

  const targetTokens = targetDescLower.split(/\s+/).filter((t) => t.length > 2);
  let matched = 0;
  for (const token of targetTokens) {
    if (descLower.includes(token)) matched++;
  }

  return targetTokens.length > 0 ? Math.max(0.3, (matched / targetTokens.length) * 0.9) : 0.75;
}

/**
 * Constructs a fully grounded production target model from a candidate element.
 */
export function createGroundedTarget(candidate: GroundedCandidate, pageStateId: string = ''): GroundedTarget {
  const el = candidate.element;
  const isHybrid = candidate.breakdown.visualScore >= 0.8 && candidate.breakdown.semanticScore >= 0.8;
  const source = isHybrid ? 'HYBRID' : candidate.breakdown.visualScore >= 0.85 ? 'VISION' : 'DOM';

  return {
    elementId: el.id,
    selector: el.id ? `[data-onee-id="${el.id}"]` : undefined,
    role: el.role,
    accessibleName: el.ariaLabel || el.text,
    text: el.text,
    boundingRect: {
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height
    },
    center: {
      x: el.centerX,
      y: el.centerY
    },
    pageStateId,
    confidence: candidate.confidence,
    source,
    timestamp: Date.now()
  };
}

/**
 * Core Hybrid Vision + DOM Grounding Fusion Algorithm.
 * Reranks DOM candidates using multimodal spatial awareness and confidence scoring.
 */
export function hybridGrounding(
  action: AgentAction,
  visionTarget: VisionTargetCandidate | undefined,
  domCandidates: PageElement[],
  weights: GroundingWeights = DEFAULT_GROUNDING_WEIGHTS,
  minConfidence: number = MIN_ACTION_CONFIDENCE
): HybridGroundingResult {
  // If specific elementId was already selected with high confidence
  if (action.elementId) {
    const directMatch = domCandidates.find((c) => c.id === action.elementId);
    if (directMatch) {
      const breakdown: ConfidenceBreakdown = {
        confidence: 0.95,
        semanticScore: 0.95,
        visualScore: 0.92,
        spatialScore: 0.96,
        visibilityScore: directMatch.visible ? 1.0 : 0.3,
        interactionScore: directMatch.enabled ? 1.0 : 0.2
      };

      const candidate: GroundedCandidate = {
        element: directMatch,
        confidence: 0.95,
        breakdown,
        matchReason: `High-confidence direct DOM match for ${action.reason}`
      };

      return {
        bestCandidate: candidate,
        allCandidates: [candidate],
        strategyUsed: 'dom_high_confidence',
        isConfident: true
      };
    }
  }

  const intentText = action.reason || action.text || '';
  const scoredCandidates: GroundedCandidate[] = [];

  for (const element of domCandidates) {
    const semanticScore = calculateSemanticScore(element, intentText);
    const spatialScore = calculateSpatialScore(element, visionTarget?.bbox);
    const visualScore = calculateVisualScore(element, visionTarget);
    const visibilityScore = element.visible ? 1.0 : 0.0;
    const interactionScore = element.enabled ? 1.0 : 0.0;

    const totalConfidence = Number(
      (
        semanticScore * weights.semantic +
        visualScore * weights.visual +
        spatialScore * weights.spatial +
        visibilityScore * weights.visibility +
        interactionScore * weights.interaction
      ).toFixed(3)
    );

    const breakdown: ConfidenceBreakdown = {
      confidence: totalConfidence,
      semanticScore,
      visualScore,
      spatialScore,
      visibilityScore,
      interactionScore
    };

    scoredCandidates.push({
      element,
      confidence: totalConfidence,
      breakdown,
      matchReason: `Semantic: ${Math.round(semanticScore * 100)}%, Spatial: ${Math.round(spatialScore * 100)}%, Visual: ${Math.round(visualScore * 100)}%`
    });
  }

  // Sort descending by confidence
  scoredCandidates.sort((a, b) => b.confidence - a.confidence);

  const best = scoredCandidates[0];
  const isConfident = Boolean(best && best.confidence >= minConfidence);

  return {
    bestCandidate: isConfident ? best : undefined,
    allCandidates: scoredCandidates.slice(0, 10),
    strategyUsed: 'vision_dom_fusion',
    isConfident
  };
}
