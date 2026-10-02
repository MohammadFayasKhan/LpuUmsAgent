/*
 * Apple iOS Fluid Scroll and Text Cleaning Helpers.
 *
 * Implements WWDC Human Interface Guidelines for physical, critically-damped
 * scroll follow-through and reveals without compositor jitter.
 */

/**
 * Smoothly scrolls an element into view when it is revealed/expanded.
 * Performs a two-phase reveal:
 *  1. An initial gentle scroll to ensure the element's start is in view.
 *  2. A follow-up scroll after CSS grid/height transition completes (~220ms)
 *     so that newly revealed child content (e.g. seat, room, schedule)
 *     is comfortably visible above the bottom fold.
 */
export const smoothScrollToReveal = (targetEl: HTMLElement | null, delayMs = 80): void => {
  if (!targetEl) return;

  setTimeout(() => {
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    setTimeout(() => {
      if (!targetEl.isConnected) return;
      const rect = targetEl.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

      // If the newly revealed bottom content extends past the visible viewport
      if (rect.bottom > viewportHeight - 20) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    }, 200);
  }, delayMs);
};

/**
 * Smoothly anchors an element when it is unrevealed/collapsed,
 * preventing any sudden viewport disorientation.
 */
export const smoothScrollOnCollapse = (targetEl: HTMLElement | null, delayMs = 40): void => {
  if (!targetEl) return;

  setTimeout(() => {
    if (!targetEl.isConnected) return;
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, delayMs);
};

/**
 * Cleans preview text snippets for conversation history cards.
 * Strips markdown symbols (###, **, *, _, `, etc.) and converts em dashes (—) to arrows (→).
 */
export const cleanPreviewSnippet = (text?: string, maxLength = 80): string => {
  if (!text) return '';
  return text
    .replace(/^#+\s+/gm, '') // Remove markdown heading hashes at line start (e.g. "### 📅")
    .replace(/[*_`~>#]/g, '') // Strip remaining markdown formatting characters
    .replace(/—/g, '→')       // Replace em dashes with out arrow
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
};
