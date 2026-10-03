/*
 * Voice Event Bridge for ONEE.
 *
 * Exposes a React hook `useVoiceAgent` to easily bind voice state,
 * mode switching, microphone toggling, and live audio transcription
 * to React components.
 */

import { useState, useEffect, useCallback } from 'react';
import { voiceController } from './VoiceController';
import { VoiceState, VoiceMode, VoicePreferences } from './VoiceTypes';

export interface UseVoiceAgentReturn {
  voiceState: VoiceState;
  voiceMode: VoiceMode;
  preferences: VoicePreferences;
  interimTranscript: string;
  isListening: boolean;
  isSpeaking: boolean;
  startListening: () => Promise<void>;
  stopListening: () => void;
  stopSpeaking: () => void;
  toggleListening: () => Promise<void>;
  setVoiceMode: (mode: VoiceMode) => Promise<void>;
  updatePreferences: (updates: Partial<VoicePreferences>) => Promise<void>;
}

export function useVoiceAgent(): UseVoiceAgentReturn {
  const [voiceState, setVoiceState] = useState<VoiceState>(voiceController.getState());
  const [preferences, setPreferences] = useState<VoicePreferences>(voiceController.getPreferences());
  const [interimTranscript, setInterimTranscript] = useState<string>('');

  useEffect(() => {
    const unsubscribe = voiceController.subscribe((state, payload) => {
      setVoiceState(state);
      setPreferences(voiceController.getPreferences());
      if (payload?.interimTranscript !== undefined) {
        setInterimTranscript(payload.interimTranscript);
      } else if (state === 'IDLE') {
        setInterimTranscript('');
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const startListening = useCallback(async () => {
    await voiceController.startListening();
  }, []);

  const stopListening = useCallback(() => {
    voiceController.stopListening();
  }, []);

  const stopSpeaking = useCallback(() => {
    voiceController.stopSpeaking();
  }, []);

  const toggleListening = useCallback(async () => {
    if (voiceState === 'LISTENING') {
      voiceController.stopListening();
    } else {
      await voiceController.startListening();
    }
  }, [voiceState]);

  const setVoiceMode = useCallback(async (mode: VoiceMode) => {
    await voiceController.setMode(mode);
    setPreferences(voiceController.getPreferences());
  }, []);

  const updatePreferences = useCallback(async (updates: Partial<VoicePreferences>) => {
    await voiceController.updatePreferences(updates);
    setPreferences(voiceController.getPreferences());
  }, []);

  return {
    voiceState,
    voiceMode: preferences.mode,
    preferences,
    interimTranscript,
    isListening: voiceState === 'LISTENING' || voiceState === 'TRANSCRIBING',
    isSpeaking: voiceState === 'SPEAKING',
    startListening,
    stopListening,
    stopSpeaking,
    toggleListening,
    setVoiceMode,
    updatePreferences
  };
}
