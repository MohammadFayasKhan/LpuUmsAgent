import { describe, it, expect, vi, beforeEach } from 'vitest';
import { voiceController } from '../../voice/VoiceController';
import { nativeSpeechRecognitionProvider } from '../../voice/providers/NativeSpeechRecognitionProvider';
import { nativeSpeechSynthesisProvider } from '../../voice/providers/NativeSpeechSynthesisProvider';

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

describe('VoiceController', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
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
    expect(nativeSpeechSynthesisProvider.stop).toHaveBeenCalled();
    expect(nativeSpeechRecognitionProvider.start).toHaveBeenCalled();
  });

  it('handles user voice cancellation command by cancelling active agent safely', async () => {
    const cancelAgentMock = vi.fn();
    const commandHandlerMock = vi.fn();

    voiceController.registerHandlers(commandHandlerMock, cancelAgentMock);

    // Call startListening with mock triggering "stop"
    (nativeSpeechRecognitionProvider.start as any).mockImplementationOnce(
      (_onInterim: any, onFinal: any) => {
        onFinal('stop');
      }
    );

    await voiceController.startListening();

    expect(cancelAgentMock).toHaveBeenCalled();
    expect(nativeSpeechSynthesisProvider.speak).toHaveBeenCalled();
  });

  it('dispatches student voice commands directly into the registered agent pipeline', async () => {
    const commandHandlerMock = vi.fn();
    voiceController.registerHandlers(commandHandlerMock);

    (nativeSpeechRecognitionProvider.start as any).mockImplementationOnce(
      (_onInterim: any, onFinal: any) => {
        onFinal('What is my next exam?');
      }
    );

    await voiceController.startListening();

    expect(commandHandlerMock).toHaveBeenCalledWith('What is my next exam?');
  });
});
