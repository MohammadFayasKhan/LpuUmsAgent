/**
 * Chrome Offscreen Document Audio Manager for ONEE.
 *
 * Ensures audio playback is fully isolated from the side panel UI thread,
 * preventing any UI freezing or stutter during high-speed agent execution.
 */

let creatingOffscreen: Promise<void> | null = null;
let fallbackAudio: HTMLAudioElement | null = null;

async function ensureOffscreenDocument(): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.offscreen) {
    return false;
  }

  try {
    const existing = await chrome.offscreen.hasDocument();
    if (existing) {
      return true;
    }

    if (creatingOffscreen) {
      await creatingOffscreen;
      return true;
    }

    creatingOffscreen = chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen.html'),
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: 'Play synthesized AI speech responses from Groq Orpheus without UI interruption'
    });

    await creatingOffscreen;
    creatingOffscreen = null;
    return true;
  } catch (err: any) {
    console.warn('[OffscreenAudio] Could not create offscreen document, using fallback:', err);
    creatingOffscreen = null;
    return false;
  }
}

export async function playOffscreenAudio(
  executionId: string,
  audioBase64: string,
  contentType: string = 'audio/wav'
): Promise<boolean> {
  const hasOffscreen = await ensureOffscreenDocument();

  if (hasOffscreen) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          target: 'offscreen-audio',
          type: 'PLAY_AUDIO',
          executionId,
          audioBase64,
          contentType
        },
        (response) => {
          if (chrome.runtime.lastError || !response?.success) {
            console.warn('[OffscreenAudio] Message send failed or offscreen error:', chrome.runtime.lastError || response?.error);
            // Fallback to local audio
            playLocalAudio(executionId, audioBase64, contentType).then(resolve);
          } else {
            resolve(true);
          }
        }
      );
    });
  } else {
    return playLocalAudio(executionId, audioBase64, contentType);
  }
}

export async function stopOffscreenAudio(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.offscreen) {
    try {
      const hasDoc = await chrome.offscreen.hasDocument();
      if (hasDoc) {
        chrome.runtime.sendMessage({
          target: 'offscreen-audio',
          type: 'STOP_AUDIO'
        }).catch(() => {});
      }
    } catch (e) {
      // ignore
    }
  }

  if (fallbackAudio) {
    try {
      fallbackAudio.pause();
      fallbackAudio.currentTime = 0;
      if (fallbackAudio.src.startsWith('blob:')) {
        URL.revokeObjectURL(fallbackAudio.src);
      }
    } catch (e) {}
    fallbackAudio = null;
  }
}

async function playLocalAudio(
  _executionId: string,
  audioBase64: string,
  contentType: string
): Promise<boolean> {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') {
    return false;
  }

  stopOffscreenAudio();

  try {
    const byteCharacters = atob(audioBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: contentType });
    const url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    fallbackAudio = audio;

    return new Promise((resolve) => {
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (fallbackAudio === audio) fallbackAudio = null;
        resolve(true);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        if (fallbackAudio === audio) fallbackAudio = null;
        resolve(false);
      };
      audio.play().then(() => resolve(true)).catch((e) => {
        console.warn('[OffscreenAudio] Local audio play failed:', e);
        resolve(false);
      });
    });
  } catch (err) {
    console.error('[OffscreenAudio] Failed to decode audio locally:', err);
    return false;
  }
}
