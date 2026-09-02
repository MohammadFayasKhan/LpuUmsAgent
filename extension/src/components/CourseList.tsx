/*
 * Expandable Course Attendance List for ONEE.
 *
 * Renders every course from the parsed attendance table as a list of CourseRow
 * components. The list highlights the lowest-attendance subject with a distinct
 * visual marker so the student immediately sees which course needs attention.
 *
 * When a student taps a row, it opens the BunkCalculatorModal for that specific
 * course so they can explore "how many classes can I skip" or "how many do I need
 * to attend" at different target thresholds.
 */

import React from 'react';
import { AttendanceRecord } from '../shared/types';
import { CourseRow } from './CourseRow';
import { getLowestAttendanceSubject } from '../shared/attendanceCalculator';
import styles from './CourseList.module.css';

interface CourseListProps {
  courses: AttendanceRecord[];
  onSelectCourse: (course: AttendanceRecord) => void;
}

export const CourseList: React.FC<CourseListProps> = ({
  courses,
  onSelectCourse
}) => {
  const lowest = getLowestAttendanceSubject(courses);

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <h2 className={styles.title}>Subjects</h2>
        <span className={styles.count}>{courses.length} enrolled</span>
      </div>

      <div className={styles.list}>
        {courses.map((course) => (
          <CourseRow
            key={course.code}
            course={course}
            isLowest={lowest?.code === course.code && courses.length > 1}
            onSelect={onSelectCourse}
          />
        ))}
      </div>
    </div>
  );
};
