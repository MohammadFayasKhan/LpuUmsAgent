# Chrome Web Store Listing - ONEE

## Listing Metadata

- **Extension Name:** ONEE - LPU Agent
- **Summary Description (up to 132 characters):** ONEE LPU Agent for Lovely Professional University. Autonomous browser navigation, attendance verification, and attendance analytics.
- **Category:** Productivity / Education
- **Version:** 1.0.0
- **Default Language:** English

## Detailed Description

ONEE is an agent built for students at Lovely Professional University (LPU).

Operating inside the Chrome Side Panel alongside your real LPU UMS portal, ONEE provides instant, deterministic attendance calculations, bunk allowances, and agent navigation.

Key Features:
- Real-Time Attendance Overview: View your exact aggregate percentage calculated across all enrolled courses.
- Deterministic Bunk Calculator: Calculate exactly how many classes you can skip while remaining at or above 75%, 80%, 85%, or 90%.
- Class Recovery Planner: Find out exactly how many consecutive future classes you need to attend to recover below-threshold attendance.
- Interactive Simulator: Test scenarios for attending or missing upcoming lectures.
- Conversational Assistant: Ask questions in plain English ("Which subject is lowest?", "Can I bunk CSE330?", "What is my attendance?") powered by Groq Qwen.
- Verified Activity Timeline: View transparent, real-time logs of every navigation and extraction step.

Privacy and Security by Design:
- Zero Password Access: You sign into LPU UMS directly in your browser. ONEE never asks for, stores, or transmits your university credentials.
- Zero Cookie Transmission: Session cookies are never collected or sent to any server.
- Human-Controlled Verification: Cloudflare challenges and CAPTCHAs are handled naturally in your browser tab.
- Isolated Sessions: No cross-user caching. Your data stays strictly in your local session.

## Permissions Justification

| Permission | Technical Reason for Use | Plain-English Justification |
| :--- | :--- | :--- |
| `sidePanel` | `chrome.sidePanel` API | Required to display ONEE as a persistent side panel alongside the active webpage. |
| `storage` | `chrome.storage.local` | Used solely to remember user UI preferences (e.g. dismissing the first-run privacy modal). No student credentials or attendance records are stored permanently. |
| `tabs` | `chrome.tabs.query`, `chrome.tabs.sendMessage` | Required to detect when the active browser tab navigates to or from `ums.lpu.in` and send parsing requests to the content script. |
| `scripting` | `chrome.scripting` | Allows safe script communication with the active UMS tab. |

### Host Permissions Justification

| Host Match | Justification |
| :--- | :--- |
| `*://ums.lpu.in/*` | Required to inject the content script that reads student attendance tables on the university portal. |
| `*://*.lpu.in/*` | Required to support university subdomains and dashboard navigation. |

## Privacy and Data Use Disclosure

- **Single Purpose:** Academic attendance analytics and student agent for LPU students.
- **Data Collection:** ONEE does not collect personally identifiable information, passwords, or authentication cookies.
- **Data Transmission:** Only structured course attendance numbers (code, name, attended, total) are sent to the local backend during active chat inquiries to calculate answers.
