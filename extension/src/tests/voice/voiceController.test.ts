import { describe, it, expect, vi, beforeEach } from 'vitest';
import { voiceController, VoiceController } from '../../voice/VoiceController';
import { nativeSpeechSynthesisProvider } from '../../voice/providers/NativeSpeechSynthesisProvider';
import { kokoroTTSProvider } from '../../voice/providers/KokoroTTSProvider';
import { groqOrpheusProvider } from '../../voice/providers/GroqOrpheusProvider';
import { nativeSpeechRecognitionProvider } from '../../voice/providers/NativeSpeechRecognitionProvider';
import { groqWhisperProvider } from '../../voice/providers/GroqWhisperProvider';

vi.mock('../../voice/providers/GroqOrpheusProvider', () => {
  return {
    groqOrpheusProvider: {
      name: 'groq-orpheus-tts',
      isSupported: vi.fn(() => true),
      speak: vi.fn(() => Promise.resolve()),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      isSpeaking: vi.fn(() => false),
      getAvailableVoices: vi.fn(() => Promise.resolve([]))
    }
  };
});

vi.mock('../../voice/providers/GroqWhisperProvider', () => {
  return {
    GroqWhisperProvider: {
      WHISPER_MODEL: 'whisper-large-v3'
    },
    groqWhisperProvider: {
      name: 'groq-whisper',
      isSupported: vi.fn(() => true),
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
      abortUtterance: vi.fn(),
      cancelPendingWork: vi.fn(),
      isListening: vi.fn(() => false)
    }
  };
});

vi.mock('../../voice/providers/NativeSpeechRecognitionProvider', () => {
  return {
    nativeSpeechRecognitionProvider: {
      name: 'native-speech-recognition',
      isSupported: vi.fn(() => true),
      start: vi.fn(),
      stop: vi.fn(),
      abort: vi.fn(),
      isListening: vi.fn(() => false)
    }
  };
});

vi.mock('../../voice/providers/NativeSpeechSynthesisProvider', () => {
  return {
    nativeSpeechSynthesisProvider: {
      name: 'native-speech-synthesis',
      isSupported: vi.fn(() => true),
      speak: vi.fn(() => Promise.resolve()),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      isSpeaking: vi.fn(() => false),
      getAvailableVoices: vi.fn(() => Promise.resolve([]))
    }
  };
});

vi.mock('../../voice/providers/KokoroTTSProvider', () => {
  return {
    kokoroTTSProvider: {
      name: 'kokoro-82m-tts',
      isSupported: vi.fn(() => true),
      initialize: vi.fn(() => Promise.resolve()),
      speak: vi.fn(() => Promise.resolve()),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      isSpeaking: vi.fn(() => false),
      getLifecycleState: vi.fn(() => 'ready'),
      getAvailableVoices: vi.fn(() => Promise.resolve([]))
    }
  };
});

