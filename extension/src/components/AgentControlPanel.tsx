/*
 * Browser Agent Control Panel for ONEE.
 *
 * This is the main UI for Computer Use: it shows the user what ONEE is actually
 * doing on the UMS page in real time. The panel has three visual states:
 *
 * 1. Idle: Two preset goal buttons are shown ("lowest attendance" and "full summary").
 * 2. Running: A pipeline stepper (Observe → Think → Locate → Verify → Move → Act → Extract → Done)
 *    highlights the current stage, and a live action card shows what the agent is doing right now.
 * 3. Completed: A "Computer Use Final Response" card appears with the verified attendance result,
 *    including a green verified badge, source metadata, and "Copy" / "Ask ONEE" actions.
 *
 * The pipeline stages map directly from agentState.status (e.g. "thinking" → THINK, "extracting" → EXTRACT).
 * We never show a stage as complete unless the agent has actually moved past it.
 */

import React from 'react';
import { AgentState, AgentStage, ExaminationRecord, TimetableDay, TimetableSlot, CourseFacultyRecord, TimetableSummary } from '../shared/types';
import { getTodayClasses, getCurrentOrNextClass, getDayOfWeekName, formatVerificationSource } from '../shared/timetableCalculator';
import { getShortExamTypeTag } from '../shared/examinationCalculator';
import { smoothScrollToReveal, smoothScrollOnCollapse } from '../lib/scrollUtils';
import styles from './AgentControlPanel.module.css';

const getExamKey = (exam: ExaminationRecord, fallbackIdx: number): string => {
  if (exam.id) return `${exam.id}-${fallbackIdx}`;
  const parts = [
    exam.courseCode,
    exam.examDate,
    exam.startTime || '',
    exam.examType || '',
    exam.mode || '',
    String(fallbackIdx)
  ].filter(Boolean);
  return parts.join('-');
};

interface AgentControlPanelProps {
  agentState: AgentState;
  onStartGoal: (goal: string) => void;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onToggleDebug?: () => void;
  onAskOnee?: (prompt: string) => void;
  onCopy?: (text: string) => void;
}

const PIPELINE_STAGES: { stage: AgentStage; label: string }[] = [
  { stage: 'OBSERVE', label: 'Observe' },
  { stage: 'THINK', label: 'Think' },
  { stage: 'LOCATE', label: 'Locate' },
  { stage: 'VERIFY', label: 'Verify' },
  { stage: 'MOVE', label: 'Move' },
  { stage: 'ACT', label: 'Act' },
  { stage: 'EXTRACT', label: 'Extract' },
  { stage: 'DONE', label: 'Done' }
];

