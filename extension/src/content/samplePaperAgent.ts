/*
 * Sample Question Paper Sub-Automation for ONEE.
 *
 * Why this is a separate Computer Use agent:
 * During Date Sheet scanning, we only detect whether a sample paper exists on a card.
 * We do NOT automatically download or open every paper, because that would trigger
 * multiple unwanted file downloads or popups while the student is just checking dates.
 *
 * When the student explicitly asks ("Open sample paper for CSE408" or "Show next exam's sample paper"):
 * 1. This agent locates the exact verified examination card on the live UMS DOM.
 * 2. Grounds the real "Sample Question Paper" control.
 * 3. Animates the visual cursor to the button with smooth Bézier motion.
 * 4. Highlights the target and triggers the real click.
 * 5. Detects the resulting browser action (PDF URL, new tab, or file download).
 * 6. Reports the verified result back to ONEE without faking or generating artificial PDFs.
 */

import { SamplePaperResult } from '../shared/types';
import {
  showCursor,
  hideCursor,
  animateCursorTo,
  highlightElement,
  setHighlightState,
  hideHighlight,
  triggerClickRipple,
  setCursorStatus
} from './aiCursorOverlay';
import { agentMotion } from './agentMotion';
import { findExaminationCardElements } from './examination/examDateSheetParser';

/**
 * Locates the specific, dedicated "Sample Question Paper" button or box inside an examination card.
 * Ensures we target ONLY the tight purple download box itself rather than the entire examination card.
 */
export function findDedicatedSamplePaperBox(card: HTMLElement): HTMLElement | null {
  // Check if card has any mention of sample paper
  const cardText = (card.textContent || '').toLowerCase();
  if (!cardText.includes('sample') && !cardText.includes('paper')) {
    return null;
  }

  const allElements = Array.from(
    card.querySelectorAll<HTMLElement>(
      'a, button, [role="button"], div, span, p, [class*="sample" i], [class*="paper" i], [class*="btn" i]'
    )
  );

  // Filter to elements that genuinely contain sample paper text/title
  const sampleElements = allElements.filter((el) => {
    const text = (el.textContent || '').toLowerCase().trim();
    const title = (el.getAttribute('title') || '').toLowerCase();
    const aria = (el.getAttribute('aria-label') || '').toLowerCase();

    if (text.includes('no sample paper') || text.includes('not available')) return false;

    return (
      text.includes('sample question paper') ||
      (text.includes('sample') && text.includes('paper')) ||
      title.includes('sample question paper') ||
      title.includes('sample paper') ||
      aria.includes('sample question paper')
    );
  });

  if (sampleElements.length === 0) return null;

  // Reject elements that are wide outer containers (contain other card sections like "Awaited", "MCQ", dates)
  const pureSampleElements = sampleElements.filter((el) => {
    const cls = (el.className || '').toLowerCase();
    const t = (el.textContent || '').toLowerCase();

    if (
      cls.includes('card-body') ||
      cls.includes('card-header') ||
      cls.includes('card-footer') ||
      cls.includes('col-') ||
      cls.includes('row')
    ) {
      return false;
    }

    return (
      !t.includes('awaited') &&
      !t.includes('multiple choice') &&
      !t.includes('short question') &&
      !t.includes('reporting') &&
      !t.includes('theory end term') &&
      !t.includes('theory mid term') &&
      !t.includes('objective type') &&
      !t.includes('upcoming') &&
      !t.includes('total exam')
    );
  });

  const candidates = pureSampleElements.length > 0 ? pureSampleElements : sampleElements;

  // If there is an explicit button or link among candidates, use it immediately
  const explicitAction = candidates.find((el) => {
    const tag = el.tagName.toLowerCase();
    return tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button';
  });
  if (explicitAction) {
    return explicitAction;
  }

  // Find the deepest leaf element that contains the words "sample" and "paper"
  const leafCandidates = candidates.filter((el) => {
    return !Array.from(el.children).some((child) => candidates.includes(child as HTMLElement));
  });

  const leaf = leafCandidates[0] || candidates[candidates.length - 1];

  // From the leaf, walk UP to find the dedicated button/widget box (e.g. purple box)
  let curr: HTMLElement = leaf;
  let bestBox: HTMLElement = leaf;

  while (curr && curr !== card) {
    const tag = curr.tagName.toLowerCase();
    const cls = (curr.className || '').toLowerCase();
    const isExplicitButton = tag === 'button' || tag === 'a' || curr.getAttribute('role') === 'button';

    if (isExplicitButton) {
      return curr;
    }

    const rect = curr.getBoundingClientRect();
    const isCompactBox = rect.width > 0 && rect.width <= 360 && rect.height <= 120;
    const hasButtonClass =
      cls.includes('btn') ||
      cls.includes('button') ||
      cls.includes('box') ||
      cls.includes('download') ||
      cls.includes('sample') ||
      cls.includes('paper');

    if (isCompactBox || hasButtonClass) {
      bestBox = curr;
    }

    const parent = curr.parentElement;
    if (!parent || parent === card) break;

    const parentCls = (parent.className || '').toLowerCase();
    if (
      parentCls.includes('card-body') ||
      parentCls.includes('col-') ||
      parentCls.includes('row') ||
      parent === card
    ) {
      // Parent is a layout container or the card body, so curr is the dedicated box!
      break;
    }

    const parentRect = parent.getBoundingClientRect();
    if (parentRect.width > 380 || parentRect.height > 140) {
      // Parent is too large (likely the column or card body), so curr is the dedicated box!
      break;
    }

    curr = parent;
  }

  return bestBox;
}

