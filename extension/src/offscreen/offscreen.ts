/**
 * ONEE Offscreen Document Audio Runtime.
 *
 * Dedicated to non-blocking audio playback in Chrome MV3:
 * - Plays synthesized speech from Groq Orpheus without freezing the UI or side panel.
 * - Handles immediate cancellation (barge-in) when interrupted.
 * - Dispatches runtime playback status events.
 */

let currentAudio: HTMLAudioElement | null = null;
let currentExecutionId: string | null = null;

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

function stopCurrentAudio() {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      if (currentAudio.src && currentAudio.src.startsWith('blob:')) {
        URL.revokeObjectURL(currentAudio.src);
      }
    } catch (e) {
      console.warn('[Offscreen Audio] Error pausing audio:', e);
    }
    currentAudio = null;
    currentExecutionId = null;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'offscreen-audio') {
    return false;
  }

  switch (message.type) {
    case 'PLAY_AUDIO': {
      const { executionId, audioBase64, contentType = 'audio/wav' } = message;

      // Stop any existing audio immediately
      stopCurrentAudio();

      try {
        const blob = base64ToBlob(audioBase64, contentType);
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudio = audio;
        currentExecutionId = executionId;

        audio.onplay = () => {
          chrome.runtime.sendMessage({
            type: 'AUDIO_PLAYBACK_STARTED',
            executionId
          }).catch(() => {});
        };

        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (currentAudio === audio) {
            currentAudio = null;
            currentExecutionId = null;
          }
          chrome.runtime.sendMessage({
            type: 'AUDIO_PLAYBACK_ENDED',
            executionId
          }).catch(() => {});
        };

        audio.onerror = (err) => {
          URL.revokeObjectURL(url);
          console.error('[Offscreen Audio] Playback error:', err);
          if (currentAudio === audio) {
            currentAudio = null;
            currentExecutionId = null;
          }
          chrome.runtime.sendMessage({
            type: 'AUDIO_PLAYBACK_FAILED',
            executionId,
            error: 'Audio playback failed'
          }).catch(() => {});
        };

        audio.play().then(() => {
          sendResponse({ success: true, executionId });
        }).catch((playErr) => {
          console.error('[Offscreen Audio] Failed to play audio:', playErr);
          sendResponse({ success: false, error: playErr.message });
        });

        return true; // Keep channel open for async sendResponse
      } catch (err: any) {
        console.error('[Offscreen Audio] Exception loading audio:', err);
        sendResponse({ success: false, error: err.message });
        return false;
      }
    }

    case 'STOP_AUDIO': {
      stopCurrentAudio();
      sendResponse({ success: true });
      return false;
    }

    case 'GET_STATUS': {
      sendResponse({
        isPlaying: currentAudio !== null && !currentAudio.paused,
        executionId: currentExecutionId
      });
      return false;
    }

    default:
      return false;
  }
});

console.log('[ONEE Offscreen Audio] Audio runtime initialized.');
