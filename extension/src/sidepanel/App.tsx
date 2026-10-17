/*
 * Main Application Component for ONEE Side Panel.
 *
 * This coordinates the three main parts of the extension:
 * 1. Connection to the live UMS tab (detecting whether the student is on the login
 *    page, dashboard, or attendance view).
 * 2. The Browser Agent Controller (running Computer Use tasks like locating
 *    and extracting attendance tables).
 * 3. The Local Chat Agent (answering questions about attendance, calculating
 *    skip allowance, and suggesting next questions).
 *
 * It also manages session boundaries: if the student logs out or switches accounts,
 * we reset active agent state and clear temporary memory so data never bleeds across accounts.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AttendanceSummary, AttendanceRecord, ExaminationSummary, TimetableSummary, ConnectionStatus } from '../shared/types';
import { useUmsConnection } from '../hooks/useUmsConnection';
import { useChatAgent } from '../hooks/useChatAgent';
import { useAgentController } from '../hooks/useAgentController';
import { markPrivacyNoticeSeen } from '../services/storage';
import { verifiedExaminationRepo, verifiedTimetableRepo } from '../services/repositories';
import {
  routeUserIntent,
  extractCourseFromText,
  enforceCapabilityDomain,
  goalForCapabilityDomain
} from '../services/intentRouter';
import { resolveSemanticIntent, generateVerifiedResponse, ConversationState } from '../services/semanticRouter';
import { generateLocalFallbackResponse } from '../services/api';
import { logVoiceDiagnostic } from '../voice/VoiceDiagnostics';
import { generateContextualSuggestions } from '../services/suggestionGenerator';
import { SmoothTokenPacer } from '../services/streamingPacer';
import { voiceController, audioController } from '../voice';
import { navigateToStudentDashboard } from '../services/tabMessenger';

import { Header } from '../components/Header';
import { ConnectionState } from '../components/ConnectionState';
import { AttendanceCard } from '../components/AttendanceCard';
import { CourseList } from '../components/CourseList';
import { ActivityTimeline } from '../components/ActivityTimeline';
import { ChatView } from '../components/ChatView';
import { BunkCalculatorModal } from '../components/BunkCalculatorModal';
import { PrivacyModal } from '../components/PrivacyModal';
import { InfoCarousel } from '../components/InfoCarousel';
import { ConversationDrawer } from '../components/ConversationDrawer';
import { Skeletons } from '../components/Skeletons';
import { AgentControlPanel } from '../components/AgentControlPanel';
import { ExaminationCard } from '../components/ExaminationCard';
import { ToastContainer, useToasts } from '../components/Toast';

import styles from './App.module.css';
import { triggerSuccessConfetti } from '../lib/confetti';
import { classifySocial, buildChatGreeting } from '../lib/greeting';
import { connectionManager, RuntimeConnectionState } from '../services/connectionManager';

export const App: React.FC = () => {
  const [runtimeState, setRuntimeState] = useState<RuntimeConnectionState>('INITIAL');
  const [examination, setExamination] = useState<ExaminationSummary | null>(null);
  const [localTimetable, setLocalTimetable] = useState<TimetableSummary | null>(null);
  const [conversationState, setConversationState] = useState<ConversationState | null>(null);
  const { toasts, addToast, dismissToast } = useToasts();

  /*
   * Load any previously verified examination and timetable data from local storage
   */
  useEffect(() => {
    verifiedExaminationRepo.getLatestVerifiedExamination('default').then((record) => {
      if (record?.examination) {
        setExamination(record.examination);
      }
    });
    verifiedTimetableRepo.getLatestVerifiedTimetable('default').then((record) => {
      if (record?.timetable) {
        setLocalTimetable(record.timetable);
      }
    });
  }, []);

  /*
   * useUmsConnection monitors the active Chrome tab. It detects whether the student
   * is on ums.lpu.in, whether the attendance iframe/table is mounted, and handles
   * tab creation/reloading.
   */
  const {
    status,
    attendance,
    timetable: connectionTimetable,
    currentUrl,
    activePageType,
    errorMessage,
    isLoading,
    activities,
    hasAttendanceLink,
    refresh,
    openUmsTab,
    navigateToAttendance
  } = useUmsConnection();

  const [selectedCourse, setSelectedCourse] = useState<AttendanceRecord | null>(null);
  const [showOverallCalc, setShowOverallCalc] = useState<boolean>(false);
  // Launch info flow: the multi-card carousel shows on fresh launch; the full
  // privacy panel opens from the header (i) button or the carousel's last card.
  const [showIntro, setShowIntro] = useState<boolean>(true);
  const [showPrivacy, setShowPrivacy] = useState<boolean>(false);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  /*
   * Keep track of the background service worker connection status.
   * If the MV3 service worker goes idle and terminates, connectionManager
   * updates this state to RECONNECTING while it restores the port.
   */
  useEffect(() => {
    const unsubscribe = connectionManager.subscribe((state) => {
      setRuntimeState(state);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    voiceController.playSessionGreeting();
  }, []);

  /*
   * useAgentController manages active Computer Use tasks.
   * When an extraction finishes successfully, it invokes this callback so we
   * can play confetti and trigger a fresh read of the verified data.
   */
  const {
    state: agentState,
    isRunning: isAgentRunning,
    startGoal,
    stopAgent,
    pauseAgent,
    resumeAgent,
    toggleDebugMode,
    resetAgentState
  } = useAgentController(
    (_extractedAttendance: AttendanceSummary) => {
      addToast('Attendance updated', 'success');
      triggerSuccessConfetti();
      refresh();
      // Verified result speech is dynamically formulated by DynamicNarrationEngine
      // from runtimeState.agentState.finalResponse, strictly grounded on extracted facts.
    },
    'default',
    (_extractedExam: ExaminationSummary) => {
      setExamination(_extractedExam);
      addToast('Examination schedule verified', 'success');
      triggerSuccessConfetti();
      // Verified result speech is dynamically formulated by DynamicNarrationEngine
      // from runtimeState.agentState.finalResponse, strictly grounded on extracted facts.
    },
    (_extractedTimetable: TimetableSummary) => {
      setLocalTimetable(_extractedTimetable);
      addToast('Timetable verified', 'success');
      triggerSuccessConfetti();
    }
  );

  useEffect(() => {
    if (
      agentState?.timetable &&
      ((agentState.timetable.slots && agentState.timetable.slots.length > 0) ||
        (agentState.timetable.courses && agentState.timetable.courses.length > 0))
    ) {
      setLocalTimetable(agentState.timetable);
    }
  }, [agentState?.timetable]);

  const currentTimetable = agentState?.timetable || connectionTimetable || localTimetable || null;

  /*
   * useChatAgent manages conversation threads, local IndexedDB persistence,
   * and fallback streaming.
   */
  const {
    messages,
    isTyping,
    startPendingExchange,
    updatePendingExchangeChunk,
    completePendingExchange,
    clearHistory,
    suggestions,
    conversations,
    activeConversationId,
    newConversation,
    switchConversation,
    deleteConversation
  } = useChatAgent(attendance, undefined, 'default', examination, currentTimetable);

  /*
   * Track UMS status transitions. Whenever the student logs in to LPU UMS
   * (transition from LOGIN_PAGE / NOT_CONNECTED to CONNECTED / TABLE_DETECTED),
   * display the ONEE Data & Privacy info panel.
   */
  const prevStatusRef = useRef<ConnectionStatus>(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;

    const isAuth =
      status === 'READY' ||
      status === 'UMS_DETECTED' ||
      status === 'READING' ||
      status === 'NO_ATTENDANCE_ON_PAGE' ||
      status === 'connected';

    if ((prev === 'LOGIN_PAGE' || prev === 'NOT_CONNECTED') && isAuth) {
      setShowPrivacy(true);
    }
  }, [status]);

  /*
   * Session boundary check:
   * If the student gets redirected to the UMS login page or logs out,
   * immediately reset any active agent state and stop speech.
   * Runs only on REAL status transitions: the initial mount status must never
   * cancel the session greeting before it has a chance to play.
   */
  const prevSessionStatusRef = useRef<ConnectionStatus | null>(null);
  useEffect(() => {
    const prev = prevSessionStatusRef.current;
    prevSessionStatusRef.current = status;
    if (prev === null) return;
    if (status === 'LOGIN_PAGE' || status === 'NOT_CONNECTED' || status === 'HUMAN_VERIFICATION') {
      resetAgentState();
      setExamination(null);
      voiceController.stopSpeaking();
      voiceController.setActiveExecutionId(null);
    }
  }, [status, resetAgentState]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refresh();
    setTimeout(() => setIsRefreshing(false), 600);
  };

  const handleClosePrivacy = async () => {
    setShowPrivacy(false);
    await markPrivacyNoticeSeen();
  };

  /** Carousel finished (or skipped): land the student on the main chat page. */
  const handleCloseIntro = async (openPrivacy = false) => {
    setShowIntro(false);
    await markPrivacyNoticeSeen();
    if (openPrivacy) setShowPrivacy(true);
  };

  /*
   * Normalizes raw UMS extraction models (e.g. TimetableSummary with slots) into
   * a canonical verification contract with top-level active day and day-specific classes.
   */
  const normalizeVerifiedData = useCallback(
    (
      capability: string,
      raw: any,
      query: string,
      entities: Record<string, any> = {},
      convState?: ConversationState
    ): Record<string, any> => {
      if (!raw || typeof raw !== 'object') return {};

      if (capability === 'timetable') {
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const qLower = query.toLowerCase();
        const isWeeklyRequest =
          entities.view === 'weekly_matrix' ||
          entities.day === 'all' ||
          raw.day === 'Weekly Matrix' ||
          Boolean(raw.isWeekly) ||
          /all classes|matrix|weekly|complete list|list of classes|this week|whole week|entire week|every day|all days|detailed matrix|classes that i have|classes in this week|full timetable/i.test(qLower);

        let targetDay = entities.day;

        if (isWeeklyRequest) {
          targetDay = 'Weekly Matrix';
        } else {
          const daysMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const todayIdx = new Date().getDay();
          const tomorrowDay = daysMap[(todayIdx + 1) % 7];
          const dayAfterTomorrowDay = daysMap[(todayIdx + 2) % 7];
          const todayDay = daysMap[todayIdx] === 'Sunday' ? 'Monday' : daysMap[todayIdx];

          if (targetDay && targetDay.toLowerCase() === 'day after tomorrow') {
            targetDay = dayAfterTomorrowDay;
          } else if (targetDay && targetDay.toLowerCase() === 'tomorrow') {
            targetDay = tomorrowDay;
          } else if (targetDay && targetDay.toLowerCase() === 'today') {
            targetDay = todayDay;
          } else if (!targetDay) {
            if (qLower.includes('day after tomorrow')) {
              targetDay = dayAfterTomorrowDay;
            } else if (qLower.includes('tomorrow')) {
              targetDay = tomorrowDay;
            } else if (qLower.includes('today')) {
              targetDay = todayDay;
            } else {
              const matched = days.find((d) => qLower.includes(d));
              if (matched) {
                targetDay = matched.charAt(0).toUpperCase() + matched.slice(1);
              } else if (convState?.activeEntity?.day && convState.activeEntity.day !== 'all' && convState.activeEntity.day !== 'Weekly Matrix') {
                targetDay = convState.activeEntity.day;
              } else if (raw.day && raw.day !== 'all' && raw.day !== 'Weekly Matrix') {
                targetDay = raw.day;
              } else {
                targetDay = todayDay;
              }
            }
          }
        }

        const allSlots = Array.isArray(raw.slots) ? raw.slots : [];
        const byDay = raw.byDay || {};

        let dayClasses: any[] = [];
        if (isWeeklyRequest) {
          dayClasses = allSlots;
        } else if (targetDay && byDay[targetDay] && Array.isArray(byDay[targetDay])) {
          dayClasses = byDay[targetDay];
        } else if (allSlots.length > 0) {
          dayClasses = allSlots.filter(
            (s: any) => (s.day || '').toLowerCase() === (targetDay || '').toLowerCase()
          );
        } else if (Array.isArray(raw.classes)) {
          dayClasses = raw.classes;
        }

        return {
          ...raw,
          day: targetDay,
          classes: dayClasses,
          classCount: dayClasses.length,
          slots: allSlots,
          byDay,
          isWeekly: isWeeklyRequest,
          courses: raw.courses || [],
          homeSection: raw.homeSection || '',
          vid: raw.vid || '',
          verified: allSlots.length > 0 || dayClasses.length > 0 || (raw.courses && raw.courses.length > 0)
        };
      }

      if (capability === 'examination') {
        const exams = Array.isArray(raw.exams)
          ? raw.exams
          : Array.isArray(raw.courses)
          ? raw.courses
          : [];
        return {
          ...raw,
          exams,
          examCount: exams.length,
          verified: exams.length > 0
        };
      }

      if (capability === 'attendance') {
        const courses = Array.isArray(raw.courses) ? raw.courses : [];
        const overall = raw.overallPercentage ?? raw.overall ?? 0;
        return {
          ...raw,
          courses,
          courseCount: courses.length,
          overallPercentage: overall,
          verified: courses.length > 0
        };
      }

      if (capability === 'sample_papers') {
        const papers = Array.isArray(raw.papers)
          ? raw.papers
          : Array.isArray(raw.samplePapers)
          ? raw.samplePapers
          : [];
        return {
          ...raw,
          papers,
          paperCount: papers.length,
          verified: papers.length > 0
        };
      }

      return raw;
    },
    []
  );

  const activeExecutionIdRef = useRef<string | null>(null);

  /*
   * Unified Interaction Pipeline:
   * 1. Understand full intent & context via Groq Qwen 3.8 27B + ConversationState
   * 2. Execute on UMS with pure visual runtime telemetry (ZERO vocal chatter)
   * 3. Extract and verify complete dataset
   * 4. Generate ONE canonical, intelligent natural response
   * 5. Display response in Chat UI and speak the SAME text via Groq Orpheus
   */
  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      // 1. Ensure AudioContext is unlocked for playback upon student interaction
      audioController.unlockAudio().catch(() => {});

      // Warm the primary local voice while the browser agent is working, so the
      // answer is spoken by the intended primary provider rather than a fallback.
      voiceController.prewarmSpeech();

      // 2. Immediate Barge-in: Stop active speech and interrupt running agent
      audioController.stop('new_command');
      voiceController.stopSpeaking();
      if (isAgentRunning) {
        await stopAgent();
      }

      // 3. Generate unique execution ID for request tracking and race condition prevention
      const goalExecutionId = `EXEC-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      activeExecutionIdRef.current = goalExecutionId;
      voiceController.setActiveExecutionId(goalExecutionId);
      audioController.setActiveExecutionId(goalExecutionId);

      // 4. Start visual pending bubble in Chat UI immediately
      const placeholderId = await startPendingExchange(text, goalExecutionId);

      let accumulatedText = '';
      let effectiveCapability = 'general';

      try {
        // 5. Resolve intent, capability, and entities via Groq Qwen 3.8 27B Semantic Engine
        const historyForSemantic = messages
          .filter((m) => m.text && m.text.trim())
          .slice(-6)
          .map((m) => ({
            role: m.sender === 'user' ? 'user' : 'assistant',
            content: (m.text as string) || ''
          }));

        const hasFullAttendance = Boolean(
          attendance &&
          attendance.courses &&
          attendance.courses.length > 0 &&
          ((attendance.totalDelivered || 0) > 0 || (attendance.totalClasses || 0) > 0 || attendance.courses.some((c) => (c.total || 0) > 0))
        );

        const hasFullTimetable = Boolean(
          currentTimetable &&
          ((currentTimetable.slots && currentTimetable.slots.length > 0) ||
            (currentTimetable.courses && currentTimetable.courses.length > 0))
        );

        const hasFullExamination = Boolean(
          examination && examination.exams && examination.exams.length > 0
        );

        const contextSummary = {
          hasAttendance: hasFullAttendance,
          hasFullAttendance,
          totalDelivered: attendance?.totalDelivered || 0,
          attendanceCourseCodes: attendance?.courses?.map((c) => c.code) || [],
          overallAttendance: attendance?.overallPercentage,
          hasTimetable: hasFullTimetable,
          hasFullTimetable,
          hasExamination: hasFullExamination,
          hasFullExamination
        };

        const semantic = await resolveSemanticIntent({
          query: text,
          executionId: goalExecutionId,
          currentUrl: currentUrl || undefined,
          currentPageType: activePageType || undefined,
          activeCapability: conversationState?.currentCapability || agentState?.finalResponse?.capability,
          conversationState: conversationState || undefined,
          history: historyForSemantic,
          contextSummary
        });

        if (activeExecutionIdRef.current !== goalExecutionId) {
          console.log('[ONEE] Superseded execution discarded after semantic resolution:', goalExecutionId);
          return;
        }

        // Groq's structured semantic result is the sole primary routing decision.
        // resolveSemanticIntent supplies a local result only when the service is
        // unavailable, so UI keyword branches never override conversational intent.
        if (semantic.conversationState) {
          setConversationState(semantic.conversationState);
        }

        const isDashboardIntent =
          semantic.intent === 'dashboard_navigation' ||
          semantic.target === 'student_dashboard' ||
          (semantic.action === 'navigate' && semantic.entities?.destination === 'student_dashboard');
        if (isDashboardIntent) {
          const dashboardTab = await navigateToStudentDashboard();
          const responseText = dashboardTab
            ? 'Taking you to your UMS home page now.'
            : 'I could not open the UMS home page. Please try again.';
          await completePendingExchange(placeholderId, text, responseText, {
            executionId: goalExecutionId
          });
          return;
        }

        const isVoiceDiagnostic =
          semantic.intent === 'voice_diagnostic' ||
          semantic.entities?.interaction === 'voice_diagnostic';
        if (isVoiceDiagnostic) {
          if (voiceController.getPreferences().mode === 'OFF') {
            await voiceController.setMode('LIVE_AGENT');
          }

          // Canonical chat response stays complete and structured; Sofia receives a
          // concise spoken summary derived from that same response.
          const voiceTestMsg =
            `### 🔊 Voice Assistant Test: Online & Active!\n\n` +
            `I am speaking right now. If your audio output or headphones are connected, you should hear ONEE clearly.\n\n` +
            `- **Status:** Online & Healthy\n` +
            `- **Speech Output:** Groq Orpheus cloud voice\n` +
            `- **Speech Input:** Groq Whisper transcription\n\n` +
            `Try asking: *"What classes do I have today?"*`;
          const voiceTestSpoken =
            `Voice check complete. I'm Sofia, and my speech pipeline is online and speaking normally. ` +
            `My voice is Groq Orpheus and my listening is Groq Whisper. What would you like to check next?`;

          await completePendingExchange(placeholderId, text, voiceTestMsg, {
            executionId: goalExecutionId,
            ttsChunks: [voiceTestSpoken]
          });
          return;
        }

        const isConversationalIntent =
          semantic.capability === 'onee_identity' ||
          semantic.capability === 'conversation' ||
          semantic.intent === 'identity_query' ||
          semantic.intent === 'casual_conversation' ||
          // Belt & braces: social text stays conversational even if a resolver
          // leg classifies it as general — "Hey Sophia!" must greet, never
          // launch the browser agent (that produced the old UMS-error reply).
          classifySocial(text) !== null;

        if (isConversationalIntent) {
          // DYNAMIC greeting: the opener varies by time of day AND rotates per
          // minute, echoes the student's own words, and surfaces verified live
          // context (aggregate attendance, next exam) — never one canned line.
          const social = classifySocial(text) || 'greeting';
          const nextExamRec =
            examination?.exams?.find((e) => Boolean(e.examDate)) || null;
          const { chatMsg: greetingMsg, spoken: greetingSpoken } =
            buildChatGreeting(social, {
              hasAttendance: Boolean(attendance?.courses?.length),
              aggregateAttendance: attendance?.overallPercentage ?? null,
              subjectCount: attendance?.courses?.length,
              nextExam: nextExamRec
                ? {
                    courseCode: nextExamRec.courseCode || '',
                    examDate: nextExamRec.examDate || ''
                  }
                : null,
              studentName: attendance?.studentName || null
            });

          await completePendingExchange(placeholderId, text, greetingMsg, {
            executionId: goalExecutionId,
            ttsChunks: [greetingSpoken]
          });
          return;
        }

        // Deterministic capability firewall: never let one verified dataset answer
        // a question that explicitly belongs to another domain. The browser goal is
        // rebuilt too, so automation always targets the corrected UMS section.
        const resolvedCapability = semantic.capability || 'general';
        const firewalledCapability = enforceCapabilityDomain(resolvedCapability, text);

        if (firewalledCapability !== resolvedCapability) {
          console.warn(
            `[ONEE] Capability firewall: ${resolvedCapability} -> ${firewalledCapability} for "${text}"`
          );
        }

        effectiveCapability = firewalledCapability;
        const routedDomain =
          firewalledCapability !== resolvedCapability
            ? {
                ...semantic,
                capability: firewalledCapability as typeof semantic.capability,
                goal: goalForCapabilityDomain(firewalledCapability, text),
                intent: `${firewalledCapability}_query`,
                requiresBrowserAction: true,
                action: 'read' as const
              }
            : semantic;
        logVoiceDiagnostic('capability_resolved', 'semantic-router', {
          intent: routedDomain.intent,
          configuredCapability: resolvedCapability,
          capability: firewalledCapability,
          requiresBrowserAction: Boolean(routedDomain.requiresBrowserAction),
          modelUsed: semantic.modelUsed
        }, goalExecutionId);
        let hasDataInMemory = false;
        if (effectiveCapability === 'timetable') {
          hasDataInMemory = Boolean(
            currentTimetable &&
            ((currentTimetable.slots && currentTimetable.slots.length > 0) ||
             (currentTimetable.courses && currentTimetable.courses.length > 0))
          );
        } else if (effectiveCapability === 'examination') {
          hasDataInMemory = Boolean(examination && examination.exams && examination.exams.length > 0);
        } else if (effectiveCapability === 'attendance') {
          hasDataInMemory = Boolean(attendance && attendance.courses && attendance.courses.length > 0);
        }

        const liveUmsCapability = ['attendance', 'examination', 'sample_papers', 'seating_plan', 'timetable'].includes(
          effectiveCapability
        );
        const shouldRunBrowserAction =
          liveUmsCapability ||
          Boolean(routedDomain.requiresBrowserAction) ||
          routedDomain.action === 'download' ||
          routedDomain.action === 'navigate' ||
          // Only LIVE UMS capabilities may fall back to a browser run when the
          // in-memory snapshot is missing. Social/general intents must respond
          // locally — spinning up the agent for "Hey Sophia!" is exactly what
          // produced the old "records not available" error for a greeting.
          (liveUmsCapability && !hasDataInMemory);

        let rawVerifiedResult: Record<string, any> = {};
        let taskOutcome: 'success' | 'data_unavailable' | 'failed' | 'cancelled' = 'data_unavailable';

        if (shouldRunBrowserAction) {
          // Requirement 2/4: after transcription + intent resolution and BEFORE
          // browser automation, Sofia speaks ONE short natural acknowledgement
          // ("Sure, I'll check your CSE330 attendance.") through the normal
          // VoiceQueue provider hierarchy. Browser-agent internals stay silent.
          if (voiceController.getPreferences().mode !== 'OFF') {
            voiceController.acknowledgeGoal(routedDomain.goal || text, goalExecutionId);
          }

          logVoiceDiagnostic('browser_execution_started', 'browser-agent', {
            capability: effectiveCapability,
            intent: semantic.intent,
            goal: routedDomain.goal || text
          }, goalExecutionId);
          const browserExecStartedAt = Date.now();

          // Autonomous UMS execution: pure visual runtime telemetry, ZERO vocal chatter
          const agentRes = await startGoal(routedDomain.goal || text, goalExecutionId, {
            intent: routedDomain.intent,
            capability: routedDomain.capability,
            entities: routedDomain.entities,
            target: routedDomain.target,
            action: routedDomain.action
          });
          if (activeExecutionIdRef.current !== goalExecutionId) {
            console.log('[ONEE] Superseded execution discarded after startGoal:', goalExecutionId);
            return;
          }

          /*
           * LIVE_UMS_RESPONSE_REQUIRES_VERIFIED_EXECUTION:
           * `taskOutcome` may only become 'success' from THIS execution's
           * verified dataset. Stale in-memory snapshots must never promote a
           * failed or skipped Browser Agent run into a factual answer, and an
           * absent agent result is a failed execution — not empty-but-verified
           * data.
           */
          const pickAgentDataset = (): Record<string, any> => {
            if (!agentRes) return {};
            if (effectiveCapability === 'timetable') return agentRes.timetable || {};
            if (effectiveCapability === 'examination') return agentRes.examination || {};
            if (effectiveCapability === 'seating_plan') return agentRes.examination || {};
            if (effectiveCapability === 'attendance') return agentRes.attendance || {};
            if (effectiveCapability === 'sample_papers') {
              const samplePaperResult = (agentRes.finalResponse as any)?.samplePaperResult;
              const base = agentRes.examination || {};
              return samplePaperResult ? { ...base, samplePaperResult } : base;
            }
            return agentRes.finalResponse?.details || (agentRes.finalResponse as any) || {};
          };
          const datasetHasRecords = (d: Record<string, any>) =>
            Boolean(
              (d?.courses && d.courses.length > 0) ||
              (d?.slots && d.slots.length > 0) ||
              (d?.exams && d.exams.length > 0) ||
              (d?.subjects && d.subjects.length > 0) ||
              d?.samplePaperResult?.success ||
              d?.status === 'READY'
            );

          if (agentRes && agentRes.taskOutcome === 'success') {
            rawVerifiedResult = pickAgentDataset();
            taskOutcome = datasetHasRecords(rawVerifiedResult) ? 'success' : 'data_unavailable';
          } else if (agentRes) {
            taskOutcome = agentRes.taskOutcome === 'failed' ? 'failed' : 'data_unavailable';
            rawVerifiedResult = {};
          } else {
            // startGoal returned without executing (superseded/ref busy):
            // execution never happened, so no factual result may be produced.
            taskOutcome = 'data_unavailable';
            rawVerifiedResult = {};
          }

          logVoiceDiagnostic('browser_execution_completed', 'browser-agent', {
            capability: effectiveCapability,
            taskOutcome,
            agentRan: Boolean(agentRes),
            agentOutcome: agentRes?.taskOutcome || 'not_run',
            recordCount:
              (rawVerifiedResult?.courses?.length ?? 0) ||
              (rawVerifiedResult?.exams?.length ?? 0) ||
              (rawVerifiedResult?.slots?.length ?? 0) ||
              (rawVerifiedResult?.subjects?.length ?? 0),
            durationMs: Date.now() - browserExecStartedAt
          }, goalExecutionId);
        } else {
          // Answer directly from verified in-memory session context
          if (effectiveCapability === 'timetable') {
            rawVerifiedResult = (currentTimetable as any) || {};
          } else if (effectiveCapability === 'examination' || effectiveCapability === 'sample_papers' || effectiveCapability === 'seating_plan') {
            rawVerifiedResult = (examination as any) || {};
          } else if (effectiveCapability === 'attendance') {
            rawVerifiedResult = (attendance as any) || {};
          }
          taskOutcome = Object.keys(rawVerifiedResult).length > 0 ? 'success' : 'data_unavailable';
        }

        // Normalize verified result into canonical contract with explicit active day and classes
        const verifiedResult = normalizeVerifiedData(
          effectiveCapability,
          rawVerifiedResult,
          text,
          routedDomain.entities,
          routedDomain.conversationState || conversationState || undefined
        );

        // The response service is the single source of truth for both UI text and
        // speech chunks.  The generic chat stream used to re-interpret a verified
        // browser result, which caused cards to merge separate exam records and
        // let voice say something different from the displayed answer.
        const canonical = await generateVerifiedResponse({
          executionId: goalExecutionId,
          query: text,
          intent: semantic.intent,
          capability: effectiveCapability,
          verifiedResult,
          history: historyForSemantic,
          conversationState: routedDomain.conversationState || conversationState || undefined,
          taskOutcome
        });

        logVoiceDiagnostic('response_composed', 'response-composer', {
          capability: effectiveCapability,
          taskOutcome,
          replyLength: (canonical.reply || '').length,
          cardType: canonical.cardType,
          verifiedRecordCount:
            (Array.isArray(verifiedResult?.courses) && verifiedResult.courses.length) ||
            (Array.isArray(verifiedResult?.exams) && verifiedResult.exams.length) ||
            (Array.isArray(verifiedResult?.slots) && verifiedResult.slots.length) || 0
        }, goalExecutionId);

        if (activeExecutionIdRef.current !== goalExecutionId) {
          console.log('[ONEE] Superseded execution discarded after verified response:', goalExecutionId);
          return;
        }

        if (canonical.conversationState) {
          setConversationState(canonical.conversationState);
        }

        let finalText = canonical.reply.trim();

        // Verified datasets that actually drove this answer. Suggestions and the
        // entity-specificity guard both read from these, never from stale state.
        const verifiedCourses: Array<{ code: string; percentage?: number }> = Array.isArray(
          (verifiedResult as any)?.courses
        )
          ? (verifiedResult as any).courses
          : [];
        const verifiedExams = Array.isArray((verifiedResult as any)?.exams)
          ? (verifiedResult as any).exams
          : [];
        const verifiedSlots = Array.isArray((verifiedResult as any)?.slots)
          ? (verifiedResult as any).slots
          : [];

        const suggestionAttendance =
          effectiveCapability === 'attendance' && verifiedCourses.length > 0
            ? (verifiedResult as AttendanceSummary)
            : attendance;
        const suggestionExamination =
          effectiveCapability === 'examination' && verifiedExams.length > 0
            ? (verifiedResult as ExaminationSummary)
            : examination;
        const suggestionTimetable =
          effectiveCapability === 'timetable' && verifiedSlots.length > 0
            ? (verifiedResult as TimetableSummary)
            : currentTimetable;

        const queriedCourseCode = extractCourseFromText(text);
        const lowestCourse =
          verifiedCourses.length > 0
            ? [...verifiedCourses].sort((a, b) => (a.percentage ?? 0) - (b.percentage ?? 0))[0]
            : null;
        const wantsEntitySpecificAttendance =
          /\b(lowest|least|worst|tightest|shortage|margin|bunk|bunks|skip|skips|miss|missing|how many|can i)\b/i.test(
            text
          ) || Boolean(queriedCourseCode);
        const requiredEntity = queriedCourseCode || (lowestCourse ? String(lowestCourse.code) : null);

        // A verified dataset must never be answered with a generic aggregate
        // sentence: when the student named a course (or asked for the lowest
        // one), the answer has to name that course explicitly.
        const attendanceReplyIsGeneric =
          effectiveCapability === 'attendance' &&
          verifiedCourses.length > 0 &&
          (!/\d/.test(finalText) ||
            (wantsEntitySpecificAttendance &&
              Boolean(requiredEntity) &&
              !finalText.toUpperCase().includes(requiredEntity!.toUpperCase())));

        const isGenericStub = !finalText || attendanceReplyIsGeneric;

        // Voice summary derived from whichever canonical response we actually show.
        // It can never describe a different answer than the chat message, and it is
        // never the raw chat markdown: Sofia speaks a greeting + direct answer +
        // concise conclusion produced by the dedicated voice-summary engine.
        const deriveVoiceSummary = (messageText: string): string[] => {
          if (!messageText || !messageText.trim()) return [];
          return [messageText];
        };

        let voiceSummary: string[] = deriveVoiceSummary(finalText);

        if (isGenericStub) {
          finalText = generateLocalFallbackResponse(
            text,
            effectiveCapability === 'attendance' ? (verifiedResult as AttendanceSummary) : attendance,
            effectiveCapability === 'examination' ? (verifiedResult as ExaminationSummary) : examination,
            effectiveCapability === 'timetable' ? (verifiedResult as TimetableSummary) : currentTimetable,
            messages
          ).message;
          // Regenerated canonical response ⇒ its own derived voice summary.
          voiceSummary = deriveVoiceSummary(finalText);
        }

        const pacer = new SmoothTokenPacer((chunk) => {
          if (activeExecutionIdRef.current === goalExecutionId) {
            updatePendingExchangeChunk(placeholderId, chunk);
          }
        });
        pacer.push(finalText);
        await pacer.finish();

        if (activeExecutionIdRef.current !== goalExecutionId) {
          return;
        }

        const freshSuggestions = generateContextualSuggestions(
          suggestionAttendance,
          text,
          suggestionExamination,
          suggestionTimetable,
          finalText
        );

        // VOICE: speak the composer's deterministic SPOKEN SUMMARY (natural
        // prose — no markdown headings, no tables, no raw fractions). It is
        // derived from the same verified data as the chat text, so facts can
        // never diverge. Fall back to the canonical text only when no spoken
        // form exists.
        const spokenChunks =
          Array.isArray(canonical.ttsChunks) && canonical.ttsChunks.length > 0
            ? canonical.ttsChunks
            : voiceSummary;

        await completePendingExchange(placeholderId, text, finalText, {
          executionId: goalExecutionId,
          cardType: canonical.cardType,
          ttsChunks: spokenChunks,
          capability: effectiveCapability,
          suggestions: freshSuggestions
        });

        logVoiceDiagnostic('execution_completed', 'pipeline', {
          status: 'completed',
          capability: effectiveCapability,
          taskOutcome,
          responseLength: finalText.length
        }, goalExecutionId);
      } catch (err: any) {
        if (activeExecutionIdRef.current !== goalExecutionId) return;
        console.error('[ONEE Pipeline Error] Response pipeline failure:', err);
        logVoiceDiagnostic(
          'execution_completed',
          'pipeline',
          { status: 'error', capability: effectiveCapability, error: err?.message || String(err) },
          goalExecutionId,
          err?.message || String(err)
        );
        const routedFallbackCapability =
          effectiveCapability !== 'general' ? effectiveCapability : routeUserIntent(text).capability;
        const isLiveUmsFallback =
          ['attendance', 'examination', 'sample_papers', 'seating_plan', 'timetable'].includes(
            effectiveCapability
          ) ||
          ['ATTENDANCE', 'EXAM_DATE_SHEET', 'SEATING_PLAN', 'SAMPLE_PAPER', 'TIMETABLE'].includes(
            String(routedFallbackCapability)
          );
        let fallbackMsg = accumulatedText.trim();
        if (!fallbackMsg) {
          if (isLiveUmsFallback) {
            // LIVE_UMS_RESPONSE_REQUIRES_VERIFIED_EXECUTION: a failed pipeline must
            // never be papered over with a direct LLM answer built from stale context.
            fallbackMsg =
              "I couldn't complete the live UMS check for that request, so I don't have a verified answer yet. Please keep your UMS tab open and logged in, then try again.";
          } else {
            try {
              const hasValidTt = Boolean(
                currentTimetable &&
                ((currentTimetable.slots && currentTimetable.slots.length > 0) ||
                 (currentTimetable.courses && currentTimetable.courses.length > 0))
              );
              const fallbackTimetable = hasValidTt ? currentTimetable : undefined;
              const localFallback = generateLocalFallbackResponse(
                text,
                attendance,
                examination,
                fallbackTimetable,
                messages
              );
              fallbackMsg = localFallback.message;
            } catch (fallbackErr) {
              console.warn('[ONEE Local Fallback Failed]:', fallbackErr);
              fallbackMsg = "I couldn't complete that verification right now. Please ensure your UMS session is active or open the relevant section in UMS.";
            }
          }
        }

        const pacer = new SmoothTokenPacer((chunk) => {
          if (activeExecutionIdRef.current === goalExecutionId) {
            updatePendingExchangeChunk(placeholderId, chunk);
          }
        });
        pacer.push(fallbackMsg);
        await pacer.finish();

        if (activeExecutionIdRef.current !== goalExecutionId) {
          return;
        }

        const freshFallbackSuggs = generateContextualSuggestions(
          attendance,
          text,
          examination,
          currentTimetable,
          fallbackMsg
        );

        await completePendingExchange(
          placeholderId,
          text,
          fallbackMsg,
          {
            executionId: goalExecutionId,
            ttsChunks: fallbackMsg ? [fallbackMsg] : undefined,
            skipVoice: !fallbackMsg,
            capability: effectiveCapability,
            suggestions: freshFallbackSuggs
          }
        );
      }
    },
    [
      isAgentRunning,
      stopAgent,
      startPendingExchange,
      currentUrl,
      activePageType,
      conversationState,
      agentState?.finalResponse?.capability,
      currentTimetable,
      attendance,
      examination,
      startGoal,
      messages,
      updatePendingExchangeChunk,
      completePendingExchange,
      normalizeVerifiedData
    ]
  );

  /*
   * Register voice command handlers with VoiceController so spoken input enters
   * the exact same agent & intent pipeline as typed input.
   */
  useEffect(() => {
    voiceController.registerHandlers(
      async (transcript: string) => {
        await handleSendMessage(transcript);
      },
      () => {
        stopAgent();
        voiceController.stopSpeaking();
        voiceController.setActiveExecutionId(null);
      }
    );
  }, [handleSendMessage, stopAgent]);

  const chatSectionRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLElement>(null);

  /*
   * When student clicks "Ask ONEE about this" in verification cards or quick actions,
   * immediately trigger message generation and smoothly glide down to the chatbot section.
   */
  const handleAskOnee = useCallback(
    (prompt: string) => {
      // 1. Kick off prompt generation immediately through unified semantic execution pipeline
      handleSendMessage(prompt);

      // 2. Smoothly glide down to the chatbot section and generated response
      requestAnimationFrame(() => {
        const container = mainContentRef.current;
        if (container) {
          container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
        } else {
          chatSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
      });
    },
    [handleSendMessage]
  );

  const isAttendanceVerified = Boolean(
    attendance &&
    attendance.status === 'verified' &&
    // 'cached-verified-record' is the identity-gated IndexedDB snapshot that
    // provably belongs to THIS student (shown with a last-verified caption
    // while the tab is on a non-dashboard UMS page); 'live-ums-dom' is a
    // fresh read of the page currently on screen.
    (attendance.source === 'live-ums-dom' || attendance.source === 'cached-verified-record') &&
    attendance.courses &&
    attendance.courses.length > 0
  );

  const activeCapability =
    agentState?.finalResponse?.capability ||
    (isAgentRunning ? routeUserIntent(agentState?.currentGoal || '').capability : null);

  const showAttendanceViews =
    isAttendanceVerified &&
    messages.length === 0 &&
    (!activeCapability || activeCapability === 'ATTENDANCE');

  const showExaminationViews =
    Boolean(examination) &&
    messages.length === 0 &&
    (!activeCapability || activeCapability === 'EXAM_DATE_SHEET' || activeCapability === 'SEATING_PLAN');

  const isSessionAuthenticated =
    status !== 'LOGIN_PAGE' &&
    status !== 'NOT_CONNECTED' &&
    status !== 'HUMAN_VERIFICATION';

  return (
    <div className={styles.root}>
      <Header
        status={status}
        runtimeState={runtimeState}
        agentState={agentState}
        isChatTyping={isTyping}
        onOpenPrivacy={() => setShowPrivacy(true)}
        onOpenHistory={() => setShowHistory(true)}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />

      <main ref={mainContentRef} className={styles.mainContent}>
        {isLoading && !attendance ? (
          <Skeletons />
        ) : !isSessionAuthenticated ? (
          /* Sign In Required / Disconnected State */
          <div className={styles.dashboard}>
            <ConnectionState
              status={status}
              errorMessage={errorMessage}
              hasAttendanceLink={hasAttendanceLink}
              onOpenUms={openUmsTab}
              onRefresh={handleRefresh}
              onNavigateToAttendance={navigateToAttendance}
            />
          </div>
        ) : (
          <div className={styles.dashboard}>
            {/* Active Computer-Use Agent Launcher & Controller */}
            <AgentControlPanel
              agentState={agentState}
              onStartGoal={startGoal}
              onStop={() => {
                stopAgent();
                voiceController.stopSpeaking();
                voiceController.setActiveExecutionId(null);
              }}
              onPause={pauseAgent}
              onResume={resumeAgent}
              onToggleDebug={toggleDebugMode}
              onAskOnee={handleAskOnee}
              onCopy={(text) => {
                navigator.clipboard.writeText(text);
                addToast('Summary copied to clipboard', 'success');
              }}
            />

            {showAttendanceViews && (
              <>
                <AttendanceCard
                  attendance={attendance!}
                  onOpenCalculator={() => setShowOverallCalc(true)}
                />

                <CourseList
                  courses={attendance!.courses}
                  onSelectCourse={(course) => setSelectedCourse(course)}
                />
              </>
            )}

            {!isAttendanceVerified && !activeCapability && (
              <ConnectionState
                status={status}
                errorMessage={errorMessage}
                hasAttendanceLink={hasAttendanceLink}
                onOpenUms={openUmsTab}
                onRefresh={handleRefresh}
                onNavigateToAttendance={navigateToAttendance}
              />
            )}

            {/* Examination Schedule & Seating Plan Card */}
            {showExaminationViews && (
              <ExaminationCard
                examination={examination}
                onCheckDateSheet={() =>
                  startGoal('Open Date Sheet from Important Links and check my exams')
                }
                onOpenSamplePaper={(code) =>
                  startGoal(`Open sample paper for ${code}`)
                }
              />
            )}

            <ActivityTimeline activities={activities} />

            <div
              id="ask-onee-chat-section"
              ref={chatSectionRef}
              className={styles.chatSection}
            >
              <div className={styles.chatHeader}>
                <h3 className={styles.chatTitle}>Ask ONEE</h3>
              </div>
              <ChatView
                messages={messages}
                isTyping={isTyping}
                onSendMessage={handleSendMessage}
                suggestions={suggestions}
                agentState={agentState}
                attendance={attendance}
                examination={examination}
                timetable={currentTimetable}
                scrollContainerRef={mainContentRef}
              />
            </div>
          </div>
        )}
      </main>

      {/* Conversation History Drawer */}
      <ConversationDrawer
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={switchConversation}
        onNewConversation={newConversation}
        onDeleteConversation={deleteConversation}
      />

      {/* Bunk Calculator Modal for specific subject */}
      {selectedCourse && (
        <BunkCalculatorModal
          course={selectedCourse}
          onClose={() => setSelectedCourse(null)}
        />
      )}

      {/* Bunk Calculator Modal for overall attendance */}
      {showOverallCalc && attendance && (
        <BunkCalculatorModal
          overall={attendance}
          onClose={() => setShowOverallCalc(false)}
        />
      )}

      {/* Launch info carousel: lively multi-card flow with ONEE, lands on main */}
      {showIntro && <InfoCarousel onClose={handleCloseIntro} />}

      {/* Privacy & Local Data Management Modal */}
      {showPrivacy && (
        <PrivacyModal
          onClose={handleClosePrivacy}
          onDataCleared={() => {
            clearHistory();
            setExamination(null);
            addToast('Local data cleared', 'info');
          }}
        />
      )}

      {/* Global Notification Toast Container */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};
