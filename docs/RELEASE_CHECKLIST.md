# ONEE → LPU Agent: Chrome Web Store Release Checklist

**Release Candidate:** v1.1.0  
**Manifest Version:** Manifest V3  
**Package:** `dist/onee-lpu-agent-v1.1.0.zip`

---

## 1. Comprehensive Release Verification Checklist

- [x] **Entire Repository Inspected**: Every file across `src/`, `components/`, `content/`, `services/`, `hooks/`, `tests/`, `styles/`, `scripts/`, `docs/`, and `backend/` reviewed.
- [x] **No Source File Skipped**: Complete file-by-file inventory documented in `CODEBASE_AUDIT.md`.
- [x] **No CSS File Skipped**: Baseline resets, variables, responsive clamp sizing, and module stylesheets commented.
- [x] **Entry Files Commented**: `main.tsx`, `App.tsx`, `service-worker.ts`, and `content-script.ts` documented.
- [x] **All Test Files Commented**: All 10 Vitest test suites documented with scenario explanations.
- [x] **Configuration Files Audited**: `vite.config.ts`, `vite.background.config.ts`, `vite.content.config.ts`, `manifest.json`, `tsconfig.json`.
- [x] **Natural Student Comments**: Practical, technically accurate comments explaining WHY code is implemented this way without corporate buzzwords.
- [x] **No AI Comment Banners**: Decorative section banners removed in favor of clean multiline comments.
- [x] **Em Dashes Cleaned**: Replaced with clean arrows (`→`) or standard punctuation.
- [x] **Humanizer Rules Applied**: Removed boilerplate opening clichés, concluding filler, and corporate jargon.
- [x] **Aesthetic README Created**: Modeled on the AttentionIsAllYouNeed structure with custom badges, architecture diagram, tech stack table, and student background.
- [x] **Real UMS Attendance Parser**: Deterministic table extraction from live DOM with exact count verification.
- [x] **Lowest Attendance Math**: Deterministic minimum percentage calculation without LLM math dependency.
- [x] **Bunk Allowance Algebra**: Exact algebraic formulas for safe skips and required recovery classes.
- [x] **Existing Modal Detection**: Detects open Attendance Summary modals to avoid redundant clicks.
- [x] **Whole-Table Highlighting**: Measures full table bounding boxes across all subject rows.
- [x] **Slow, Smooth Cursor Motion**: Calibrated 400–1200ms cubic-Bézier trajectories with cosine smoothstep easing.
- [x] **Live Cursor State Labels**: Synchronized labels near the cursor reflecting actual execution stages.
- [x] **No Fake Computer Use**: Cursors move only during real DOM observations and actions.
- [x] **Local Planner Fallback**: Offline / fetch failures switch to local deterministic planning and browser execution.
- [x] **Streaming Recovery**: Token streaming failures fall back to local response rendering without re-running browser tasks.
- [x] **Service Worker Auto-Recovery**: Port disconnects handle MV3 worker termination and restore session state.
- [x] **Execution ID Tracking**: New executionId for every request; stale async callbacks blocked.
- [x] **Account Switch Isolation**: Login page detection clears active attendance and execution caches.
- [x] **Local-First IndexedDB Storage**: Conversations, messages, executions, and verified attendance stored on-device.
- [x] **Zero window.localStorage**: Content scripts and sidepanel strictly avoid `window.localStorage`.
- [x] **Zero Password & Cookie Storage**: Never asks for or stores passwords, `.ASPXAUTH`, or `ASP.NET_SessionId`.
- [x] **Minimal Context AI Principle**: Only minimal grounded attendance context sent for remote inference.
- [x] **Dynamic Horizontal Suggestion Rail**: Trackpad and mouse-wheel horizontal scrolling without ugly scrollbars.
- [x] **Interactive Procedural Avatar**: 60fps SVG canvas avatar responding to 22 unified runtime states.
- [x] **Context-Aware Speech Bubble**: Dynamic popup messages matching real agent stages.
- [x] **Responsive Sidepanel**: Adapts smoothly across 320px, 420px, and 600px widths.
- [x] **Initial Scroll Preservation**: Sidepanel opening keeps Browser Agent visible rather than jumping to input.
- [x] **Storage Retention & Deletion**: Retention capping and one-click data wipe controls in Privacy modal.
- [x] **Manifest V3 CSP Compliance**: Zero `eval()`, `new Function()`, or `unsafe-eval`.
- [x] **Permission Minimization**: Restricted to `sidePanel`, `storage`, `tabs`, `scripting`, and `*://*.lpu.in/*`.
- [x] **Zero Secrets in Bundle**: No API keys or credentials shipped in client package.
- [x] **Zero Localhost Dependencies**: Extension operates completely offline with local fallback.
- [x] **Automated Tests**: 60 / 60 tests passing in Vitest.
- [x] **Production Packaging**: Validated zip generated at `dist/onee-lpu-agent-v1.1.0.zip`.

---

## 2. Chrome Web Store Submission Guide

1. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Click **Add New Item** and upload `extension/dist/onee-lpu-agent-v1.1.0.zip`.
3. Fill in the listing details using `CHROMEWEBSTORE.md`.
4. Copy privacy disclosures and permission justifications from `docs/privacy.md`.
5. Submit for review.
