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

import { useState, useEffect, useCallback } from 'react';
import { AttendanceSummary, ConnectionStatus, AgentActivity } from '../shared/types';
import { MESSAGE_TYPES, UmsResponsePayload } from '../shared/messages';
import { getActiveLpuTab, sendTabMessageWithAutoRecovery, isLpuUrl } from '../services/tabMessenger';
import { localDatabase } from '../services/localDatabase';

export interface UseUmsConnectionResult {
  status: ConnectionStatus;
  attendance: AttendanceSummary | null;
  errorMessage: string | null;
  isLoading: boolean;
  activities: AgentActivity[];
  hasAttendanceLink: boolean;
  refresh: () => Promise<void>;
  openUmsTab: () => void;
  navigateToAttendance: () => Promise<void>;
}

function parseVerifiedRecordToSummary(rec: any): AttendanceSummary | null {
  if (!rec || !rec.subjects || !rec.aggregate) return null;
  return {
    courses: rec.subjects.map((s: any) => ({
      code: s.code,
      name: s.code,
      percentage: s.percentage,
      attended: s.attended,
      total: s.delivered,
      dutyLeave: s.dutyLeave || 0,
      lastAttended: s.lastAttended
    })),
    overallPercentage: rec.aggregate.percentage,
    totalAttended: rec.aggregate.attended,
    totalDelivered: rec.aggregate.delivered,
    totalCourses: rec.aggregate.totalCourses,
    status: 'verified',
    source: 'live-ums-dom'
  };
}

export function useUmsConnection(): UseUmsConnectionResult {
  const [status, setStatus] = useState<ConnectionStatus>('NOT_CONNECTED');
  const [attendance, setAttendance] = useState<AttendanceSummary | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [hasAttendanceLink, setHasAttendanceLink] = useState<boolean>(false);

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

  const queryActiveTab = useCallback(async () => {
    setIsLoading(true);
    try {
      const activeTab = await getActiveLpuTab();

      if (!activeTab || !activeTab.id || !activeTab.url || !isLpuUrl(activeTab.url)) {
        setStatus('NOT_CONNECTED');
        setAttendance(null);
        setErrorMessage(null);
        setIsLoading(false);
        return;
      }

      const url = new URL(activeTab.url);
      addActivity('Connected to LPU UMS tab', url.pathname);

      // Request attendance via self-healing content script message
      const response: UmsResponsePayload | null = await sendTabMessageWithAutoRecovery({
        type: MESSAGE_TYPES.REQUEST_ATTENDANCE_DATA
      });

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
        setStatus(response.status);
        setErrorMessage(response.errorMessage || null);
        setHasAttendanceLink(Boolean(response.hasAttendanceLink));
        // Retain verified attendance in state! Do not wipe it when on Seating Plan or other LPU tab.
        setAttendance((prev) => {
          if (prev && prev.status === 'verified' && prev.courses && prev.courses.length > 0) {
            return prev;
          }
          localDatabase.getLatestVerifiedAttendance('default').then((cached) => {
            const parsed = parseVerifiedRecordToSummary(cached);
            if (parsed) {
              setAttendance((existing) => existing || parsed);
            }
          }).catch(() => {});
          return null;
        });
      } else {
        setStatus('UMS_DETECTED');
        setErrorMessage('Connected to UMS. Ready to check attendance.');
        setAttendance((prev) => {
          if (prev && prev.status === 'verified' && prev.courses && prev.courses.length > 0) {
            return prev;
          }
          localDatabase.getLatestVerifiedAttendance('default').then((cached) => {
            const parsed = parseVerifiedRecordToSummary(cached);
            if (parsed) {
              setAttendance((existing) => existing || parsed);
            }
          }).catch(() => {});
          return null;
        });
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

    // Hydrate latest verified attendance from local database on startup
    localDatabase.getLatestVerifiedAttendance('default').then((cached) => {
      const parsed = parseVerifiedRecordToSummary(cached);
      if (parsed) {
        setAttendance((prev) => prev || parsed);
      }
    }).catch(() => {});

    const messageListener = (message: any) => {
      if (message.type === MESSAGE_TYPES.UMS_STATUS_UPDATE && message.payload) {
        const payload: UmsResponsePayload = message.payload;
        if (payload.status === 'READY' && payload.attendance && payload.attendance.status === 'verified') {
          setStatus('READY');
          setAttendance(payload.attendance);
          addActivity(
            `Verified ${payload.attendance.totalCourses} subjects`,
            `Overall: ${payload.attendance.overallPercentage}%`
          );
        } else {
          setStatus(payload.status);
          setErrorMessage(payload.errorMessage || null);
          setHasAttendanceLink(Boolean(payload.hasAttendanceLink));
          // Only wipe attendance if session is truly logged out or disconnected from UMS
          if (payload.status === 'NOT_CONNECTED' || payload.status === 'LOGIN_PAGE' || payload.status === 'HUMAN_VERIFICATION') {
            setAttendance(null);
          }
        }
      } else if (message.type === 'ONEE_TAB_CHANGED') {
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
    errorMessage,
    isLoading,
    activities,
    hasAttendanceLink,
    refresh,
    openUmsTab,
    navigateToAttendance
  };
}
