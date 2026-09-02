/*
 * Agent Execution Activity Timeline for ONEE.
 *
 * While the browser agent is running, each step it takes (observe, think, locate,
 * move, act, extract, verify) gets logged as an AgentActivity entry. This component
 * renders those entries as a vertical timeline with colored dots and connector lines.
 *
 * The timeline shows the most recent 6 activities to avoid overwhelming the UI.
 * Completed steps show a green checkmark, active steps pulse, and future steps
 * remain dimmed. The student can expand an activity to see its detail text,
 * which includes things like "Found attendance table at row 3" or "Clicked
 * Attendance Summary link".
 */

import React, { useState } from 'react';
import { AgentActivity } from '../shared/types';
import styles from './ActivityTimeline.module.css';

interface ActivityTimelineProps {
  activities: AgentActivity[];
}

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({ activities }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);

  if (!activities || activities.length === 0) return null;

  const latestActivity = activities[activities.length - 1];

  const getStatusIcon = (status: AgentActivity['status']) => {
    switch (status) {
      case 'completed':
        return '✓';
      case 'in_progress':
        return '●';
      case 'warning':
        return '⚠';
      case 'error':
        return '✕';
      default:
        return '·';
    }
  };

  return (
    <div className={styles.container}>
      <button
        className={styles.summaryBar}
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <span className={styles.liveDot} />
        <div className={styles.summaryText}>
          <span className={styles.activityTitle}>{latestActivity.title}</span>
          {latestActivity.detail && (
            <span className={styles.activityDetail}>· {latestActivity.detail}</span>
          )}
        </div>
        <span className={styles.chevron}>{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className={styles.timelineList}>
          {activities.map((act) => (
            <div key={act.id} className={`${styles.timelineItem} ${styles[act.status]}`}>
              <span className={styles.itemIcon}>{getStatusIcon(act.status)}</span>
              <div className={styles.itemContent}>
                <div className={styles.itemHeader}>
                  <span className={styles.itemTitle}>{act.title}</span>
                  <span className={styles.itemTime}>{act.timestamp}</span>
                </div>
                {act.detail && <p className={styles.itemDetail}>{act.detail}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
