/**
 * Shared jsdom environment stubs for browser APIs used by the sidepanel that
 * jsdom does not implement. Real Chrome provides all of these natively; the
 * stubs only prevent `ReferenceError` crashes when components mount in tests.
 *
 * Registered once via `test.setupFiles` in vite.config.ts.
 */

if (typeof globalThis.IntersectionObserver === 'undefined') {
  class IntersectionObserverStub implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '';
    readonly thresholds: readonly number[] = [];
    constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {}
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    IntersectionObserverStub;
}
