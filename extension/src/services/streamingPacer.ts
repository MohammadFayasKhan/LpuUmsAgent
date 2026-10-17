/*
 * Smooth Token Pacer for ChatGPT-Style Progressive Streaming.
 *
 * Prevents rapid TCP/SSE token bursts from flooding React state all at once.
 * Decants incoming tokens at a steady human-readable cadence (line-by-line and
 * word-by-word) with natural breathing pauses on line breaks and punctuation.
 */

export class SmoothTokenPacer {
  private queue: string[] = [];
  private onEmit: (chunk: string) => void;
  private isDraining = false;
  private isFinished = false;
  private resolveDone: (() => void) | null = null;

  constructor(onEmit: (chunk: string) => void) {
    this.onEmit = onEmit;
  }

  /**
   * Pushes incoming text chunk into the pacing queue.
   * Emits markdown table rows atomically line by line to prevent erratic table re-parsing,
   * while streaming headers, paragraphs, and lists progressively word by word.
   */
  push(text: string): void {
    if (!text) return;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isTableRow = line.trim().startsWith('|');
      if (isTableRow) {
        // Emit table row atomically (with newline if not last line)
        this.queue.push(line + (i < lines.length - 1 ? '\n' : ''));
      } else {
        // Normal text: split into words, punctuation, spaces
        const tokens = line.match(/(\S+|\s+)/g) || [line];
        for (const t of tokens) {
          this.queue.push(t);
        }
        if (i < lines.length - 1) {
          this.queue.push('\n');
        }
      }
    }
    if (!this.isDraining) {
      this.drain();
    }
  }

  /**
   * Signals that the network stream has completed.
   * Resolves only after all buffered tokens have finished typing out onto the screen.
   */
  finish(): Promise<void> {
    this.isFinished = true;
    if (this.queue.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.resolveDone = resolve;
    });
  }

  private async drain(): Promise<void> {
    this.isDraining = true;
    while (this.queue.length > 0) {
      const token = this.queue.shift()!;
      this.onEmit(token);

      const qLen = this.queue.length;
      // Human-readable cadence, deliberately unhurried: a response should look
      // like it is being COMPOSED, not dumped. Long queues decant slightly
      // faster but never below the floor, so a full response can never burst
      // onto the screen all at once.
      let delay = 24;
      if (qLen > 80) {
        delay = 14;
      } else if (qLen > 40) {
        delay = 18;
      } else if (qLen > 15) {
        delay = 21;
      }

      // Rhythm overlays always win over the base cadence:
      if (token.includes('\n')) {
        delay = Math.max(delay, 60); // line-by-line breathing pause
      } else if (/[.!?]$/.test(token.trim())) {
        delay = Math.max(delay, 85); // sentence pause
      } else if (/[,;:]$/.test(token.trim())) {
        delay = Math.max(delay, 40); // clause pause
      }

      await new Promise((r) => setTimeout(r, delay));
    }

    this.isDraining = false;
    if (this.isFinished && this.resolveDone) {
      const cb = this.resolveDone;
      this.resolveDone = null;
      cb();
    }
  }
}
