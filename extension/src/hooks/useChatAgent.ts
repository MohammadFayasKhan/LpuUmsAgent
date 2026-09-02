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
import { AttendanceSummary, ChatMessage, AgentActivity } from '../shared/types';
import { streamChatMessage } from '../services/api';
import {
  localDatabase,
  ConversationRecord,
  MessageRecord
} from '../services/localDatabase';
import { personalizationStore } from '../services/personalizationStore';

export interface UseChatAgentResult {
  messages: ChatMessage[];
  isTyping: boolean;
  sendMessage: (text: string) => Promise<void>;
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

/**
 * Generates dynamic, highly personalized prompt suggestions based on current student data.
 */
function generateDynamicSuggestions(
  attendance: AttendanceSummary | null,
  messages: ChatMessage[] = []
): string[] {
  if (!attendance || !attendance.courses || attendance.courses.length === 0) {
    const unauthenticatedPool = [
      "Check my live attendance",
      "Which subject has the lowest attendance?",
      "How do safe bunk calculations work?",
      "Show my overall attendance summary"
    ];
    return unauthenticatedPool;
  }

  const courses = attendance.courses;
  const dangerCourses = courses.filter((c) => c.percentage < 75);
  const safeCourses = courses.filter((c) => c.percentage >= 75);

  // Extract recent query context from chat history
  const recentHistoryText = messages
    .slice(-8)
    .map((m) => (m.text || m.content || '').toUpperCase())
    .join(' ');

  // Filter courses that haven't been queried recently
  const unaskedCourses = courses.filter(
    (c) => !recentHistoryText.includes(c.code.toUpperCase())
  );

  const pool: string[] = [];

  // 1. Critical & At-Risk Course Inquiries
  if (dangerCourses.length > 0) {
    dangerCourses.forEach((c) => {
      if (!recentHistoryText.includes(c.code.toUpperCase())) {
        pool.push(`How many classes to recover ${c.code} to 75%?`);
        pool.push(`Can I afford to miss any ${c.code} lectures?`);
      }
    });
  }

  // 2. Unasked Course Inquiries
  const coursesToSuggest = unaskedCourses.length > 0 ? unaskedCourses : courses;
  coursesToSuggest.forEach((c) => {
    if (c.percentage >= 85) {
      pool.push(`How many classes can I safely skip in ${c.code}?`);
    } else if (c.percentage >= 75) {
      pool.push(`Can I bunk any classes in ${c.code}?`);
      pool.push(`What is my safe margin in ${c.code}?`);
    } else {
      pool.push(`How to get ${c.code} back to 75%?`);
    }
  });

  // 3. Strategic / Overview Questions
  if (!recentHistoryText.includes('BUFFER') && !recentHistoryText.includes('COMBINED')) {
    pool.push(`What is my overall bunk buffer across all ${courses.length} subjects?`);
  }
  if (!recentHistoryText.includes('CLOSEST') && !recentHistoryText.includes('RISK') && safeCourses.length > 0) {
    pool.push(`Which subject is closest to falling below 75%?`);
  }
  if (!recentHistoryText.includes('BREAKDOWN') && !recentHistoryText.includes('SUMMARY')) {
    pool.push(`Give me a summary breakdown of all my subjects`);
  }
  if (!recentHistoryText.includes('ELIGIB') && !recentHistoryText.includes('EXAM')) {
    pool.push(`Am I eligible for exams across all subjects?`);
  }
  if (!recentHistoryText.includes('TOMORROW') && !recentHistoryText.includes('MISS')) {
    pool.push(`What happens if I take leave tomorrow?`);
  }

  // Deduplicate and filter out any prompt that matches an existing message exactly
  const uniqueSuggestions = Array.from(new Set(pool)).filter(
    (sug) => !messages.some((m) => (m.text || m.content || '').trim().toLowerCase() === sug.trim().toLowerCase())
  );

  // Return up to 4 dynamic suggestions
  if (uniqueSuggestions.length >= 3) {
    return uniqueSuggestions.slice(0, 4);
  }

  // Fallback defaults if pool is depleted
  const fallbacks = [
    `Can I bunk any classes in ${courses[0]?.code || 'my courses'}?`,
    `What is my overall bunk buffer?`,
    `Give me a summary breakdown of all my subjects`,
    `Which subject has the lowest attendance?`
  ];
  return Array.from(new Set([...uniqueSuggestions, ...fallbacks])).slice(0, 4);
}

export function useChatAgent(
  attendance: AttendanceSummary | null,
  onActivityLog?: (activity: AgentActivity) => void,
  accountId: string = 'default'
): UseChatAgentResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState<boolean>(false);
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>('');
  const [localVerifiedContext, setLocalVerifiedContext] = useState<AttendanceSummary | null>(null);

  const activeConvRef = useRef<string>('');
  activeConvRef.current = activeConversationId;

  // Effective attendance: Merges live snapshot with local verified context so exact class counts are never lost
  const effectiveAttendance = useMemo(() => {
    if (!attendance || !attendance.courses || attendance.courses.length === 0) {
      return localVerifiedContext;
    }
    if (!localVerifiedContext || !localVerifiedContext.courses || localVerifiedContext.courses.length === 0) {
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
        const [convList, verifiedAtt] = await Promise.all([
          localDatabase.listConversations(accountId),
          localDatabase.getLatestVerifiedAttendance(accountId)
        ]);

        if (!isMounted) return;

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
            source: 'live-ums-dom'
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

  // Dynamic contextual suggestions based on live/local attendance state and message history
  const suggestions = useMemo(
    () => generateDynamicSuggestions(effectiveAttendance, messages),
    [effectiveAttendance, messages]
  );

  const switchConversation = useCallback(
    async (conversationId: string) => {
      setActiveConversationId(conversationId);
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
    async (text: string) => {
      if (!text.trim() || isTyping) return;

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

      try {
        const response = await streamChatMessage(
          text,
          effectiveAttendance,
          messages,
          (chunk: string) => {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, text: m.text + chunk } : m))
            );
          },
          (act: AgentActivity) => {
            if (onActivityLog) onActivityLog(act);
          }
        );

        const oneeTimestamp = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        });

        const finalText = response.message || '';

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  text: finalText || m.text,
                  timestamp: oneeTimestamp,
                  isStreaming: false,
                  activities: response.activities,
                  toolCalls: response.tool_calls
                }
              : m
          )
        );

        // Persist assistant message to IndexedDB
        const assistantRecord: MessageRecord = {
          id: assistantId,
          conversationId: convId,
          accountId,
          role: 'assistant',
          content: finalText,
          timestamp: oneeTimestamp,
          createdAt: Date.now(),
          sources: effectiveAttendance ? ['UMS_DOM'] : [],
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
            lastMessagePreview: finalText.slice(0, 80)
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
    clearHistory,
    suggestions,
    conversations,
    activeConversationId,
    newConversation,
    switchConversation,
    deleteConversation
  };
}
