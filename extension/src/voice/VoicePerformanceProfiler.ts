/*
 * Voice & Agent Latency Instrumentation Profiler for ONEE.
 *
 * Measures precise millisecond timestamps and calculates component latencies:
 * - STT latency
 * - Intent latency
 * - Time to first narration
 * - Kokoro generation latency
 * - Time to first audio
 * - Browser execution latency
 * - Total perceived response latency
 */

export interface ExecutionTimestamps {
  executionId: string;
  inputReceived?: number;
  sttFinal?: number;
  intentReady?: number;
  executionStarted?: number;
  firstMeaningfulEvent?: number;
  narrationRequested?: number;
  firstNarrationText?: number;
  kokoroStarted?: number;
  firstAudioReady?: number;
  firstAudioPlayed?: number;
  executionCompleted?: number;
  finalResponseGenerated?: number;
  finalAudioPlayed?: number;
}

export interface LatencyReport {
  executionId: string;
  sttLatencyMs?: number;
  intentLatencyMs?: number;
  timeToFirstNarrationMs?: number;
  kokoroGenerationLatencyMs?: number;
  timeToFirstAudioMs?: number;
  browserExecutionLatencyMs?: number;
  totalPerceivedResponseLatencyMs?: number;
}

export class VoicePerformanceProfiler {
  private static instance: VoicePerformanceProfiler;
  private records: Map<string, ExecutionTimestamps> = new Map();
  private maxRecords: number = 50;

  private constructor() {}

  public static getInstance(): VoicePerformanceProfiler {
    if (!VoicePerformanceProfiler.instance) {
      VoicePerformanceProfiler.instance = new VoicePerformanceProfiler();
    }
    return VoicePerformanceProfiler.instance;
  }

  private getOrCreate(executionId: string): ExecutionTimestamps {
    let rec = this.records.get(executionId);
    if (!rec) {
      rec = { executionId };
      this.records.set(executionId, rec);
      if (this.records.size > this.maxRecords) {
        const oldestKey = this.records.keys().next().value;
        if (oldestKey) this.records.delete(oldestKey);
      }
    }
    return rec;
  }

  public record(
    executionId: string,
    event: keyof Omit<ExecutionTimestamps, 'executionId'>,
    customTime?: number
  ): void {
    const rec = this.getOrCreate(executionId);
    if (!rec[event]) {
      rec[event] = customTime ?? Date.now();
      this.checkAndLogReport(executionId);
    }
  }

  public getReport(executionId: string): LatencyReport | null {
    const rec = this.records.get(executionId);
    if (!rec) return null;

    const report: LatencyReport = { executionId };

    if (rec.inputReceived && rec.sttFinal) {
      report.sttLatencyMs = rec.sttFinal - rec.inputReceived;
    }
    if (rec.sttFinal && rec.intentReady) {
      report.intentLatencyMs = rec.intentReady - rec.sttFinal;
    }
    if (rec.inputReceived && rec.firstNarrationText) {
      report.timeToFirstNarrationMs = rec.firstNarrationText - rec.inputReceived;
    }
    if (rec.kokoroStarted && rec.firstAudioReady) {
      report.kokoroGenerationLatencyMs = rec.firstAudioReady - rec.kokoroStarted;
    }
    if (rec.inputReceived && rec.firstAudioPlayed) {
      report.timeToFirstAudioMs = rec.firstAudioPlayed - rec.inputReceived;
    }
    if (rec.executionStarted && rec.executionCompleted) {
      report.browserExecutionLatencyMs = rec.executionCompleted - rec.executionStarted;
    }
    if (rec.inputReceived && (rec.firstAudioPlayed || rec.finalAudioPlayed)) {
      report.totalPerceivedResponseLatencyMs =
        (rec.firstAudioPlayed || rec.finalAudioPlayed)! - rec.inputReceived;
    }

    return report;
  }

  private checkAndLogReport(executionId: string): void {
    const report = this.getReport(executionId);
    if (!report) return;

    if (report.timeToFirstAudioMs !== undefined || report.totalPerceivedResponseLatencyMs !== undefined) {
      console.info(`[VoicePerformanceProfiler][${executionId}] Latency Metrics:`, report);
    }
  }

  public clear(): void {
    this.records.clear();
  }
}

export const voiceProfiler = VoicePerformanceProfiler.getInstance();
