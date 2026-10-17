import { describe, expect, it } from 'vitest';
import { planNextAction, setBackendUrlForTesting } from '../services/api';
import { PageObservation } from '../shared/types';

describe('date-sheet planner routing', () => {
  it('extracts immediately when the seating-plan URL is live even if a stale observer label says dashboard', async () => {
    // Prevent a network request: examination goals use the deterministic route.
    setBackendUrlForTesting(null);
    const observation: PageObservation = {
      url: 'https://studentums.lpu.in/dashboard/examination/conduct/seatingplan',
      title: 'Examination Date Sheet',
      pageType: 'Student Dashboard',
      isLoginPage: false,
      isAuthenticated: true,
      hasAttendanceTable: false,
      hasCampusDriveModal: false,
      isExamPage: false,
      isExamContentRendered: true,
      hasExamTable: false,
      examRecordsCount: 1,
      isTimetablePage: false,
      hasTimetableGrid: false,
      elements: [],
      viewportWidth: 1280,
      viewportHeight: 720,
      devicePixelRatio: 1
    };

    const plan = await planNextAction('Show my complete date sheet', 1, observation);

    expect(plan.action.action).toBe('extractExamination');
    expect(plan.action.reason).not.toContain('Opening Date Sheet');
  });

  it('uses the Groq semantic capability instead of reclassifying a neutral execution goal', async () => {
    setBackendUrlForTesting(null);
    const observation: PageObservation = {
      url: 'https://ums.lpu.in/LpuUms/StudentDashboard.aspx',
      title: 'Student Dashboard',
      pageType: 'Dashboard',
      isLoginPage: false,
      isAuthenticated: true,
      hasAttendanceTable: false,
      hasCampusDriveModal: false,
      isExamPage: false,
      isExamContentRendered: false,
      hasExamTable: false,
      examRecordsCount: 0,
      isTimetablePage: false,
      hasTimetableGrid: false,
      elements: [],
      viewportWidth: 1280,
      viewportHeight: 720,
      devicePixelRatio: 1
    };

    const plan = await planNextAction(
      'retrieve the verified records',
      1,
      observation,
      [],
      undefined,
      undefined,
      { intent: 'examination_query', capability: 'examination', target: 'examination', action: 'read' }
    );

    expect(plan.action.action).toBe('scroll');
    expect(plan.action.reason).toContain('Date Sheet');
  });
});
