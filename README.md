<div align="center">

# ONEE → LPU Agent 🎓✨

**An autonomous, privacy-first Browser Agent and Attendance Intelligence Companion built for Lovely Professional University (LPU) students.**

[![React](https://img.shields.io/badge/React-18.3-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5.4-B73BFE?style=flat-square&logo=vite&logoColor=FFD62E)](https://vitejs.dev/)
[![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![IndexedDB](https://img.shields.io/badge/Storage-IndexedDB_Local--First-7C3AED?style=flat-square)](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
[![Vitest](https://img.shields.io/badge/Tests-60_Passing-22c55e?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev/)
[![Groq](https://img.shields.io/badge/Inference-Groq_Qwen_3.8--27B-F55036?style=flat-square)](https://groq.com/)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)

<br/>

<img src="extension/public/icons/onee-master-1024.png" alt="ONEE Companion Mascot & Browser Agent" width="220" style="border-radius: 24px;" />
<p align="center"><em>Native Chrome Side Panel Agent operating directly inside the student's authenticated UMS session</em></p>

</div>

---

## 📖 Overview

**ONEE** is an autonomous browser companion designed specifically for LPU students. Running as a **Manifest V3 Chrome Extension** in the native **Chrome Side Panel**, ONEE operates alongside the official university portal (`ums.lpu.in`).

Instead of brittle external scrapers or automated browser instances (Playwright / Puppeteer) that break on Cloudflare Turnstile verification or require handing over plaintext student passwords, ONEE works inside the student's **already-authenticated, real Chrome session**. The student logs into UMS normally, and ONEE provides:

1. **Autonomous Computer Use Navigation:** Sees the live DOM layout, grounds UI targets, moves a visible cursor along smooth cubic-Bézier paths, and clicks navigation controls to open attendance records.
2. **Deterministic Attendance Algebra:** Extracts course tables directly from the DOM and computes exact safe-bunk allowances and required recovery classes algebraically without relying on LLMs for math.
3. **Local-First Privacy & Memory:** Stores all chat history, execution traces, and verified attendance snapshots in on-device **IndexedDB** namespaces, transmitting only minimal grounded context for AI inference.
4. **Live Procedural 3D Companion:** An animated SVG mascot that synchronizes its expressions and speech bubbles with what the agent is actually doing in the browser tab.

---

## 🌟 Core Capabilities

### 1. Autonomous Browser Agent & Computer Use
- **Perception-Action Loop:** Follows a strict sequence: `OBSERVE → PLAN → GROUND → MOVE → ACT → OBSERVE AGAIN → VERIFY → EXTRACT → VALIDATE → DONE`.
- **Hybrid Target Grounding:** Matches intended UI actions to real interactive DOM nodes using 2D Intersection-over-Union (IoU) spatial matching combined with text similarity scoring.
- **Natural Human-like Motion:** Moves the visible cursor using cubic-Bézier trajectories and cosine smoothstep easing with travel times proportional to distance ($400\text{--}1200\text{ ms}$).
- **State-Aware Modal Handling:** Detects if the Student Attendance modal is already open. If already visible, ONEE skips redundant clicks and moves straight to extraction.

### 2. Deterministic Attendance & Safe-Bunk Algebra
- **Zero Math Hallucinations:** Large language models often make off-by-one errors with arithmetic. ONEE performs all attendance calculations deterministically:

$$\text{Safe Bunks (Attendance } \ge T\text{):} \quad x \le \left\lfloor \frac{\text{Attended} - T \cdot \text{Total}}{T} \right\rfloor$$

$$\text{Required Recovery (Attendance } < T\text{):} \quad x \ge \left\lceil \frac{T \cdot \text{Total} - \text{Attended}}{1 - T} \right\rceil$$

- **Discrepancy Validation:** Cross-checks stated percentages against delivered/attended ratios to catch university record updates or duty leaves automatically.

### 3. Grounded Conversational AI & Streaming
- **Stateless Inference:** Powered by Groq Cloud (`qwen/qwen3.8-27b`) with automatic fallback to `qwen/qwen3.6-27b` and `openai/gpt-oss-120b`.
- **Flicker-Free Markdown Streaming:** Renders structured tables, course breakdowns, and bulleted lists incrementally with token buffering to prevent UI jitter.
- **Local Fallback Mode:** If the backend is offline, ONEE switches to a local deterministic response generator so students never lose access to their numbers.

### 4. Local-First Privacy & Storage Architecture
- **Three-Tier Storage Model:**
  - **IndexedDB:** Structured persistent records (`conversations`, `messages`, `agent_executions`, `verified_attendance`).
  - `chrome.storage.local`: Lightweight settings and privacy acknowledgements.
  - `chrome.storage.session`: Ephemeral runtime flags and active execution IDs.
- **Zero Host Storage Pollution:** Completely avoids `window.localStorage` in content scripts to eliminate security leaks into the university host page.
- **Session Isolation:** Changing the logged-in student account resets active caches immediately so data never bleeds across shared laptops.

### 5. Interactive Procedural Companion Mascot
- **Lightweight SVG Canvas Engine:** Renders a 60fps animated character using pure mathematical curves without heavy 3D GLTF bundles or animated GIFs.
- **CSP Compliant:** Eliminates runtime code generation (`eval`, `new Function`, Ajv compilation) to comply strictly with Chrome Web Store Manifest V3 CSP.
- **Context-Aware Reactions:** Features 22 state-driven expressions (observing, thinking, moving, reading, celebrate, confused, etc.) driven by a unified runtime state machine.

---

## 🏗️ Architecture & Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CHROME BROWSER TAB                               │
│  ums.lpu.in (Student logs in normally; solves Cloudflare verification)     │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ ONEE Content Script (content.js)                                      │  │
│  │ ├─ umsDetector.ts (Domain & login validation)                         │  │
│  │ ├─ pageObserver.ts (Interactive DOM element harvesting)               │  │
│  │ ├─ hybridGrounding.ts (2D IoU + Text matching)                        │  │
│  │ ├─ agentMotion.ts (Cubic-Bézier cursor trajectories)                  │  │
│  │ ├─ aiCursorOverlay.ts (Live viewport cursor & target highlights)      │  │
│  │ ├─ actionEngine.ts (Native click & input dispatch)                    │  │
│  │ └─ umsAttendanceParser.ts (Deterministic table extraction)            │  │
│  └──────────────────────────────────┬────────────────────────────────────┘  │
└─────────────────────────────────────┼───────────────────────────────────────┘
                                      │ Chrome Runtime Messaging (IPC)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     ONEE CHROME SIDE PANEL (sidepanel.html)                  │
│  React 18 + TypeScript + Apple Human Interface Design Tokens                │
│                                                                             │
│  ├─ useUmsConnection.ts (Live active tab tracking & reconnect)              │
│  ├─ useAgentController.ts (Autonomous execution loop & step validation)     │
│  ├─ useChatAgent.ts (Thread persistence & streaming response handler)       │
│  ├─ localDatabase.ts (On-Device IndexedDB: chat, executions, attendance)     │
│  ├─ attendanceCalculator.ts (Exact algebraic bunk & recovery math)          │
│  └─ OneeCompanion.tsx (Procedural SVG 3D avatar & context-aware speech)     │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │ Minimal Grounded Context (POST /api/chat)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ONEE BACKEND (FastAPI / Groq Cloud)                      │
│  Stateless • Zero User Database • Multi-User Isolated                       │
│                                                                             │
│  ├─ /api/chat (Token streaming with grounded attendance prompt context)     │
│  ├─ /api/agent/plan (Computer Use next-action planner)                      │
│  └─ Groq Service (qwen/qwen3.8-27b → qwen/qwen3.6-27b → gpt-oss-120b)       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🛠 Tech Stack

| Category | Technology | Purpose |
| :--- | :--- | :--- |
| **Extension Framework** | **Chrome Extension Manifest V3** | Native Chrome Side Panel integration, content scripts, background worker |
| **Frontend Framework** | **React 18.3**, **TypeScript 5.6** | Component hierarchy, state hooks, and strict type safety |
| **Build & Tooling** | **Vite 5.4**, **Rollup** | Multi-target bundling (side panel, background service worker, content script) |
| **Styling & Design** | **Vanilla CSS Modules** | Apple-inspired design tokens, glassmorphism, responsive clamp typography |
| **Local Storage** | **IndexedDB** (`idb`), `chrome.storage` | On-device persistent memory for chat threads, execution traces, and profiles |
| **Testing** | **Vitest 2.1**, **happy-dom** | Unit and integration test suite (60 tests covering math, DOM, parser, storage) |
| **Backend API** | **FastAPI 0.115**, **Python 3.11+** | Stateless REST and Server-Sent Events (SSE) streaming server |
| **AI Inference** | **Groq Cloud API** | Ultra-fast token streaming (`qwen/qwen3.8-27b` with multi-tier fallback) |
| **Avatar Engine** | **@bible-strong/avatar-core** | Pure-math SVG procedural geometry and ambient motion without CSP eval |

---

## 📁 Project Structure

```
FreshProject/
├── backend/                                     # Stateless FastAPI Backend
│   ├── app/
│   │   ├── agent/
│   │   │   ├── agent.py                         # Conversational agent & tool execution loop
│   │   │   ├── planner.py                       # Computer Use next-action planner
│   │   │   ├── prompts.py                       # Grounded system prompts & tone rules
│   │   │   └── tools.py                         # Deterministic attendance calculation tools
│   │   ├── schemas/                             # Pydantic request/response models
│   │   ├── services/
│   │   │   └── groq_service.py                  # Groq API client with fallback chain
│   │   ├── config.py                            # Environment configuration
│   │   └── main.py                              # FastAPI entry point & CORS configuration
│   ├── tests/                                   # Backend unit tests
│   └── requirements.txt                         # Python dependencies
│
├── docs/                                        # Architecture & Audit Reports
│   ├── CODEBASE_AUDIT.md                        # Complete file-by-file inventory audit
│   ├── RELEASE_CHECKLIST.md                     # Chrome Web Store verification matrix
│   ├── architecture.md                          # Detailed extension subsystem design
│   ├── development.md                           # Local developer setup guide
│   └── privacy.md                               # Local-first privacy disclosures
│
├── extension/                                   # Chrome Extension (Manifest V3)
│   ├── manifest.json                            # Manifest V3 configuration & permissions
│   ├── sidepanel.html                           # Side panel HTML shell
│   ├── package.json                             # Extension dependencies & scripts
│   ├── vite.config.ts                           # Side panel Vite configuration
│   ├── vite.background.config.ts                # Service worker Vite build config
│   ├── vite.content.config.ts                   # Content script Vite build config
│   │
│   ├── src/
│   │   ├── background/
│   │   │   └── service-worker.ts                # MV3 worker lifecycle, port reconnections & tabs
│   │   │
│   │   ├── components/                          # React UI Components
│   │   │   ├── AgentControlPanel.tsx            # Computer Use visualizer & pipeline stepper
│   │   │   ├── AttendanceCard.tsx               # Overview attendance card & greeting
│   │   │   ├── BunkCalculatorModal.tsx          # Interactive safe-bunk / recovery modal
│   │   │   ├── ChatMessage.tsx                  # Message bubble with markdown & avatar
│   │   │   ├── ChatView.tsx                     # Chat interface with horizontal suggestion rail
│   │   │   ├── ConnectionState.tsx              # UMS connection status indicator
│   │   │   ├── ConversationDrawer.tsx           # Slide-out conversation history list
│   │   │   ├── CourseList.tsx                   # Expandable course attendance list
│   │   │   ├── CourseRow.tsx                    # Individual course card with progress bar
│   │   │   ├── Header.tsx                       # Side panel navigation & mascot header
│   │   │   ├── OneeCompanion.tsx                # Live mascot avatar & speech bubble
│   │   │   ├── PrivacyModal.tsx                 # On-device data metrics & purge controls
│   │   │   ├── Skeletons.tsx                    # Shimmer loading placeholders
│   │   │   ├── Toast.tsx                        # Notification toast manager
│   │   │   ├── common/
│   │   │   │   └── MarkdownRenderer.tsx         # Streaming markdown & table parser
│   │   │   └── onee/
│   │   │       ├── avatarCore.ts                # CSP-safe procedural avatar geometry
│   │   │       └── avatarRenderer.ts            # 60fps SVG requestAnimationFrame loop
│   │   │
│   │   ├── content/                             # Injected UMS Content Scripts
│   │   │   ├── actionEngine.ts                  # Real DOM click & text input dispatcher
│   │   │   ├── agentMotion.ts                   # Cubic-Bézier cursor motion & easing
│   │   │   ├── aiCursorOverlay.ts               # Visible on-screen cursor & bounding boxes
│   │   │   ├── content-script.ts                # Content script entry & message bridge
│   │   │   ├── coordinateUtils.ts               # Viewport vs document coordinate transforms
│   │   │   ├── hybridGrounding.ts               # Hybrid 2D IoU & text target matcher
│   │   │   ├── pageObserver.ts                  # Interactive DOM scanning & ID mapping
│   │   │   ├── umsAttendanceParser.ts           # Deterministic attendance table extractor
│   │   │   └── umsDetector.ts                   # Hostname & Cloudflare challenge detector
│   │   │
│   │   ├── hooks/                               # React Hooks
│   │   │   ├── useAgentController.ts            # Autonomous perception-action loop
│   │   │   ├── useChatAgent.ts                  # Chat persistence & streaming response hook
│   │   │   ├── useReducedMotion.ts              # System accessibility preference listener
│   │   │   └── useUmsConnection.ts              # UMS tab detection & auto-reconnect
│   │   │
│   │   ├── lib/                                 # Shared Client Utilities
│   │   │   ├── confetti.ts                      # Restrained celebratory particle bursts
│   │   │   ├── humanizer.ts                     # AI cliché & corporate filler stripper
│   │   │   ├── oneeEvents.ts                    # Mascot state machine & event bridge
│   │   │   └── runtimeState.ts                  # Centralized single source of truth
│   │   │
│   │   ├── services/                            # Data & IPC Repositories
│   │   │   ├── api.ts                           # Backend API client & local fallback engine
│   │   │   ├── connectionManager.ts             # Service worker port keeper & heartbeat
│   │   │   ├── localDatabase.ts                 # IndexedDB stores & lifecycle controls
│   │   │   ├── personalizationStore.ts          # On-device student preferences & topics
│   │   │   ├── repositories.ts                  # Clean repository abstraction layer
│   │   │   ├── suggestionGenerator.ts           # Dynamic context-aware suggestion rail
│   │   │   └── tabMessenger.ts                  # Chrome tab query & script injector
│   │   │
│   │   ├── shared/                              # Shared Interfaces & Math
│   │   │   ├── attendanceCalculator.ts          # Pure algebraic bunk & recovery math
│   │   │   ├── messages.ts                      # IPC message protocol definitions
│   │   │   └── types.ts                         # Complete domain models & telemetry types
│   │   │
│   │   ├── sidepanel/                           # Side Panel Entry
│   │   │   ├── App.tsx                          # Root coordinator & view switcher
│   │   │   └── main.tsx                         # Side panel React mounting
│   │   │
│   │   ├── styles/                              # Design Tokens & Baseline
│   │   │   ├── global.css                       # Reset, slim scrollbars & focus rings
│   │   │   └── variables.css                    # Color palette, radii & motion tokens
│   │   │
│   │   └── tests/                               # Vitest Unit & Integration Tests (60 tests)
│   │
│   └── scripts/                                 # Build & Packaging Utilities
│       ├── dev.mjs                              # Multi-bundle watch dev server
│       └── package_extension.py                 # Chrome Web Store ZIP packager
│
└── README.md                                    # Project documentation
```

---

## ⚙️ Installation & Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v18.x or later)
- [Python 3.11+](https://www.python.org/) (for optional backend)
- Google Chrome (or Chromium-based browser)

### 1. Clone the Repository

```bash
git clone https://github.com/MohammadFayasKhan/FreshProject.git
cd FreshProject
```

### 2. Install Extension Dependencies & Build

```bash
cd extension
npm install
npm run build
```

### 3. Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the `FreshProject/extension/dist` directory.
4. Open the Chrome Side Panel (or click the ONEE toolbar icon) while visiting `https://ums.lpu.in/`.

### 4. (Optional) Run the FastAPI Backend

The extension works completely offline using built-in deterministic math and fallback logic. To enable remote LLM streaming via Groq:

```bash
cd ../backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Create .env file with your Groq API key
echo "GROQ_API_KEY=your_groq_api_key_here" > .env

# Start server
uvicorn app.main:app --reload --port 8000
```

---

## 🧪 Testing & Verification Matrix

The codebase includes an extensive automated test suite covering deterministic mathematics, DOM observers, coordinate spaces, and IndexedDB storage:

```bash
cd extension
npm run test
```

### Test Coverage Summary

| Test Suite | Focus Area | Status |
| :--- | :--- | :--- |
| `attendanceCalculator.test.ts` | Bunk formulas, recovery math, lowest subject search | ✅ Passed |
| `actionEngine.test.ts` | Coordinate bounds, click dispatch, text input | ✅ Passed |
| `coordinateUtils.test.ts` | Viewport/document conversions, navbar safe zones | ✅ Passed |
| `hybridGrounding.test.ts` | 2D IoU spatial matching, text similarity scoring | ✅ Passed |
| `localDatabase.test.ts` | IndexedDB CRUD, session isolation, data purge | ✅ Passed |
| `oneeCompanion.test.ts` | Event bridge subscription, avatar state transitions | ✅ Passed |
| `pageObserver.test.ts` | Interactive element scanning, ID attribute mapping | ✅ Passed |
| `repositories.test.ts` | Repository tier abstraction, storage boundaries | ✅ Passed |
| `umsAttendanceParser.test.ts` | Real HTML fixtures, 6-subject counts, discrepancy flags | ✅ Passed |
| `umsDetector.test.ts` | Hostname matching, login screen, Cloudflare detection | ✅ Passed |

---

## 🔒 Privacy & Security Disclosures

- **Zero Password Collection:** ONEE never asks for, captures, or transmits student passwords.
- **Zero Cookie Extraction:** UMS authentication cookies (`ASP.NET_SessionId`, `.ASPXAUTH`) are never accessed or transmitted.
- **No Cloudflare Bypassing:** Turnstile verification and human challenges remain strictly student-operated in the browser tab.
- **On-Device Storage:** Conversations, execution traces, and verified attendance snapshots remain 100% private in the browser's local IndexedDB.
- **Minimal Remote Context:** Only the minimal grounded attendance context needed for the immediate query is transmitted to the AI provider.
- **Full Data Ownership:** Students can inspect exact storage metrics and purge individual or all local records anytime via the built-in Privacy modal.

---

## 💡 Why I Built This

As a B.Tech Computer Science Engineering student at Lovely Professional University, tracking course attendance, calculating safe bunk allowances across 6+ subjects, and ensuring regular exam eligibility requires navigating through multiple portal submenus every week.

Existing tools often rely on storing student passwords in external databases, run fragile scrapers that trigger account lockouts, or use LLMs that hallucinate simple arithmetic.

I built ONEE to demonstrate a production-grade browser agent architecture that solves this problem right:
- Operates inside the student's real, already-authenticated session.
- Separates deterministic calculations from conversational reasoning.
- Respects student privacy with on-device memory and zero credential storage.

---

## 👨‍💻 Author

<div align="center">
  <h3><strong>Mohammad Fayas Khan</strong></h3>
  <p><em>B.Tech Computer Science Engineering Student • Lovely Professional University</em></p>

  <p>
    <a href="https://www.linkedin.com/in/mohammadfayaskhan/" target="_blank">
      <img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white" alt="LinkedIn" />
    </a>&nbsp;
    <a href="https://github.com/MohammadFayasKhan" target="_blank">
      <img src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub" />
    </a>&nbsp;
    <a href="mailto:fayaskhanmohammad@gmail.com">
      <img src="https://img.shields.io/badge/Email-EA4335?style=for-the-badge&logo=gmail&logoColor=white" alt="Email" />
    </a>
  </p>
</div>

---

## 📝 License

This project is open-source and licensed under the [MIT License](LICENSE).
