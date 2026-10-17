/*
 * UMS Connection Hook for ONEE Side Panel.
 *
 * This hook maintains live synchronization with the student's active UMS tab:
 * 1. Active Tab Detection: Inspects the current tab to see if the student is browsing ums.lpu.in.
 * 2. Self-Healing Messaging: If the content script got disconnected (due to an ASP.NET postback
 *    or iframe reload), it uses sendTabMessageWithAutoRecovery to automatically re-inject
 *    the content script and retry communication.
 * 3. Status Pipeline: Exposes connection status ('NOT_CONNECTED', 'LOGIN_PAGE',
 *    'HUMAN_VERIFICATION', 'READY') to drive dashboard cards and onboarding banners.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { AttendanceSummary, TimetableSummary, ConnectionStatus, AgentActivity } from '../shared/types';
import { MESSAGE_TYPES, UmsResponsePayload } from '../shared/messages';
import { getActiveLpuTab, sendTabMessageWithAutoRecovery, isLpuUrl } from '../services/tabMessenger';
import { isAuthenticatedUmsUrl } from '../content/umsDetector';
import { isValidCourseCode } from '../content/umsAttendanceParser';
import { isCachedAttendanceForStudent } from '../shared/attendanceCalculator';
import { localDatabase } from '../services/localDatabase';

/**
 * Compares two UMS URLs ignoring query string and hash (ASP.NET session keys
 * and postback tokens change those constantly) so the same page is recognized
 * across reloads and postbacks.
 */
function sameUmsPage(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.origin === ub.origin && ua.pathname.toLowerCase() === ub.pathname.toLowerCase();
  } catch {
    return false;
  }
}

export interface UseUmsConnectionResult {
  status: ConnectionStatus;
  attendance: AttendanceSummary | null;
  timetable: TimetableSummary | null;
  currentUrl: string | null;
  activePageType: string | null;
  errorMessage: string | null;
  isLoading: boolean;
  activities: AgentActivity[];
  hasAttendanceLink: boolean;
  hasTimetableLink: boolean;
  refresh: () => Promise<void>;
  openUmsTab: () => void;
  navigateToAttendance: () => Promise<void>;
}

function parseVerifiedRecordToSummary(rec: any): AttendanceSummary | null {
  if (!rec || !rec.subjects || !rec.aggregate) return null;
  // Phantom gate: a cached subject whose code would not be accepted from the
  // live attendance DOM (e.g. legacy TERM2026/ON19 rows) is dropped here so
  // stale IndexedDB records can never resurface as verified context.
  const subjects = rec.subjects.filter((s: any) => s && isValidCourseCode(s.code));
  if (subjects.length === 0) return null;
  return {
    courses: subjects.map((s: any) => ({
      code: s.code,
      name: s.code,
      percentage: s.percentage,
      attended: s.attended,
      total: s.delivered,
      dutyLeave: s.dutyLeave || 0,
      lastAttended: s.lastAttended,
      source: 'ums-attendance-dom'
    })),
    overallPercentage: rec.aggregate.percentage,
    totalAttended: rec.aggregate.attended,
    totalDelivered: rec.aggregate.delivered,
    totalCourses: rec.aggregate.totalCourses,
    status: 'verified',
    // Labeled honestly: this is a rehydrated IndexedDB snapshot, NOT a fresh
    // DOM read. The old 'live-ums-dom' label made another account's stale
    // numbers look freshly verified from the page on screen.
    source: 'cached-verified-record',
    studentName: rec.studentName || undefined,
    registrationNumber: rec.registrationNumber || undefined,
    fetchedAt: typeof rec.capturedAt === 'number' ? rec.capturedAt : Date.now(),
    extractedAt: typeof rec.capturedAt === 'number' ? rec.capturedAt : Date.now()
  };
}

