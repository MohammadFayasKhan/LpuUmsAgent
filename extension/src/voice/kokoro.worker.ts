/*
 * Dedicated Kokoro-82M Voice Web Worker for ONEE.
 *
 * Runs on-device ONNX WebAssembly inference entirely off the main UI thread.
 * Maintains a persistent, warm Kokoro-82M model instance for the lifetime
 * of the browser session.
 *
 * Incoming messages:
 * - INIT: Initializes model weights and sets up wasm/voice paths
 * - WARMUP: Pre-caches voice weights (default: af_heart)
 * - GENERATE: Generates PCM audio for text chunk and returns Float32Array via transferable buffer
 * - CANCEL: Cancels in-flight or pending generation by id or executionId
 * - PING: Returns PONG for liveness check
 */

import type { KokoroTTS } from 'kokoro-js';

// In Web Worker scope
const ctx = self as any;

let ttsModel: KokoroTTS | null = null;
let initPromise: Promise<KokoroTTS> | null = null;
let cancelledIds = new Set<string>();
let cancelledExecutions = new Set<string>();

const VOICE_CACHE = new Map<string, ArrayBuffer>();

async function getOrInitModel(wasmBase?: string): Promise<KokoroTTS> {
  if (ttsModel) return ttsModel;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const { env } = await import('@huggingface/transformers');
      if (env) {
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        if (wasmBase && env.backends?.onnx?.wasm) {
          env.backends.onnx.wasm.wasmPaths = wasmBase;
          env.backends.onnx.wasm.numThreads = 1;
        } else if (env.backends?.onnx?.wasm) {
          env.backends.onnx.wasm.numThreads = 1;
        }
      }

      const { KokoroTTS } = await import('kokoro-js');
      const isNode = typeof process !== 'undefined' && process.versions?.node;
      const device = isNode ? 'cpu' : 'wasm';

      console.info(`[KokoroWorker] Initializing Kokoro-82M on device: ${device}`);
      const model = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: 'q8',
        device
      });

      ttsModel = model;
      console.info('[KokoroWorker] Kokoro-82M model loaded successfully!');
      return model;
    } catch (err: any) {
      console.error('[KokoroWorker] Model initialization error:', err);
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}

async function ensureVoiceCached(voiceName: string, voicesBase?: string): Promise<void> {
  if (VOICE_CACHE.has(voiceName)) return;

  try {
    const url = voicesBase
      ? `${voicesBase}${voiceName}.bin`
      : `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices/${voiceName}.bin`;

    const res = await fetch(url);
    if (res.ok) {
      const buffer = await res.arrayBuffer();
      VOICE_CACHE.set(voiceName, buffer);
    }
  } catch (err) {
    // Non-fatal: kokoro-js will attempt its own fetch if missing
  }
}

ctx.addEventListener('message', async (event: MessageEvent) => {
  const data = event.data;
  if (!data || !data.type) return;

  switch (data.type) {
    case 'INIT': {
      try {
        await getOrInitModel(data.wasmBase);
        ctx.postMessage({ type: 'READY', model: 'Kokoro-82M-v1.0-ONNX' });
      } catch (err: any) {
        ctx.postMessage({ type: 'ERROR', error: err?.message || String(err) });
      }
      break;
    }

    case 'WARMUP': {
      try {
        await getOrInitModel(data.wasmBase);
        const voice = data.voice || 'af_heart';
        await ensureVoiceCached(voice, data.voicesBase);
        ctx.postMessage({ type: 'WARMED_UP', voice });
      } catch (err: any) {
        ctx.postMessage({ type: 'WARMUP_ERROR', error: err?.message || String(err) });
      }
      break;
    }

    case 'CANCEL': {
      if (data.id) cancelledIds.add(data.id);
      if (data.executionId) cancelledExecutions.add(data.executionId);
      break;
    }

    case 'CLEAR_CANCELLATIONS': {
      cancelledIds.clear();
      cancelledExecutions.clear();
      break;
    }

    case 'GENERATE': {
      const { id, text, voice, speed, executionId, wasmBase, voicesBase } = data;

      // Early cancellation check
      if (cancelledIds.has(id) || (executionId && cancelledExecutions.has(executionId))) {
        ctx.postMessage({ type: 'CANCELLED', id, executionId });
        return;
      }

      try {
        const model = await getOrInitModel(wasmBase);
        const selectedVoice = voice || 'af_heart';
        await ensureVoiceCached(selectedVoice, voicesBase);

        // Pre-generation check
        if (cancelledIds.has(id) || (executionId && cancelledExecutions.has(executionId))) {
          ctx.postMessage({ type: 'CANCELLED', id, executionId });
          return;
        }

        const rawAudio = await model.generate(text, {
          voice: selectedVoice,
          speed: speed ?? 1.0
        });

        // Post-generation check: discard if cancelled while generating
        if (cancelledIds.has(id) || (executionId && cancelledExecutions.has(executionId))) {
          ctx.postMessage({ type: 'CANCELLED', id, executionId });
          return;
        }

        const audioData: Float32Array = rawAudio.audio;
        const sampleRate: number = rawAudio.sampling_rate || 24000;

        // Transfer Float32Array buffer for 0-copy transfer off worker thread
        ctx.postMessage(
          {
            type: 'AUDIO_CHUNK',
            id,
            executionId,
            audioData,
            sampleRate
          },
          [audioData.buffer]
        );
      } catch (err: any) {
        ctx.postMessage({
          type: 'GENERATE_ERROR',
          id,
          executionId,
          error: err?.message || String(err)
        });
      }
      break;
    }

    case 'PING': {
      ctx.postMessage({ type: 'PONG', isReady: Boolean(ttsModel) });
      break;
    }

    default:
      break;
  }
});
