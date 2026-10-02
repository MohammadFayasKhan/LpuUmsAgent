<div align="center">

# ONEE → Autonomous Browser Agent & Academic Copilot 🎓✨

**An autonomous, privacy-first Browser Agent with Computer Use for Attendance Intelligence, Examination Date Sheets, and Seating Plan verification on LPU UMS.**

[![React](https://img.shields.io/badge/React-18.3-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5.4-B73BFE?style=flat-square&logo=vite&logoColor=FFD62E)](https://vitejs.dev/)
[![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![IndexedDB](https://img.shields.io/badge/Storage-IndexedDB_Local--First-7C3AED?style=flat-square)](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
[![Vitest](https://img.shields.io/badge/Vitest-97_Passing-22c55e?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev/)
[![Pytest](https://img.shields.io/badge/Pytest-13_Passing-22c55e?style=flat-square&logo=pytest&logoColor=white)](https://pytest.org/)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)

<br/>

<img src="extension/public/icons/onee-master-1024.png" alt="ONEE Companion Mascot & Browser Agent" width="180" style="border-radius: 28px;" />
<p align="center"><em>Native Chrome Side Panel Agent operating directly inside the student's authenticated UMS session</em></p>

</div>

---

## 📖 Overview

**ONEE** is an autonomous browser copilot built for Lovely Professional University (LPU) students. It runs as a **Manifest V3 Chrome Extension** in the native **Chrome Side Panel** alongside the university portal (`ums.lpu.in` and `studentums.lpu.in`).

Most university bots rely on external scrapers (Playwright or Puppeteer) that break on Cloudflare Turnstile or require students to share plaintext passwords. ONEE runs inside the student's **already-authenticated Chrome session**. The student logs into UMS normally, and ONEE handles navigation through real Computer Use:

1. **Autonomous Computer Use Navigation:** Observes the live DOM, locates UI targets, moves a visible cursor along smooth cubic-Bézier paths, and clicks navigation controls to find date sheets and attendance records.
2. **Dynamic SPA Synchronization (`WAIT_FOR_RENDER`):** Handles single-page app delays on `studentums.lpu.in` with live DOM mutation observers, ensuring records are fully mounted before extraction.
3. **Examination Date Sheet & Seating Plan Verification:** Extracts course codes, dates, times, relative reporting windows, rooms, desks, and online exam links.
4. **Deterministic Attendance Algebra:** Calculates safe bunks and required recovery classes algebraically with zero reliance on LLMs for arithmetic.
5. **Local-First Privacy & Memory:** Stores all chat history, execution traces, and verified academic records on-device in **IndexedDB**.
6. **Live Procedural 3D Companion:** An animated SVG mascot with 22 state-driven expressions synchronized to the agent's real-time browser actions.

---

## 🌟 Core Features

### 1. Autonomous Computer Use Pipeline

ONEE executes real browser actions through a strict perception-action loop:

$$\text{OBSERVE} \longrightarrow \text{THINK} \longrightarrow \text{LOCATE} \longrightarrow \text{WAIT\_FOR\_RENDER} \longrightarrow \text{MOVE} \longrightarrow \text{ACT} \longrightarrow \text{EXTRACT} \longrightarrow \text{VALIDATE} \longrightarrow \text{VERIFY} \longrightarrow \text{DONE}$$

- **Hybrid Element Grounding:** Pairs 2D Intersection-over-Union (IoU) spatial matching with semantic text scoring to target real DOM elements without brittle static selectors.
- **Natural Cursor Physics:** Uses cubic-Bézier curves and cosine smoothstep easing with travel times proportional to distance ($400\text{--}1200\text{ ms}$).
- **Visual Target Highlighting:** Outlines active target elements with distinct color-coded badges (`discovered`, `targeting`, `verified`).
- **Dynamic SPA Loading State (`WAIT_FOR_RENDER`):** Recognizes Angular SPA page shells and monitors DOM mutations until exam cards mount, preventing blank extractions.

---

### 2. Examination Date Sheet & Seating Plan Agent

ONEE provides dedicated browser agent automation for student examinations:

- **Universal Layout Support:** Reads legacy tabular schedules on `ums.lpu.in` and modern Angular card lists on `studentums.lpu.in/dashboard/examination/conduct/seatingplan`.
- **Relative Reporting Time Resolution:** Automatically calculates exact reporting windows from natural phrases (for example, *"Report 30 minutes before start of exam"* for a 14:00 exam resolves to `13:30 (30 mins before)`).
- **Seat Allocation & Venue Tracking:** Extracts room numbers, block/building designations, desk assignments, and online exam portals.
- **Next Exam Tracking:** Identifies the nearest upcoming exam, computes remaining days, and flags pending instructions.
- **Isolated IndexedDB Storage:** Saves structured examination records to `verified_examination` without modifying attendance data.

---

### 3. Deterministic Attendance & Safe-Bunk Algebra

ONEE performs all attendance mathematics deterministically using exact algebraic bounds:

$$\text{Safe Bunks (Attendance } \ge T\text{):} \quad x \le \left\lfloor \frac{\text{Attended} - T \cdot \text{Total}}{T} \right\rfloor$$

$$\text{Required Recovery (Attendance } < T\text{):} \quad x \ge \left\lceil \frac{T \cdot \text{Total} - \text{Attended}}{1 - T} \right\rceil$$

- **Zero Arithmetic Hallucinations:** Large language models frequently make off-by-one errors. ONEE guarantees mathematically sound bunk counts.
- **Margin Analysis:** Evaluates exact lecture margins for $75\%$, $80\%$, and $85\%$ thresholds across all enrolled courses.
- **Discrepancy Checks:** Compares published percentages against attended-to-delivered ratios to flag duty leaves and pending updates automatically.

---

### 4. Local-First Privacy & Storage Architecture

- **Three-Tier Storage Model:**
  - **IndexedDB:** Structured local records (`conversations`, `messages`, `agent_executions`, `verified_attendance`, `verified_examination`).
  - `chrome.storage.local`: Lightweight settings and privacy acknowledgements.
  - `chrome.storage.session`: Active execution run IDs and ephemeral runtime flags.
- **Zero Host Storage Pollution:** Completely avoids `window.localStorage` inside content scripts to prevent data leaks into the university host page.
- **Session Isolation:** Switching student accounts resets active caches immediately so data never bleeds across shared computers.

---

### 5. Interactive Procedural Companion Mascot

- **Lightweight SVG Engine:** Renders a 60fps character using pure mathematical curves without external GLTF bundles or static GIFs.
- **CSP Compliant:** Eliminates runtime code generation (`eval`, `new Function`) to comply strictly with Chrome Web Store Manifest V3 security rules.
- **Contextual Reactions:** Features 22 state-driven expressions (observing, thinking, moving, reading, celebrate, warning, error) linked to browser agent events.

---

## 🏗️ Architecture & Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CHROME BROWSER TAB                               │
│  ums.lpu.in / studentums.lpu.in (Real authenticated student session)        │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ ONEE Content Script (content.js)                                      │  │
│  │ ├─ umsDetector.ts (Domain, login, and portal surface routing)         │  │
│  │ ├─ pageObserver.ts (Interactive DOM element harvesting & card index)  │  │
│  │ ├─ examinationDetector.ts (SPA content detection & MutationObserver) │  │
│  │ ├─ examDateSheetParser.ts (Leaf card extraction & reporting times)    │  │
│  │ ├─ umsAttendanceParser.ts (Deterministic table extraction)            │  │
│  │ ├─ hybridGrounding.ts (2D IoU + Text matching)                        │  │
│  │ ├─ agentMotion.ts (Cubic-Bézier trajectories & easing)                │  │
│  │ ├─ aiCursorOverlay.ts (Visible viewport cursor & target highlights)   │  │
│  │ └─ actionEngine.ts (Native click, input dispatch & waitForRender)     │  │
│  └──────────────────────────────────┬────────────────────────────────────┘  │
└─────────────────────────────────────┼───────────────────────────────────────┘
                                      │ Chrome Runtime Messaging (IPC)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     ONEE CHROME SIDE PANEL (sidepanel.html)                  │
│  React 18 + TypeScript + Vanilla CSS Modules                                │
│                                                                             │
│  ├─ useUmsConnection.ts (Active tab tracking & automatic reconnection)      │
│  ├─ useAgentController.ts (Autonomous perception-action loop manager)      │
│  │   └─ WAIT_FOR_RENDER stage & terminal state gating (READY/FAILED/etc)   │
│  ├─ AgentControlPanel.tsx (Activity stepper, visualizer & retry controls)   │
│  ├─ localDatabase.ts (On-Device IndexedDB: chat, executions, attendance)     │
│  ├─ verifiedExaminationRepo.ts (Dedicated exam date sheet persistence)      │
│  ├─ attendanceCalculator.ts (Exact algebraic bunk & recovery formulas)      │
│  └─ OneeCompanion.tsx (Procedural SVG 3D avatar & context speech)            │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │ Minimal Grounded Context (POST /api/chat)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ONEE BACKEND (FastAPI / Groq Cloud)                      │
│  Stateless • Zero Credential Storage • Multi-User Isolated                   │
│                                                                             │
│  ├─ /api/chat (Token streaming with grounded academic context)              │
│  ├─ /api/agent/plan (Computer Use next-action planner with waitForRender)   │
│  └─ Groq Service (qwen/qwen3.8-27b → qwen/qwen3.6-27b → gpt-oss-120b)       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🛠 Tech Stack

| Category | Technology | Purpose |
| :--- | :--- | :--- |
| **Extension Framework** | **Chrome Extension Manifest V3** | Native Chrome Side Panel integration, content scripts, background worker |
| **Frontend Framework** | **React 18.3**, **TypeScript 5.6** | Modular component hierarchy, custom hooks, strict type safety |
| **Build System** | **Vite 5.4**, **Rollup** | Multi-bundle packaging (sidepanel, background service worker, content script) |
| **Styling & Design** | **Vanilla CSS Modules** | Tailored dark theme, glassmorphism, responsive clamp typography |
| **Local Storage** | **IndexedDB** (`idb`), `chrome.storage` | On-device persistent memory for conversations, executions, and records |
| **Testing (Frontend)** | **Vitest 2.1**, **JSDOM** | 14 test suites with 97 passing tests covering DOM, parsers, math, and actions |
| **Testing (Backend)** | **Pytest 9.1**, **pytest-asyncio** | 13 passing unit and integration tests for planner, API, and agent tools |
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
│   │   │   ├── agent.py                         # Conversational agent & tool loop
│   │   │   ├── planner.py                       # Computer Use planner (supports waitForRender)
│   │   │   ├── prompts.py                       # Grounded prompts & academic tone rules
│   │   │   └── tools.py                         # Deterministic attendance tools
│   │   ├── schemas/                             # Pydantic models (PageObservation, AgentAction)
│   │   ├── services/
│   │   │   └── groq_service.py                  # Groq client with multi-model fallback
│   │   ├── config.py                            # Backend settings & environment variables
│   │   └── main.py                              # FastAPI entry point & CORS configuration
│   ├── tests/                                   # Pytest test suite (13 passing tests)
│   └── requirements.txt                         # Python dependencies
│
├── extension/                                   # Chrome Extension (Manifest V3)
│   ├── manifest.json                            # MV3 manifest with side panel declaration
│   ├── sidepanel.html                           # Side panel HTML shell
│   ├── package.json                             # Extension scripts & dependencies
│   ├── vite.config.ts                           # Side panel Vite configuration
│   ├── vite.background.config.ts                # Service worker Vite build config
│   ├── vite.content.config.ts                   # Content script Vite build config
│   │
│   ├── src/
│   │   ├── background/
│   │   │   └── service-worker.ts                # MV3 worker lifecycle, port reconnections & tabs
│   │   │
│   │   ├── components/                          # React UI Components
│   │   │   ├── AgentControlPanel.tsx            # Computer Use visualizer & terminal state cards
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
│   │   │   └── onee/
│   │   │       ├── avatarCore.ts                # CSP-safe procedural avatar geometry
│   │   │       └── avatarRenderer.ts            # 60fps SVG requestAnimationFrame loop
│   │   │
│   │   ├── content/                             # Injected UMS Content Scripts
│   │   │   ├── actionEngine.ts                  # Real DOM click, type, and waitForRender dispatcher
│   │   │   ├── agentMotion.ts                   # Cubic-Bézier cursor motion & easing
│   │   │   ├── aiCursorOverlay.ts               # Visible on-screen cursor & bounding boxes
│   │   │   ├── content-script.ts                # Content script entry & message bridge
│   │   │   ├── coordinateUtils.ts               # Viewport vs document coordinate transforms
│   │   │   ├── hybridGrounding.ts               # Hybrid 2D IoU & text target matcher
│   │   │   ├── pageObserver.ts                  # Interactive DOM scanning & ID mapping
│   │   │   ├── umsAttendanceParser.ts           # Deterministic attendance table extractor
│   │   │   ├── umsDetector.ts                   # Hostname & Cloudflare challenge detector
│   │   │   └── examination/                     # Examination Agent Content Subsystem
│   │   │       ├── examDateSheetParser.ts       # Leaf card parser with relative reporting time
│   │   │       ├── examinationDetector.ts       # Page detection & MutationObserver render watcher
│   │   │       ├── examinationValidator.ts      # Schema validator for examination records
│   │   │       └── seatingPlanParser.ts         # Seating allocation & venue parser
│   │   │
│   │   ├── hooks/                               # React Custom Hooks
│   │   │   ├── useAgentController.ts            # Autonomous perception-action loop manager
│   │   │   ├── useChatAgent.ts                  # Chat persistence & streaming response hook
│   │   │   ├── useReducedMotion.ts              # Accessibility preference listener
│   │   │   └── useUmsConnection.ts              # UMS tab detection & auto-reconnect
│   │   │
│   │   ├── services/                            # Data & IPC Repositories
│   │   │   ├── api.ts                           # Backend API client & local fallback engine
│   │   │   ├── connectionManager.ts             # Service worker port keeper & heartbeat
│   │   │   ├── localDatabase.ts                 # IndexedDB stores & lifecycle controls
│   │   │   ├── verifiedExaminationRepo.ts       # Examination records persistence store
│   │   │   └── tabMessenger.ts                  # Chrome tab query & script injector
│   │   │
│   │   ├── shared/                              # Shared Types & Math
│   │   │   ├── attendanceCalculator.ts          # Pure algebraic bunk & recovery math
│   │   │   ├── messages.ts                      # IPC message protocol definitions
│   │   │   └── types.ts                         # Complete domain models & telemetry types
│   │   │
│   │   └── tests/                               # Vitest Unit & Integration Tests (97 tests)
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

- [Node.js](https://nodejs.org/) (version 18.x or later)
- [Python 3.11+](https://www.python.org/) (for optional backend server)
- Google Chrome (or any Chromium-based browser with Side Panel support)

### 1. Clone the Repository

```bash
git clone https://github.com/MohammadFayasKhan/OneeLpuAgent.git
cd OneeLpuAgent
```

### 2. Build the Chrome Extension

```bash
cd extension
npm install
npm run build
```

This compiles TypeScript and generates all three bundles (`sidepanel.html`, `content.js`, `service-worker.js`) into `extension/dist/`.

### 3. Load Extension in Google Chrome

1. Open Chrome and navigate to `chrome://extensions/`.
2. Toggle **Developer mode** in the upper-right corner.
3. Click **Load unpacked** and select the `OneeLpuAgent/extension/dist` folder.
4. Navigate to `https://ums.lpu.in/` in Chrome and open the Side Panel (or click the ONEE icon in your browser toolbar).

### 4. (Optional) Start the FastAPI Backend

ONEE runs completely offline with built-in deterministic calculation and local planning. To enable remote LLM streaming via Groq:

```bash
cd ../backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Create environment configuration
echo "GROQ_API_KEY=your_groq_api_key_here" > .env

# Run FastAPI server
uvicorn app.main:app --reload --port 8000
```

---

## 🧪 Testing & Verification Matrix

The project includes thorough test suites covering deterministic mathematics, DOM observers, coordinate spaces, and IndexedDB storage:

### Extension Unit & Integration Tests (Vitest)

```bash
cd extension
npm test
```

| Test Suite | Focus Area | Tests | Status |
| :--- | :--- | :---: | :---: |
| `umsPreflight.test.ts` | Campus Drive modal detection, isolation, Remind me later gating | 6 | ✅ Passed |
| `examDateSheetParser.test.ts` | Angular SPA leaf cards, relative reporting times, dynamic traversal | 12 | ✅ Passed |
| `examinationValidator.test.ts` | Examination schema verification, date parsing, missing venue checks | 17 | ✅ Passed |
| `attendanceCalculator.test.ts` | Safe-bunk algebra, recovery class bounds, lowest subject search | 16 | ✅ Passed |
| `actionEngine.test.ts` | Real DOM clicks, input dispatch, table & card element highlighting | 5 | ✅ Passed |
| `umsAttendanceParser.test.ts` | Real HTML fixtures, course counts, discrepancy checks | 7 | ✅ Passed |
| `umsDetector.test.ts` | Hostname matching, login screen, Cloudflare detection | 10 | ✅ Passed |
| `intentRouter.test.ts` | Natural language goal classification (attendance vs examination) | 8 | ✅ Passed |
| `repositories.test.ts` | Repository tier abstraction, storage boundaries | 6 | ✅ Passed |
| `localDatabase.test.ts` | IndexedDB CRUD, session isolation, data purge | 6 | ✅ Passed |
| `verifiedExaminationRepo.test.ts` | Examination persistence, multi-user isolation | 3 | ✅ Passed |
| `coordinateUtils.test.ts` | Viewport/document conversions, navbar safe zones | 3 | ✅ Passed |
| `hybridGrounding.test.ts` | 2D IoU spatial matching, text similarity scoring | 3 | ✅ Passed |
| `pageObserver.test.ts` | Interactive element scanning, ID attribute mapping | 3 | ✅ Passed |
| `examinationCalculator.test.ts` | Chronological sort, next exam computation, timing checks | 16 | ✅ Passed |
| `oneeCompanion.test.ts` | Event bridge subscription, avatar state transitions | 2 | ✅ Passed |
| **Total** | **All 16 Test Suites** | **123** | **✅ 100% Passed** |

### Backend Tests (Pytest)

```bash
cd backend
.venv/bin/pytest
```

| Test Suite | Focus Area | Tests | Status |
| :--- | :--- | :---: | :---: |
| `test_agent.py` | Conversational agent execution loop | 1 | ✅ Passed |
| `test_api.py` | REST endpoints and health checks | 2 | ✅ Passed |
| `test_fallback.py` | Offline fallback planning and recovery | 2 | ✅ Passed |
| `test_planner.py` | Next-action planner & `waitForRender` actions | 5 | ✅ Passed |
| `test_tools.py` | Deterministic calculation tool bindings | 6 | ✅ Passed |
| **Total** | **All Backend Test Files** | **16** | **✅ 100% Passed** |

---

## 🔒 Privacy & Security

- **Zero Password Storage:** ONEE never requests, intercepts, or saves student passwords.
- **Zero Cookie Extraction:** UMS session cookies (`ASP.NET_SessionId`, `.ASPXAUTH`) are never read or transmitted.
- **Real Session Operation:** Runs exclusively inside the student's browser tab. Cloudflare verification and multi-factor authentication remain student-controlled.
- **On-Device Storage:** Attendance history, examination schedules, and chat records stay private in the browser's local IndexedDB.
- **Minimal Remote Context:** Only the specific grounded data needed to answer the immediate question is sent to the AI provider.
- **Complete Data Control:** Students can review stored metrics and delete local records at any time using the Privacy modal.

---

## 💡 Why I Built This

As a B.Tech Computer Science Engineering student at Lovely Professional University, keeping track of attendance percentages across multiple subjects, calculating exact safe-bunk allowances to maintain $75\%$, and finding exam seating plans across different portal submenus is part of weekly university life.

Existing tools often require students to enter passwords into third-party databases, use fragile scrapers that trigger account lockouts, or use chatbots that make arithmetic mistakes.

I built ONEE to demonstrate a clean, reliable browser agent architecture:
- Operates inside the student's real, authenticated session without storing credentials.
- Separates deterministic calculations from conversational reasoning.
- Treats portal loading delays as explicit state transitions (`WAIT_FOR_RENDER`) instead of arbitrary timeouts.
- Keeps student data private using on-device memory.

---

## 👨‍💻 Author

<div align="center">
  <h3><strong>Mohammad Fayas Khan</strong></h3>
  <p><em>B.Tech Computer Science Engineering Student • Lovely Professional University</em></p>
  <p><em>Aspiring AI/ML Engineer</em></p>

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