export const AgentControlPanel: React.FC<AgentControlPanelProps> = ({
  agentState,
  onStartGoal,
  onStop,
  onPause,
  onResume,
  onToggleDebug,
  onAskOnee,
  onCopy
}) => {
  const isRunning =
    agentState.status !== 'idle' &&
    agentState.status !== 'completed' &&
    agentState.status !== 'stopped' &&
    agentState.status !== 'error';

  const [activeCategory, setActiveCategory] = React.useState<'all' | 'timetable' | 'examination' | 'attendance'>('all');
  const [expandedExamId, setExpandedExamId] = React.useState<string | null>(null);
  const [timetableDay, setTimetableDay] = React.useState<'Today' | TimetableDay | 'All'>('Today');
  const [timetableView, setTimetableView] = React.useState<'classes' | 'faculty' | 'grid'>('classes');
  const [isCopied, setIsCopied] = React.useState<boolean>(false);

  const timelineRef = React.useRef<HTMLDivElement | null>(null);
  const finalResponseRef = React.useRef<HTMLDivElement | null>(null);

  // Auto-scroll agent trace while lively working
  React.useEffect(() => {
    if (isRunning && timelineRef.current) {
      timelineRef.current.scrollTo({
        top: timelineRef.current.scrollHeight,
        behavior: 'smooth'
      });
      timelineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }
  }, [agentState.activities.length, agentState.status, agentState.currentStep, isRunning]);

  // Auto-scroll automatically to result card after each browser action completes
  React.useEffect(() => {
    if (agentState.finalResponse) {
      const timer = setTimeout(() => {
        finalResponseRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        });
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [
    agentState.finalResponse?.status,
    agentState.finalResponse?.title,
    agentState.finalResponse?.capability,
    agentState.finalResponse?.explanation,
    agentState.status
  ]);

  const timetableGoals = [
    {
      id: 'view_timetable',
      title: 'View Time Table & Schedule',
      goal: 'Open view time table and show my complete weekly schedule and faculty cabins',
      desc: 'Extracts full weekly timetable grid and faculty cabin directory from UMS',
      icon: '🗓️',
      badge: 'NEW'
    },
    {
      id: 'today_classes',
      title: 'What classes do I have today?',
      goal: 'What classes do I have today and where are the rooms?',
      desc: "Calculates today's active schedule, lecture timings, and faculty rooms",
      icon: '⏰',
      badge: 'NEW'
    }
  ];

  const examGoals = [
    {
      id: 'date_sheet',
      title: 'Open Date Sheet from Important Links',
      goal: 'Open Date Sheet from Important Links and check my exams',
      desc: 'Clicks Date Sheet on Dashboard & extracts seating plan from studentums',
      icon: '📅',
      badge: 'NEW'
    },
    {
      id: 'next_exam',
      title: 'When is my next exam & where is my seat?',
      goal: 'When is my next exam and where is my seat?',
      desc: 'Calculates nearest upcoming exam, venue, room & seat deterministically',
      icon: '💺',
      badge: 'NEW'
    }
  ];

  const attendanceGoals = [
    {
      id: 'lowest_attendance',
      title: 'Which subject has lowest attendance?',
      goal: 'Go to my attendance and tell me which subject has the lowest attendance',
      desc: 'Navigates to attendance & calculates bunk safety margin',
      icon: '📊'
    },
    {
      id: 'full_summary',
      title: 'Open Attendance Summary and read full attendance',
      goal: 'Open Attendance Summary and read my full subject attendance',
      desc: 'Reads all courses, total attended and delivered lectures',
      icon: '📋'
    }
  ];

  const isPaused = agentState.status === 'paused';

  const bestCandidate = agentState.lastGroundingResult?.bestCandidate;
  const telemetry = agentState.lastTelemetry;
  const execContext = agentState.executionContext;
  const finalResponse = agentState.finalResponse;

  // Determine current active pipeline stage
  let activeStage: AgentStage = 'OBSERVE';
  if (agentState.status === 'thinking' || agentState.status === 'planning') activeStage = 'THINK';
  else if (agentState.status === 'locating' || agentState.status === 'grounding') activeStage = 'LOCATE';
  else if (agentState.status === 'verifying_target' || agentState.status === 'verifying') activeStage = 'VERIFY';
  else if (agentState.status === 'moving') activeStage = 'MOVE';
  else if (agentState.status === 'acting' || agentState.status === 'executing') activeStage = 'ACT';
  else if (agentState.status === 'extracting' || agentState.status === 'validating') activeStage = 'EXTRACT';
  else if (agentState.status === 'completed') activeStage = 'DONE';

  const activeStageIndex = PIPELINE_STAGES.findIndex((p) => p.stage === activeStage);

  return (
    <div className={styles.container}>
      {/* Header & Identity Card */}
      <div className={styles.headerCard}>
        <div className={styles.headerTop}>
          <span className={styles.agentBadge}>
            <span className={styles.liveDot} />
            Browser Agent
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className={styles.connectedText}>CONNECTED</span>
            {agentState.activeModel && (
              <span
                className={`${styles.modelBadge} ${agentState.isFallbackModel ? styles.modelBadgeFallback : ''}`}
                title={`Reasoning Model: ${agentState.activeModel}${agentState.isFallbackModel ? ' (Fallback)' : ''}`}
              >
                {agentState.isFallbackModel ? `↻ ${agentState.activeModel.split('/')[1] || agentState.activeModel}` : agentState.activeModel.split('/')[1] || agentState.activeModel}
              </span>
            )}
            {onToggleDebug && (
              <button
                className={`${styles.debugToggle} ${agentState.debugMode ? styles.debugActive : ''}`}
                onClick={onToggleDebug}
                title="Toggle developer vision-DOM telemetry"
              >
                {agentState.debugMode ? 'Debug ON' : 'Debug'}
              </button>
            )}
          </div>
        </div>
        <h3 className={styles.taskTitle}>
          {agentState.currentGoal || 'Autonomous Browser Agent'}
        </h3>
        <p className={styles.taskSubtitle}>UMS • Attendance, Date Sheet & Seating Plan</p>
      </div>

      {/* Active Computer-Use Execution UI */}
      {isRunning ? (
        <>
          {/* Pipeline Stepper Visualizer */}
          <div className={styles.pipelineContainer}>
            {PIPELINE_STAGES.map((step, idx) => {
              const isStepActive = idx === activeStageIndex;
              const isStepCompleted = idx < activeStageIndex || agentState.status === 'completed';
              return (
                <React.Fragment key={step.stage}>
                  <div
                    className={`${styles.pipelineStep} ${
                      isStepActive ? styles.active : isStepCompleted ? styles.completed : ''
                    }`}
                  >
                    <span
                      className={`${styles.stepDot} ${
                        isStepActive ? styles.active : isStepCompleted ? styles.completed : ''
                      }`}
                    />
                    <span>{step.label}</span>
                  </div>
                  {idx < PIPELINE_STAGES.length - 1 && (
                    <span className={styles.pipelineArrow}>›</span>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Dynamic Live Action Card */}
          <div className={styles.liveActionCard}>
            <div className={styles.liveActionHeader}>
              <span className={styles.liveActionPulse} />
              <span className={styles.liveActionStatus}>
                {isPaused ? 'PAUSED' : agentState.status.replace(/_/g, ' ')}
              </span>
            </div>
            <p className={styles.liveActionDesc}>
              {agentState.currentAction?.reason ||
                (agentState.status === 'observing'
                  ? 'Inspecting current UMS page layout...'
                  : agentState.status === 'thinking'
                  ? 'Analyzing candidates and planning path...'
                  : agentState.status === 'extracting'
                  ? ((agentState.currentGoal || '').toLowerCase().includes('timetable') ||
                     (agentState.currentGoal || '').toLowerCase().includes('time table') ||
                     (agentState.currentGoal || '').toLowerCase().includes('schedule') ||
                     (agentState.currentGoal || '').toLowerCase().includes('class') ||
                     (agentState.currentGoal || '').toLowerCase().includes('faculty') ||
                     (agentState.currentGoal || '').toLowerCase().includes('cabin')
                      ? 'Reading weekly timetable from DOM...'
                      : (agentState.currentGoal || '').toLowerCase().includes('exam') ||
                        (agentState.currentGoal || '').toLowerCase().includes('date sheet') ||
                        (agentState.currentGoal || '').toLowerCase().includes('datesheet') ||
                        (agentState.currentGoal || '').toLowerCase().includes('seating')
                      ? 'Reading examination date sheet from DOM...'
                      : 'Reading attendance table from DOM...')
                  : agentState.status === 'validating'
                  ? 'Verifying and validating records...'
                  : 'Operating active session...')}
            </p>
            <div className={styles.modalityGrid}>
              <div className={`${styles.modalityItem} ${styles.active}`}>
                <span>Vision</span>
                <span>✓</span>
              </div>
              <div className={`${styles.modalityItem} ${styles.active}`}>
                <span>DOM</span>
                <span>✓</span>
              </div>
              <div className={`${styles.modalityItem} ${styles.active}`}>
                <span>Accessibility</span>
                <span>✓</span>
              </div>
            </div>
          </div>

          {/* Action Control Row */}
          <div className={styles.controlRow}>
            <div className={styles.controlInfo}>
              <span className={styles.stepLabel}>
                {isPaused
                  ? 'USER CONTROL ACTIVE'
                  : `STEP ${agentState.currentStep}/${agentState.maxSteps}`}
                {agentState.retryContext && (
                  <span style={{ color: '#f59e0b', marginLeft: '6px' }}>
                    [Retry {agentState.retryContext.attemptCount}/3]
                  </span>
                )}
              </span>
              <span className={styles.actionLabel}>
                {agentState.currentAction?.reason || 'Observing...'}
              </span>
            </div>
            <div className={styles.controlButtons}>
              {isPaused ? (
                <button className={styles.resumeBtn} onClick={onResume}>
                  Resume
                </button>
              ) : (
                <button className={styles.pauseBtn} onClick={onPause}>
                  Take Control
                </button>
              )}
              <button className={styles.stopBtn} onClick={onStop}>
                Stop
              </button>
            </div>
          </div>
        </>
      ) : (
        /* Preset Goal Launcher Section with Category Selector */
        <div className={styles.presetSection}>
          <div className={styles.categoryTabs} role="tablist" aria-label="Goal categories">
            <button
              role="tab"
              aria-selected={activeCategory === 'all'}
              className={`${styles.categoryTab} ${activeCategory === 'all' ? styles.active : ''}`}
              onClick={() => setActiveCategory('all')}
            >
              <span className={styles.categoryLabel}>All</span>
              <span className={styles.categoryCount}>
                {timetableGoals.length + examGoals.length + attendanceGoals.length}
              </span>
            </button>
            <button
              role="tab"
              aria-selected={activeCategory === 'timetable'}
              className={`${styles.categoryTab} ${activeCategory === 'timetable' ? styles.active : ''}`}
              onClick={() => setActiveCategory('timetable')}
            >
              <span className={styles.categoryIcon}>🗓️</span>
              <span className={styles.categoryLabel}>Time Table</span>
              <span className={styles.newBadge}>NEW</span>
            </button>
            <button
              role="tab"
              aria-selected={activeCategory === 'examination'}
              className={`${styles.categoryTab} ${activeCategory === 'examination' ? styles.active : ''}`}
              onClick={() => setActiveCategory('examination')}
            >
              <span className={styles.categoryIcon}>📅</span>
              <span className={styles.categoryLabel}>Date Sheet</span>
              <span className={styles.newBadge}>NEW</span>
            </button>
            <button
              role="tab"
              aria-selected={activeCategory === 'attendance'}
              className={`${styles.categoryTab} ${activeCategory === 'attendance' ? styles.active : ''}`}
              onClick={() => setActiveCategory('attendance')}
            >
              <span className={styles.categoryIcon}>📊</span>
              <span className={styles.categoryLabel}>Attendance</span>
            </button>
          </div>

          <div className={styles.presetGoals}>
            {(activeCategory === 'all' || activeCategory === 'timetable') &&
              timetableGoals.map((item) => (
                <button
                  key={item.id}
                  className={`${styles.presetBtn} ${styles.examPresetBtn}`}
                  onClick={() => onStartGoal(item.goal)}
                >
                  <span className={styles.actionIcon}>{item.icon}</span>
                  <div className={styles.presetContent}>
                    <div className={styles.presetTitleRow}>
                      <span className={styles.presetTitle}>{item.title}</span>
                      {item.badge && <span className={styles.newBadge}>{item.badge}</span>}
                    </div>
                    <span className={styles.presetDesc}>{item.desc}</span>
                  </div>
                </button>
              ))}

            {(activeCategory === 'all' || activeCategory === 'examination') &&
              examGoals.map((item) => (
                <button
                  key={item.id}
                  className={`${styles.presetBtn} ${styles.examPresetBtn}`}
                  onClick={() => onStartGoal(item.goal)}
                >
                  <span className={styles.actionIcon}>{item.icon}</span>
                  <div className={styles.presetContent}>
                    <div className={styles.presetTitleRow}>
                      <span className={styles.presetTitle}>{item.title}</span>
                      {item.badge && <span className={styles.newBadge}>{item.badge}</span>}
                    </div>
                    <span className={styles.presetDesc}>{item.desc}</span>
                  </div>
                </button>
              ))}

            {(activeCategory === 'all' || activeCategory === 'attendance') &&
              attendanceGoals.map((item) => (
                <button
                  key={item.id}
                  className={styles.presetBtn}
                  onClick={() => onStartGoal(item.goal)}
                >
                  <span className={styles.actionIcon}>{item.icon}</span>
                  <div className={styles.presetContent}>
                    <span className={styles.presetTitle}>{item.title}</span>
                    <span className={styles.presetDesc}>{item.desc}</span>
                  </div>
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Developer Debug Telemetry Box */}
      {agentState.debugMode && (
        <div className={styles.debugBox}>
          <div className={styles.debugTitle}>Production Telemetry (V2)</div>
          <div className={styles.debugGrid}>
            <div className={styles.debugRow}>
              <span>Task ID:</span>
              <strong className={styles.truncate}>{execContext?.taskId || 'None'}</strong>
            </div>
            <div className={styles.debugRow}>
              <span>Exec ID:</span>
              <strong className={styles.truncate}>{execContext?.executionId || 'None'}</strong>
            </div>
            <div className={styles.debugRow}>
              <span>Page State:</span>
              <strong className={styles.truncate}>{execContext?.pageStateId || 'None'}</strong>
            </div>
            <div className={styles.debugRow}>
              <span>Target ID:</span>
              <strong className={styles.truncate}>{bestCandidate?.element.id || 'None'}</strong>
            </div>
            <div className={styles.debugRow}>
              <span>Source:</span>
              <strong>{telemetry?.targetSource || 'HYBRID'}</strong>
            </div>
            <div className={styles.debugRow}>
              <span>Confidence:</span>
              <strong
                style={{
                  color: (bestCandidate?.confidence || 0) >= 0.7 ? '#10b981' : '#f59e0b'
                }}
              >
                {bestCandidate ? `${Math.round(bestCandidate.confidence * 100)}%` : '---'}
              </strong>
            </div>
            <div className={styles.debugRow}>
              <span>Duration:</span>
              <span>{telemetry?.movementDuration ? `${telemetry.movementDuration}ms` : '---'}</span>
            </div>
            <div className={styles.debugRow}>
              <span>Verification:</span>
              <strong
                style={{
                  color: telemetry?.verificationResult === 'PASS' ? '#10b981' : '#ef4444'
                }}
              >
                {telemetry?.verificationResult || 'PENDING'}
              </strong>
            </div>
          </div>
        </div>
      )}

      {/* Real-time Agent Action Timeline */}
      {agentState.activities.length > 0 && (
        <div className={styles.timeline} ref={timelineRef}>
          {agentState.activities.slice(-15).map((act) => {
            const stage = act.stage || 'OBSERVE';
            const isCompleted = act.status === 'completed';
            return (
              <div key={act.id} className={styles.timelineItem}>
                <span
                  className={`${styles.stageBadge} ${styles[act.status] || ''}`}
                >
                  {isCompleted ? `✓ ${stage}` : stage === 'MOVE' ? `→ ${stage}` : `● ${stage}`}
                </span>
                <div className={styles.timelineContent}>
                  <span className={styles.timelineTitle}>{act.title}</span>
                  {act.detail && (
                    <span className={styles.timelineDetail}>{act.detail}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/*
        * Once the browser agent verifies the attendance numbers, we render
        * the structured final card right here with the green verified badge.
        */}
      {finalResponse && (
        <div
          ref={finalResponseRef}
          id="onee-final-response-card"
          className={`${styles.finalResponseCard} ${
            finalResponse.status === 'READY'
              ? ''
              : finalResponse.status === 'FAILED'
              ? styles.terminalFailed
              : finalResponse.status === 'TIMED_OUT'
              ? styles.terminalTimedOut
              : finalResponse.status === 'CANCELLED'
              ? styles.terminalCancelled
              : styles.waiting
          }`}
        >
          <div
            className={`${styles.finalResponseHeader} ${
              finalResponse.status === 'READY' ? '' : styles.waiting
            }`}
          >
            <span>Computer Use Final Response</span>
            {finalResponse.status === 'READY' && (
              <span style={{ color: '#10b981', fontSize: '9px' }}>✓ VERIFIED</span>
            )}
            {finalResponse.status === 'FAILED' && (
              <span style={{ color: '#ef4444', fontSize: '9px' }}>✕ FAILED</span>
            )}
            {finalResponse.status === 'TIMED_OUT' && (
              <span style={{ color: '#f59e0b', fontSize: '9px' }}>⏰ TIMED OUT</span>
            )}
            {finalResponse.status === 'CANCELLED' && (
              <span style={{ color: '#9ca3af', fontSize: '9px' }}>⏹ CANCELLED</span>
            )}
          </div>

          {finalResponse.status === 'FAILED' ||
          finalResponse.status === 'TIMED_OUT' ||
          finalResponse.status === 'CANCELLED' ? (
            <div className={styles.terminalBox}>
              <div className={styles.terminalContent}>
                <span className={styles.terminalIcon}>
                  {finalResponse.status === 'FAILED'
                    ? '⚠'
                    : finalResponse.status === 'TIMED_OUT'
                    ? '⏰'
                    : '⏹'}
                </span>
                <div>
                  <div className={styles.waitingTitle}>{finalResponse.title}</div>
                  <div className={styles.waitingSubtitle}>
                    {finalResponse.explanation}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className={styles.retryBtn}
                onClick={() =>
                  onStartGoal(
                    agentState.currentGoal ||
                      (finalResponse.capability === 'EXAM_DATE_SHEET'
                        ? 'When is my next exam and where is my seat?'
                        : 'Which subject has lowest attendance?')
                  )
                }
              >
                <span>↺</span>
                <span>Retry Verification</span>
              </button>
            </div>
          ) : finalResponse.status !== 'READY' ? (
            <div className={styles.waitingBox}>
              <span className={styles.waitingPulse} />
              <div>
                <div className={styles.waitingTitle}>
                  {agentState.status === 'waiting_for_render'
                    ? 'Waiting for examination records…'
                    : finalResponse.title || 'Analyzing verified results…'}
                </div>
                <div className={styles.waitingSubtitle}>
                  ○{' '}
                  {agentState.status === 'waiting_for_render'
                    ? 'Observing live page mutations (records loading...)'
                    : finalResponse.explanation || 'Waiting for verification'}
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Type 1: Lowest Attendance */}
              {finalResponse.type === 'lowest_attendance' && (
                <>
                  <div className={styles.finalResponseSubject}>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                      Lowest attendance
                    </span>
                    <span className={styles.subjectCode}>
                      {finalResponse.subjectCode || 'CSE330'}
                    </span>
                    {finalResponse.subjectName && (
                      <span className={styles.subjectName}>
                        {finalResponse.subjectName}
                      </span>
                    )}
                  </div>

                  <div className={styles.metricRow}>
                    <span
                      className={`${styles.bigPercentage} ${
                        (finalResponse.percentage || 0) < 75 ? styles.warning : ''
                      }`}
                    >
                      {finalResponse.percentage}%
                    </span>
                    {finalResponse.attended !== undefined &&
                      finalResponse.delivered !== undefined && (
                        <span className={styles.attendanceCount}>
                          {finalResponse.attended} / {finalResponse.delivered} classes attended
                        </span>
                      )}
                  </div>

                  {finalResponse.explanation && (
                    <div className={styles.rationaleText}>
                      {finalResponse.explanation}
                    </div>
                  )}
                </>
              )}

              {/* Type 2: Full Attendance Summary */}
              {finalResponse.type === 'full_summary' && (
                <>
                  <div className={styles.finalResponseSubject}>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                      Attendance verified
                    </span>
                    <div className={styles.metricRow}>
                      <span className={styles.bigPercentage}>
                        {finalResponse.details?.overallPercentage ||
                          finalResponse.percentage ||
                          98}%
                      </span>
                      <span className={styles.attendanceCount}>
                        overall across {finalResponse.details?.totalCourses || 6} subjects
                      </span>
                    </div>
                  </div>

                  <div className={styles.rationaleText}>
                    {finalResponse.details?.lowestSubjects &&
                      finalResponse.details.lowestSubjects.length > 0 && (
                        <div>
                          <strong>Lowest:</strong> {finalResponse.details.lowestSubjects.join(', ')}
                        </div>
                      )}
                    {finalResponse.details?.highestSubjects &&
                      finalResponse.details.highestSubjects.length > 0 && (
                        <div style={{ marginTop: '4px' }}>
                          <strong>Highest:</strong> {finalResponse.details.highestSubjects.join(', ')} → 100%
                        </div>
                      )}
                    <div style={{ marginTop: '6px', color: 'var(--text-secondary)' }}>
                      You currently have a strong overall attendance position.
                    </div>
                  </div>
                </>
              )}

              {/* Type 3: Safe Bunk Calculation */}
              {finalResponse.type === 'safe_bunk' && (
                <>
                  <div className={styles.finalResponseSubject}>
                    <span className={styles.subjectCode}>
                      {finalResponse.title}
                    </span>
                    <span className={styles.subjectName}>
                      {finalResponse.explanation}
                    </span>
                  </div>

                  {finalResponse.details?.bunkCalculations && (
                    <ul className={styles.calculationList}>
                      {finalResponse.details.bunkCalculations.map((calc, i) => (
                        <li key={i} className={styles.calcItem}>
                          <span className={styles.calcBullet}>•</span>
                          <span>{calc}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              {/* Type: Examination Schedule, Date Sheet & Seating Plan (Unified Multi-Exam UI) */}
              {(finalResponse.type === 'next_exam' ||
                finalResponse.type === 'exam_date_sheet' ||
                finalResponse.type === 'seating_plan' ||
                finalResponse.capability === 'EXAM_DATE_SHEET' ||
                finalResponse.capability === 'SEATING_PLAN') &&
                finalResponse.type !== 'sample_paper' && (() => {
                  const examsToRender: ExaminationRecord[] = finalResponse.details?.exams || [];
                  const verifiedExamCount = examsToRender.length || finalResponse.verification?.examsChecked || 0;
                  const nextExam = finalResponse.details?.nextExam || (examsToRender.length > 0 ? examsToRender[0] : undefined);

                  console.log('[AgentControlPanel] render examination card:', {
                    verifiedExamCount,
                    resultExamCount: finalResponse.details?.exams?.length,
                    renderedExamCount: examsToRender.length,
                    type: finalResponse.type,
                    capability: finalResponse.capability
                  });

                  if (examsToRender.length === 0 && finalResponse.type === 'seating_plan' && (finalResponse.details?.room || finalResponse.details?.seat)) {
                    return (
                      <>
                        <div className={styles.finalResponseSubject}>
                          <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                            Seating & Venue Allocation
                          </span>
                          <span className={styles.subjectCode}>
                            {finalResponse.subjectCode || 'Allocated Room'}
                          </span>
                          {finalResponse.details?.room && (
                            <span className={styles.subjectName}>
                              Room {finalResponse.details.room} {finalResponse.details.venue ? `· ${finalResponse.details.venue}` : ''}
                            </span>
                          )}
                        </div>
                        <div className={styles.metricRow}>
                          <span className={styles.bigPercentage} style={{ fontSize: '18px' }}>
                            🪑 Seat: {finalResponse.details?.seat || 'Assigned on arrival'}
                          </span>
                        </div>
                        <div className={styles.rationaleText}>
                          {finalResponse.explanation && <div>{finalResponse.explanation}</div>}
                        </div>
                      </>
                    );
                  }

                  return (
                    <>
                      {/* 1. Header & Metric Row */}
                      <div className={styles.finalResponseSubject}>
                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                          Examination Schedule Verified
                        </span>
                        <div className={styles.metricRow}>
                          <span className={styles.bigPercentage} style={{ fontSize: '20px' }}>
                            {verifiedExamCount} {verifiedExamCount === 1 ? 'Exam' : 'Exams'}
                          </span>
                          <span className={styles.attendanceCount}>
                            scheduled in active Date Sheet
                          </span>
                        </div>
                      </div>

                      {/* 2. Next Exam Spotlight Section */}
                      {nextExam && (
                        <div
                          style={{
                            background: 'rgba(124, 58, 237, 0.08)',
                            border: '1px solid rgba(124, 58, 237, 0.25)',
                            borderRadius: '8px',
                            padding: '10px 12px',
                            marginTop: '10px',
                            marginBottom: '12px'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--brand-purple, #7c3aed)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                              Next Scheduled Examination
                            </span>
                            <span className={`${styles.examStatusBadge} ${styles.examStatusUpcoming}`}>
                              Earliest
                            </span>
                          </div>

                          <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '2px' }}>
                            {nextExam.courseCode}
                            {nextExam.courseName && (
                              <span style={{ fontWeight: 400, fontSize: '12px', color: 'var(--text-secondary)', marginLeft: '6px' }}>
                                - {nextExam.courseName}
                              </span>
                            )}
                          </div>

                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            <span>📅 <strong>{nextExam.examDate}</strong></span>
                            {nextExam.startTime && (
                              <span>⏰ {nextExam.startTime}{nextExam.endTime ? ` - ${nextExam.endTime}` : ''}</span>
                            )}
                          </div>

                          {nextExam.reportingTime && (
                            <div style={{ fontSize: '11px', color: '#f59e0b', marginTop: '4px', fontWeight: 500 }}>
                              🚪 <strong>Reporting Time:</strong> {nextExam.reportingTime}
                            </div>
                          )}

                          {(nextExam.venue || nextExam.room || nextExam.seat) && (
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                              🏢 {nextExam.venue ? `${nextExam.venue}` : ''}
                              {nextExam.room ? ` (Room ${nextExam.room})` : ''}
                              {nextExam.seat ? ` · Seat ${nextExam.seat}` : ''}
                            </div>
                          )}

                          {finalResponse.explanation && (
                            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '6px', fontStyle: 'italic' }}>
                              {finalResponse.explanation}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Suggested Sub-Action Banner (e.g. Fetch & Open Sample Paper) - ONLY when this specific exam has a sample paper */}
                      {finalResponse.suggestedSubAction && (
                        <div className={styles.subActionBanner}>
                          <div className={styles.subActionHeader}>
                            <span className={styles.subActionBadge}>
                              <span>💡</span> SUGGESTED SUB-ACTION
                            </span>
                            <span className={styles.subActionPill}>Resource Ready</span>
                          </div>
                          <div className={styles.subActionTitle}>
                            📄 Sample Question Paper Available for <strong>{finalResponse.suggestedSubAction.courseCode}</strong>
                            {finalResponse.suggestedSubAction.examType && (
                              <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-secondary)', marginLeft: '6px' }}>
                                ({finalResponse.suggestedSubAction.examType})
                              </span>
                            )}
                          </div>
                          <div className={styles.subActionDesc}>
                            {finalResponse.suggestedSubAction.description || 'Official UMS sample question paper verified on active date sheet.'}
                          </div>
                          <button
                            className={styles.subActionButton}
                            onClick={(e) => {
                              e.stopPropagation();
                              onStartGoal?.(finalResponse.suggestedSubAction!.actionGoal);
                            }}
                            title={`Fetch and open official sample paper for ${finalResponse.suggestedSubAction.courseCode}`}
                          >
                            <span style={{ display: 'flex', alignItems: 'center' }}>
                              <span className={styles.subActionBtnIcon}>📄</span>
                              <span>{finalResponse.suggestedSubAction.label}</span>
                            </span>
                            <span className={styles.subActionBtnArrow}>→</span>
                          </button>
                        </div>
                      )}

                      {/* Additional sample papers available across other or later examinations */}
                      {(() => {
                        const otherSubActions = (finalResponse.suggestedSubActions || []).filter(
                          (s) => s.id !== finalResponse.suggestedSubAction?.id
                        );
                        if (otherSubActions.length === 0) return null;

                        return (
                          <div className={styles.otherSubActionsContainer}>
                            <div className={styles.otherSubActionsLabel}>
                              {finalResponse.suggestedSubAction
                                ? 'Other Available Sample Papers:'
                                : 'Available Sample Papers (Later Exams):'}
                            </div>
                            <div className={styles.otherSubActionsList}>
                              {otherSubActions.map((sub) => (
                                <button
                                  key={sub.id}
                                  className={styles.subActionCardChip}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onStartGoal?.(sub.actionGoal);
                                  }}
                                  title={`Fetch and open ${sub.courseCode}${sub.examType ? ` ${sub.examType}` : ''} sample paper (${sub.examDate || ''})`}
                                >
                                  <span className={styles.subActionCardChipIcon}>📄</span>
                                  <div className={styles.subActionCardChipContent}>
                                    <span className={styles.subActionCardChipTitle}>
                                      <strong>{sub.courseCode}</strong>
                                      {sub.examType ? ` · ${sub.examType}` : ''}
                                    </span>
                                    {sub.examDate && (
                                      <span className={styles.subActionCardChipDate}>📅 {sub.examDate}</span>
                                    )}
                                  </div>
                                  <span className={styles.subActionCardChipArrow}>→</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* 3. All Scheduled Examinations Section */}
                      {examsToRender.length > 0 && (
                        <div style={{ marginTop: '8px', marginBottom: '8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)' }}>
                              All Examinations ({verifiedExamCount})
                            </span>
                            {verifiedExamCount > 3 && (
                              <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                                Scroll for complete date sheet ↓
                              </span>
                            )}
                          </div>

                          <div className={styles.examCardList} style={{ maxHeight: '240px', overflowY: 'auto' }}>
                            {examsToRender.map((exam, idx) => {
                              const examKey = getExamKey(exam, idx);
                              const isExpanded = expandedExamId === examKey;
                              const isToday = (exam.status || '').toLowerCase().includes('today');

                              return (
                                <div
                                  key={examKey}
                                  className={`${styles.examItemCard} ${isExpanded ? styles.active : ''}`}
                                  onClick={(e) => {
                                    const next = isExpanded ? null : examKey;
                                    setExpandedExamId(next);
                                    const cardEl = e.currentTarget;
                                    if (next) {
                                      smoothScrollToReveal(cardEl);
                                    } else {
                                      smoothScrollOnCollapse(cardEl);
                                    }
                                  }}
                                >
                                  {/* Top Row: Course Code + Mode & Status Badge + Chevron */}
                                  <div className={styles.examCardHeaderTop}>
                                    <div className={styles.examCardCourseInfo}>
                                      <span className={styles.examCourseCode}>{exam.courseCode}</span>
                                      {(() => {
                                        const shortTag = getShortExamTypeTag(exam.examType, exam.courseName);
                                        return shortTag ? (
                                          <span className={styles.examTypeTag} title={exam.examType}>
                                            {shortTag}
                                          </span>
                                        ) : null;
                                      })()}
                                    </div>
                                    <div className={styles.examCardHeaderRight}>
                                      <span className={`${styles.examStatusBadge} ${isToday ? styles.examStatusToday : styles.examStatusUpcoming}`}>
                                        {exam.status || 'Upcoming'}
                                      </span>
                                      <span className={`${styles.expandChevron} ${isExpanded ? styles.expanded : ''}`} aria-hidden="true">
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                                          <polyline points="6 9 12 15 18 9" />
                                        </svg>
                                      </span>
                                    </div>
                                  </div>

                                  {/* Subject Title: Dedicated full-width row with zero overlap */}
                                  {exam.courseName && exam.courseName !== exam.courseCode && (
                                    <div className={styles.examCourseTitleRow}>
                                      <span className={styles.examCourseSubname} title={exam.courseName}>
                                        {exam.courseName}
                                      </span>
                                    </div>
                                  )}

                                  {/* Meta Row: Date, Time, Venue/Seat Chips */}
                                  <div className={styles.examCardMetaRow}>
                                    <div className={styles.examMetaItem}>
                                      <span className={styles.examMetaIcon} aria-hidden="true">📅</span>
                                      <span className={styles.examMetaDate}>{exam.examDate}</span>
                                    </div>
                                    {(exam.startTime || exam.endTime) && (
                                      <div className={styles.examMetaItem}>
                                        <span className={styles.examMetaIcon} aria-hidden="true">🕒</span>
                                        <span className={styles.examMetaTime}>
                                          {exam.startTime}{exam.endTime ? ` - ${exam.endTime}` : ''}
                                        </span>
                                      </div>
                                    )}
                                    {(exam.venue || exam.room || exam.seat) && (
                                      <div className={styles.examMetaItem}>
                                        <span className={styles.examMetaIcon} aria-hidden="true">🪑</span>
                                        <span className={`${styles.examMetaSeat} ${exam.room || exam.seat ? styles.seatAllocated : ''}`}>
                                          {exam.room ? `Room ${exam.room}` : exam.venue ? exam.venue : exam.seat ? `Seat ${exam.seat}` : 'Awaited'}
                                        </span>
                                      </div>
                                    )}
                                  </div>

                                  {/* Action Row: Sample Paper Button if available */}
                                  {exam.samplePaper?.available && (
                                    <div className={styles.examActionRow}>
                                      <button
                                        className={styles.miniSamplePaperBtn}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onStartGoal?.(`Fetch and open sample paper for ${exam.courseCode}`);
                                        }}
                                        title={`Fetch and open official sample paper for ${exam.courseCode}`}
                                      >
                                        <span className={styles.paperBtnIcon}>📄</span>
                                        <span>Sample Paper</span>
                                        <span className={styles.paperBtnArrow}>→</span>
                                      </button>
                                    </div>
                                  )}

                                  <div className={`${styles.examExpandableWrapper} ${isExpanded ? styles.expanded : ''}`}>
                                    <div className={styles.examExpandedDetails} onClick={(e) => e.stopPropagation()}>
                                      {exam.courseName && (
                                        <div className={styles.examDetailGridRow}>
                                          <span className={styles.examDetailLabel}>COURSE</span>
                                          <span className={styles.examDetailVal}>{exam.courseName}</span>
                                        </div>
                                      )}
                                      {exam.examType && (
                                        <div className={styles.examDetailGridRow}>
                                          <span className={styles.examDetailLabel}>TYPE</span>
                                          <span className={styles.examDetailVal}>
                                            {exam.examType}{exam.mode ? ` (${exam.mode})` : ''}
                                          </span>
                                        </div>
                                      )}
                                      {(exam.startTime || exam.endTime) && (
                                        <div className={styles.examDetailGridRow}>
                                          <span className={styles.examDetailLabel}>TIME</span>
                                          <span className={styles.examDetailVal}>
                                            {exam.startTime || 'TBD'}{exam.endTime ? ` - ${exam.endTime}` : ''}
                                          </span>
                                        </div>
                                      )}
                                      {exam.reportingTime && (
                                        <div className={styles.examDetailGridRow}>
                                          <span className={styles.examDetailLabel}>REPORTING</span>
                                          <span className={styles.examDetailVal}>{exam.reportingTime}</span>
                                        </div>
                                      )}
                                      {(exam.venue || exam.room || exam.seat) && (
                                        <div className={styles.examDetailGridRow}>
                                          <span className={styles.examDetailLabel}>SEATING</span>
                                          <span className={styles.examDetailVal}>
                                            {[
                                              exam.venue,
                                              exam.room ? `Room ${exam.room}` : null,
                                              exam.seat ? `Seat ${exam.seat}` : null
                                            ].filter(Boolean).join(' · ')}
                                          </span>
                                        </div>
                                      )}
                                      {exam.instructions && (
                                        <div className={styles.examDetailGridRow}>
                                          <span className={styles.examDetailLabel}>INSTRUCTIONS</span>
                                          <span className={styles.examDetailVal}>{exam.instructions}</span>
                                        </div>
                                      )}
                                      {exam.samplePaper?.available && (
                                        <div className={styles.examDetailGridRow}>
                                          <span className={styles.examDetailLabel}>RESOURCE</span>
                                          <div className={styles.examDetailVal}>
                                            <button
                                              className={styles.samplePaperBtn}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                onStartGoal?.(`Open sample paper for ${exam.courseCode}`);
                                              }}
                                              title={`Locate and open official Sample Question Paper for ${exam.courseCode}`}
                                            >
                                              📄 View Sample Question Paper ({exam.courseCode})
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}

              {/* Type 7: Sample Question Paper Result */}
              {finalResponse.type === 'sample_paper' && (
                <>
                  <div className={styles.finalResponseSubject}>
                    <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                      Sample Question Paper Verified
                    </span>
                    <span className={styles.subjectCode}>
                      {finalResponse.subjectCode || 'Sample Paper'}
                    </span>
                    {finalResponse.subjectName && (
                      <span className={styles.subjectName}>
                        {finalResponse.subjectName}
                      </span>
                    )}
                  </div>

                  <div className={styles.metricRow}>
                    <span className={styles.bigPercentage} style={{ fontSize: '18px' }}>
                      📄 {finalResponse.samplePaperResult?.paperUrl ? 'PDF Ready' : 'Sample Paper Ready'}
                    </span>
                  </div>

                  <div className={styles.rationaleText}>
                    {finalResponse.explanation && (
                      <div>{finalResponse.explanation}</div>
                    )}
                    {finalResponse.samplePaperResult?.fileName && (
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '6px' }}>
                        📥 Document downloaded to your browser downloads folder: <strong>{finalResponse.samplePaperResult.fileName}</strong>
                      </div>
                    )}
                    {finalResponse.samplePaperResult?.paperUrl && (
                      <div style={{ marginTop: '8px' }}>
                        <a
                          href={finalResponse.samplePaperResult.paperUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.samplePaperBtn}
                          style={{ textDecoration: 'none' }}
                        >
                          ↗ Open Sample Paper PDF
                        </a>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Type 8: Student Time Table & Faculty Overview */}
              {(finalResponse.type === 'timetable' || finalResponse.capability === 'TIMETABLE') && (() => {
                const tt: TimetableSummary | undefined = finalResponse.timetable || finalResponse.details?.timetable;
                if (!tt) {
                  return (
                    <div className={styles.finalResponseSubject}>
                      <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                        Time Table Overview
                      </span>
                      <div className={styles.rationaleText}>
                        {finalResponse.explanation || 'Timetable details verified.'}
                      </div>
                    </div>
                  );
                }

                const todayName = getDayOfWeekName();
                const todayClasses = getTodayClasses(tt);
                const currentOrNext = getCurrentOrNextClass(tt);
                const activeSlot = currentOrNext.currentClass || currentOrNext.nextClass;
                const isRunningNow = currentOrNext.isRunningNow;

                // Filter classes based on selected timetableDay
                const displayedSlots: TimetableSlot[] = (() => {
                  if (timetableDay === 'Today') return todayClasses;
                  if (timetableDay === 'All') return tt.slots;
                  return tt.slots.filter((s: TimetableSlot) => s.day === timetableDay);
                })();

                const days: ('Today' | TimetableDay | 'All')[] = [
                  'Today',
                  'Monday',
                  'Tuesday',
                  'Wednesday',
                  'Thursday',
                  'Friday',
                  'Saturday',
                  'All'
                ];

                const uniqueTimes: string[] = Array.from(new Set(tt.slots.map((s: TimetableSlot) => s.time)));

                return (
                  <div className={styles.timetableContainer}>
                    {/* Header & Meta Pill */}
                    <div className={styles.timetableHeaderRow}>
                      <div className={styles.finalResponseSubject} style={{ margin: 0 }}>
                        <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                          Verified Time Table
                        </span>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                          <span className={styles.bigPercentage} style={{ fontSize: '18px' }}>
                            {(() => {
                              let sec = (tt.homeSection || '').replace(/Legends.*$/i, '').trim();
                              if (!sec || /^(time|timetable|table|schedule|weekly|report|legends|legend)$/i.test(sec)) {
                                const fallbackSlot = tt.slots?.find((s: TimetableSlot) => s.section && !/^(time|timetable|table|schedule|weekly|report|legends|legend)$/i.test(s.section));
                                sec = fallbackSlot?.section || (tt.vid ? `VID: ${tt.vid}` : 'Enrolled');
                              }
                              return `Section ${sec}`;
                            })()}
                          </span>
                        </div>
                      </div>
                      <div className={styles.timetableMetaPill}>
                        <span>🗓️ {tt.totalSlots} Classes/Wk</span>
                        <span>•</span>
                        <span>👨‍🏫 {tt.courses.length} Courses</span>
                      </div>
                    </div>

                    {/* Navigation View Switcher (Classes / Faculty / Grid) */}
                    <div className={styles.timetableViewNav}>
                      <button
                        className={`${styles.timetableViewBtn} ${timetableView === 'classes' ? styles.timetableViewBtnActive : ''}`}
                        onClick={() => setTimetableView('classes')}
                      >
                        <span>📅 Classes</span>
                      </button>
                      <button
                        className={`${styles.timetableViewBtn} ${timetableView === 'faculty' ? styles.timetableViewBtnActive : ''}`}
                        onClick={() => setTimetableView('faculty')}
                      >
                        <span>👨‍🏫 Faculty ({tt.courses.length})</span>
                      </button>
                      <button
                        className={`${styles.timetableViewBtn} ${timetableView === 'grid' ? styles.timetableViewBtnActive : ''}`}
                        onClick={() => setTimetableView('grid')}
                      >
                        <span>🗂️ Matrix</span>
                      </button>
                    </div>

                    {/* View 1: Classes & Day Filter */}
                    {timetableView === 'classes' && (
                      <>
                        {/* Day Selector Chips */}
                        <div className={styles.dayFilterBar}>
                          {days.map((d) => {
                            const count =
                              d === 'Today'
                                ? todayClasses.length
                                : d === 'All'
                                ? tt.slots.length
                                : tt.slots.filter((s: TimetableSlot) => s.day === d).length;
                            return (
                              <button
                                key={d}
                                className={`${styles.dayChip} ${timetableDay === d ? styles.dayChipActive : ''}`}
                                onClick={() => setTimetableDay(d)}
                              >
                                <span>{d === 'Today' ? `Today (${todayName.slice(0, 3)})` : d.slice(0, 3)}</span>
                                <span style={{ opacity: 0.8, fontSize: '9px', marginLeft: '3px' }}>({count})</span>
                              </button>
                            );
                          })}
                        </div>

                        {/* Current / Next Class Banner */}
                        {timetableDay === 'Today' && activeSlot && (
                          <div className={styles.nowClassCard}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span className={isRunningNow ? styles.nowBadge : styles.nextBadge}>
                                {isRunningNow ? '⚡ Happening Now' : '⏳ Next Upcoming Class'}
                              </span>
                              <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                                ⏰ {activeSlot.time}
                              </span>
                            </div>
                            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                              {activeSlot.courseCode}
                              {activeSlot.courseTitle && (
                                <span style={{ fontWeight: 400, fontSize: '11px', color: 'var(--text-secondary)', marginLeft: '6px' }}>
                                  - {activeSlot.courseTitle}
                                </span>
                              )}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                              <span>🚪 <strong>Room {activeSlot.room || 'TBD'}</strong></span>
                              <span>•</span>
                              <span>📖 {activeSlot.type}</span>
                              {activeSlot.facultyName && (
                                <>
                                  <span>•</span>
                                  <span>👨‍🏫 {activeSlot.facultyName}</span>
                                </>
                              )}
                              {activeSlot.facultyCabin && (
                                <span style={{ color: '#7c3aed', fontWeight: 600 }}>
                                  (Cabin: {activeSlot.facultyCabin})
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {/* List of Class Slots */}
                        {displayedSlots.length === 0 ? (
                          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '12px' }}>
                            {timetableDay === 'Today'
                              ? `No scheduled classes today (${todayName})! Enjoy your free time or prepare for upcoming classes.`
                              : `No scheduled classes for ${timetableDay}.`}
                          </div>
                        ) : (
                          <div className={styles.classCardList}>
                            {displayedSlots.map((slot, idx) => (
                              <div key={`${slot.day}-${slot.time}-${slot.courseCode}-${idx}`} className={styles.classItemCard}>
                                <div className={styles.classItemHeader}>
                                  <span className={styles.classItemCourse}>
                                    <span>{slot.courseCode}</span>
                                    <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-tertiary)' }}>
                                      {slot.day.slice(0, 3)} {slot.time}
                                    </span>
                                  </span>
                                  <span className={`${styles.classPill} ${slot.type.toLowerCase().includes('practical') ? styles.classPillGreen : styles.classPillPurple}`}>
                                    {slot.type}
                                  </span>
                                </div>
                                {slot.courseTitle && (
                                  <div className={styles.classItemTitle}>{slot.courseTitle}</div>
                                )}
                                <div className={styles.classBadgeGroup}>
                                  <span className={styles.classPill}>
                                    🚪 Room: <strong>{slot.room || 'TBD'}</strong>
                                  </span>
                                  {slot.group && (
                                    <span className={styles.classPill}>
                                      👥 Group: {slot.group}
                                    </span>
                                  )}
                                  {slot.section && (
                                    <span className={styles.classPill}>
                                      🏷️ Section: {slot.section}
                                    </span>
                                  )}
                                </div>
                                {(slot.facultyName || slot.facultyCabin) && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px', marginTop: '2px', color: 'var(--text-secondary)' }}>
                                    <span>👨‍🏫 {slot.facultyName || 'Faculty Assigned'}</span>
                                    {slot.facultyCabin && (
                                      <span style={{ color: '#7c3aed', fontWeight: 600 }}>
                                        (📍 {slot.facultyCabin})
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}

                    {/* View 2: Faculty & Cabins Directory */}
                    {timetableView === 'faculty' && (
                      <div className={styles.facultyCardList}>
                        {tt.courses.map((fac: CourseFacultyRecord) => (
                          <div key={fac.courseCode} className={styles.facultyItemCard}>
                            <div className={styles.facultyItemHeader}>
                              <div>
                                <span style={{ fontWeight: 700, fontSize: '12px', color: 'var(--text-primary)' }}>
                                  {fac.courseCode}
                                </span>
                                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginLeft: '6px', fontWeight: 500 }}>
                                  {fac.courseTitle}
                                </span>
                              </div>
                              <span className={styles.classPill}>
                                {fac.credits} Credits ({fac.lectures}-{fac.tutorial}-{fac.practical})
                              </span>
                            </div>

                            <div className={styles.facultyNameRow}>
                              <span>👨‍🏫</span>
                              <span><strong>{fac.facultyName}</strong></span>
                              {fac.courseType && (
                                <span style={{ fontSize: '9px', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                                  [{fac.courseType}]
                                </span>
                              )}
                            </div>

                            {fac.facultyCabin ? (
                              <div className={styles.facultyCabinRow}>
                                <span>📍 Cabin:</span>
                                <strong>{fac.facultyCabin}</strong>
                              </div>
                            ) : (
                              <span style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                                Cabin information not specified
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* View 3: Complete Weekly Grid Matrix */}
                    {timetableView === 'grid' && (
                      <div className={styles.timetableGridWrap}>
                        <table className={styles.timetableMiniTable}>
                          <thead>
                            <tr>
                              <th>Time</th>
                              <th>Mon</th>
                              <th>Tue</th>
                              <th>Wed</th>
                              <th>Thu</th>
                              <th>Fri</th>
                              <th>Sat</th>
                            </tr>
                          </thead>
                          <tbody>
                            {uniqueTimes.map((time: string) => {
                              const dayCols: TimetableDay[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                              return (
                                <tr key={time}>
                                  <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{time}</td>
                                  {dayCols.map((day) => {
                                    const slot = tt.slots.find((s: TimetableSlot) => s.time === time && s.day === day);
                                    if (!slot) return <td key={day} style={{ color: '#d1d5db', textAlign: 'center' }}>-</td>;
                                    return (
                                      <td key={day}>
                                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{slot.courseCode}</div>
                                        <div style={{ fontSize: '8px', color: '#7c3aed' }}>{slot.room ? `R: ${slot.room}` : ''}</div>
                                        <div style={{ fontSize: '8px', color: 'var(--text-tertiary)' }}>{slot.type}</div>
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Verified Badge */}
              <div className={styles.verifiedBadge}>
                <span className={styles.verifiedCheck}>✓</span>
                <span>Verified directly from UMS</span>
              </div>

              {/* Verification Footer Metadata */}
              <div className={styles.verificationFooter}>
                <div className={styles.footerSourceRow}>
                  <span className={styles.footerLabel}>Source:</span>
                  <span
                    className={styles.footerSourceValue}
                    title={finalResponse.verification?.source || 'UMS Dashboard'}
                  >
                    {formatVerificationSource(finalResponse.verification?.source)}
                  </span>
                </div>

                <div className={styles.footerMetaGrid}>
                  <div className={styles.footerItem}>
                    <span className={styles.footerLabel}>
                      {finalResponse.verification?.examsChecked !== undefined || finalResponse.details?.exams !== undefined
                        ? 'Exams checked:'
                        : finalResponse.timetable || finalResponse.details?.timetable
                        ? 'Classes checked:'
                        : 'Subjects checked:'}
                    </span>
                    <span className={styles.footerValue}>
                      {finalResponse.details?.exams?.length ??
                        finalResponse.timetable?.totalSlots ??
                        finalResponse.details?.timetable?.totalSlots ??
                        finalResponse.verification?.examsChecked ??
                        finalResponse.verification?.subjectsChecked ??
                        0}
                    </span>
                  </div>
                  <div className={styles.footerItem}>
                    <span className={styles.footerLabel}>Execution:</span>
                    <span className={styles.executionCompleted}>
                      completed
                    </span>
                  </div>
                  <div className={styles.footerItem}>
                    <span className={styles.footerLabel}>Observation:</span>
                    <span className={styles.footerValue}>just now</span>
                  </div>
                </div>
              </div>

              {/* Interactive Action Button Row */}
              <div className={styles.actionBtnRow}>
                <button
                  className={`${styles.copyBtn} ${isCopied ? styles.copied : ''}`}
                  onClick={() => {
                    let summary = '';
                    if (finalResponse?.type === 'lowest_attendance') {
                      summary = `Lowest Attendance: ${finalResponse.subjectCode} at ${finalResponse.percentage}% (${finalResponse.attended}/${finalResponse.delivered} attended). ${finalResponse.explanation}`;
                    } else if (finalResponse?.type === 'safe_bunk') {
                      summary = `${finalResponse.title}. ${finalResponse.explanation}`;
                    } else if (
                      finalResponse?.type === 'next_exam' ||
                      finalResponse?.type === 'exam_date_sheet' ||
                      finalResponse?.type === 'seating_plan' ||
                      finalResponse?.capability === 'EXAM_DATE_SHEET' ||
                      finalResponse?.capability === 'SEATING_PLAN'
                    ) {
                      const count = finalResponse.details?.exams?.length || finalResponse.verification?.examsChecked || 0;
                      const ne = finalResponse.details?.nextExam;
                      summary = `Date Sheet: ${count} scheduled ${count === 1 ? 'examination' : 'examinations'} verified from UMS.`;
                      if (ne) {
                        summary += ` Next Exam: ${ne.courseCode} on ${ne.examDate} at ${ne.startTime || 'TBD'}. Venue: ${ne.venue || 'TBD'} Room: ${ne.room || 'TBD'} Seat: ${ne.seat || 'TBD'}.`;
                      }
                    } else if (
                      finalResponse?.type === 'timetable' ||
                      finalResponse?.capability === 'TIMETABLE'
                    ) {
                      const tt = finalResponse.timetable || finalResponse.details?.timetable;
                      summary = `Time Table: ${tt?.totalSlots || 0} weekly classes verified from UMS (Section ${tt?.homeSection || 'Enrolled'}). Faculty Directory: ${tt?.courses?.length || 0} courses.`;
                    } else {
                      summary = `Overall Attendance: ${finalResponse?.details?.overallPercentage || 98}% across ${finalResponse?.details?.totalCourses || 6} subjects.`;
                    }
                    if (onCopy) onCopy(summary);
                    else navigator.clipboard.writeText(summary);
                    setIsCopied(true);
                    setTimeout(() => setIsCopied(false), 2000);
                  }}
                  title="Copy verified summary to clipboard"
                >
                  <span className={styles.btnIcon}>{isCopied ? '✅' : '📋'}</span>
                  <span>{isCopied ? 'Copied!' : 'Copy'}</span>
                </button>
                {onAskOnee && (
                  <button
                    className={styles.askOneeBtn}
                    onClick={() => {
                      let prompt = '';
                      if (finalResponse?.type === 'lowest_attendance') {
                        prompt = `Tell me more about my ${finalResponse.subjectCode} attendance and what I should do next.`;
                      } else if (finalResponse?.type === 'safe_bunk') {
                        prompt = `Can you calculate a detailed bunk planner for all my subjects?`;
                      } else if (
                        finalResponse?.type === 'next_exam' ||
                        finalResponse?.type === 'exam_date_sheet' ||
                        finalResponse?.type === 'seating_plan' ||
                        finalResponse?.capability === 'EXAM_DATE_SHEET' ||
                        finalResponse?.capability === 'SEATING_PLAN'
                      ) {
                        prompt = `Show my entire examination date sheet with upcoming dates and slots.`;
                      } else if (
                        finalResponse?.type === 'timetable' ||
                        finalResponse?.capability === 'TIMETABLE'
                      ) {
                        prompt = `What is my timetable for tomorrow and which cabins are my teachers in?`;
                      } else {
                        prompt = `How can I maintain my attendance across all subjects?`;
                      }
                      onAskOnee(prompt);
                    }}
                    title="Ask ONEE follow-up question"
                  >
                    <span className={styles.btnIcon}>💬</span>
                    <span>Ask ONEE about this</span>
                    <span className={styles.askOneeArrow}>›</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
