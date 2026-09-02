/*
 * Vite Configuration for ONEE Content Script.
 *
 * Compiles content-script.ts into a standalone IIFE bundle (dist/content.js)
 * injected into ums.lpu.in tabs for DOM observation and Computer Use actions.
 */

import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/content/content-script.ts'),
      name: 'OneeContentScript',
      formats: ['iife'],
      fileName: () => 'content.js'
    }
  }
});
