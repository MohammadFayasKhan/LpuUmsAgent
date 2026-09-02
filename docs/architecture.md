# ONEE System Architecture

## Overview

ONEE is designed as a zero-credential, side-by-side Chrome Extension application with a stateless Python backend.

```
┌────────────────────────────────────────────────────────┐
│                   User's Chrome Browser                │
│                                                        │
│  ┌───────────────────────┐   ┌──────────────────────┐  │
│  │     Real LPU UMS      │   │    ONEE Side Panel   │  │
│  │   (ums.lpu.in)        │   │ (React 18 + TS)      │  │
│  │                       │   │                      │  │
│  │ ┌───────────────────┐ │   │ ┌──────────────────┐ │  │
│  │ │ Content Script    │─┼───┼─│ Connection Hook  │ │  │
│  │ │ - umsDetector     │ │msg│ │ - useUmsConn.    │ │  │
│  │ │ - umsParser       │ │   │ │ - useChatAgent   │ │  │
│  │ └───────────────────┘ │   │ └──────────────────┘ │  │
│  └───────────────────────┘   └──────────┬───────────┘  │
└─────────────────────────────────────────┼──────────────┘
                                          │ HTTP (POST /api/chat)
                                          ▼
                               ┌──────────────────────┐
                               │ ONEE FastAPI Backend │
                               │ (Stateless)          │
                               │                      │
                               │ ┌──────────────────┐ │
                               │ │ Deterministic    │ │
                               │ │ Tools Engine     │ │
                               │ └────────┬─────────┘ │
                               │          │           │
                               │ ┌────────▼─────────┐ │
                               │ │ Groq Qwen Agent  │ │
                               │ └──────────────────┘ │
                               └──────────────────────┘
```

## Key Architectural Principles

1. **Active Tab Grounding**: Instead of spinning up headless browsers or automating login, ONEE runs as a content script in the tab where the student is actively browsing.
2. **Deterministic Calculations**: Bunk allowances, threshold recoveries, and weighted aggregate totals are strictly computed using mathematical algorithms in TypeScript and Python, never left to LLM hallucinations.
3. **Stateless Multi-Tenant Isolation**: The backend stores no database records, no user session tokens, and no student caches. Every request is completely self-contained.
4. **Local Fallback**: If the AI backend is unreachable, the Side Panel generates deterministic answers locally using client-side arithmetic.
