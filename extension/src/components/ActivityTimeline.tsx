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
import { smoothScrollToReveal, smoothScrollOnCollapse } from '../lib/scrollUtils';
import styles from './ActivityTimeline.module.css';

interface ActivityTimelineProps {
  activities: AgentActivity[];
}

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({ activities }) => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  if (!activities || activities.length === 0) return null;

  const latestActivity = activities[activities.length - 1];

  const getStageFromActivity = (act: AgentActivity) => {
    if (act.stage) return act.stage;
    const upper = act.title.toUpperCase();
    if (upper.includes('OBSERVE')) return 'OBSERVE';
    if (upper.includes('THINK') || upper.includes('PLAN')) return 'THINK';
    if (upper.includes('LOCATE') || upper.includes('FIND')) return 'LOCATE';
    if (upper.includes('MOVE') || upper.includes('CLICK') || upper.includes('HOVER')) return 'MOVE';
    if (upper.includes('WAIT')) return 'WAIT_FOR_RENDER';
    if (upper.includes('EXTRACT') || upper.includes('READ')) return 'EXTRACT';
    if (upper.includes('VALIDATE')) return 'VALIDATE';
    if (upper.includes('VERIFY') || upper.includes('CONFIRM')) return 'VERIFY';
    if (act.status === 'completed') return 'DONE';
    return 'STEP';
  };

  const handleToggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next) {
      smoothScrollToReveal(containerRef.current);
    } else {
      smoothScrollOnCollapse(containerRef.current);
    }
  };

  React.useEffect(() => {
    if (isOpen && listRef.current) {
      listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [activities.length, isOpen]);

  return (
    <div ref={containerRef} className={styles.container}>
      <button
        className={styles.summaryBar}
        onClick={handleToggle}
        aria-expanded={isOpen}
      >
        <span className={styles.liveDot} />
        <div
          className={styles.summaryText}
          title={latestActivity.detail ? `${latestActivity.title} · ${latestActivity.detail}` : latestActivity.title}
        >
          <span className={styles.activityTitle}>{latestActivity.title}</span>
          {latestActivity.detail && (
            <span className={styles.activityDetail}>· {latestActivity.detail}</span>
          )}
        </div>
        <span className={`${styles.chevron} ${isOpen ? styles.expanded : ''}`} aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>

      <div className={`${styles.timelineWrapper} ${isOpen ? styles.expanded : ''}`}>
        <div className={styles.timelineList} ref={listRef}>
          {activities.map((act) => {
            const stage = getStageFromActivity(act);
            const isCompleted = act.status === 'completed';
            return (
              <div key={act.id} className={`${styles.timelineItem} ${styles[act.status] || ''}`}>
                <span className={`${styles.stageBadge} ${styles[act.status] || ''}`}>
                  {isCompleted ? `✓ ${stage}` : stage === 'MOVE' ? `→ ${stage}` : `● ${stage}`}
                </span>
                <div className={styles.itemContent}>
                  <div className={styles.itemHeader}>
                    <span className={styles.itemTitle}>{act.title}</span>
                    {act.timestamp && <span className={styles.itemTime}>{act.timestamp}</span>}
                  </div>
                  {act.detail && <p className={styles.itemDetail}>{act.detail}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
