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
import { AttendanceSummary, AttendanceRecord, ExaminationSummary, ConnectionStatus } from '../shared/types';
import { useUmsConnection } from '../hooks/useUmsConnection';
import { useChatAgent } from '../hooks/useChatAgent';
import { useAgentController } from '../hooks/useAgentController';
import { markPrivacyNoticeSeen } from '../services/storage';
import { verifiedExaminationRepo } from '../services/repositories';
import { routeUserIntent } from '../services/intentRouter';
import { voiceController } from '../voice';

import { Header } from '../components/Header';
import { ConnectionState } from '../components/ConnectionState';
import { AttendanceCard } from '../components/AttendanceCard';
import { CourseList } from '../components/CourseList';
import { ActivityTimeline } from '../components/ActivityTimeline';
import { ChatView } from '../components/ChatView';
import { BunkCalculatorModal } from '../components/BunkCalculatorModal';
import { PrivacyModal } from '../components/PrivacyModal';
import { ConversationDrawer } from '../components/ConversationDrawer';
import { Skeletons } from '../components/Skeletons';
import { AgentControlPanel } from '../components/AgentControlPanel';
import { ExaminationCard } from '../components/ExaminationCard';
import { ToastContainer, useToasts } from '../components/Toast';

import styles from './App.module.css';
import { triggerSuccessConfetti } from '../lib/confetti';
import { connectionManager, RuntimeConnectionState } from '../services/connectionManager';

export const App: React.FC = () => {
  const [runtimeState, setRuntimeState] = useState<RuntimeConnectionState>('INITIAL');
  const [examination, setExamination] = useState<ExaminationSummary | null>(null);
  const { toasts, addToast, dismissToast } = useToasts();

  /*
   * Load any previously verified examination data from local storage
   */
  useEffect(() => {
    verifiedExaminationRepo.getLatestVerifiedExamination('default').then((record) => {
      if (record?.examination) {
        setExamination(record.examination);
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
  // Show privacy & info panel on fresh launch
  const [showPrivacy, setShowPrivacy] = useState<boolean>(true);
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

  /*
   * useAgentController manages active Computer Use tasks.
   * When an extraction finishes successfully, it invokes this callback so we
   * can play confetti and trigger a fresh read of the verified data.
   */
  const {
    state: agentState,
    startGoal,
    stopAgent,
    pauseAgent,
    resumeAgent,
    toggleDebugMode,
    resetAgentState
  } = useAgentController(
    (extractedAttendance: AttendanceSummary) => {
      addToast('Attendance updated', 'success');
      triggerSuccessConfetti();
      refresh();
      if (extractedAttendance.totalCourses > 0) {
        voiceController.speakText(
          `Attendance verified for ${extractedAttendance.totalCourses} courses. Overall attendance is ${Math.round(extractedAttendance.overallPercentage)} percent.`,
          true
        );
      }
    },
    'default',
    (extractedExam: ExaminationSummary) => {
      setExamination(extractedExam);
      addToast('Examination schedule verified', 'success');
      triggerSuccessConfetti();
      if (extractedExam.totalExams > 0) {
        voiceController.speakText(
          `Examination schedule verified. Found ${extractedExam.totalExams} scheduled exams.`,
          true
        );
      }
    }
  );

  /*
   * useChatAgent manages conversation threads, local IndexedDB persistence,
   * and fallback streaming.
   */
  const {
    messages,
    isTyping,
    sendMessage,
    clearHistory,
    suggestions,
    conversations,
    activeConversationId,
    newConversation,
    switchConversation,
    deleteConversation
  } = useChatAgent(attendance, undefined, 'default', examination);

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
   */
  useEffect(() => {
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

  /*
   * Dispatches student input into both browser Computer Use and chat assistant.
   * If the intent involves examinations, seating, timetable, or attendance navigation,
   * the autonomous agent starts visibly executing on UMS with live voice narration.
   */
  const handleSendMessage = useCallback(
    async (text: string) => {
      const textLower = text.toLowerCase();
      const routed = routeUserIntent(text, {
        latestAttendance: attendance,
        latestExamination: examination
      });

      const isAgentAction =
        routed.capability === 'EXAM_DATE_SHEET' ||
        routed.capability === 'SEATING_PLAN' ||
        routed.capability === 'SAMPLE_PAPER' ||
        routed.capability === 'TIMETABLE' ||
        textLower.includes('go to') ||
        textLower.includes('navigate') ||
        textLower.includes('open attendance') ||
        textLower.includes('find attendance') ||
        textLower.includes('check attendance') ||
        textLower.includes('check my attendance') ||
        textLower.includes('open date sheet') ||
        textLower.includes('find my seat') ||
        textLower.includes('where is my seat');

      if (isAgentAction) {
        voiceController.acknowledgeGoal(text, 'active-voice-goal');
        await startGoal(text);
      }
      await sendMessage(text);
    },
    [attendance, examination, startGoal, sendMessage]
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
      // 1. Kick off prompt generation immediately
      sendMessage(prompt);

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
    [sendMessage]
  );

  const isAttendanceVerified = Boolean(
    attendance &&
    attendance.status === 'verified' &&
    attendance.source === 'live-ums-dom' &&
    attendance.courses &&
    attendance.courses.length > 0
  );

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
              onStop={stopAgent}
              onPause={pauseAgent}
              onResume={resumeAgent}
              onToggleDebug={toggleDebugMode}
              onAskOnee={handleAskOnee}
              onCopy={(text) => {
                navigator.clipboard.writeText(text);
                addToast('Summary copied to clipboard', 'success');
              }}
            />

            {isAttendanceVerified ? (
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
            ) : (
              <ConnectionState
                status={status}
                errorMessage={errorMessage}
                hasAttendanceLink={hasAttendanceLink}
                onOpenUms={openUmsTab}
                onRefresh={handleRefresh}
                onNavigateToAttendance={navigateToAttendance}
              />
            )}

            {/* Examination Schedule & Seating Plan Card - Preserved alongside attendance report */}
            <ExaminationCard
              examination={examination}
              onCheckDateSheet={() =>
                startGoal('Open Date Sheet from Important Links and check my exams')
              }
              onOpenSamplePaper={(code) =>
                startGoal(`Open sample paper for ${code}`)
              }
            />

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
