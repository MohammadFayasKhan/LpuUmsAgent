/*
 * Vite Configuration for ONEE Background Service Worker.
 *
 * Compiles service-worker.ts into a standalone IIFE bundle (dist/service-worker.js)
 * that Chrome's Manifest V3 background service worker can execute directly.
 */

import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/background/service-worker.ts'),
      name: 'OneeServiceWorker',
      formats: ['iife'],
      fileName: () => 'service-worker.js'
    }
  }
});