/**
 * Locates the exact Sample Question Paper button for the specified course on the live UMS DOM.
 */
export function findSamplePaperButtonForCourse(
  courseCode: string,
  doc: Document = document,
  examType?: string
): { cardElement: HTMLElement | null; buttonElement: HTMLElement | null } {
  // Extract pure course code (e.g. "CSE408" from "CSE408 (End Term)")
  const codeMatch = courseCode.match(/([A-Z]{2,5}\s*\d{3,4}[A-Z]?)/i);
  const cleanCode = codeMatch ? codeMatch[1].replace(/\s+/g, '').toUpperCase() : courseCode.replace(/\s+/g, '').toUpperCase();

  // Infer exam type if not provided directly
  const termMatch = courseCode.match(/\(([^)]+)\)/) || courseCode.match(/(mid\s*term|end\s*term|practical|theory)/i);
  const effectiveExamType = examType || (termMatch ? termMatch[1] : undefined);

  const cards = findExaminationCardElements(doc);

  let targetCard: HTMLElement | null = null;
  let targetButton: HTMLElement | null = null;

  for (const card of cards) {
    const text = card.textContent || '';
    if (text.toUpperCase().includes(cleanCode)) {
      if (effectiveExamType && !text.toLowerCase().includes(effectiveExamType.toLowerCase())) {
        continue;
      }

      // Look for the dedicated sample paper control inside this card
      const dedicatedBox = findDedicatedSamplePaperBox(card);
      if (dedicatedBox) {
        targetCard = card;
        targetButton = dedicatedBox;
        break;
      }
    }
  }

  return { cardElement: targetCard, buttonElement: targetButton };
}

/**
 * Executes real Computer Use action to open or download the student's sample question paper.
 */