describe('VoiceController', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Shrink the STT completion window so tests do not wait 1.4s of real time.
    VoiceController.STT_COMPLETION_WINDOW_MS = 20;
    await voiceController.setMode('LIVE_AGENT');
  });

  it('updates voice mode cleanly and persists changes', async () => {
    await voiceController.setMode('ASSIST');
    expect(voiceController.getPreferences().mode).toBe('ASSIST');

    await voiceController.setMode('OFF');
    expect(voiceController.getPreferences().mode).toBe('OFF');
  });

  it('triggers barge-in by cancelling active speech when user starts listening', async () => {
    await voiceController.startListening();
    expect(groqOrpheusProvider.stop).toHaveBeenCalled();
    expect(groqWhisperProvider.start).toHaveBeenCalled();
    expect(nativeSpeechRecognitionProvider.start).not.toHaveBeenCalled();
  });

  it('starts a fresh Groq capture on the second microphone press', async () => {
    (groqWhisperProvider.start as any).mockResolvedValue(undefined);
    await voiceController.startListening();
    voiceController.stopListening();
    await voiceController.startListening();
    expect(groqWhisperProvider.start).toHaveBeenCalledTimes(2);
    expect(groqWhisperProvider.abortUtterance).toHaveBeenCalled();
    expect(nativeSpeechRecognitionProvider.start).not.toHaveBeenCalled();
  });

  it('handles user voice cancellation command by cancelling active agent safely and speaking via primary TTS', async () => {
    const cancelAgentMock = vi.fn();
    const commandHandlerMock = vi.fn();

    voiceController.registerHandlers(commandHandlerMock, cancelAgentMock);

    // The primary provider transcript is the only one allowed to dispatch.
    (groqWhisperProvider.start as any).mockImplementationOnce(
      (_onInterim: any, onFinal: any) => {
        onFinal('stop');
      }
    );

    await voiceController.startListening();

    // The final transcript only dispatches after the completion window.
    await new Promise((r) => setTimeout(r, 60));

    expect(cancelAgentMock).toHaveBeenCalled();
    // The only TTS provider is Groq Orpheus (canonical Sofia voice).
    expect(groqOrpheusProvider.speak).toHaveBeenCalled();
    expect(kokoroTTSProvider.speak).not.toHaveBeenCalled();
    expect(nativeSpeechSynthesisProvider.speak).not.toHaveBeenCalled();
  });

  it('dispatches student voice commands directly into the registered agent pipeline', async () => {
    const commandHandlerMock = vi.fn();
    voiceController.registerHandlers(commandHandlerMock);

    (groqWhisperProvider.start as any).mockImplementationOnce(
      (_onInterim: any, onFinal: any) => {
        onFinal('What is my next exam?');
      }
    );

    await voiceController.startListening();

    // The final transcript only dispatches after the completion window.
    await new Promise((r) => setTimeout(r, 60));

    expect(commandHandlerMock).toHaveBeenCalledWith('What is my next exam?');
  });

  it('reports an honest terminal error on Groq failure and NEVER starts browser SpeechRecognition', async () => {
    (groqWhisperProvider.start as any).mockImplementationOnce(
      (_onInterim: any, _onFinal: any, onError: any) => {
        onError(new Error('Groq Whisper transcription timed out.'));
      }
    );
    (nativeSpeechRecognitionProvider.start as any).mockResolvedValue(undefined);

    await voiceController.startListening();

    expect(groqWhisperProvider.start).toHaveBeenCalled();
    // FINAL SPEC: local/browser STT is removed from the runtime entirely.
    expect(nativeSpeechRecognitionProvider.start).not.toHaveBeenCalled();
    expect(voiceController.getState()).toBe('ERROR');
  });

  it('reports a terminal error when Groq backend is unreachable instead of falling back locally', async () => {
    (groqWhisperProvider.start as any).mockImplementationOnce(
      (_onInterim: any, _onFinal: any, onError: any) => {
        onError(new TypeError('Failed to fetch'));
      }
    );

    await voiceController.startListening();

    expect(nativeSpeechRecognitionProvider.start).not.toHaveBeenCalled();
    expect(voiceController.getState()).toBe('ERROR');
  });

  it('supports five consecutive microphone requests without reload, each a fresh Groq capture', async () => {
    (groqWhisperProvider.start as any).mockResolvedValue(undefined);

    for (let i = 0; i < 5; i++) {
      await voiceController.startListening();
      expect(groqWhisperProvider.start).toHaveBeenCalledTimes(i + 1);
      voiceController.stopListening();
    }

    // Every request used the canonical Groq capture; local STT never started,
    // and each press created a fresh capture session via abortUtterance().
    expect(nativeSpeechRecognitionProvider.start).not.toHaveBeenCalled();
    expect((groqWhisperProvider.abortUtterance as any).mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('ignores a late final transcript from a previous request (request-scoped ownership)', async () => {
    const commandHandlerMock = vi.fn();
    voiceController.registerHandlers(commandHandlerMock);

    // Request 1: capture callbacks are retained but never finalize.
    const captured: { final?: (t: string) => void } = {};
    (groqWhisperProvider.start as any).mockImplementationOnce(
      (_onInterim: any, onFinal: any) => {
        captured.final = onFinal;
      }
    );
    await voiceController.startListening();

    // Request 2: a new session token and a new Groq capture.
    (groqWhisperProvider.start as any).mockImplementationOnce(
      (_onInterim: any, onFinal: any) => {
        onFinal('second request transcript');
      }
    );
    await voiceController.startListening();
    await new Promise((r) => setTimeout(r, 60));

    expect(commandHandlerMock).toHaveBeenCalledTimes(1);
    expect(commandHandlerMock).toHaveBeenCalledWith('second request transcript');

    // A LATE final from request 1 must be a no-op: it can never replace the
    // second request's transcript or dispatch a second command.
    captured.final?.('stale first request transcript');
    await new Promise((r) => setTimeout(r, 60));

    expect(commandHandlerMock).toHaveBeenCalledTimes(1);
    expect(commandHandlerMock).not.toHaveBeenCalledWith('stale first request transcript');
  });
});
