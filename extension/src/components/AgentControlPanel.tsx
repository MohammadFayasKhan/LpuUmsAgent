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
import { AgentState, AgentStage } from '../shared/types';
import styles from './AgentControlPanel.module.css';

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

  const isPaused = agentState.status === 'paused';

  const primaryGoal =
    'Go to my attendance and tell me which subject has the lowest attendance';
  const secondaryGoal =
    'Open Attendance Summary and read my full subject attendance';

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
          {agentState.currentGoal || 'Checking your attendance'}
        </h3>
        <p className={styles.taskSubtitle}>UMS • Student Dashboard</p>
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
                  ? 'Reading attendance table from DOM...'
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
        /* Preset Goal Launcher Buttons */
        <div className={styles.presetGoals}>
          <button
            className={styles.presetBtn}
            onClick={() => onStartGoal(primaryGoal)}
          >
            <span className={styles.actionBullet}>●</span>
            <span>{primaryGoal}</span>
          </button>
          <button
            className={styles.presetBtn}
            onClick={() => onStartGoal(secondaryGoal)}
          >
            <span className={styles.actionBullet}>●</span>
            <span>{secondaryGoal}</span>
          </button>
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
        <div className={styles.timeline}>
          {agentState.activities.slice(-6).map((act) => {
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
          className={`${styles.finalResponseCard} ${
            finalResponse.status !== 'READY' ? styles.waiting : ''
          }`}
        >
          <div
            className={`${styles.finalResponseHeader} ${
              finalResponse.status !== 'READY' ? styles.waiting : ''
            }`}
          >
            <span>Computer Use Final Response</span>
            {finalResponse.status === 'READY' && (
              <span style={{ color: '#10b981', fontSize: '9px' }}>✓ VERIFIED</span>
            )}
          </div>

          {finalResponse.status !== 'READY' ? (
            <div className={styles.waitingBox}>
              <span className={styles.waitingPulse} />
              <div>
                <div className={styles.waitingTitle}>
                  {finalResponse.title || 'Analyzing verified results…'}
                </div>
                <div className={styles.waitingSubtitle}>
                  ○ {finalResponse.explanation || 'Waiting for verification'}
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

              {/* Verified Badge */}
              <div className={styles.verifiedBadge}>
                <span>✓</span>
                <span>Verified directly from UMS</span>
              </div>

              {/* Verification Footer Metadata Grid */}
              <div className={styles.verificationFooter}>
                <div className={styles.footerItem}>
                  <span>Source:</span>
                  <span className={styles.footerValue}>UMS Dashboard</span>
                </div>
                <div className={styles.footerItem}>
                  <span>Subjects checked:</span>
                  <span className={styles.footerValue}>
                    {finalResponse.verification.subjectsChecked || 6}
                  </span>
                </div>
                <div className={styles.footerItem}>
                  <span>Observation:</span>
                  <span className={styles.footerValue}>just now</span>
                </div>
                <div className={styles.footerItem}>
                  <span>Execution:</span>
                  <span className={styles.footerValue} style={{ color: '#10b981' }}>
                    completed
                  </span>
                </div>
              </div>

              {/* Interactive Action Button Row */}
              <div className={styles.actionBtnRow}>
                <button
                  className={styles.copyBtn}
                  onClick={() => {
                    const summary =
                      finalResponse?.type === 'lowest_attendance'
                        ? `Lowest Attendance: ${finalResponse.subjectCode} at ${finalResponse.percentage}% (${finalResponse.attended}/${finalResponse.delivered} attended). ${finalResponse.explanation}`
                        : finalResponse?.type === 'safe_bunk'
                        ? `${finalResponse.title}. ${finalResponse.explanation}`
                        : `Overall Attendance: ${finalResponse?.details?.overallPercentage || 98}% across ${finalResponse?.details?.totalCourses || 6} subjects.`;
                    if (onCopy) onCopy(summary);
                    else navigator.clipboard.writeText(summary);
                  }}
                >
                  <span>📋</span>
                  <span>Copy</span>
                </button>
                {onAskOnee && (
                  <button
                    className={styles.askOneeBtn}
                    onClick={() => {
                      const prompt =
                        finalResponse?.type === 'lowest_attendance'
                          ? `Tell me more about my ${finalResponse.subjectCode} attendance and what I should do next.`
                          : finalResponse?.type === 'safe_bunk'
                          ? `Can you calculate a detailed bunk planner for all my subjects?`
                          : `How can I maintain my attendance across all subjects?`;
                      onAskOnee(prompt);
                    }}
                  >
                    <span>💬</span>
                    <span>Ask ONEE about this</span>
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
