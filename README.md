<div align="center">

# ONEE → Autonomous Browser Agent & Academic Copilot 🎓✨

**An autonomous, privacy-first Browser Agent with Computer Use for Attendance Intelligence, Examination Date Sheets, Seating Plans, and Lecture Schedules on LPU UMS.**

[![React](https://img.shields.io/badge/React-18.3-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5.4-B73BFE?style=flat-square&logo=vite&logoColor=FFD62E)](https://vitejs.dev/)
[![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![Design System](https://img.shields.io/badge/Design_System-Apple_iOS_HIG-007AFF?style=flat-square&logo=apple&logoColor=white)](https://developer.apple.com/design/human-interface-guidelines/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=flat-square&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![IndexedDB](https://img.shields.io/badge/Storage-IndexedDB_Local--First-7C3AED?style=flat-square)](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
[![Vitest](https://img.shields.io/badge/Vitest-239_Passing-22c55e?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev/)
[![Pytest](https://img.shields.io/badge/Pytest-22_Passing-22c55e?style=flat-square&logo=pytest&logoColor=white)](https://pytest.org/)
[![Voice Agent](https://img.shields.io/badge/Voice_Agent-Multimodal_Computer_Use-7c3aed?style=flat-square)](https://groq.com/)
[![Playwright](https://img.shields.io/badge/E2E-Playwright_Verified-2EAD33?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev/)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)

<br/>

<img src="extension/public/icons/onee-master-1024.png" alt="ONEE Companion Mascot & Browser Agent" width="180" style="border-radius: 28px;" />
<p align="center"><em>Native Chrome Side Panel Agent operating directly inside the student's authenticated UMS session</em></p>

</div>

> **No passwords. No scrapers. No headless browsers.**
> ONEE works inside your real Chrome session → sees the same pages you see → navigates with a visible AI cursor → extracts verified data → stores everything locally on your device.

---

## 📖 Overview

**ONEE** is an autonomous browser copilot engineered specifically for Lovely Professional University (LPU) students. It runs as a **Manifest V3 Chrome Extension** in the native **Chrome Side Panel** alongside university portals (`ums.lpu.in` and `studentums.lpu.in`).

Most university bots rely on external headless scrapers (Playwright or Puppeteer) that break on Cloudflare Turnstile verification or require students to share plaintext passwords with third-party servers. ONEE runs inside the student's **already-authenticated Chrome session**. The student logs into UMS normally, and ONEE handles portal navigation through real Computer Use:

1. **Autonomous Computer Use Navigation:** Observes the live DOM, locates UI targets, moves a visible cursor along smooth cubic-Bézier paths, and clicks navigation controls to find date sheets and attendance records.
2. **Global UMS Preflight & Modal Handling:** Automatically detects blocking *"Campus Drive Notifications"* popups and safely clicks *"Remind me later"* with visual AI cursor movement so student placement opportunities remain saved.
3. **Examination Date Sheet & Seating Plan Verification:** Extracts course codes, dates, times, relative reporting windows, rooms, desks, and online exam links across 1 to 10+ scheduled exams.
4. **Timetable & LMS Lecture Schedules:** Traverses internal SSRS report viewer containers without scrolling the host page, supporting segmented day filtering (Today, Mon–Sat) and faculty directories.
5. **Sample Question Paper Sub-Automation (`SamplePaperAgent`):** Detects question paper availability without auto-downloading, navigating directly to the PDF preview on request.
6. **Deterministic Attendance Algebra:** Calculates safe bunks and required recovery classes algebraically with zero reliance on LLMs for arithmetic.
7. **Apple iOS Design System & Fluid 60 FPS Motion:** Frosted glass materials (`backdrop-filter: blur(40px)`), critically-damped spring animations, specular edge highlights, and smooth streaming response follow-through.
8. **Local-First Privacy & Memory:** Stores all chat history, execution traces, and verified academic records on-device in **IndexedDB**.
9. **Live Procedural 3D Companion:** An animated SVG mascot with 22 state-driven expressions synchronized to the agent's real-time browser actions.

---

## 🌟 Core Features

### 1. Autonomous Computer Use Pipeline

ONEE executes real browser actions through a strict perception-action loop:

```mermaid
flowchart LR
    A["● OBSERVE"] --> B["● THINK"]
    B --> C["● LOCATE"]
    C --> D["✓ WAIT_FOR_RENDER"]
    D --> E["→ MOVE"]
    E --> F["● ACT"]
    F --> G["● EXTRACT"]
    G --> H["✓ VALIDATE"]
    H --> I["✓ VERIFY"]
    I --> J["✓ DONE"]

    classDef observe fill:#7c3aed,stroke:#a78bfa,stroke-width:1px,color:#ffffff;
    classDef think fill:#6366f1,stroke:#818cf8,stroke-width:1px,color:#ffffff;
    classDef locate fill:#2563eb,stroke:#60a5fa,stroke-width:1px,color:#ffffff;
    classDef wait fill:#0d9488,stroke:#2dd4bf,stroke-width:1px,color:#ffffff;
    classDef move fill:#d97706,stroke:#fcd34d,stroke-width:1px,color:#ffffff;
    classDef act fill:#ea580c,stroke:#fb923c,stroke-width:1px,color:#ffffff;
    classDef extract fill:#0284c7,stroke:#38bdf8,stroke-width:1px,color:#ffffff;
    classDef validate fill:#16a34a,stroke:#4ade80,stroke-width:1px,color:#ffffff;
    classDef verify fill:#059669,stroke:#34d399,stroke-width:1px,color:#ffffff;
    classDef done fill:#10b981,stroke:#6ee7b7,stroke-width:1px,color:#ffffff;

    class A observe;
    class B think;
    class C locate;
    class D wait;
    class E move;
    class F act;
    class G extract;
    class H validate;
    class I verify;
    class J done;
```

> `● OBSERVE` → `● THINK` → `● LOCATE` → `✓ WAIT_FOR_RENDER` → `→ MOVE` → `● ACT` → `● EXTRACT` → `✓ VALIDATE` → `✓ VERIFY` → `✓ DONE`

- **Hybrid Element Grounding:** Pairs 2D Intersection-over-Union (IoU) spatial matching with semantic text scoring to target real DOM elements without brittle static selectors.
- **Natural Cursor Physics:** Uses cubic-Bézier curves and cosine smoothstep easing with travel times proportional to distance ($400\text{--}1200\text{ ms}$).
- **Visual Target Highlighting:** Outlines active target elements with distinct color-coded badges (`discovered`, `targeting`, `verified`).
- **Dynamic SPA Loading State (`WAIT_FOR_RENDER`):** Recognizes Angular SPA page shells and monitors DOM mutations until records mount, preventing blank extractions.

---

### 2. Global UMS Preflight & Blocking Modal Dismissal

- **Pre-Execution Modal Inspection:** Runs before any navigation or extraction starts.
- **Safe Dismissal Guarantee:** Identifies the *"Campus Drive Notifications"* modal and targets **"Remind me later"** exclusively. Never clicks destructive actions like "Mark as Read" so placement opportunities stay preserved.
- **Visual Trajectory Feedback:** Moves the visible AI cursor to the button, provides visual highlight confirmation, and verifies modal removal before allowing subsequent automation steps to proceed.
- **Dynamic In-Loop Guard:** If a notification popup appears mid-session (e.g. after navigating back to dashboard), the agent intercepts it immediately, dismisses it, and re-observes the unblocked page.

---

### 3. Examination Date Sheet & Seating Plan Agent

ONEE provides dedicated browser agent automation for student examinations:

- **Universal Layout Support:** Reads legacy tabular schedules on `ums.lpu.in` and modern Angular card lists on `studentums.lpu.in/dashboard/examination/conduct/seatingplan`.
- **Relative Reporting Time Resolution:** Automatically calculates exact reporting windows from natural phrases (e.g. *"Report 30 minutes before start of exam"* for a 14:00 exam resolves to `13:30 (30 mins before)`).
- **Seat Allocation & Venue Tracking:** Extracts room numbers, block/building designations, desk assignments, and online exam portals.
- **Next Exam Spotlight:** Highlights the nearest upcoming exam, computes remaining days/hours, and flags pending instructions.
- **Isolated IndexedDB Storage:** Saves structured examination records to `verified_examination` without modifying attendance data.

---

### 4. Timetable & LMS Lecture Schedules

- **SSRS Report Container Traversal:** Navigates `Academics ➔ LMS ➔ View Time Table` and scrolls inside internal Microsoft ReportViewer scroll containers down to the faculty directory without scrolling the student's main browser window.
- **Segmented Day Filter Bar:** Filter classes by day (**Today**, **Mon**, **Tue**, **Wed**, **Thu**, **Fri**, **Sat**) using Apple segmented control aesthetics with instant tactile touch states.
- **Live Class Detection:** Detects current ongoing and next upcoming classes based on 24-hour university scheduling intervals.
- **Faculty & Venue Directory:** Displays course instructor names, cabin/room locations, and delivery status (Attended, Delivered, Cancelled).

---

### 5. Sample Question Paper Sub-Automation (`SamplePaperAgent`)

- **Passive Metadata Indexing:** Detects whether a sample question paper is available during initial Date Sheet extraction without auto-downloading or triggering unwanted files.
- **Dedicated Intent Execution:** Responds to requests like *"Open sample paper for CSE408"* by resolving the target course card, navigating the physical AI cursor to the specific button, and opening the official university question paper.

---

### 6. Deterministic Attendance & Safe-Bunk Algebra

ONEE performs all attendance mathematics deterministically using exact algebraic bounds:

**Safe Bunks** (when current attendance >= threshold):

```
Allowable Bunks  =  floor( (Attended - T * Total) / T )
```

**Required Recovery** (when current attendance < threshold):

```
Classes Needed   =  ceil( (T * Total - Attended) / (1 - T) )
```

> Where `T` = target threshold (0.75, 0.80, or 0.85), `Attended` = classes attended, `Total` = total classes delivered.

- **Zero Arithmetic Hallucinations:** Large language models frequently make off-by-one errors. ONEE guarantees mathematically sound bunk counts using pure algebraic computation.
- **Multi-Threshold Margin Analysis:** Evaluates exact lecture margins for **75%**, **80%**, and **85%** thresholds across all enrolled courses simultaneously.
- **Discrepancy Detection:** Compares published percentages against attended-to-delivered ratios to flag duty leaves and pending updates automatically.

---

### 7. Apple iOS Design System & Fluid Motion

- **Frosted Glass Acrylic Surfaces:** Uses `backdrop-filter: blur(40px) saturate(190%)` paired with specular top rim highlights (`inset 0 1px 0 rgba(255, 255, 255, 0.2)`).
- **Physical Spring Feedback:** Buttons and interactive cards feature critically-damped spring transitions (`cubic-bezier(0.16, 1, 0.3, 1)`) with instant touch response (`:active { transform: scale(0.97) }`).
- **Continuous CSS Grid Disclosures:** Accordions and expandable exam cards transition fluidly using CSS grid `0fr → 1fr` rather than abrupt DOM mounts.
- **Rotating Vector SVG Chevrons:** Crisp SVG polylines rotating smoothly `0deg → 180deg` on state toggle across all dashboard components.
- **Non-Clipping Typography:** Text wrapping and responsive padding prevent truncation (`...`) on course titles, exam tags, and metadata values.

---

### 8. Real-Time 60 FPS Response Generation Follow-Through ("Ask ONEE about this")

- **Direct Smooth Glide:** Clicking *"Ask ONEE about this"* in verification cards or action menus smoothly glides the viewport down to the active chatbot feed via `requestAnimationFrame`.
- **Critically-Damped Spring Follow Loop (60 FPS):** During active streaming token generation, a continuous `requestAnimationFrame` loop computes distance and glides down line-by-line as paragraphs unfold:
  ```ts
  const step = Math.max(1, Math.ceil(diff * 0.18));
  container.scrollTop = current + step;
  ```
- **Intelligent Gesture Detection:** If the student intentionally wheels or swipes upward to read previous messages (`deltaY < -2`), auto-scroll pauses gracefully. As soon as they scroll back down (< 45px) or ask another question, auto-scroll re-engages seamlessly.
- **Zero Compositor Lag:** Programmatic scrolling operates without CSS interpolation conflicts, delivering fluid 60 FPS animation.

---

### 9. Conversations History Drawer & Privacy Modal

- **Sanitized History Previews:** Strips raw markdown headers (`###`), bold markers, and replaces em dashes (`—`) with out arrows (`→`) so conversation cards render clean, readable previews.
- **Guaranteed Non-Collapsing Telemetry:** Storage metrics grid (`Chat History`, `Browser Agent runs`, `Saved Context`) and selective purge buttons use non-collapsing flex structures (`flex-shrink: 0`).
- **Automatic Presentation on Fresh Launch & Login:**
  - Opens automatically on fresh extension startup so students are informed of local-first storage.
  - Automatically triggers whenever the student authenticates into LPU UMS.

---

### 10. Interactive Procedural Companion Mascot

- **Lightweight SVG Engine:** Renders a 60fps character using pure mathematical curves without external GLTF bundles or static GIFs.
- **CSP Compliant:** Eliminates runtime code generation (`eval`, `new Function`) to comply strictly with Chrome Web Store Manifest V3 security rules.
- **Contextual Reactions:** Features 22 state-driven expressions (observing, thinking, moving, reading, celebrate, warning, error) linked to browser agent events.

---

### 11. Voice + Agentic Computer Use Layer 🗣️✨

ONEE turns natural student speech into verified browser execution. Rather than a superficial "mic button + chatbot TTS", ONEE is an interactive voice-driven agent where students speak naturally, ONEE acknowledges, plans, visibly acts on UMS, narrates meaningful milestones in real time, extracts actual portal data, verifies the result, and speaks the verified answer:

```
LISTEN → TRANSCRIBE → UNDERSTAND → PLAN → NARRATE → GROUND → MOVE → ACT → WAIT_FOR_RENDER → OBSERVE → EXTRACT → VALIDATE → VERIFY → SPEAK RESULT
```

- **Three Adaptive Voice Modes:**
  - **Voice Off (Default):** Normal silent typed chat and visual browser agent for quiet study rooms or libraries.
  - **Voice Assist:** Spoken query input with spoken final answers; intermediate navigation narration is silenced.
  - **Live Agent:** Complete multimodal experience — real-time narration of semantic milestones while the physical cursor operates UMS.
- **Two Speech Lanes (Zero-Latency + Expressive Output):**
  - **Lane 1 (Instant Local Narration):** Browser `window.speechSynthesis` speaks instant short cues (*"Sure, I'll check that on UMS"*, *"Opening your examination schedule"*, *"Verifying details"*) with near-zero network delay.
  - **Lane 2 (Expressive Verified Speech):** Groq `canopylabs/orpheus-v1-english` generates expressive vocal-directed audio for rich conversational answers and verified final results.
- **Dedicated Credential & Rate-Limit Isolation:**
  - Dedicated Voice API key (`GROQ_VOICE_API_KEY`) and separate backend endpoints (`/api/voice/transcribe`, `/api/voice/speak`) isolate speech transcription & synthesis completely from the LLM reasoning account.
  - Server-side only: keys are never exposed in the client extension.
- **Barge-In & Voice Interruption:**
  - If the student speaks or clicks the mic while ONEE is talking, speech cancels immediately and transitions into `LISTENING`.
  - Spoken commands (*"Stop"*, *"Cancel that"*, *"Hold on"*) instantly stop TTS, safely cancel active browser execution, release locks, and update the companion avatar to `CANCELLED`.
- **Truthful Execution Integrity:**
  - Voice narration strictly reflects actual execution state — it never claims *"I found your seat"* or *"Your attendance is 81%"* until DOM extraction and algebraic validation have succeeded.

---

## 🏗️ Architecture & Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            CHROME BROWSER TAB                               │
│  ums.lpu.in / studentums.lpu.in (Real authenticated student session)        │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ ONEE Content Script (content.js)                                      │  │
│  │ ├─ umsDetector.ts (Domain & login validation)                         │  │
│  │ ├─ umsPreflight.ts (Campus Drive notification modal safe dismissal)   │  │
│  │ ├─ pageObserver.ts (Interactive DOM element harvesting & card index)  │  │
│  │ ├─ examinationDetector.ts (SPA content detection & MutationObserver) │  │
│  │ ├─ examDateSheetParser.ts (Leaf card extraction & reporting times)    │  │
│  │ ├─ umsAttendanceParser.ts (Deterministic table extraction)            │  │
│  │ ├─ timetableParser.ts (SSRS internal container schedule parser)       │  │
│  │ ├─ samplePaperAgent.ts (Sample question paper control locator)        │  │
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
│  React 18 + TypeScript + Apple Human Interface Guidelines Design Tokens     │
│                                                                             │
│  ├─ Voice Subsystem (extension/src/voice/)                                  │
│  │   ├─ VoiceController.ts (Microphone lifecycle, barge-in, interruption)    │
│  │   ├─ VoiceQueue.ts (Sentence chunking, priority queue, execution guard)  │
│  │   ├─ NarrationPolicy.ts (Semantic state-to-speech mapping & truthfulness) │
│  │   ├─ NarrationManager.ts (Central RuntimeState subscriber)                │
│  │   └─ Providers (Native SpeechRecognition/Synthesis + Groq Whisper/Orpheus)│
│  ├─ useUmsConnection.ts (Active tab tracking & automatic reconnection)      │
│  ├─ useAgentController.ts (Autonomous perception-action loop manager)      │
│  │   └─ WAIT_FOR_RENDER stage & terminal state gating (READY/FAILED/etc)   │
│  ├─ useChatAgent.ts (Conversational agent & local fallback engine)          │
│  ├─ AgentControlPanel.tsx (Apple iOS execution cards & category pills)      │
│  ├─ ExaminationCard.tsx (Verified schedule cards & fluid grid reveal)       │
│  ├─ ActivityTimeline.tsx (Execution pipeline progress rail & stage badges)  │
│  ├─ ConversationDrawer.tsx (Apple iOS sidebar with sanitized preview text)  │
│  ├─ PrivacyModal.tsx (Non-collapsing local storage metrics & purge tools)   │
│  ├─ localDatabase.ts (On-Device IndexedDB v3: chat, executions, datasets)    │
│  ├─ attendanceCalculator.ts (Exact algebraic bunk & recovery formulas)      │
│  ├─ examinationCalculator.ts (Composite key deduplication & sort)           │
│  ├─ timetableCalculator.ts (SSRS schedule analysis & day filters)           │
│  ├─ scrollUtils.ts (Two-phase reveal scroll & preview text sanitization)    │
│  └─ OneeCompanion.tsx (Procedural SVG 3D avatar & context speech)            │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │ Minimal Context & Audio (REST / SSE)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ONEE BACKEND (FastAPI / Groq Cloud)                      │
│  Stateless • Zero Credential Storage • Multi-User Isolated                   │
│                                                                             │
│  ├─ /api/chat (Token streaming with grounded academic context)              │
│  ├─ /api/agent/plan (Computer Use next-action planner with waitForRender)   │
│  ├─ /api/voice/transcribe (Groq Whisper large-v3-turbo STT fallback)        │
│  ├─ /api/voice/speak (Groq Orpheus expressive audio synthesis)              │
│  └─ Groq Service (Dedicated Agent & Voice API Keys)                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🛠 Tech Stack

| Category | Technology | Purpose |
| :--- | :--- | :--- |
| **Extension Framework** | **Chrome Extension Manifest V3** | Native Chrome Side Panel integration, content scripts, background worker |
| **Frontend Framework** | **React 18.3**, **TypeScript 5.6** | Modular component hierarchy, custom hooks, strict type safety |
| **Build System** | **Vite 5.4**, **Rollup** | Multi-bundle packaging (sidepanel, background service worker, content script) |
| **Styling & Motion** | **Apple iOS Design System**, **CSS Modules** | Frosted glass (`backdrop-filter`), critically-damped springs, specular rims |
| **Local Storage** | **IndexedDB** (`idb`), `chrome.storage` | On-device persistent memory for conversations, executions, and records |
| **Testing (Frontend)** | **Vitest 2.1**, **JSDOM** | 23 test suites with 217 passing tests covering DOM, parsers, math, and actions |
| **Testing (E2E)** | **Playwright** | Real browser workflow integration and modal regression testing |
| **Testing (Backend)** | **Pytest 9.1**, **pytest-asyncio** | 16 passing unit and integration tests for planner, API, and agent tools |
| **Backend API** | **FastAPI 0.115**, **Python 3.11+** | Stateless REST and Server-Sent Events (SSE) streaming server |
| **AI Inference** | **Groq Cloud API** | Ultra-fast token streaming (`qwen/qwen3.8-27b` with multi-tier fallback) |
| **Avatar Engine** | **@bible-strong/avatar-core** | Pure-math SVG procedural geometry and ambient motion without CSP eval |

---

## 📁 Project Structure

```
OneeLpuAgent/
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
│   ├── tests/                                   # Pytest test suite (16 passing tests)
│   └── requirements.txt                         # Python dependencies
│
├── extension/                                   # Chrome Extension (Manifest V3)
│   ├── manifest.json                            # MV3 manifest with side panel declaration
│   ├── sidepanel.html                           # Side panel HTML shell
│   ├── package.json                             # Extension scripts & dependencies
│   ├── vite.config.ts                           # Side panel Vite configuration
│   ├── vite.background.config.ts                # Service worker Vite build config
│   ├── vite.content.config.ts                   # Content script Vite build config
│   ├── playwright.config.ts                     # Playwright E2E configuration
│   │
│   ├── src/
│   │   ├── background/
│   │   │   └── service-worker.ts                # MV3 worker lifecycle, port reconnections & tabs
│   │   │
│   │   ├── components/                          # React UI Components (Apple iOS HIG)
│   │   │   ├── AgentControlPanel.tsx            # Computer Use visualizer & terminal state cards
│   │   │   ├── AttendanceCard.tsx               # Overview attendance card & greeting
│   │   │   ├── BunkCalculatorModal.tsx          # Interactive safe-bunk / recovery modal
│   │   │   ├── ChatMessage.tsx                  # Message bubble with frosted glass & avatar
│   │   │   ├── ChatView.tsx                     # Chat interface with 60FPS RAF spring follow
│   │   │   ├── ConnectionState.tsx              # UMS connection status indicator
│   │   │   ├── ConversationDrawer.tsx           # Apple iOS history drawer with sanitized previews
│   │   │   ├── CourseList.tsx                   # Expandable course attendance list
│   │   │   ├── CourseRow.tsx                    # Individual course card with progress bar
│   │   │   ├── ExaminationCard.tsx              # Verified schedule cards & fluid grid reveal
│   │   │   ├── Header.tsx                       # Side panel navigation & mascot header
│   │   │   ├── OneeCompanion.tsx                # Live mascot avatar & speech bubble
│   │   │   ├── PrivacyModal.tsx                 # Non-collapsing on-device data metrics & purge
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
│   │   │   ├── umsPreflight.ts                  # Blocking Campus Drive modal safe dismissal
│   │   │   ├── samplePaperAgent.ts              # Sample paper control locator & viewer
│   │   │   ├── examination/                     # Examination Agent Content Subsystem
│   │   │   │   ├── examDateSheetParser.ts       # Leaf card parser with relative reporting time
│   │   │   │   ├── examinationDetector.ts       # Page detection & MutationObserver render watcher
│   │   │   │   ├── examinationValidator.ts      # Schema validator for examination records
│   │   │   │   └── seatingPlanParser.ts         # Seating allocation & venue parser
│   │   │   └── timetable/                       # Timetable Content Subsystem
│   │   │       └── timetableParser.ts           # SSRS internal container schedule parser
│   │   │
│   │   ├── hooks/                               # React Custom Hooks
│   │   │   ├── useAgentController.ts            # Autonomous perception-action loop manager
│   │   │   ├── useChatAgent.ts                  # Chat persistence & streaming response hook
│   │   │   ├── useReducedMotion.ts              # Accessibility preference listener
│   │   │   └── useUmsConnection.ts              # UMS tab detection & auto-reconnect
│   │   │
│   │   ├── lib/                                 # Shared Utilities & Math
│   │   │   ├── scrollUtils.ts                   # Two-phase reveal scroll & snippet sanitizer
│   │   │   ├── runtimeState.ts                  # State machine definitions & status transitions
│   │   │   ├── confetti.ts                      # Success confetti particle emitter
│   │   │   └── humanizer.ts                     # Relative time & human-friendly date formatters
│   │   │
│   │   ├── services/                            # Data & IPC Repositories
│   │   │   ├── api.ts                           # Backend API client & local fallback engine
│   │   │   ├── connectionManager.ts             # Service worker port keeper & heartbeat
│   │   │   ├── localDatabase.ts                 # IndexedDB stores & lifecycle controls
│   │   │   ├── repositories.ts                  # Grounded data repositories
│   │   │   ├── suggestionGenerator.ts           # Contextual query suggestions
│   │   │   ├── intentRouter.ts                  # Multi-goal natural language router
│   │   │   └── tabMessenger.ts                  # Chrome tab query & script injector
│   │   │
│   │   ├── shared/                              # Shared Types & Math
│   │   │   ├── attendanceCalculator.ts          # Pure algebraic bunk & recovery math
│   │   │   ├── examinationCalculator.ts         # Composite key deduplication & sort
│   │   │   ├── timetableCalculator.ts           # SSRS schedule analysis & day filters
│   │   │   ├── messages.ts                      # IPC message protocol definitions
│   │   │   └── types.ts                         # Complete domain models & telemetry types
│   │   │
│   │   └── tests/                               # Vitest Unit & Integration Tests (217 tests)
│   │
│   └── dist/                                    # Compiled Extension Bundles
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
git clone https://github.com/MohammadFayasKhan/LpuUmsAgent.git
cd LpuUmsAgent
```

### 2. Build the Chrome Extension

```bash
cd extension
npm install
npm run build
```

This compiles TypeScript and builds all three production bundles into `extension/dist/`:
- `sidepanel.html` + `assets/` (React Side Panel UI)
- `content.js` (Injected UMS browser agent content script)
- `service-worker.js` (Background runtime & port coordinator)

### 3. Load Extension in Google Chrome

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** via the toggle in the upper-right corner.
3. Click **Load unpacked** and select the `extension/dist` directory.
4. Navigate to `https://ums.lpu.in/` in Chrome and open the Side Panel (or click the ONEE icon in your browser extensions toolbar).

### 4. (Optional) Start the FastAPI Backend

ONEE functions completely offline with built-in deterministic calculations and local planning. To enable remote LLM streaming via Groq:

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

The project includes thorough, automated test suites covering deterministic mathematics, DOM observers, coordinate spaces, and IndexedDB storage:

### Extension Unit & Integration Tests (Vitest)

```bash
cd extension
npm test
```

| Test Suite | Focus Area | Tests | Status |
| :--- | :--- | :---: | :---: |
| `actionEngine.test.ts` | Real DOM clicks, input dispatch, table & card element highlighting | 12 | ✅ Passed |
| `aiCursorOverlay.test.ts` | Visible cursor physics, landmark highlights, cubic-Bézier overlays | 5 | ✅ Passed |
| `attendanceCalculator.test.ts` | Safe-bunk algebra, recovery class bounds, lowest subject search | 16 | ✅ Passed |
| `coordinateUtils.test.ts` | Viewport/document conversions, navbar safe zones | 5 | ✅ Passed |
| `examDateSheetParser.test.ts` | Angular SPA leaf cards, relative reporting times, dynamic traversal | 18 | ✅ Passed |
| `examinationCalculator.test.ts` | Chronological sort, next exam computation, timing checks | 23 | ✅ Passed |
| `examinationDataFlow.test.ts` | End-to-end data pipeline from DOM extraction to IndexedDB | 5 | ✅ Passed |
| `examinationValidator.test.ts` | Examination schema verification, date parsing, missing venue checks | 17 | ✅ Passed |
| `hybridGrounding.test.ts` | 2D IoU spatial matching, text similarity scoring | 3 | ✅ Passed |
| `intentRouter.test.ts` | Natural language goal classification (attendance vs examination vs timetable) | 15 | ✅ Passed |
| `localDatabase.test.ts` | IndexedDB CRUD, session isolation, data purge | 6 | ✅ Passed |
| `oneeCompanion.test.ts` | Event bridge subscription, avatar state transitions | 2 | ✅ Passed |
| `pageObserver.test.ts` | Interactive element scanning, ID attribute mapping | 4 | ✅ Passed |
| `repositories.test.ts` | Repository tier abstraction, storage boundaries | 6 | ✅ Passed |
| `samplePaperAgent.test.ts` | Question paper discovery, cursor navigation, PDF preview | 8 | ✅ Passed |
| `seatingPlanTab.test.ts` | Duplicate tab cleanup, tab messaging protocols | 3 | ✅ Passed |
| `suggestionGenerator.test.ts` | Contextual question generation from verified records | 6 | ✅ Passed |
| `timetableCalculator.test.ts` | Timetable day filtering, faculty directory, current/next class | 18 | ✅ Passed |
| `timetableParser.test.ts` | SSRS report viewer table parser, lecture slot extraction | 17 | ✅ Passed |
| `umsAttendanceParser.test.ts` | Real HTML fixtures, course counts, discrepancy checks | 7 | ✅ Passed |
| `umsDetector.test.ts` | Hostname matching, login screen, Cloudflare detection | 10 | ✅ Passed |
| `umsPreflight.test.ts` | Campus Drive modal detection, isolation, Remind me later gating | 8 | ✅ Passed |
| `verifiedExaminationRepo.test.ts` | Examination persistence, multi-user isolation | 3 | ✅ Passed |
| **Total** | **All 23 Test Suites** | **217** | **✅ 100% Passed** |

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

As a B.Tech Computer Science Engineering student at Lovely Professional University, keeping track of attendance percentages across multiple subjects, calculating exact safe-bunk allowances to maintain **75%**, and finding exam seating plans across different portal submenus is part of weekly university life.

Existing tools often require students to enter passwords into third-party databases, use fragile scrapers that trigger account lockouts, or use chatbots that make arithmetic mistakes.

I built ONEE to demonstrate a clean, reliable browser agent architecture:
- Operates inside the student's real, authenticated session without storing credentials.
- Separates deterministic calculations from conversational reasoning.
- Treats portal loading delays as explicit state transitions (`WAIT_FOR_RENDER`) instead of arbitrary timeouts.
- Keeps student data private using on-device memory.
- Follows Apple Human Interface Guidelines for physical, fluid motion and tactile responsiveness.

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/MohammadFayasKhan/LpuUmsAgent/issues).

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Added amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## ⭐ Show Your Support

If ONEE helped you track your attendance or find your exam seat, give the project a **star** → it means a lot!

---

## 👨‍💻 Author

<div align="center">
  <h3><strong>Mohammad Fayas Khan</strong></h3>
  <p><em>B.Tech Computer Science Engineering Student → Lovely Professional University</em></p>
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
