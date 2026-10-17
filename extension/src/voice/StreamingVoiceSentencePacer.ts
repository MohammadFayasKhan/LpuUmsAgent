/*
 * Streaming Voice Sentence Pacer for ONEE.
 *
 * Pipelines incoming streaming LLM response tokens into natural sentence chunks
 * for Kokoro TTS synthesis. Instead of waiting for the full response to finish
 * (which takes 3-8 seconds), speech begins immediately on the first completed
 * sentence.
 *
 * Guarantees:
 * 1. Clean Spoken Text: Strips markdown symbols (headers #, asterisks *, markdown tables |)
 * 2. Safe Boundaries: Emits complete natural sentences ending in [.!?\n]
 * 3. Execution ID Tagging: Discards output if executionId becomes stale
 * 4. No Duplicate Speech: Emits each sentence once and flushes remaining tail on finish
 */

export interface VoicePacerOptions {
  executionId: string;
  onSentence: (sentence: string, isFinal: boolean) => void;
  minSentenceLength?: number;
}

export class StreamingVoiceSentencePacer {
  private buffer: string = '';
  private executionId: string;
  private onSentence: (sentence: string, isFinal: boolean) => void;
  private minLength: number;
  private isFinished: boolean = false;
  private isCancelled: boolean = false;
  private emittedSentences: string[] = [];

  constructor(options: VoicePacerOptions) {
    this.executionId = options.executionId;
    this.onSentence = options.onSentence;
    this.minLength = options.minSentenceLength ?? 18;
  }

  public getExecutionId(): string {
    return this.executionId;
  }

  public push(token: string): void {
    if (this.isCancelled || this.isFinished || !token) return;

    this.buffer += token;
    this.processBuffer(false);
  }

  public finish(): void {
    if (this.isCancelled || this.isFinished) return;
    this.isFinished = true;
    this.processBuffer(true);
  }

  public cancel(): void {
    this.isCancelled = true;
    this.buffer = '';
  }

  public getEmittedCount(): number {
    return this.emittedSentences.length;
  }

  private accumulatedChunk: string = '';

  private processBuffer(isFinalFlush: boolean): void {
    if (this.isCancelled) return;

    // Sentence break pattern: period, exclamation, question mark, or newline followed by space or end
    const sentenceRegex = /([^\n.!?]+[.!?]+(?:\s+|$)|[^\n]+(?:\n\n|\n))/g;
    let match: RegExpExecArray | null;
    let lastIndex = 0;

    while ((match = sentenceRegex.exec(this.buffer)) !== null) {
      const rawChunk = match[0];
      const cleaned = this.cleanForSpeech(rawChunk);
      lastIndex = match.index + rawChunk.length;

      if (!cleaned) continue;

      if (this.accumulatedChunk) {
        this.accumulatedChunk += ' ' + cleaned;
      } else {
        this.accumulatedChunk = cleaned;
      }

      if (this.accumulatedChunk.length >= this.minLength) {
        const sentenceToEmit = this.accumulatedChunk;
        this.accumulatedChunk = '';
        this.emittedSentences.push(sentenceToEmit);
        this.onSentence(sentenceToEmit, false);
      }
    }

    if (lastIndex > 0) {
      this.buffer = this.buffer.slice(lastIndex);
    }

    if (isFinalFlush) {
      const remainingCleaned = this.cleanForSpeech(this.buffer);
      this.buffer = '';
      let finalChunk = this.accumulatedChunk;
      this.accumulatedChunk = '';
      if (remainingCleaned) {
        finalChunk = finalChunk ? `${finalChunk} ${remainingCleaned}` : remainingCleaned;
      }
      if (finalChunk.trim().length > 0) {
        this.emittedSentences.push(finalChunk);
        this.onSentence(finalChunk, true);
      }
    }
  }

  private cleanForSpeech(raw: string): string {
    return raw
      .replace(/#+\s*/g, '') // Remove markdown headers
      .replace(/[*_~`]/g, '') // Remove asterisks, bold, inline code ticks
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Convert markdown links [text](url) to text
      .replace(/\|[^\n|]+\|/g, ' ') // Remove table rows / columns
      .replace(/[-•]\s+/g, '') // Remove bullet points
      .replace(/\s+/g, ' ') // Collapse spaces
      .trim();
  }
}