export function useUmsConnection(): UseUmsConnectionResult {
  const [status, setStatus] = useState<ConnectionStatus>('NOT_CONNECTED');
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [timetable, setTimetable] = useState<TimetableSummary | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [activePageType, setActivePageType] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [hasAttendanceLink, setHasAttendanceLink] = useState<boolean>(false);
  const [hasTimetableLink, setHasTimetableLink] = useState<boolean>(false);

  /*
   * URL of the tab this side panel is currently synced to. Used to attribute
   * incoming UMS_STATUS_UPDATE broadcasts: a stray login-page tab must never
   * clobber the state of the signed-in dashboard tab.
   */
  const activeTabUrlRef = useRef<string | null>(null);

  const addActivity = useCallback((title: string, detail?: string, activityStatus: AgentActivity['status'] = 'completed') => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setActivities((prev) => [
      ...prev.slice(-9),
      {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        timestamp,
        title,
        detail,
        status: activityStatus
      }
    ]);
  }, []);

  /*
   * Identity of the student currently signed into the UMS tab. The verified
   * attendance snapshot is persisted under a fixed 'default' key, so this ref
   * is what stops a record captured while ANOTHER account was signed in from
   * re-hydrating after they log out and the real student logs in — the panel
   * would otherwise show the previous account's numbers until the attendance
   * modal was manually reopened.
   */
  const liveStudentRef = useRef<{ registrationNumber?: string; studentName?: string }>({});

  const noteLiveStudent = useCallback(
    (
      profile?: { studentName?: string; registrationNumber?: string },
      snapshot?: AttendanceSummary | null
    ) => {
      const registrationNumber = profile?.registrationNumber || snapshot?.registrationNumber;
      const studentName = profile?.studentName || snapshot?.studentName;
      if (registrationNumber) liveStudentRef.current.registrationNumber = registrationNumber;
      if (studentName) liveStudentRef.current.studentName = studentName;
    },
    []
  );

  /**
   * Reads the cached snapshot ONLY when it provably belongs to the student
   * signed in right now. On a confirmed mismatch the record is deleted (so it
   * can never resurface) and any other-account numbers still on screen are
   * cleared immediately.
   */
  const hydrateCachedAttendance = useCallback(async (): Promise<AttendanceSummary | null> => {
    try {
      const rec = await localDatabase.getLatestVerifiedAttendance('default');
      if (!rec) return null;

      if (!isCachedAttendanceForStudent(rec, liveStudentRef.current)) {
        console.warn('[ONEE UMS] Dropping cached attendance captured under a different UMS account.');
        await localDatabase.deleteVerifiedAttendance('default');
        setAttendance((prev) =>
          prev && isCachedAttendanceForStudent(prev, liveStudentRef.current) ? prev : null
        );
        return null;
      }

      return parseVerifiedRecordToSummary(rec);
    } catch {
      return null;
    }
  }, []);

  const queryActiveTab = useCallback(async () => {
    setIsLoading(true);
    try {
      const activeTab = await getActiveLpuTab();
      activeTabUrlRef.current = activeTab?.url ?? null;

      if (!activeTab || !activeTab.id || !activeTab.url || !isLpuUrl(activeTab.url)) {
        setStatus('NOT_CONNECTED');
        setAttendance(null);
        setErrorMessage(null);
        setIsLoading(false);
        return;
      }

      const url = new URL(activeTab.url);
      setCurrentUrl(activeTab.url);

      const lowUrl = activeTab.url.toLowerCase();
      let pageType = 'other';
      if (lowUrl.includes('frmstudenttimetable') || lowUrl.includes('timetable')) {
        pageType = 'student_timetable';
      } else if (lowUrl.includes('studentdashboard')) {
        pageType = 'student_dashboard';
      } else if (lowUrl.includes('studentattendance') || lowUrl.includes('frmstudentattendance')) {
        pageType = 'student_attendance';
      } else if (lowUrl.includes('exam') || lowUrl.includes('datesheet') || lowUrl.includes('seatingplan')) {
        pageType = 'student_examination';
      }
      setActivePageType(pageType);
      addActivity('Connected to LPU UMS tab', url.pathname);

      // Request attendance and timetable via self-healing content script message
      const response: UmsResponsePayload | null = await sendTabMessageWithAutoRecovery({
        type: MESSAGE_TYPES.REQUEST_ATTENDANCE_DATA
      });

      console.info('[ONEE UMS] status query', {
        tabUrl: activeTab.url,
        reportedStatus: response?.status ?? 'no-response'
      });

      // Track who is signed in BEFORE any retention / hydration decision below.
      noteLiveStudent(response?.studentProfile, response?.attendance);

      if (response && response.timetable && response.timetable.slots && response.timetable.slots.length > 0) {
        setTimetable(response.timetable);
        setHasTimetableLink(true);
        addActivity(
          `Verified timetable`,
          `${response.timetable.slots.length} slots loaded for ${response.timetable.homeSection || 'schedule'}`
        );
      } else if (response && response.hasTimetableLink) {
        setHasTimetableLink(true);
      }

      if (response && response.status === 'READY' && response.attendance && response.attendance.status === 'verified') {
        setStatus('READY');
        setAttendance(response.attendance);
        setErrorMessage(null);
        setHasAttendanceLink(true);
        addActivity(
          `Verified ${response.attendance.totalCourses} subjects`,
          `Aggregate attendance: ${response.attendance.overallPercentage}%`
        );
      } else if (response && response.status) {
        let nextStatus = response.status;
        let nextError = response.errorMessage || null;

        // Defense in depth: a LOGIN_PAGE verdict for an authenticated UMS URL
        // is a stale/misclassified detection. Trust the tab URL.
        if (nextStatus === 'LOGIN_PAGE' && isAuthenticatedUmsUrl(activeTab.url)) {
          console.warn('[ONEE UMS] Ignoring LOGIN_PAGE for authenticated tab:', activeTab.url);
          nextStatus = 'NO_ATTENDANCE_ON_PAGE';
          nextError = 'Connected to UMS. Ready to check attendance.';
        }

        setStatus(nextStatus);
        setErrorMessage(nextError);
        setHasAttendanceLink(Boolean(response.hasAttendanceLink));
        // Retain verified attendance in state — but only when it belongs to the
        // student signed in right now (an account switch must drop old numbers).
        setAttendance((prev) => {
          if (
            prev &&
            prev.status === 'verified' &&
            prev.courses &&
            prev.courses.length > 0 &&
            isCachedAttendanceForStudent(prev, liveStudentRef.current)
          ) {
            return prev;
          }
          return null;
        });
        hydrateCachedAttendance()
          .then((cached) => {
            if (cached) setAttendance((existing) => existing || cached);
          })
          .catch(() => {});
      } else {
        setStatus('UMS_DETECTED');
        setErrorMessage('Connected to UMS. Ready to check attendance.');
        setAttendance((prev) => {
          if (
            prev &&
            prev.status === 'verified' &&
            prev.courses &&
            prev.courses.length > 0 &&
            isCachedAttendanceForStudent(prev, liveStudentRef.current)
          ) {
            return prev;
          }
          return null;
        });
        hydrateCachedAttendance()
          .then((cached) => {
            if (cached) setAttendance((existing) => existing || cached);
          })
          .catch(() => {});
      }
    } catch (err: any) {
      console.warn('Error querying active tab:', err);
      setStatus('ERROR');
      setAttendance(null);
      setErrorMessage(err.message || 'Failed to communicate with tab');
    } finally {
      setIsLoading(false);
    }
  }, [addActivity]);

  const refresh = useCallback(async () => {
    addActivity('Scanning page for attendance updates...');
    await queryActiveTab();
  }, [queryActiveTab, addActivity]);

  const openUmsTab = useCallback(() => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: 'https://ums.lpu.in/lpuums/StudentDashboard.aspx' });
    } else {
      window.open('https://ums.lpu.in/lpuums/StudentDashboard.aspx', '_blank');
    }
  }, []);

  const navigateToAttendance = useCallback(async () => {
    try {
      await sendTabMessageWithAutoRecovery({
        type: MESSAGE_TYPES.NAVIGATE_TO_ATTENDANCE
      });
      addActivity('Scanning Attendance section...');
      setTimeout(() => queryActiveTab(), 400);
    } catch {
      setTimeout(() => queryActiveTab(), 300);
    }
  }, [queryActiveTab, addActivity]);

  useEffect(() => {
    queryActiveTab();

    // Hydrate latest verified attendance from local database on startup —
    // identity-gated so a previous account's snapshot can never open the panel.
    hydrateCachedAttendance()
      .then((cached) => {
        if (cached) setAttendance((prev) => prev || cached);
      })
      .catch(() => {});

    const messageListener = (message: any) => {
      if (message.type === MESSAGE_TYPES.UMS_STATUS_UPDATE && message.payload) {
        const payload: UmsResponsePayload = message.payload;
        const sourceUrl: string | undefined = payload.sourceUrl;
        const activeUrl = activeTabUrlRef.current;

        const isWipingStatus =
          payload.status === 'LOGIN_PAGE' ||
          payload.status === 'NOT_CONNECTED' ||
          payload.status === 'HUMAN_VERIFICATION';

        // Attribute the broadcast to its source tab. A stray login tab (or any
        // other UMS tab) must not reset the signed-in dashboard's state.
        if (isWipingStatus && sourceUrl && activeUrl && !sameUmsPage(sourceUrl, activeUrl)) {
          console.info('[ONEE UMS] Ignoring status from non-active tab:', {
            from: sourceUrl,
            active: activeUrl,
            status: payload.status
          });
          return;
        }

        // Never show "Sign In Required" for a tab that is on an authenticated page.
        const loginMisclassified =
          payload.status === 'LOGIN_PAGE' &&
          ((sourceUrl && isAuthenticatedUmsUrl(sourceUrl)) || (activeUrl && isAuthenticatedUmsUrl(activeUrl)));
        const effectiveStatus = loginMisclassified ? 'NO_ATTENDANCE_ON_PAGE' : payload.status;
        const effectiveError = loginMisclassified
          ? 'Connected to UMS. Ready to check attendance.'
          : payload.errorMessage || null;
        if (loginMisclassified) {
          console.warn('[ONEE UMS] Reconciled LOGIN_PAGE broadcast for authenticated tab', {
            sourceUrl,
            activeUrl
          });
        }

        if (payload.timetable && payload.timetable.slots && payload.timetable.slots.length > 0) {
          setTimetable(payload.timetable);
          setHasTimetableLink(true);
        } else if (payload.hasTimetableLink !== undefined) {
          setHasTimetableLink(Boolean(payload.hasTimetableLink));
        }

        // Learn (or refresh) who is signed in from every authenticated scan.
        noteLiveStudent(payload.studentProfile, payload.attendance);

        if (payload.status === 'READY' && payload.attendance && payload.attendance.status === 'verified') {
          setStatus('READY');
          setAttendance(payload.attendance);
          addActivity(
            `Verified ${payload.attendance.totalCourses} subjects`,
            `Overall: ${payload.attendance.overallPercentage}%`
          );
        } else {
          setStatus(effectiveStatus);
          setErrorMessage(effectiveError);
          setHasAttendanceLink(Boolean(payload.hasAttendanceLink));
          // Only wipe attendance if session is truly logged out or disconnected from UMS
          if (
            effectiveStatus === 'NOT_CONNECTED' ||
            effectiveStatus === 'LOGIN_PAGE' ||
            effectiveStatus === 'HUMAN_VERIFICATION'
          ) {
            // Nobody is signed in — forget the previous student's identity so
            // a later hydration can prove any leftover snapshot is stale.
            liveStudentRef.current = {};
            setAttendance(null);
            setTimetable(null);
            setCurrentUrl(null);
            setActivePageType(null);
          }
        }
      } else if (message.type === 'ONEE_TAB_CHANGED') {
        if (message.url) activeTabUrlRef.current = message.url;
        queryActiveTab();
      }
    };

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(messageListener);
      return () => {
        chrome.runtime.onMessage.removeListener(messageListener);
      };
    }
  }, [queryActiveTab, addActivity]);

  return {
    status,
    attendance,
    timetable,
    currentUrl,
    activePageType,
    errorMessage,
    isLoading,
    activities,
    hasAttendanceLink,
    hasTimetableLink,
    refresh,
    openUmsTab,
    navigateToAttendance
  };
}
