// LPU UMS Agent - Interactive Architecture & Page Controllers
// 100% Grounded in Real Project Specifications

document.addEventListener("DOMContentLoaded", () => {
  // ========================================================
  // 1. HERO SCREENSHOT SWITCHER & SMOOTH AUTO-PLAY SLIDESHOW
  // ========================================================
  const ssButtons = Array.from(document.querySelectorAll(".ss-btn"));
  const heroScreenshotImg = document.getElementById("heroScreenshotImg");
  const windowAddress = document.getElementById("windowAddress");
  const heroScreenshotWindow = document.getElementById("heroScreenshotWindow");
  const autoPlayBarFill = document.getElementById("autoPlayBarFill");

  let currentIndex = 0;
  const AUTO_PLAY_DELAY = 4000; // 4 seconds per screenshot
  let progressAnimation = null;
  let startTime = Date.now();
  let isPaused = false;

  function switchToIndex(index, isUserAction = false) {
    if (index < 0 || index >= ssButtons.length) return;
    currentIndex = index;

    ssButtons.forEach((b, i) => {
      b.classList.toggle("active", i === currentIndex);
    });

    const activeBtn = ssButtons[currentIndex];
    const imgSrc = activeBtn.getAttribute("data-img");
    const address = activeBtn.getAttribute("data-addr");

    if (windowAddress && address) {
      windowAddress.textContent = address;
    }

    if (heroScreenshotImg && imgSrc) {
      // Smooth fade transition
      heroScreenshotImg.style.opacity = "0.2";
      setTimeout(() => {
        heroScreenshotImg.src = imgSrc;
        heroScreenshotImg.alt = activeBtn.textContent.trim();
        heroScreenshotImg.setAttribute("data-caption", activeBtn.textContent.trim());
        heroScreenshotImg.style.opacity = "1";
      }, 150);
    }

    // Scroll active button ONLY inside the horizontal switcher container (NEVER scroll the page/window)
    const switcher = document.querySelector(".screenshot-switcher");
    if (switcher && activeBtn) {
      const btnLeft = activeBtn.offsetLeft;
      const btnWidth = activeBtn.offsetWidth;
      const switcherWidth = switcher.clientWidth;
      const targetScroll = btnLeft - (switcherWidth / 2) + (btnWidth / 2);
      switcher.scrollTo({ left: Math.max(0, targetScroll), behavior: "smooth" });
    }

    // Reset progress bar on change
    startTime = Date.now();
  }

  function startAutoPlay() {
    stopAutoPlay();
    startTime = Date.now();

    function updateProgress() {
      if (!isPaused && autoPlayBarFill) {
        const elapsed = Date.now() - startTime;
        const progress = Math.min((elapsed / AUTO_PLAY_DELAY) * 100, 100);
        autoPlayBarFill.style.width = `${progress}%`;

        if (elapsed >= AUTO_PLAY_DELAY) {
          const nextIndex = (currentIndex + 1) % ssButtons.length;
          switchToIndex(nextIndex);
          startTime = Date.now();
        }
      }
      progressAnimation = requestAnimationFrame(updateProgress);
    }

    progressAnimation = requestAnimationFrame(updateProgress);
  }

  function stopAutoPlay() {
    if (progressAnimation) {
      cancelAnimationFrame(progressAnimation);
      progressAnimation = null;
    }
  }

  ssButtons.forEach((btn, index) => {
    btn.addEventListener("click", () => {
      switchToIndex(index, true);
    });
  });

  // Pause on hover
  if (heroScreenshotWindow) {
    heroScreenshotWindow.addEventListener("mouseenter", () => {
      isPaused = true;
    });
    heroScreenshotWindow.addEventListener("mouseleave", () => {
      isPaused = false;
      startTime = Date.now();
    });
  }

  // Pause auto-play when user scrolls down past the hero screenshot section (prevent background CPU & unwanted changes)
  if ("IntersectionObserver" in window && heroScreenshotWindow) {
    const heroObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            isPaused = true;
          } else {
            isPaused = false;
            startTime = Date.now();
          }
        });
      },
      { threshold: 0.15 }
    );
    heroObserver.observe(heroScreenshotWindow);
  }

  // Start smooth auto-play
  startAutoPlay();

  // ========================================================
  // 2. ARCHITECTURE LEVEL SWITCHER (Level 1 / 2 / 3)
  // ========================================================
  const levelTabs = document.querySelectorAll(".level-tab");
  const levelViews = document.querySelectorAll(".level-view");

  levelTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      levelTabs.forEach((t) => t.classList.remove("active"));
      levelViews.forEach((v) => v.classList.remove("active"));

      tab.classList.add("active");
      const level = tab.getAttribute("data-level");
      const targetView = document.getElementById(`level-${level}-view`);
      if (targetView) {
        targetView.classList.add("active");
      }
    });
  });

  // ========================================================
  // 4. LEVEL 1: TOPOLOGY NODE INSPECTOR DATA
  // ========================================================
  const componentData = {
    client: {
      pill: "CLIENT TIER",
      title: "Native Chrome Side Panel (React 18.3 & Apple iOS HIG)",
      summary: "Modern React sidepanel hosted inside Chrome's Manifest V3 side panel API. Directly mounts adjacent to active UMS portal tabs (ums.lpu.in and studentums.lpu.in), providing students with real-time academic records, attendance forecasts, and voice controls without context switching.",
      resp: [
        "Apple iOS Human Interface Guidelines design system with frosted acrylic blur (backdrop-filter: blur(40px))",
        "Deterministic attendance gauge with dynamic 75%, 80%, and 85% safe bunk indicators",
        "SSRS ReportViewer timetable viewer with day-by-day segmented filtering",
        "Procedural 3D SVG companion mascot with 22 dynamic state-driven expressions",
        "Chrome runtime message passing to background service worker and content script",
        "Verified by 422 unit tests using Vitest"
      ],
      tech: ["React 18.3", "TypeScript 5.6", "TailwindCSS", "Vite 5.4", "Chrome Side Panel API", "Vitest"]
    },
    dom: {
      pill: "COMPUTER USE",
      title: "Content Script & Autonomous Visual Cursor",
      summary: "Autonomous in-session computer-use engine executing directly inside the student's authenticated browser DOM. Uses 2D IoU spatial matching and semantic text grounding to navigate portals with a 60 FPS visual cursor gliding along smooth cubic-Bézier trajectories.",
      resp: [
        "Perception-Action loop: OBSERVE -> THINK -> LOCATE -> WAIT_FOR_RENDER -> MOVE -> ACT -> EXTRACT -> VALIDATE -> VERIFY -> DONE",
        "Hybrid 2D IoU spatial matching paired with semantic text scoring to target real DOM buttons",
        "Natural cursor physics using cubic-Bézier curves and cosine smoothstep easing (400-1200ms)",
        "Visual target highlighting with distinct color-coded badges (discovered, targeting, verified)",
        "Dispatches genuine synthetic mouse events (mousedown, mouseup, click) and handles legacy ASPX __doPostBack handlers",
        "MutationObserver SPA watchers (WAIT_FOR_RENDER) detecting Angular card renders on studentums.lpu.in"
      ],
      tech: ["TypeScript", "DOM Level 3 Events", "Cubic-Bézier Interpolation", "MutationObserver API", "2D IoU Grounding"]
    },
    modal: {
      pill: "PREFLIGHT GUARD",
      title: "Global UMS Preflight & Modal Dismissal Guard",
      summary: "Automated pre-execution guard that inspects the page before any navigation begins. Detects blocking 'Campus Drive Notifications' popups and safely clicks 'Remind me later' using the visual AI cursor so student placement notices are never deleted.",
      resp: [
        "Pre-execution DOM modal inspection before initiating navigation trajectories",
        "Safe dismissal guarantee: strictly targets 'Remind me later' and never clicks 'Mark as Read'",
        "Preserves critical student placement drives and internship notifications",
        "Visual AI cursor movement providing transparent confirmation of popup dismissal",
        "Dynamic in-loop guard that intercepts unexpected modals appearing mid-session"
      ],
      tech: ["Content Script Preflight", "Modal DOM Watchers", "Safe Target Filter"]
    },
    gateway: {
      pill: "API GATEWAY",
      title: "FastAPI Asynchronous Gateway (Hugging Face Spaces)",
      summary: "Stateless backend service powering the Chrome Side Panel extension. Hosted on Hugging Face Spaces with FastAPI and Uvicorn, fully compatible with both CPU Basic and ZeroGPU (A10G) tiers.",
      resp: [
        "GET /health: Microsecond service health check and LLM model verification",
        "POST /api/chat: Token-streaming conversational reasoning with grounded context",
        "POST /api/agent/plan: Autonomous Computer Use browser action planner",
        "POST /api/voice/transcribe: Groq Whisper large-v3 speech-to-text processing",
        "POST /api/voice/speak: Groq Orpheus expressive audio synthesis",
        "Zero credential collection: zero passwords or student session cookies touch this backend"
      ],
      tech: ["FastAPI 0.115", "Python 3.11", "Uvicorn (ASGI)", "Hugging Face Spaces", "ZeroGPU Support"]
    },
    math: {
      pill: "DETERMINISTIC ENGINE",
      title: "Deterministic Attendance Algebra Engine",
      summary: "Pure mathematical module that calculates safe bunk allowances and required recovery attendances. Completely decouples numerical calculations from the LLM to guarantee 100% mathematical precision and eliminate debarment risk.",
      resp: [
        "Evaluates exact safe bunk limit: B = floor((P - 0.75 * T) / 0.75) where P is attended and T is delivered",
        "Calculates required recovery lectures if below 75%: R = ceil((0.75 * T - P) / 0.25)",
        "Multi-threshold margin analysis supporting 75%, 80%, and 85% attendance targets",
        "Duty leave reconciliation matching official LPU registrar formulas",
        "Zero LLM arithmetic hallucination guarantee validated by 22 Pytest unit tests"
      ],
      tech: ["Deterministic Python Math", "TypeScript Math Mirror", "Closed-Form Calculus", "Pytest"]
    },
    voice: {
      pill: "VOICE PIPELINE",
      title: "Dual-Tier Groq Voice Pipeline (Whisper & Orpheus)",
      summary: "Full-duplex voice execution pipeline powered by Groq Whisper large-v3 STT and Groq Orpheus expressive audio TTS. Features hardware audio prewarming, speech interruption (barge-in), and dynamic milestone narration.",
      resp: [
        "Groq Whisper large-v3 transcription with domain adaptation for Indian English academic accents",
        "Groq Orpheus expressive audio synthesis with natural human speech cadence",
        "Hardware audio prewarming reducing speech playback startup latency to sub-200ms",
        "Real-time speech barge-in: speaking automatically cancels ongoing audio narration",
        "Dynamic progress narration: verbally reports milestones (e.g. 'Opening seating plan', 'Found room 34-201')"
      ],
      tech: ["Groq Whisper Large-v3", "Groq Orpheus Audio", "Web Audio API", "Voice Activity Detection (VAD)"]
    },
    storage: {
      pill: "LOCAL STORAGE",
      title: "Local-First IndexedDB v3 Storage Engine",
      summary: "Persistent on-device memory store hosted inside the student's browser via IndexedDB v3. Stores all chat histories, execution traces, verified timetable schedules, and examination date sheets locally on the student's machine.",
      resp: [
        "Zero-knowledge privacy: all academic data stays on the student's machine",
        "Stores verified examination dates, room allocations, and desk numbers for offline access",
        "Maintains multi-turn conversation threads across browser restarts",
        "Instant query caching allowing immediate attendance card rendering without network round-trips",
        "Complete user data export and one-click purge controls"
      ],
      tech: ["IndexedDB v3", "Local-First Architecture", "Dexie.js / Native IDB", "Web Storage API"]
    },
    llm: {
      pill: "INFERENCE TIER",
      title: "Groq LPU Inference Cluster (Llama 3.3 70B & Qwen 2.5)",
      summary: "Ultra-fast Language Processing Unit (LPU) cloud cluster via Groq delivering 500+ tokens/second inference. Translates user commands into structured Computer Use JSON action plans and reasons over academic guidelines.",
      resp: [
        "Sustained 500+ tokens/sec inference speed for instant response streaming",
        "Outputs strongly typed JSON action schemas for autonomous computer-use navigation",
        "High-capacity 32,768 token context window for multi-turn student planning",
        "Strict academic persona grounded only in live extracted DOM data without fabrication",
        "Powers sub-agent planning for sample paper retrieval and syllabus navigation"
      ],
      tech: ["Groq Cloud LPUs", "Llama 3.3 70B Versatile", "Qwen 2.5", "Structured Tool Calling"]
    }
  };

  const nodeBoxes = document.querySelectorAll(".node-box");
  const inspPill = document.getElementById("inspPill");
  const inspTitle = document.getElementById("inspTitle");
  const inspSummary = document.getElementById("inspSummary");
  const inspResponsibilities = document.getElementById("inspResponsibilities");
  const inspTechnologies = document.getElementById("inspTechnologies");

  nodeBoxes.forEach((box) => {
    box.addEventListener("click", () => {
      nodeBoxes.forEach((b) => b.classList.remove("active"));
      box.classList.add("active");

      const nodeKey = box.getAttribute("data-node") || "gateway";
      const data = componentData[nodeKey];

      if (data) {
        if (inspPill) inspPill.textContent = data.pill;
        if (inspTitle) inspTitle.textContent = data.title;
        if (inspSummary) inspSummary.textContent = data.summary;
        if (inspResponsibilities) {
          inspResponsibilities.innerHTML = data.resp
            .map((item) => `<li>${item}</li>`)
            .join("");
        }
        if (inspTechnologies) {
          inspTechnologies.innerHTML = data.tech
            .map((item) => `<li>${item}</li>`)
            .join("");
        }
      }
    });
  });

  // ========================================================
  // 5. LEVEL 2: COMPONENT ZOOM SWITCHER
  // ========================================================
  const zoomBtns = document.querySelectorAll(".zoom-btn");
  const zoomContents = document.querySelectorAll(".zoom-content");

  zoomBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      zoomBtns.forEach((b) => b.classList.remove("active"));
      zoomContents.forEach((c) => c.classList.remove("active"));

      btn.classList.add("active");
      const zoomKey = btn.getAttribute("data-zoom");
      const targetZoom = document.getElementById(`zoom-${zoomKey}`);
      if (targetZoom) {
        targetZoom.classList.add("active");
      }
    });
  });

  // ========================================================
  // 6. LEVEL 3: DATA FLOW SWITCHER
  // ========================================================
  const flowTabBtns = document.querySelectorAll(".flow-tab-btn");
  const flowStepDecks = document.querySelectorAll(".flow-step-deck");

  flowTabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      flowTabBtns.forEach((b) => b.classList.remove("active"));
      flowStepDecks.forEach((d) => d.classList.remove("active"));

      btn.classList.add("active");
      const flowKey = btn.getAttribute("data-flow");
      const targetDeck = document.getElementById(`flow-${flowKey}`);
      if (targetDeck) {
        targetDeck.classList.add("active");
      }
    });
  });

  // ========================================================
  // 7. LIGHTBOX MODAL FOR IMAGES & DIAGRAMS
  // ========================================================
  const imageModal = document.getElementById("imageModal");
  const modalImg = document.getElementById("modalImg");
  const modalCaption = document.getElementById("modalCaption");
  const modalClose = document.getElementById("modalClose");

  const zoomableItems = document.querySelectorAll(".zoomable-img");

  zoomableItems.forEach((item) => {
    item.addEventListener("click", () => {
      const src = item.getAttribute("data-full-src") || item.src;
      const caption = item.getAttribute("data-caption") || item.alt || "Visual Diagram";

      if (imageModal && modalImg) {
        modalImg.src = src;
        if (modalCaption) modalCaption.textContent = caption;
        imageModal.classList.add("active");
      }
    });
  });

  if (modalClose && imageModal) {
    modalClose.addEventListener("click", () => {
      imageModal.classList.remove("active");
    });

    imageModal.addEventListener("click", (e) => {
      if (e.target === imageModal) {
        imageModal.classList.remove("active");
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && imageModal.classList.contains("active")) {
        imageModal.classList.remove("active");
      }
    });
  }
});
