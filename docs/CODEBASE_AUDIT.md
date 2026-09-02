# ONEE → LPU Agent: Comprehensive Codebase Audit Report

**Audit Date:** September 2, 2026  
**Audited Scope:** Extension codebase, background service worker, content scripts, storage architecture, DOM perception, action execution, security policies, and documentation.  
**Target Release:** Chrome Web Store Manifest V3 (v1.1.0)

---

## 1. Executive Summary

This audit documents the final production hardening of the ONEE → LPU Agent Chrome extension. The project was systematically audited, refactored, and documented:
- Zero `window.localStorage` usage across content scripts and side panel UI.
- All persistent data stored in on-device **IndexedDB** with session isolation.
- Every TypeScript, TSX, CSS, Python, and script file commented with natural explanations of design decisions.
- All 60 Vitest unit and integration tests passing.
- Clean Manifest V3 CSP compliance with zero `eval` or `new Function`.

---

## 2. Complete File-by-File Repository Inventory

| File Path | Type | Purpose | Disposition | Comment Status |
| :--- | :--- | :--- | :--- | :--- |
| `extension/src/sidepanel/main.tsx` | TSX | Side panel entry point, React StrictMode mounting | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/sidepanel/App.tsx` | TSX | Root state coordinator & view switcher | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/sidepanel/App.module.css` | CSS | Viewport flex containment & scrolling | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/background/service-worker.ts` | TS | MV3 background service worker, port keeper, tab events | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/content/content-script.ts` | TS | UMS tab injection entry point & message bridge | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/content/umsDetector.ts` | TS | Hostname & Cloudflare challenge detection | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/content/umsAttendanceParser.ts` | TS | Deterministic HTML table extraction & fraction parsing | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/content/pageObserver.ts` | TS | Interactive DOM element harvesting & `data-onee-id` map | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/content/agentMotion.ts` | TS | Cubic-Bézier trajectories & cosine smoothstep easing | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/content/coordinateUtils.ts` | TS | Coordinate space transforms & safe viewport checks | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/content/hybridGrounding.ts` | TS | Hybrid 2D IoU box overlap & text similarity scoring | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/content/actionEngine.ts` | TS | Native DOM click & text input event dispatcher | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/content/aiCursorOverlay.ts` | TS | Viewport cursor rendering & target bounding boxes | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/hooks/useAgentController.ts` | TS | Autonomous perception-action loop & execution tracking | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/hooks/useChatAgent.ts` | TS | Conversation persistence & streaming response handler | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/hooks/useReducedMotion.ts` | TS | System accessibility motion preference listener | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/hooks/useUmsConnection.ts` | TS | Live active tab detection & auto-reconnect | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/AgentControlPanel.tsx` | TSX | Computer Use visualizer & pipeline stepper | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/AgentControlPanel.module.css` | CSS | Stepper layout, modal styles, action pulse | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/AttendanceCard.tsx` | TSX | Dashboard attendance overview card & greeting | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/AttendanceCard.module.css` | CSS | Large percentage typography, stat grid | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/BunkCalculatorModal.tsx` | TSX | Interactive safe-bunk / recovery calculator modal | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/BunkCalculatorModal.module.css` | CSS | Bottom-sheet modal animation & custom slider | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/ChatMessage.tsx` | TSX | Message bubble with avatar & markdown rendering | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/ChatMessage.module.css` | CSS | User/assistant bubble alignment & avatar layout | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/ChatView.tsx` | TSX | Chat container with horizontal suggestion rail | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/ChatView.module.css` | CSS | Horizontal scroll rail, trackpad wheel mapping | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/ConnectionState.tsx` | TSX | UMS connection indicator & splash card | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/ConnectionState.module.css` | CSS | Centered empty state & reconnect buttons | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/ConversationDrawer.tsx` | TSX | Slide-out conversation history panel | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/ConversationDrawer.module.css` | CSS | Drawer slide-in animation & history item cards | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/CourseList.tsx` | TSX | Expandable list of student course cards | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/CourseList.module.css` | CSS | Section headers & card spacing | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/CourseRow.tsx` | TSX | Individual course row with progress bar & badge | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/CourseRow.module.css` | CSS | Progress bar track, lowest subject border accent | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/Header.tsx` | TSX | Top navigation bar with mascot & action buttons | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/Header.module.css` | CSS | Header layout, brand logo group, action buttons | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/OneeCompanion.tsx` | TSX | Live companion mascot avatar & speech bubble | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/OneeCompanion.module.css` | CSS | Responsive clamp sizing & floating bubble pointer | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/PrivacyModal.tsx` | TSX | Local storage metrics & data purge controls | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/PrivacyModal.module.css` | CSS | Storage metrics grid & danger zone styling | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/Skeletons.tsx` | TSX | Loading skeleton shimmer placeholders | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/Skeletons.module.css` | CSS | Shimmer animation & placeholder shapes | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/Toast.tsx` | TSX | Toast notification stack | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/Toast.module.css` | CSS | Bottom-anchored toast stack & slide-up animation | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/ActivityTimeline.tsx` | TSX | Agent execution step log & expandable cards | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/ActivityTimeline.module.css` | CSS | Collapsible timeline & state badge dots | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/AvatarController.tsx` | TSX | React lifecycle bridge for procedural avatar | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/common/MarkdownRenderer.tsx` | TSX | Streaming markdown parser & table renderer | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/common/MarkdownRenderer.module.css` | CSS | Scoped markdown typography, tables & code blocks | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/onee/avatarCore.ts` | TS | Pure-math procedural geometry & ambient motion | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/components/onee/avatarRenderer.ts` | TS | 60fps SVG requestAnimationFrame rendering loop | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/lib/confetti.ts` | TS | Micro-burst celebratory particle effects | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/lib/humanizer.ts` | TS | Post-processing utility removing AI filler clichés | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/lib/oneeEvents.ts` | TS | Visual state machine & agent event bridge | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/lib/runtimeState.ts` | TS | Centralized single source of truth for agent state | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/services/api.ts` | TS | Backend API client & local deterministic fallback | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/services/connectionManager.ts` | TS | Background service worker port keeper & heartbeat | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/services/localDatabase.ts` | TS | IndexedDB stores (chat, executions, attendance) | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/services/personalizationStore.ts` | TS | On-device student preferences & topics store | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/services/repositories.ts` | TS | Three-tier storage repository abstraction layer | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/services/storage.ts` | TS | Settings helper layer over chrome.storage.local | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/services/suggestionGenerator.ts` | TS | Context-aware dynamic follow-up suggestion generator | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/services/tabMessenger.ts` | TS | All-window tab search & script re-injection | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/shared/attendanceCalculator.ts` | TS | Deterministic algebraic bunk & recovery math | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/shared/messages.ts` | TS | Extension IPC message protocol definitions | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/shared/types.ts` | TS | Complete domain models & telemetry interfaces | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/styles/global.css` | CSS | Baseline reset, custom slim scrollbars, focus rings | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/styles/variables.css` | CSS | Design tokens, color palette & motion overrides | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/types/avatar.ts` | TS | Procedural animation and expression type definitions | Preserved & Documented | ✅ Full multiline comments |
| `extension/src/vite-env.d.ts` | TS | Ambient declarations for CSS modules & avatar packages | Preserved & Documented | ✅ Full multiline comments |
| `extension/vite.config.ts` | TS | Side panel Vite build & static copy configuration | Preserved & Documented | ✅ Full multiline comments |
| `extension/vite.background.config.ts` | TS | Service worker Vite build configuration | Preserved & Documented | ✅ Full multiline comments |
| `extension/vite.content.config.ts` | TS | Content script Vite build configuration | Preserved & Documented | ✅ Full multiline comments |
| `extension/scripts/dev.mjs` | MJS | Multi-bundle watch development server | Preserved & Documented | ✅ Full multiline comments |
| `extension/scripts/package_extension.py` | PY | Chrome Web Store ZIP packager & manifest validator | Preserved & Documented | ✅ Full multiline comments |
| `extension/sidepanel.html` | HTML | Side panel HTML shell | Preserved & Documented | ✅ Full multiline comments |
| `extension/manifest.json` | JSON | Manifest V3 extension configuration | Preserved (Strict JSON) | N/A (Strict JSON) |
| `extension/package.json` | JSON | Extension dependencies & build scripts | Preserved (Strict JSON) | N/A (Strict JSON) |
| `extension/tsconfig.json` | JSON | TypeScript compiler configuration | Preserved (Strict JSON) | N/A (Strict JSON) |
| `extension/src/assets/onee.avatar.json` | JSON | Procedural avatar geometry vector definition | Preserved (Strict JSON) | N/A (Strict JSON) |
| `backend/app/main.py` | PY | FastAPI application entry point, CORS, routes | Preserved & Documented | ✅ Full multiline docstrings |
| `backend/app/config.py` | PY | Environment configuration & pydantic-settings | Preserved & Documented | ✅ Full multiline docstrings |
| `backend/app/agent/agent.py` | PY | Conversational agent & tool execution loop | Preserved & Documented | ✅ Full multiline docstrings |
| `backend/app/agent/planner.py` | PY | Computer Use action planner & spatial grounding | Preserved & Documented | ✅ Full multiline docstrings |
| `backend/app/agent/prompts.py` | PY | Grounded system prompts & tone rules | Preserved & Documented | ✅ Full multiline docstrings |
| `backend/app/agent/tools.py` | PY | Deterministic attendance math tools for Groq | Preserved & Documented | ✅ Full multiline docstrings |
| `backend/app/schemas/attendance.py` | PY | Attendance Pydantic models & validation | Preserved & Documented | ✅ Full multiline docstrings |
| `backend/app/schemas/chat.py` | PY | Chat request and message Pydantic models | Preserved & Documented | ✅ Full multiline docstrings |
| `backend/app/schemas/planner.py` | PY | Computer Use action and element models | Preserved & Documented | ✅ Full multiline docstrings |
| `backend/app/services/groq_service.py` | PY | Groq Cloud API client with fallback chain | Preserved & Documented | ✅ Full multiline docstrings |
| `backend/requirements.txt` | TXT | Python dependencies | Preserved | N/A (Strict text) |
| `README.md` | MD | Comprehensive project presentation & documentation | Preserved & Documented | ✅ Aesthetic format |
| `CHROMEWEBSTORE.md` | MD | Chrome Web Store listing, disclosures & permissions | Preserved & Documented | ✅ Store documentation |

---

## 3. Storage Architecture Modernization

- **Elimination of `window.localStorage`**:  
  `window.localStorage` was completely removed across the extension to prevent cross-context data leaks with host pages (`ums.lpu.in`) and to adhere to Chrome extension best practices.
- **Repository Pattern (`src/services/repositories.ts`)**:  
  Storage access was centralized behind clean interfaces:
  1. `ChatRepository` (IndexedDB): Manages conversations and message records.
  2. `AgentHistoryRepository` (IndexedDB): Persists action traces and execution telemetry with an automated 30-record retention cap.
  3. `VerifiedContextRepository` (IndexedDB): Stores verified UMS attendance DOM snapshots.
  4. `PersonalizationRepository` (IndexedDB): Manages local student preferences and frequent query telemetry.
  5. `SettingsRepository` (`chrome.storage.local`): Stores extension settings and active account identifiers.
  6. `SessionRepository` (`chrome.storage.session`): Stores ephemeral execution state and connection status, automatically destroyed upon browser close.

---

## 4. Security & CSP Findings

- **Zero CSP Violations**:  
  The extension contains zero references to `eval()`, `new Function()`, or `unsafe-eval`.
- **Zero Credential Harvesting**:  
  The extension contains zero input forms for student registration numbers or passwords. It operates purely within the student's active authenticated tab session.
- **Zero Cookie Extraction**:  
  Sensitive authentication cookies (`ASP.NET_SessionId`, `.ASPXAUTH`) are never accessed or transmitted.
- **Host Permission Minimization**:  
  Restricted strictly to `*://ums.lpu.in/*` and `*://*.lpu.in/*`. Zero broad `<all_urls>` wildcards.

---

## 5. Verification Matrix Summary

- **Unit & Integration Tests**: 60 / 60 passing (`npm run test`).
- **Production Bundle Build**: Clean TypeScript compilation and Vite packaging (`npm run build`).
- **Chrome Web Store Package**: Validated ZIP generated (`npm run package` → `dist/onee-lpu-agent-v1.1.0.zip`).
