# ONEE - LPU Agent Privacy Policy & Security Architecture

**Effective Date:** September 2, 2026  
**Version:** 1.1.0  
**Target Platform:** Google Chrome Extension (Manifest V3)

---

## 1. Executive Summary & Product Purpose

ONEE - LPU Agent is a browser-resident academic companion designed exclusively for students of Lovely Professional University (LPU). Its single stated purpose is to assist students in observing, navigating, calculating, and understanding their official academic attendance metrics on the LPU University Management System (UMS) portal (`ums.lpu.in`).

> [!IMPORTANT]
> **Data Transmission Disclosure:**  
> ONEE uses local-first storage on the student's device for private chat history, browser-agent history, verified context, and personalization. Only the minimum context required for remote AI reasoning (e.g. course codes and attendance counts) is transmitted to remote AI endpoints. ONEE does **not** claim to be "fully local" because natural-language reasoning requests are processed via secure remote AI services (Groq Qwen/Llama models).

---

## 2. Information Handled by ONEE

### A. Data Stored Locally on Your Device
All persistent application data remains strictly local on the user's computer across three isolated browser storage areas:
1. **IndexedDB (`ONEE_LOCAL_DB`)**:
   - **Chat History**: Conversation threads and message records.
   - **Agent Execution History**: Action traces, high-level observation summaries, and timestamped step logs (capped at 30 recent executions with automated pruning).
   - **Verified UMS Context**: The latest attendance table snapshot extracted from the active session (`courses`, `delivered`, `attended`, `percentage`).
   - **Local Personalization**: Lightweight student preferences (response length, frequent query categories).
2. **`chrome.storage.local`**:
   - Extension installation settings (privacy disclosure dismissal flag).
   - Active account namespace identifier.
   - UI display preferences (theme, Computer Use panel visibility).
3. **`chrome.storage.session`**:
   - Ephemeral in-memory execution state (`executionId`, current step, active task status).
   - Runtime connection handshake state.
   - Automatically destroyed when the browser session terminates.

> **Zero `window.localStorage` Guarantee:** ONEE strictly prohibits using `window.localStorage` to prevent any data sharing with host-page scripts or third-party web contexts.

---

### B. Data Transmitted to Remote AI Services
When a student submits a natural language question (e.g., *"How many classes can I safely miss in CSE330?"*), ONEE sends only the minimal required context to the AI reasoning engine:
- The user's specific text query.
- The aggregated course attendance metrics needed for the calculation (`course code`, `title`, `attended`, `delivered`, `percentage`).
- Recent conversational context from the active thread (excluding private credentials).

**Data Never Transmitted Externally:**
- **Zero Passwords**: ONEE never requests, observes, or captures university passwords.
- **Zero Authentication Cookies**: Session tokens (`ASP.NET_SessionId`, `.ASPXAUTH`) and security cookies are excluded from all extension scripts and network requests.
- **Zero Unrelated Web Browsing**: ONEE is strictly host-permissioned to `*://ums.lpu.in/*` and `*://*.lpu.in/*`. It cannot observe, read, or interact with any other websites.

---

## 3. Credential & Session Handling

1. **Host-Session Operation**: ONEE operates entirely within the student's existing, manually authenticated Chrome browser tab.
2. **No Credential Harvesting**: The extension contains zero input forms for student registration numbers or passwords.
3. **No Automated Security Bypasses**: ONEE does not attempt to bypass CAPTCHAs, two-factor authentication, or Cloudflare verification challenges.
4. **Session Isolation**: When a UMS login or logout page is detected, ONEE automatically resets active execution states, cursor overlays, and cached DOM summaries to prevent data bleeding between accounts.

---

## 4. User Data Controls & Deletion

Students retain complete, sovereign ownership of their data on their device. ONEE provides granular data controls within the extension settings:
- **Clear Chat History**: Instantly wipes all saved conversation threads and message logs from IndexedDB.
- **Clear Agent History**: Erases all Computer Use execution traces and step observations.
- **Clear Verified Context**: Purges cached UMS attendance snapshots.
- **Clear All Local Data**: Comprehensively purges the entire IndexedDB database and resets extension preferences to factory defaults.
- **Uninstalling ONEE**: Completely removes all IndexedDB databases, `chrome.storage.local` preferences, and `chrome.storage.session` state from Chrome immediately.

---

## 5. Google Chrome Web Store Limited Use Compliance

ONEE complies with the **Chrome Web Store User Data Policy**, including the **Limited Use** requirements:
1. **Single Purpose**: All collected and processed data is used solely to provide and improve the attendance observation, bunk calculation, and academic advisory features requested by the student.
2. **Not for Advertising**: User data is never used or transferred for serving advertisements, personalized marketing, or promotional campaigns.
3. **Not for Sale**: Student data is never sold, leased, or rented to data brokers, advertising networks, or any commercial third parties.
4. **No Unrelated Profiling**: User data is not transferred or aggregated to determine creditworthiness or for lending purposes.
5. **No Human Access**: No human reads student data, except where necessary to resolve technical security incidents or comply with applicable legal obligations.

---

## 6. Permissions Justification

| Permission | Technical Requirement |
| :--- | :--- |
| `sidePanel` | Provides the persistent ONEE conversational assistant and Computer Use dashboard interface. |
| `storage` | Enables local-first storage using `chrome.storage.local` and `chrome.storage.session`. |
| `tabs` | Identifies the active UMS browser tab to initiate navigation and read attendance tables. |
| `scripting` | Executes isolated content scripts within `ums.lpu.in` for DOM observation and cursor overlay rendering. |
| `host_permissions` | Strictly restricted to `*://ums.lpu.in/*` and `*://*.lpu.in/*` to prevent access to any other web domain. |

---

## 7. Contact & Support

For questions regarding this privacy policy, security audits, or data deletion inquiries:
- **Developer Contact**: `support@onee-agent.com`
- **Project Repository**: [GitHub Repository](https://github.com/onee-agent/onee-lpu-agent)
- **License**: MIT
