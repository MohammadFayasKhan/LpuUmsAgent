#!/usr/bin/env node
/*
 * Development Watcher & Auto-Rebuild Script for ONEE.
 *
 * Runs Vite in watch mode across all three extension bundles:
 * 1. Side Panel UI (vite build --watch)
 * 2. Background Service Worker (vite build -c vite.background.config.ts --watch)
 * 3. Content Script (vite build -c vite.content.config.ts --watch)
 */

import { spawn } from 'child_process';
import { watch, existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');
const distDir = resolve(rootDir, 'dist');

console.log('\x1b[35m%s\x1b[0m', '═══════════════════════════════════════════════════════════════');
console.log('\x1b[1m\x1b[35m%s\x1b[0m', '  🚀 ONEE – LPU Agent Dev Server (Zero-Manual-Reload)');
console.log('\x1b[35m%s\x1b[0m', '═══════════════════════════════════════════════════════════════');

if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

// 1. Initial full build
console.log('\x1b[36m%s\x1b[0m', '⚡ Running initial build...');
const initialBuild = spawn('npm', ['run', 'build'], { cwd: rootDir, stdio: 'inherit', shell: true });

initialBuild.on('close', (code) => {
  if (code !== 0) {
    console.error('\x1b[31m%s\x1b[0m', '❌ Initial build failed.');
    process.exit(code || 1);
  }

  console.log('\x1b[32m%s\x1b[0m', '✔ Initial build complete! Launching concurrent watchers...');

  // 2. Launch concurrent watchers
  const sidepanelWatcher = spawn('npx', ['vite', 'build', '--watch'], {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true
  });

  const contentWatcher = spawn('npx', ['vite', 'build', '--config', 'vite.content.config.ts', '--watch'], {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true
  });

  const backgroundWatcher = spawn('npx', ['vite', 'build', '--config', 'vite.background.config.ts', '--watch'], {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true
  });

  const forwardLog = (proc, prefix, color) => {
    proc.stdout.on('data', (data) => {
      const str = data.toString().trim();
      if (str && !str.includes('watching for file changes')) {
        console.log(`${color}[${prefix}]\x1b[0m ${str}`);
      }
    });
    proc.stderr.on('data', (data) => {
      const str = data.toString().trim();
      if (str) {
        console.error(`\x1b[31m[${prefix} ERR]\x1b[0m ${str}`);
      }
    });
  };

  forwardLog(sidepanelWatcher, 'Sidepanel', '\x1b[34m');
  forwardLog(contentWatcher, 'ContentScript', '\x1b[33m');
  forwardLog(backgroundWatcher, 'Background', '\x1b[35m');

  // 3. Watch dist for output changes and write dev-reload stamp
  let debounceTimer = null;
  watch(distDir, { recursive: true }, (eventType, filename) => {
    if (filename && (filename.endsWith('.js') || filename.endsWith('.css') || filename.endsWith('.html'))) {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const timestamp = Date.now();
        const stampPath = resolve(distDir, 'dev-reload.json');
        try {
          writeFileSync(stampPath, JSON.stringify({ updated: timestamp, file: filename }));
          console.log('\x1b[32m%s\x1b[0m', `⚡ [Hot Dev] Rebuilt ${filename} @ ${new Date().toLocaleTimeString()}`);
        } catch {}
      }, 150);
    }
  });

  console.log('\x1b[32m%s\x1b[0m', '✨ ONEE Dev Watcher active. Changes will rebuild and auto-sync immediately!');

  process.on('SIGINT', () => {
    sidepanelWatcher.kill();
    contentWatcher.kill();
    backgroundWatcher.kill();
    process.exit(0);
  });
});
