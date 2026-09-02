/*
 * Individual Course Attendance Row for ONEE.
 *
 * Each row shows one course from the attendance table:
 * - Course code and name (e.g. "CSE330 → Linux Operating System")
 * - Attended / delivered fraction (e.g. "8 / 9")
 * - Percentage with a color-coded progress bar
 * - A small bunk allowance or recovery badge
 *
 * The progress bar width is set as a percentage of the container. Color thresholds:
 * green >= 75%, amber 70-74%, red < 70%. These match the university's minimum
 * attendance requirement.
 */

import React from 'react';
import { AttendanceRecord } from '../shared/types';
import { calculateBunkAllowance, calculateRequiredClasses } from '../shared/attendanceCalculator';
import styles from './CourseRow.module.css';

interface CourseRowProps {
  course: AttendanceRecord;
  isLowest?: boolean;
  onSelect: (course: AttendanceRecord) => void;
}

export const CourseRow: React.FC<CourseRowProps> = ({
  course,
  isLowest,
  onSelect
}) => {
  const bunk75 = calculateBunkAllowance(course.attended, course.total, 75);
  const req75 = calculateRequiredClasses(course.attended, course.total, 75);

  const getPercentageClass = () => {
    if (course.percentage >= 75) return styles.pctSafe;
    if (course.percentage >= 70) return styles.pctWarning;
    return styles.pctDanger;
  };

  return (
    <div
      className={`${styles.row} ${isLowest ? styles.lowestRow : ''}`}
      onClick={() => onSelect(course)}
      role="button"
      tabIndex={0}
    >
      <div className={styles.mainInfo}>
        <div className={styles.codeLine}>
          <span className={styles.code}>{course.code}</span>
          {isLowest && <span className={styles.lowestBadge}>Lowest</span>}
          {course.dataQuality === 'warning' && (
            <span
              className={styles.qualityWarning}
              title="UMS reported percentage has a slight count discrepancy"
            >
              ⚠
            </span>
          )}
        </div>
        <span className={styles.name} title={course.name}>
          {course.name}
        </span>
        <div className={styles.subInfo}>
          {course.total > 0 ? (
            <>
              <span className={styles.fraction}>
                {course.attended}/{course.total} attended
              </span>
              <span className={styles.separator}>·</span>
              <span className={styles.bunkHint}>
                {course.percentage >= 75 ? (
                  <span>Can bunk {bunk75}</span>
                ) : (
                  <span className={styles.needClasses}>Need +{req75} to 75%</span>
                )}
              </span>
            </>
          ) : (
            <span className={styles.bunkHint}>
              {course.percentage >= 90 ? (
                <span className={styles.safeStatus}>Safe buffer ({course.percentage}%)</span>
              ) : course.percentage >= 75 ? (
                <span className={styles.safeStatus}>On track ({course.percentage}%)</span>
              ) : course.percentage >= 70 ? (
                <span className={styles.needClasses}>Borderline ({course.percentage}%)</span>
              ) : (
                <span className={styles.needClasses}>Below 75% target ({course.percentage}%)</span>
              )}
            </span>
          )}
        </div>
      </div>

      <div className={styles.percentageColumn}>
        <span className={`${styles.percentage} ${getPercentageClass()}`}>
          {course.percentage.toFixed(course.percentage % 1 === 0 ? 0 : 2)}%
        </span>
        <div className={styles.miniTrack}>
          <div
            className={`${styles.miniBar} ${getPercentageClass()}`}
            style={{ width: `${Math.min(100, course.percentage)}%` }}
          />
        </div>
      </div>
    </div>
  );
};