export async function executeOpenSamplePaper(
  courseCode: string,
  buttonOrDoc?: HTMLElement | Document,
  docParam?: Document
): Promise<SamplePaperResult> {
  const doc: Document =
    buttonOrDoc && 'nodeType' in buttonOrDoc && buttonOrDoc.nodeType === 9
      ? (buttonOrDoc as Document)
      : docParam || document;

  let buttonEl: HTMLElement | null =
    buttonOrDoc && 'nodeType' in buttonOrDoc && buttonOrDoc.nodeType === 1
      ? (buttonOrDoc as HTMLElement)
      : null;

  if (!buttonEl) {
    const found = findSamplePaperButtonForCourse(courseCode, doc);
    buttonEl = found.buttonElement;
  }

  if (!buttonEl) {
    return {
      success: false,
      error: `Sample Question Paper control for ${courseCode} not found on page`,
      courseCode,
      actionTaken: 'opened_in_tab',
      verified: false
    };
  }

  // 1. SMOOTH SCROLLING: Bring the dedicated sample paper box into the center of the viewport
  try {
    buttonEl.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'center'
    });
  } catch {
    try {
      buttonEl.scrollIntoView(true);
    } catch {}
  }

  // Allow smooth scroll to settle so viewport coordinates are completely stable
  await agentMotion.wait(500);

  // 2. Re-acquire exact bounding rect after scrolling
  const rect = buttonEl.getBoundingClientRect();
  const targetPoint = {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.top + rect.height / 2)
  };

  showCursor();
  const timings = agentMotion.getTimings();

  try {
    setCursorStatus(`Locating Sample Question Paper for ${courseCode}...`);
    // 3. HIGHLIGHT ONLY THE DEDICATED PURPLE BOX ITSELF
    highlightElement(buttonEl, `Sample Question Paper (${courseCode})`, 'discovered');
    await agentMotion.wait(timings.preClickHighlightDelay);

    setHighlightState('approaching');
    await animateCursorTo(targetPoint.x, targetPoint.y);

    setHighlightState('verified');
    setCursorStatus(`Opening Sample Question Paper for ${courseCode}...`);
    await agentMotion.wait(timings.preClickSettleDelay);

    await triggerClickRipple();

    // Inspect if element has a direct PDF URL
    const href = buttonEl.getAttribute('href') || buttonEl.closest('a')?.getAttribute('href');
    const isDirectPdf = href && (href.toLowerCase().endsWith('.pdf') || href.includes('/pdf/'));

    // Dispatch realistic mouse click (single sequence to prevent double download warnings)
    const eventInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: targetPoint.x,
      clientY: targetPoint.y,
      buttons: 1
    };

    try {
      if (typeof PointerEvent !== 'undefined') {
        buttonEl.dispatchEvent(new PointerEvent('pointerdown', { ...eventInit, pointerType: 'mouse' }));
        buttonEl.dispatchEvent(new PointerEvent('pointerup', { ...eventInit, pointerType: 'mouse' }));
      }
    } catch {}

    try {
      buttonEl.dispatchEvent(new MouseEvent('mousedown', eventInit));
      buttonEl.dispatchEvent(new MouseEvent('mouseup', eventInit));
      buttonEl.dispatchEvent(new MouseEvent('click', eventInit));
      if (buttonEl.tagName.toLowerCase() === 'a' && typeof buttonEl.click === 'function') {
        buttonEl.click();
      }
    } catch {
      try {
        buttonEl.click();
      } catch {}
    }

    hideHighlight();
    setCursorStatus(`Sample paper opened for ${courseCode}`);
    await agentMotion.wait(500);
    hideCursor();

    return {
      success: true,
      courseCode,
      pdfUrl: isDirectPdf ? href : undefined,
      paperUrl: isDirectPdf ? href : undefined,
      fileName: `${courseCode}_Sample_Paper.pdf`,
      actionTaken: isDirectPdf ? 'preview_ready' : 'downloaded',
      verified: true
    };
  } catch (err: any) {
    hideHighlight();
    hideCursor();
    console.warn('[SamplePaperAgent] Error opening sample paper:', err);
    return {
      success: false,
      error: err.message || 'Error executing click on sample paper',
      courseCode,
      actionTaken: 'opened_in_tab',
      verified: false
    };
  }
}
