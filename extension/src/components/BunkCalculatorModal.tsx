/*
 * Interactive Bunk / Recovery Calculator Modal for ONEE.
 *
 * Students tap a course row in the attendance list to open this modal.
 * It shows two things depending on where they stand:
 *
 * 1. If attendance >= target (default 75%):
 *    "You can safely skip X more classes."
 *    The formula: floor((attended - target * total) / target)
 *
 * 2. If attendance < target:
 *    "You need to attend Y consecutive classes to recover."
 *    The formula: ceil((target * total - attended) / (1 - target))
 *
 * The student can also drag a slider to try different target thresholds
 * (e.g. 80%, 85%) and see how the numbers change in real time.
 *
 * All math is deterministic via attendanceCalculator.ts. The LLM is never
 * involved in these calculations.
 */

import React, { useState } from 'react';
import { AttendanceRecord, AttendanceSummary } from '../shared/types';
import {
  calculateBunkAllowance,
  calculateRequiredClasses
} from '../shared/attendanceCalculator';
import styles from './BunkCalculatorModal.module.css';

interface BunkCalculatorModalProps {
  course?: AttendanceRecord | null;
  overall?: AttendanceSummary | null;
  onClose: () => void;
}

export const BunkCalculatorModal: React.FC<BunkCalculatorModalProps> = ({
  course,
  overall,
  onClose
}) => {
  const [targetPct, setTargetPct] = useState<number>(75);
  const [simAttend, setSimAttend] = useState<number>(0);
  const [simBunk, setSimBunk] = useState<number>(0);

  const isCourseSpecific = Boolean(course);
  const title = course ? course.code : 'Overall Attendance';
  const subtitle = course ? course.name : `${overall?.totalCourses || 0} enrolled subjects`;

  let attended = course ? course.attended : overall?.totalAttended || 0;
  let total = course ? course.total : overall?.totalClasses || 0;
  const reportedPct = course ? course.percentage : overall?.overallPercentage || 0;

  // Fallback if class counts not directly available
  if (total === 0 && reportedPct > 0) {
    total = 100;
    attended = Math.round(reportedPct);
  }

  const currentPct = total > 0 ? Number(((attended / total) * 100).toFixed(2)) : reportedPct;
  const bunkAllowance = calculateBunkAllowance(attended, total, targetPct);
  const requiredClasses = calculateRequiredClasses(attended, total, targetPct);

  // Simulation calculation
  const simNewAttended = attended + simAttend;
  const simNewTotal = total + simAttend + simBunk;
  const simNewPct =
    simNewTotal > 0 ? Number(((simNewAttended / simNewTotal) * 100).toFixed(2)) : 0;

  const [isClosing, setIsClosing] = useState(false);

  const handleClose = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 220);
  };

  return (
    <div className={`${styles.overlay} ${isClosing ? styles.closing : ''}`} onClick={handleClose}>
      <div className={`${styles.modal} ${isClosing ? styles.closing : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <span className={styles.badge}>
              {isCourseSpecific ? 'Course Analysis' : 'Overall Analysis'}
            </span>
            <h2 className={styles.title}>{title}</h2>
            <p className={styles.subtitle}>{subtitle}</p>
          </div>
          <button className={styles.closeBtn} onClick={handleClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className={styles.currentStats}>
          <div className={styles.statBox}>
            <span className={styles.statLabel}>Current Attendance</span>
            <span className={styles.statVal}>{currentPct}%</span>
            <span className={styles.statSub}>
              {attended}/{total} classes
            </span>
          </div>

          <div className={styles.statBox}>
            <span className={styles.statLabel}>Planning Threshold</span>
            <div className={styles.targetSelector}>
              {[75, 80, 85, 90].map((t) => (
                <button
                  key={t}
                  className={`${styles.targetBtn} ${targetPct === t ? styles.targetActive : ''}`}
                  onClick={() => setTargetPct(t)}
                >
                  {t}%
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Calculated Result Box */}
        <div className={styles.resultBox}>
          {currentPct >= targetPct ? (
            <div className={styles.resultSafe}>
              <div className={styles.resultMain}>
                <span className={styles.resultNumber}>{bunkAllowance}</span>
                <span className={styles.resultText}>
                  class{bunkAllowance === 1 ? '' : 'es'} you can safely skip
                </span>
              </div>
              <p className={styles.resultDesc}>
                Skipping {bunkAllowance} class{bunkAllowance === 1 ? '' : 'es'} will leave your attendance at{' '}
                {total + bunkAllowance > 0
                  ? ((attended / (total + bunkAllowance)) * 100).toFixed(2)
                  : 0}
                % (≥ {targetPct}%).
              </p>
            </div>
          ) : (
            <div className={styles.resultDanger}>
              <div className={styles.resultMain}>
                <span className={styles.resultNumber}>+{requiredClasses}</span>
                <span className={styles.resultText}>
                  consecutive classes needed
                </span>
              </div>
              <p className={styles.resultDesc}>
                Attending the next {requiredClasses} classes in a row will bring your attendance to{' '}
                {total + requiredClasses > 0
                  ? (((attended + requiredClasses) / (total + requiredClasses)) * 100).toFixed(2)
                  : 0}
                % (≥ {targetPct}%).
              </p>
            </div>
          )}
        </div>

        {/* Interactive Scenario Simulator */}
        <div className={styles.simSection}>
          <h3 className={styles.simTitle}>Scenario Simulator</h3>
          <div className={styles.simControls}>
            <div className={styles.simRow}>
              <span className={styles.simLabel}>Attend upcoming classes:</span>
              <div className={styles.stepper}>
                <button
                  className={styles.stepBtn}
                  onClick={() => setSimAttend((p) => Math.max(0, p - 1))}
                  aria-label="Decrease attend"
                >
                  -
                </button>
                <span className={styles.stepVal}>+{simAttend}</span>
                <button
                  className={styles.stepBtn}
                  onClick={() => setSimAttend((p) => p + 1)}
                  aria-label="Increase attend"
                >
                  +
                </button>
              </div>
            </div>

            <div className={styles.simRow}>
              <span className={styles.simLabel}>Skip upcoming classes:</span>
              <div className={styles.stepper}>
                <button
                  className={styles.stepBtn}
                  onClick={() => setSimBunk((p) => Math.max(0, p - 1))}
                  aria-label="Decrease bunk"
                >
                  -
                </button>
                <span className={styles.stepVal}>+{simBunk}</span>
                <button
                  className={styles.stepBtn}
                  onClick={() => setSimBunk((p) => p + 1)}
                  aria-label="Increase bunk"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <div className={styles.simResult}>
            <span>Projected:</span>
            <strong>{simNewPct}%</strong>
            <span className={styles.simFraction}>
              ({simNewAttended}/{simNewTotal})
            </span>
            {(simAttend > 0 || simBunk > 0) && (
              <button
                className={styles.resetBtn}
                onClick={() => {
                  setSimAttend(0);
                  setSimBunk(0);
                }}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
