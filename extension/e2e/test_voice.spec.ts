import { test, expect } from '@playwright/test';
import http from 'http';
import fs from 'fs';
import path from 'path';

test('Direct Kokoro Worker Test in Browser', async ({ page }) => {
  test.setTimeout(120000);

  const distDir = path.resolve(process.cwd(), 'dist');
  const server = http.createServer((req, res) => {
    let reqPath = req.url?.split('?')[0] || '/';
    if (reqPath === '/') reqPath = '/sidepanel.html';
    const filePath = path.join(distDir, reqPath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const mimeMap: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.mjs': 'application/javascript',
        '.css': 'text/css',
        '.wasm': 'application/wasm',
        '.bin': 'application/octet-stream',
        '.json': 'application/json'
      };
      res.writeHead(200, {
        'Content-Type': mimeMap[ext] || 'application/octet-stream',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp'
      });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  await new Promise<void>((resolve) => server.listen(8999, resolve));

  page.on('console', (msg) => console.log(`[BROWSER ${msg.type()}]: ${msg.text()}`));
  page.on('pageerror', (err) => console.error('[BROWSER PAGE ERROR]:', err.message));

  try {
    await page.goto('http://localhost:8999/sidepanel.html');

    const result = await page.evaluate(async () => {
      console.log('Testing Kokoro worker in browser...');
      const w = new Worker('/assets/kokoro.worker-DgJdpcdY.js', { type: 'module' });

      const initPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Worker INIT timed out after 45s')), 45000);
        w.onmessage = (e) => {
          console.log('[Worker Msg]:', JSON.stringify(e.data));
          if (e.data.type === 'READY') {
            clearTimeout(timeout);
            resolve(e.data);
          } else if (e.data.type === 'ERROR') {
            clearTimeout(timeout);
            reject(new Error(e.data.error));
          }
        };
        w.onerror = (err) => {
          clearTimeout(timeout);
          console.error('[Worker onerror]:', err);
          reject(new Error('Worker error: ' + (err.message || 'unknown')));
        };
      });

      w.postMessage({ type: 'INIT', wasmBase: '/wasm/', voicesBase: '/voices/' });
      const readyMsg = await initPromise;
      console.log('Worker is ready! Now generating speech...');

      const genPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Worker GENERATE timed out after 30s')), 30000);
        w.onmessage = (e) => {
          console.log('[Worker Gen Msg]:', e.data.type);
          if (e.data.type === 'AUDIO_CHUNK') {
            clearTimeout(timeout);
            resolve(e.data);
          } else if (e.data.type === 'GENERATE_ERROR') {
            clearTimeout(timeout);
            reject(new Error(e.data.error));
          }
        };
      });

      w.postMessage({
        type: 'GENERATE',
        id: 'worker-test-1',
        text: 'Worker audio generation successful.',
        voice: 'af_heart',
        speed: 1.0,
        wasmBase: '/wasm/',
        voicesBase: '/voices/'
      });

      const chunk: any = await genPromise;
      w.terminate();

      return {
        sampleRate: chunk.sampleRate,
        samples: chunk.audioData ? chunk.audioData.length : 0
      };
    });

    console.log('WORKER TEST RESULT:', result);
    expect(result.samples).toBeGreaterThan(0);

  } finally {
    server.close();
  }
});
