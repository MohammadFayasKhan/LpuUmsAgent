/*
 * Vite Configuration for ONEE Chrome Side Panel.
 *
 * Builds the React side panel application into dist/sidepanel.html and copies:
 * - manifest.json to dist/
 * - public/icons to dist/icons/
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  worker: {
    format: 'es'
  },
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: 'manifest.json',
          dest: '.'
        },
        {
          src: 'public/icons/*',
          dest: 'icons'
        },
        {
          src: 'node_modules/onnxruntime-web/dist/ort-wasm*',
          dest: 'wasm'
        },
        {
          src: 'node_modules/@huggingface/transformers/dist/ort-wasm*',
          dest: 'wasm'
        },
        {
          src: 'node_modules/kokoro-js/voices/*',
          dest: 'voices'
        }
      ]
    })
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
        offscreen: resolve(__dirname, 'offscreen.html'),
        permission: resolve(__dirname, 'permission.html')
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/tests/**/*.test.{ts,tsx}'],
    setupFiles: ['src/tests/setup.ts']
  }
});
