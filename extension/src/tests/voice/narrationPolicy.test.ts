import { describe, it, expect, beforeEach } from 'vitest';
import { NarrationPolicyEngine } from '../../voice/NarrationPolicy';
import { OneeRuntimeState } from '../../lib/runtimeState';
import { FinalResponseData } from '../../shared/types';

describe('NarrationPolicyEngine', () => {
  let engine: NarrationPolicyEngine;
  let mockRuntimeState: OneeRuntimeState;

  beforeEach(() => {
    engine = new NarrationPolicyEngine();
    mockRuntimeState = {
      connectionState: 'CONNECTED',
      agentState: {
        status: 'executing',
        currentStep: 1,
        maxSteps: 15,
        activities: [],
        capability: 'EXAM_DATE_SHEET',
        currentGoal: 'Check next exam'
      },
      attendance: null,
      isUserTyping: false,
      isChatStreaming: false,
      lastUserMessage: null,
      lastExplicitInteractionAt: Date.now()
    };
  });

  it('returns null when mode is OFF', () => {
    const phrase = engine.getNarrationPhrase('PLANNING', mockRuntimeState, {
      mode: 'OFF',
      level: 'IMPORTANT'
    });
    expect(phrase).toBeNull();
  });

  it('in ASSIST mode, suppresses intermediate navigation milestones', () => {
    const phrase = engine.getNarrationPhrase('LOCATING', mockRuntimeState, {
      mode: 'ASSIST',
      level: 'IMPORTANT'
    });
    expect(phrase).toBeNull();

    const actPhrase = engine.getNarrationPhrase('ACTING', mockRuntimeState, {
      mode: 'ASSIST',
      level: 'IMPORTANT'
    });
    expect(actPhrase).toBeNull();
  });

  it('in LIVE_AGENT mode, provides concise progressive narration before actions', () => {
    const planPhrase = engine.getNarrationPhrase('PLANNING', mockRuntimeState, {
      mode: 'LIVE_AGENT',
      level: 'IMPORTANT'
    });
    expect(planPhrase).toContain('examination schedule');

    const locPhrase = engine.getNarrationPhrase('LOCATING', mockRuntimeState, {
      mode: 'LIVE_AGENT',
      level: 'IMPORTANT'
    });
    expect(locPhrase).toContain('Finding your examination');
  });

  it('never speaks verified result before actual validation and verification succeed', () => {
    // During ACTING, it must use progressive phrasing, NOT claims of final success
    mockRuntimeState.agentState!.currentAction = {
      action: 'click',
      reason: 'Opening Date Sheet from navigation',
      attemptNumber: 1
    };

    const phrase = engine.getNarrationPhrase('ACTING', mockRuntimeState, {
      mode: 'LIVE_AGENT',
      level: 'IMPORTANT'
    });
    expect(phrase).toContain('Opening your examination schedule');
    expect(phrase).not.toContain('verified');
  });

  it('formats verified exam result truthfully with date, time, and seat', () => {
    const finalResponse: FinalResponseData = {
      status: 'READY',
      type: 'next_exam',
      title: 'Next Exam: CSE408',
      details: {
        nextExam: {
          courseCode: 'CSE408',
          examDate: '24 Oct 2026',
          startTime: '09:00 AM',
          reportingTime: '08:30 AM',
          seat: 'B-24',
          room: '34-201',
          building: 'Block 34'
        }
      },
      verification: {
        verified: true,
        source: 'UMS Live DOM',
        timestamp: Date.now(),
        executionStatus: 'COMPLETED'
      }
    };

    const speech = engine.formatVerifiedResultSpeech(finalResponse);
    expect(speech).toContain('CSE408');
    expect(speech).toContain('24 Oct 2026');
    expect(speech).toContain('B-24');
    expect(speech).toContain('room 34-201');
  });

  it('formats verified attendance and bunk calculation accurately', () => {
    const finalResponse: FinalResponseData = {
      status: 'READY',
      type: 'safe_bunk',
      title: 'CSE329 → 2 classes safe',
      subjectCode: 'CSE329',
      percentage: 82.5,
      safeBuffer: 2,
      verification: {
        verified: true,
        source: 'UMS Attendance Parser',
        timestamp: Date.now(),
        executionStatus: 'COMPLETED'
      }
    };

    const speech = engine.formatVerifiedResultSpeech(finalResponse);
    expect(speech).toContain('CSE329');
    expect(speech).toContain('83 percent');
    expect(speech).toContain('2 classes');
  });

  it('deduplicates rapid repetitive phrases within throttle window', () => {
    const phrase1 = engine.getNarrationPhrase('WAITING', mockRuntimeState, {
      mode: 'LIVE_AGENT',
      level: 'IMPORTANT'
    });
    expect(phrase1).toContain('UMS page is loading');

    // Immediate second call should be suppressed to avoid robotic stutter
    const phrase2 = engine.getNarrationPhrase('WAITING', mockRuntimeState, {
      mode: 'LIVE_AGENT',
      level: 'IMPORTANT'
    });
    expect(phrase2).toBeNull();
  });
});
