/*
 * Dashboard Attendance Overview Card for ONEE.
 *
 * This is the first thing the student sees when they open the side panel with
 * UMS connected. It shows:
 * 1. A time-based greeting ("Good morning, Fayas")
 * 2. The overall attendance percentage in a large number with color coding
 *    (green >= 75%, amber 70-74%, red < 70%)
 * 3. A quick summary: total delivered, attended, absent counts
 * 4. Bunk allowance or recovery requirement at the 75% threshold
 *
 * All arithmetic here uses the shared attendanceCalculator functions so the
 * numbers always match what the chatbot and Computer Use final response show.
 */

import React from 'react';
import { AttendanceSummary } from '../shared/types';
import { calculateBunkAllowance, calculateRequiredClasses } from '../shared/attendanceCalculator';
import styles from './AttendanceCard.module.css';

interface AttendanceCardProps {
  attendance: AttendanceSummary;
  onOpenCalculator?: () => void;
}

function getGreeting(name?: string): string {
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  if (name) {
    const firstName = name.split(' ')[0];
    return `${timeGreeting}, ${firstName}`;
  }
  return timeGreeting;
}

function getStatusMessage(attendance: AttendanceSummary): string {
  const pct = attendance.overallPercentage;
  if (pct >= 85) {
    return 'Your attendance is outstanding. Keep it up!';
  }
  if (pct >= 75) {
    return 'Overall attendance is in good shape.';
  }
  if (pct >= 70) {
    return 'Attendance is close to the 75% boundary. Attend upcoming classes.';
  }
  return 'Your attendance is currently below 75%.';
}

export const AttendanceCard: React.FC<AttendanceCardProps> = ({
  attendance,
  onOpenCalculator
}) => {
  const totalDelivered = attendance.totalClasses ?? attendance.totalDelivered ?? 0;
  const totalAbsent = attendance.totalAbsent ?? Math.max(0, totalDelivered - attendance.totalAttended);

  const bunk75 = calculateBunkAllowance(attendance.totalAttended, totalDelivered, 75);
  const req75 = calculateRequiredClasses(attendance.totalAttended, totalDelivered, 75);

  const getPercentageColorClass = () => {
    const pct = attendance.overallPercentage;
    if (pct >= 75) return styles.pctSafe;
    if (pct >= 70) return styles.pctWarning;
    return styles.pctDanger;
  };

  return (
    <div className={styles.container}>
      <div className={styles.greetingSection}>
        <h1 className={styles.greeting}>{getGreeting(attendance.studentName)}</h1>
        <p className={styles.statusMessage}>{getStatusMessage(attendance)}</p>
      </div>

      <div className={styles.card} onClick={onOpenCalculator} role="button" tabIndex={0}>
        <div className={styles.cardHeader}>
          <span className={styles.cardTitle}>Overall attendance</span>
          <span className={styles.courseCount}>{attendance.totalCourses} subjects</span>
        </div>

        <div className={styles.percentageRow}>
          <span className={`${styles.percentage} ${getPercentageColorClass()}`}>
            {attendance.overallPercentage.toFixed(2)}%
          </span>
        </div>

        {/* Minimal Progress Bar with 75% marker */}
        <div className={styles.progressTrack}>
          <div
            className={`${styles.progressBar} ${getPercentageColorClass()}`}
            style={{ width: `${Math.min(100, attendance.overallPercentage)}%` }}
          />
          <div className={styles.targetMarker} title="75% minimum threshold" style={{ left: '75%' }} />
        </div>

        <div className={styles.cardFooter}>
          {totalDelivered > 0 ? (
            <span className={styles.statCount}>
              <strong>{attendance.totalAttended}</strong> attended · <strong>{totalAbsent}</strong> absent
            </span>
          ) : (
            <span className={styles.statCount}>
              Across <strong>{attendance.totalCourses}</strong> courses
            </span>
          )}

          <div className={styles.allowanceBadge}>
            {totalDelivered > 0 ? (
              attendance.overallPercentage >= 75 ? (
                <span className={styles.bunkSafe}>
                  Can bunk <strong>{bunk75}</strong> classes
                </span>
              ) : (
                <span className={styles.bunkDanger}>
                  Need <strong>{req75}</strong> classes for 75%
                </span>
              )
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
