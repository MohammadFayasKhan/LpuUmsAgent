/*
 * Chat Agent Hook for ONEE Side Panel.
 *
 * This hook manages the conversational interface with the student:
 * 1. Thread Persistence: Saves conversations and messages locally in IndexedDB.
 *    Reloading the side panel restores the active conversation cleanly.
 * 2. Grounded Context: Injects the latest verified UMS attendance numbers into
 *    the prompt context so calculations are exact.
 * 3. Fallback Resilience: If the remote backend is unreachable, it delegates to
 *    our local streaming generator so the student never sees a blank screen or raw fetch error.
 * 4. Local Personalization: Learns preferred subjects and frequently asked questions
 *    on-device without transmitting browsing habits to third parties.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { AttendanceSummary, ExaminationSummary, TimetableSummary, ChatMessage, AgentActivity } from '../shared/types';
import { streamChatMessage } from '../services/api';
import {
  localDatabase,
  ConversationRecord,
  MessageRecord
} from '../services/localDatabase';
import { verifiedExaminationRepo, verifiedTimetableRepo } from '../services/repositories';
import { generateContextualSuggestions } from '../services/suggestionGenerator';
import { personalizationStore } from '../services/personalizationStore';
import { cleanPreviewSnippet } from '../lib/scrollUtils';
import { sanitizeFinalResponseText } from '../lib/sanitizeResponseText';
import { routeUserIntent } from '../services/intentRouter';
import { isCachedAttendanceForStudent } from '../shared/attendanceCalculator';
import { voiceController } from '../voice';

export interface UseChatAgentResult {
  messages: ChatMessage[];
  isTyping: boolean;
  sendMessage: (
    text: string,
    options?: {
      skipVoice?: boolean;
      executionId?: string;
      attendance?: AttendanceSummary | null;
      examination?: ExaminationSummary | null;
      timetable?: TimetableSummary | null;
    }
  ) => Promise<void>;
  startPendingExchange: (userText: string, executionId: string) => Promise<string>;
  updatePendingExchangeChunk: (placeholderId: string, chunk: string) => void;
  completePendingExchange: (
    placeholderId: string,
    userText: string,
    reply: string,
    options?: {
      executionId?: string;
      cardType?: string;
      ttsChunks?: string[];
      skipVoice?: boolean;        suggestions?: string[];
        capability?: string;
      }
    ) => Promise<void>;
  clearHistory: () => void;
  suggestions: string[];
  conversations: ConversationRecord[];
  activeConversationId: string;
  newConversation: () => Promise<string>;
  switchConversation: (conversationId: string) => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
}

function generateUUID(): string {
  return 'conv-' + Math.random().toString(36).substring(2, 9) + '-' + Date.now().toString(36);
}
export function useChatAgent(
  attendance: AttendanceSummary | null,
  onActivityLog?: (activity: AgentActivity) => void,
  accountId: string = 'default',
  examination?: ExaminationSummary | null,
  timetable?: TimetableSummary | null
): UseChatAgentResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>('');
  const [localVerifiedContext, setLocalVerifiedContext] = useState<AttendanceSummary | null>(null);
  const [localVerifiedExamination, setLocalVerifiedExamination] = useState<ExaminationSummary | null>(null);
  const [localVerifiedTimetable, setLocalVerifiedTimetable] = useState<TimetableSummary | null>(null);
  const [dynamicSuggestions, setDynamicSuggestions] = useState<string[]>([]);

  const activeConvRef = useRef<string>('');
  activeConvRef.current = activeConversationId;

  // Effective examination: Merges live examination snapshot with local verified records
  const effectiveExamination = useMemo(() => {
    if (examination && examination.exams && examination.exams.length > 0) {
      return examination;
    }
    return localVerifiedExamination;
  }, [examination, localVerifiedExamination]);

  // Effective timetable: Merges live timetable snapshot with local verified records
  const effectiveTimetable = useMemo(() => {
    if (timetable && timetable.slots && timetable.slots.length > 0) {
      return timetable;
    }
    return localVerifiedTimetable;
  }, [timetable, localVerifiedTimetable]);

  // Effective attendance: Merges live snapshot with local verified context so exact class counts are never lost
  const effectiveAttendance = useMemo(() => {
    if (!attendance || !attendance.courses || attendance.courses.length === 0) {
      return localVerifiedContext;
    }
    if (!localVerifiedContext || !localVerifiedContext.courses || localVerifiedContext.courses.length === 0) {
      return attendance;
    }

    // Never merge another UMS account's cached counts into the live snapshot
    // captured from the tab currently on screen.
    if (!isCachedAttendanceForStudent(localVerifiedContext, attendance)) {
      return attendance;
    }

    // Merge: Preserve verified class counts from localVerifiedContext if live snapshot only has percentage (total === 0)
    const mergedCourses = attendance.courses.map((course) => {
      if (course.total === 0) {
        const verifiedMatch = localVerifiedContext.courses.find(
          (vc) => vc.code.toUpperCase() === course.code.toUpperCase()
        );
        if (verifiedMatch && verifiedMatch.total > 0) {
          return {
            ...course,
            attended: verifiedMatch.attended,
            total: verifiedMatch.total,
            delivered: verifiedMatch.total,
            dutyLeave: verifiedMatch.dutyLeave ?? course.dutyLeave,
            lastAttended: verifiedMatch.lastAttended ?? course.lastAttended
          };
        }
      }
      return course;
    });

    const hasAnyZeroTotal = mergedCourses.some((c) => c.total === 0);
    const totalDelivered = hasAnyZeroTotal && localVerifiedContext.totalDelivered > 0
      ? localVerifiedContext.totalDelivered
      : attendance.totalDelivered;
    const totalAttended = hasAnyZeroTotal && localVerifiedContext.totalAttended > 0
      ? localVerifiedContext.totalAttended
      : attendance.totalAttended;

    return {
      ...attendance,
      totalDelivered,
      totalAttended,
      courses: mergedCourses
    };
  }, [attendance, localVerifiedContext]);

  // Load initial conversation and messages from IndexedDB
  useEffect(() => {
    let isMounted = true;

    async function loadStorage() {
      try {
        const [convList, verifiedAtt, verifiedExam, verifiedTt] = await Promise.all([
          localDatabase.listConversations(accountId),
          localDatabase.getLatestVerifiedAttendance(accountId),
          verifiedExaminationRepo.getLatestVerifiedExamination(accountId),
          verifiedTimetableRepo.getLatestVerifiedTimetable(accountId)
        ]);

        if (!isMounted) return;

        if (verifiedTt && verifiedTt.timetable) {
          setLocalVerifiedTimetable(verifiedTt.timetable);
        }

        if (verifiedExam && verifiedExam.examination) {
          setLocalVerifiedExamination(verifiedExam.examination);
        }

        if (verifiedAtt && verifiedAtt.subjects) {
          setLocalVerifiedContext({
            courses: verifiedAtt.subjects.map((s) => ({
              code: s.code,
              name: s.code,
              percentage: s.percentage,
              attended: s.attended,
              total: s.delivered,
              dutyLeave: s.dutyLeave || 0,
              lastAttended: s.lastAttended
            })),
            overallPercentage: verifiedAtt.aggregate.percentage,
            totalAttended: verifiedAtt.aggregate.attended,
            totalDelivered: verifiedAtt.aggregate.delivered,
            totalCourses: verifiedAtt.aggregate.totalCourses,
            status: 'verified',
            // Cached snapshot, not a fresh DOM read — labeled honestly so it
            // can never masquerade as live data in answers or cards.
            source: 'cached-verified-record'
          });
        }

        if (convList.length > 0) {
          setConversations(convList);
          const activeConv = convList[0];
          setActiveConversationId(activeConv.id);
          const savedMsgs = await localDatabase.listMessages(activeConv.id);
          if (isMounted) {
            setMessages(
              savedMsgs.map((m) => ({
                id: m.id,
                sender: m.role === 'user' ? 'user' : 'onee',
                text: m.content,
                timestamp: m.timestamp,
                activities: m.activities,
                isError: m.isError
              }))
            );
          }
        } else {
          // Create initial conversation
          const newId = generateUUID();
          const initialConv: ConversationRecord = {
            id: newId,
            accountId,
            title: 'Attendance',
            createdAt: Date.now(),
            updatedAt: Date.now()
          };
          await localDatabase.saveConversation(initialConv);
          if (isMounted) {
            setConversations([initialConv]);
            setActiveConversationId(newId);
            setMessages([]);
          }
        }
      } catch (err) {
        console.warn('Failed to load local IndexedDB chat history:', err);
      }
    }

    loadStorage();

    return () => {
      isMounted = false;
    };
  }, [accountId]);

  // Baseline dynamic contextual suggestions based on live/local attendance & exam state and message history
  const baselineSuggestions = useMemo(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.sender === 'user')?.text || null;
    const lastAsstMsg = [...messages].reverse().find((m) => m.sender === 'onee' && m.text)?.text || null;
    return generateContextualSuggestions(
      effectiveAttendance,
      lastUserMsg,
      effectiveExamination,
      effectiveTimetable || null,
      lastAsstMsg
    );
  }, [effectiveAttendance, messages, effectiveExamination, effectiveTimetable]);

  const suggestions = useMemo(() => {
    return dynamicSuggestions.length > 0 ? dynamicSuggestions : baselineSuggestions;
  }, [dynamicSuggestions, baselineSuggestions]);

  const switchConversation = useCallback(
    async (conversationId: string) => {
      setActiveConversationId(conversationId);
      setDynamicSuggestions([]);
      try {
        const savedMsgs = await localDatabase.listMessages(conversationId);
        setMessages(
          savedMsgs.map((m) => ({
            id: m.id,
            sender: m.role === 'user' ? 'user' : 'onee',
            text: m.content,
            timestamp: m.timestamp,
            activities: m.activities,
            isError: m.isError
          }))
        );
      } catch {
        setMessages([]);
      }
    },
    []
  );

  const newConversation = useCallback(async (): Promise<string> => {
    const newId = generateUUID();
    const newConv: ConversationRecord = {
      id: newId,
      accountId,
      title: 'New Chat',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await localDatabase.saveConversation(newConv);
    setConversations((prev) => [newConv, ...prev]);
    setActiveConversationId(newId);
    setDynamicSuggestions([]);
    setMessages([]);
    return newId;
  }, [accountId]);

  const deleteConversation = useCallback(
    async (conversationId: string) => {
      await localDatabase.deleteConversation(conversationId);
      setConversations((prev) => {
        const remaining = prev.filter((c) => c.id !== conversationId);
        if (activeConvRef.current === conversationId && remaining.length > 0) {
          switchConversation(remaining[0].id);
        } else if (remaining.length === 0) {
          newConversation();
        }
        return remaining;
      });
    },
    [newConversation, switchConversation]
  );

  const sendMessage = useCallback(
    async (
      text: string,
      options?: {
        skipVoice?: boolean;
        executionId?: string;
        attendance?: AttendanceSummary | null;
        examination?: ExaminationSummary | null;
        timetable?: TimetableSummary | null;
      }
    ) => {
      if (!text.trim() || isTyping) return;

      const skipVoice = Boolean(options?.skipVoice);

      // Stop any ongoing speech from older executions (preserve immediate acknowledgement for current request)
      if (!skipVoice) {
        const currentExec = voiceController.getActiveExecutionId();
        if (!options?.executionId || options.executionId !== currentExec) {
          voiceController.stopSpeaking();
        }
      }

      let convId = activeConvRef.current;
      if (!convId) {
        convId = await newConversation();
      }

      const userTimestamp = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });

      const userMessageId = `user-${Date.now()}`;
      const userMessage: ChatMessage = {
        id: userMessageId,
        sender: 'user',
        text: text.trim(),
        timestamp: userTimestamp
      };

      const assistantId = `onee-${Date.now()}`;
      const execId = options?.executionId || assistantId;
      const assistantPlaceholder: ChatMessage = {
        id: assistantId,
        sender: 'onee',
        text: '',
        timestamp: userTimestamp,
        isStreaming: true
      };

      setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
      setIsTyping(true);

      // Persist user message to IndexedDB
      const userRecord: MessageRecord = {
        id: userMessageId,
        conversationId: convId,
        accountId,
        role: 'user',
        content: text.trim(),
        timestamp: userTimestamp,
        createdAt: Date.now()
      };
      await localDatabase.saveMessage(userRecord);

      // Record task usage in personalization store
      await personalizationStore.recordTaskUsage(text, accountId);

      /*
       * LIVE_UMS_RESPONSE_REQUIRES_VERIFIED_EXECUTION:
       * this direct chat stream may only answer non-live, conversational text.
       * Live UMS capabilities must go through the unified pipeline in App.tsx
       * (semantic intent -> capability -> Browser Agent -> verified result ->
       * response composer), never straight to an LLM.
       */
      const routedCapability = String(routeUserIntent(text).capability);
      if (
        ['ATTENDANCE', 'EXAM_DATE_SHEET', 'SEATING_PLAN', 'SAMPLE_PAPER', 'TIMETABLE'].includes(
          routedCapability
        )
      ) {
        const executionRequiredText =
          "This is a live UMS question, so I need to run my Browser Agent against your UMS session before I can answer. Please send it again from the main chat so I can verify the data first.";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  text: executionRequiredText,
                  timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                  isStreaming: false,
                  isError: false
                }
              : m
          )
        );
        await localDatabase.saveMessage({
          id: assistantId,
          conversationId: convId,
          accountId,
          role: 'assistant',
          content: executionRequiredText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          createdAt: Date.now()
        });
        setIsTyping(false);
        return;
      }

      if (!skipVoice) {
        // Track active execution ID on voiceController for this assistant message
        voiceController.setActiveExecutionId(execId);
      }

      const currentAtt = options?.attendance !== undefined ? options.attendance : effectiveAttendance;
      const currentExam = options?.examination !== undefined ? options.examination : effectiveExamination;
      const currentTt = options?.timetable !== undefined ? options.timetable : effectiveTimetable;

      try {
        const response = await streamChatMessage(
          text,
          currentAtt,
          messages,
          (chunk: string) => {
            const cleanChunk = chunk.replace(/—/g, '→');
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, text: ((m.text || '') + cleanChunk).replace(/—/g, '→') } : m))
            );
          },
          (act: AgentActivity) => {
            if (onActivityLog) onActivityLog(act);
          },
          currentExam,
          (suggs: string[]) => {
            if (Array.isArray(suggs) && suggs.length > 0) {
              setDynamicSuggestions(suggs);
            }
          },
          currentTt || null
        );

        const oneeTimestamp = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        });

        const finalText = sanitizeFinalResponseText(
          (response.message || '').replace(/—/g, '→')
        );

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  text: finalText || (m.text || '').replace(/—/g, '→'),
                  timestamp: oneeTimestamp,
                  isStreaming: false,
                  activities: response.activities,
                  toolCalls: response.tool_calls
                }
              : m
          )
        );

        // FINAL SPEC: the spoken response IS the canonical chat response (after
        // the queue's deterministic sanitation). No second summary engine.
        if (!skipVoice && voiceController.getPreferences().mode !== 'OFF' && finalText) {
          try {
            voiceController.speakText(finalText, true, execId);
          } catch (voiceErr) {
            console.warn('[ONEE] Voice delivery failed; canonical chat response is unaffected:', voiceErr);
          }
        }

        if (response.suggestions && response.suggestions.length > 0) {
          setDynamicSuggestions(response.suggestions);
        } else {
          setDynamicSuggestions([]);
        }

        // Persist assistant message to IndexedDB
        const assistantRecord: MessageRecord = {
          id: assistantId,
          conversationId: convId,
          accountId,
          role: 'assistant',
          content: finalText,
          timestamp: oneeTimestamp,
          createdAt: Date.now(),
          sources: currentAtt ? ['UMS_DOM'] : [],
          activities: response.activities
        };
        await localDatabase.saveMessage(assistantRecord);

        // Update conversation title if this is the first message
        if (messages.length === 0) {
          const title = text.length > 28 ? text.slice(0, 28) + '…' : text;
          const updatedConv: ConversationRecord = {
            id: convId,
            accountId,
            title,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastMessagePreview: cleanPreviewSnippet(finalText, 80)
          };
          await localDatabase.saveConversation(updatedConv);
          setConversations((prev) =>
            prev.map((c) => (c.id === convId ? { ...c, title, lastMessagePreview: updatedConv.lastMessagePreview } : c))
          );
        }
      } catch (err: any) {
        const errorTimestamp = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        });

        const errText = 'I had trouble generating a response. Local attendance data is still active.';

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  text: errText,
                  timestamp: errorTimestamp,
                  isStreaming: false,
                  isError: true
                }
              : m
          )
        );

        const errorRecord: MessageRecord = {
          id: assistantId,
          conversationId: convId,
          accountId,
          role: 'assistant',
          content: errText,
          timestamp: errorTimestamp,
          createdAt: Date.now(),
          isError: true
        };
        await localDatabase.saveMessage(errorRecord);
      } finally {
        setIsTyping(false);
      }
    },
    [accountId, effectiveAttendance, messages, isTyping, newConversation, onActivityLog]
  );

  const startPendingExchange = useCallback(
    async (userText: string, executionId: string): Promise<string> => {
      let convId = activeConvRef.current;
      if (!convId) {
        convId = await newConversation();
      }

      const userTimestamp = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });

      const userMessageId = `user-${Date.now()}`;
      const assistantMessageId = executionId || `onee-${Date.now()}`;

      const userMessage: ChatMessage = {
        id: userMessageId,
        sender: 'user',
        text: userText.trim(),
        timestamp: userTimestamp
      };

      const assistantPlaceholder: ChatMessage = {
        id: assistantMessageId,
        sender: 'onee',
        text: '',
        timestamp: userTimestamp,
        isStreaming: true
      };

      setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
      setIsTyping(true);
      setDynamicSuggestions([]);

      // Save user message to IndexedDB
      await localDatabase.saveMessage({
        id: userMessageId,
        conversationId: convId,
        accountId,
        role: 'user',
        content: userText.trim(),
        timestamp: userTimestamp,
        createdAt: Date.now()
      });

      await personalizationStore.recordTaskUsage(userText, accountId);
      return assistantMessageId;
    },
    [accountId, newConversation]
  );

  const updatePendingExchangeChunk = useCallback((placeholderId: string, chunk: string) => {
    const cleanChunk = chunk.replace(/—/g, '→');
    setMessages((prev) =>
      prev.map((m) =>
        m.id === placeholderId
          ? {
              ...m,
              text: ((m.text || '') + cleanChunk).replace(/—/g, '→')
            }
          : m
      )
    );
  }, []);

  const completePendingExchange = useCallback(
    async (
      placeholderId: string,
      userText: string,
      reply: string,
      options?: {
        executionId?: string;
        cardType?: string;
        ttsChunks?: string[];
        skipVoice?: boolean;
        suggestions?: string[];
        capability?: string;
      }
    ) => {
      const convId = activeConvRef.current;
      const execId = options?.executionId || placeholderId;
      const skipVoice = Boolean(options?.skipVoice);

      const oneeTimestamp = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });

      const cleanReply = sanitizeFinalResponseText(reply.replace(/—/g, '→'));

      setMessages((prev) =>
        prev.map((m) =>
          m.id === placeholderId
            ? {
                ...m,
                text: cleanReply,
                timestamp: oneeTimestamp,
                isStreaming: false
              }
            : m
        )
      );
      setIsTyping(false);

      if (convId) {
        await localDatabase.saveMessage({
          id: placeholderId,
          conversationId: convId,
          accountId,
          role: 'assistant',
          content: cleanReply,
          timestamp: oneeTimestamp,
          createdAt: Date.now()
        });

        const conv = conversations.find((c) => c.id === convId);
        if (conv) {
          const title = conv.title === 'New Chat' ? userText.slice(0, 30) : conv.title;
          const updatedConv: ConversationRecord = {
            ...conv,
            title,
            updatedAt: Date.now(),
            lastMessagePreview: cleanPreviewSnippet(cleanReply, 80)
          };
          await localDatabase.saveConversation(updatedConv);
          setConversations((prev) =>
            prev.map((c) => (c.id === convId ? updatedConv : c))
          );
        }
      }

      // ONE canonical response: chat renders `cleanReply`; voice speaks the
      // composer's deterministic spoken summary when provided (same verified
      // facts, natural prose — no headings/tables/slashes), else `cleanReply`.
      const spokenReply = sanitizeFinalResponseText(
        options?.ttsChunks && options.ttsChunks.length > 0
          ? options.ttsChunks.join(' ')
          : cleanReply
      );
      if (!skipVoice && voiceController.getPreferences().mode !== 'OFF' && spokenReply) {
        try {
          voiceController.speakText(spokenReply, true, execId);
        } catch (voiceErr) {
          console.warn('[ONEE] Voice delivery failed; canonical chat response is unaffected:', voiceErr);
        }
      }

      // Update contextual dynamic suggestions for this turn
      if (options?.suggestions && options.suggestions.length > 0) {
        setDynamicSuggestions(options.suggestions);
      } else {
        const freshSuggs = generateContextualSuggestions(
          effectiveAttendance,
          userText,
          effectiveExamination,
          effectiveTimetable || null,
          cleanReply
        );
        setDynamicSuggestions(freshSuggs);
      }
    },
    [accountId, conversations, effectiveAttendance, effectiveExamination, messages, effectiveTimetable]
  );

  const clearHistory = useCallback(async () => {
    if (activeConversationId) {
      await localDatabase.deleteConversation(activeConversationId);
    }
    await newConversation();
  }, [activeConversationId, newConversation]);

  return {
    messages,
    isTyping,
    sendMessage,
    startPendingExchange,
    updatePendingExchangeChunk,
    completePendingExchange,
    clearHistory,
    suggestions,
    conversations,
    activeConversationId,
    newConversation,
    switchConversation,
    deleteConversation
  };
}
