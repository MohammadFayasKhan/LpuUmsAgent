/*
 * Loading Skeleton Placeholders for ONEE.
 *
 * While the attendance data is being fetched from the UMS content script, we show
 * animated skeleton shapes that roughly match the layout of the AttendanceCard and
 * CourseList. This prevents layout shift when real data arrives and gives the student
 * visual feedback that something is loading rather than showing a blank panel.
 */

import React from 'react';
import styles from './Skeletons.module.css';

export const Skeletons: React.FC = () => {
  return (
    <div className={styles.container}>
      <div className={styles.greetingSkeleton}>
        <div className={`${styles.bone} ${styles.titleBone}`} />
        <div className={`${styles.bone} ${styles.subtitleBone}`} />
      </div>

      <div className={styles.cardSkeleton}>
        <div className={`${styles.bone} ${styles.headerBone}`} />
        <div className={`${styles.bone} ${styles.percentageBone}`} />
        <div className={`${styles.bone} ${styles.trackBone}`} />
        <div className={`${styles.bone} ${styles.footerBone}`} />
      </div>

      <div className={styles.listSkeleton}>
        <div className={`${styles.bone} ${styles.sectionTitleBone}`} />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={styles.rowSkeleton}>
            <div className={styles.rowLeft}>
              <div className={`${styles.bone} ${styles.codeBone}`} />
              <div className={`${styles.bone} ${styles.nameBone}`} />
            </div>
            <div className={`${styles.bone} ${styles.pctBone}`} />
          </div>
        ))}
      </div>
    </div>
  );
};
