/*
 * Examination Schedule & Seating Plan Dashboard Card for ONEE.
 *
 * Displays:
 * 1. Verified Next Exam spotlight with venue, room, seat, and reporting time.
 * 2. Complete date sheet schedule with status and exam mode.
 * 3. Quick action to re-verify or refresh date sheet via the Browser Agent.
 */

import React, { useState, useRef } from 'react';
import { ExaminationSummary } from '../shared/types';
import { getNextExam } from '../content/examination/examinationValidator';
import { getShortExamTypeTag } from '../shared/examinationCalculator';
import { smoothScrollToReveal, smoothScrollOnCollapse } from '../lib/scrollUtils';
import styles from './ExaminationCard.module.css';

interface ExaminationCardProps {
  examination: ExaminationSummary | null;
  onCheckDateSheet: () => void;
  onOpenSamplePaper?: (courseCode: string) => void;
}

export const ExaminationCard: React.FC<ExaminationCardProps> = ({
  examination,
  onCheckDateSheet,
  onOpenSamplePaper
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedExamKey, setExpandedExamKey] = useState<string | null>(null);
  const scheduleSectionRef = useRef<HTMLDivElement>(null);

  if (!examination || !examination.exams || examination.exams.length === 0) {
    return (
      <div className={styles.emptyContainer}>
        <div className={styles.emptyHeader}>
          <span className={styles.badgeNew}>NEW CAPABILITY</span>
          <h3 className={styles.emptyTitle}>Examination Date Sheet & Seating Plan</h3>
        </div>
        <p className={styles.emptyDesc}>
          Let ONEE automatically locate your Date Sheet in Important Links and extract your upcoming exam schedule, rooms, and seat allocations.
        </p>
        <button className={styles.actionBtn} onClick={onCheckDateSheet}>
          <span className={styles.btnIcon}>📅</span>
          <span>Check Date Sheet & Seating Plan</span>
        </button>
      </div>
    );
  }

  const nextExam = getNextExam(examination.exams);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerTitleGroup}>
          <span className={styles.titleIcon}>📅</span>
          <div>
            <h3 className={styles.title}>Examination Schedule</h3>
            <span className={styles.subtitle}>
              {examination.totalExams} {examination.totalExams === 1 ? 'Exam' : 'Exams'} Scheduled
            </span>
          </div>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.verifiedBadge}>✓ Verified</span>
          <button
            className={styles.refreshBtn}
            onClick={onCheckDateSheet}
            title="Re-verify examination date sheet from UMS"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Next Exam Spotlight */}
      {nextExam ? (
        <div className={styles.nextExamCard}>
          <div className={styles.nextExamHeader}>
            <span className={styles.nextExamTag}>NEXT UPCOMING EXAM</span>
            <span className={styles.nextExamDate}>{nextExam.examDate}</span>
          </div>
          <div className={styles.courseRow}>
            <span className={styles.courseCode}>{nextExam.courseCode}</span>
            {nextExam.courseName && (
              <span className={styles.courseName}>{nextExam.courseName}</span>
            )}
          </div>
          <div className={styles.examDetailsGrid}>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>TIME</span>
              <span className={styles.detailValue}>
                {nextExam.startTime || 'TBD'}{nextExam.endTime ? ` - ${nextExam.endTime}` : ''}
              </span>
            </div>
            {nextExam.reportingTime && (
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>REPORTING</span>
                <span className={styles.detailValue}>{nextExam.reportingTime}</span>
              </div>
            )}
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>VENUE & ROOM</span>
              <span className={styles.detailValue}>
                {nextExam.venue || 'TBD'}{nextExam.room ? `, Room ${nextExam.room}` : ''}
              </span>
            </div>
            <div className={styles.detailItem}>
              <span className={styles.detailLabel}>SEAT</span>
              <span className={`${styles.detailValue} ${nextExam.seat ? styles.seatAllocated : ''}`}>
                {nextExam.seat ? `Seat ${nextExam.seat}` : 'Not Allocated'}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className={styles.noUpcoming}>
          <span>{examination.totalExams === 0 ? 'No examinations currently scheduled in Date Sheet' : 'All scheduled examinations completed'}</span>
        </div>
      )}

      {/* Suggested Sub-Action Banner for Sample Question Paper */}
      {nextExam?.samplePaper?.available && (
        <div className={styles.subActionBanner}>
          <div className={styles.subActionHeader}>
            <span className={styles.subActionBadge}>
              <span>💡</span> SUGGESTED SUB-ACTION
            </span>
            <span className={styles.subActionPill}>Resource Ready</span>
          </div>
          <div className={styles.subActionTitle}>
            📄 Sample Question Paper Available for <strong>{nextExam.courseCode}</strong>
          </div>
          <button
            className={styles.subActionButton}
            onClick={() => onOpenSamplePaper?.(nextExam.courseCode)}
            title={`Fetch and open official sample paper for ${nextExam.courseCode}`}
          >
            <span>📄 Fetch & Open Sample Paper ({nextExam.courseCode})</span>
            <span>→</span>
          </button>
        </div>
      )}

      {/* Complete Date Sheet Accordion / Toggle */}
      {examination.exams.length > 1 && (
        <div ref={scheduleSectionRef} className={styles.scheduleSection}>
          <button
            className={styles.expandToggle}
            onClick={() => {
              const next = !isExpanded;
              setIsExpanded(next);
              if (next) {
                smoothScrollToReveal(scheduleSectionRef.current);
              } else {
                smoothScrollOnCollapse(scheduleSectionRef.current);
              }
            }}
          >
            <span>{isExpanded ? 'Hide Full Date Sheet' : `View All ${examination.totalExams} Exams`}</span>
            <span className={`${styles.toggleArrow} ${isExpanded ? styles.expanded : ''}`} aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </button>

          <div className={`${styles.scheduleExpandableWrapper} ${isExpanded ? styles.expanded : ''}`}>
            <div className={styles.examList}>
              {examination.exams.map((exam, idx) => {
                const examKey = exam.id || `${exam.courseCode}-${exam.examDate}-${exam.startTime || ''}-${idx}`;
                const isItemExpanded = expandedExamKey === examKey;
                const isToday = (exam.status || '').toLowerCase().includes('today');

                return (
                  <div
                    key={examKey}
                    className={`${styles.examItemCard} ${isItemExpanded ? styles.active : ''}`}
                    onClick={(e) => {
                      const nextKey = isItemExpanded ? null : examKey;
                      setExpandedExamKey(nextKey);
                      const cardEl = e.currentTarget;
                      if (nextKey) {
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
                        <span className={`${styles.expandChevron} ${isItemExpanded ? styles.expanded : ''}`} aria-hidden="true">
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
                            {exam.startTime || 'TBD'}{exam.endTime ? ` - ${exam.endTime}` : ''}
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
                            onOpenSamplePaper?.(exam.courseCode);
                          }}
                          title={`Fetch and open official sample paper for ${exam.courseCode}`}
                        >
                          <span className={styles.paperBtnIcon}>📄</span>
                          <span>Sample Paper</span>
                          <span className={styles.paperBtnArrow}>→</span>
                        </button>
                      </div>
                    )}

                    <div className={`${styles.examExpandableWrapper} ${isItemExpanded ? styles.expanded : ''}`}>
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
                                  onOpenSamplePaper?.(exam.courseCode);
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
        </div>
      )}
    </div>
  );
};
