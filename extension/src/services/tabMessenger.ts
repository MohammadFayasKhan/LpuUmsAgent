/*
 * Resilient Tab Messenger for ONEE.
 *
 * Communicating between a Chrome Extension side panel and a content script
 * running inside a webpage can fail in several real-world situations:
 * 1. The student navigated to a new page or refreshed UMS, unloading the previous content script.
 * 2. The tab was discarded by Chrome to save RAM.
 * 3. The student has multiple windows open with UMS on a background screen.
 *
 * This messenger handles those cases automatically:
 * - It searches all windows for the active UMS tab.
 * - When sending a message, if it catches "Receiving end does not exist", it requests
 *   the background script to re-inject `content.js` and immediately retries the message.
 */

import { MESSAGE_TYPES } from '../shared/messages';

export interface TabMessengerOptions {
  maxRetries?: number;
  timeoutMs?: number;
}

/**
 * Finds the most relevant tab for ONEE automation.
 * Priority:
 * 1. Active tab in current window if on LPU domain
 * 2. Any active tab on LPU domain across all windows
 * 3. Any tab on LPU domain
 * 4. Currently active tab in current window
 */
export async function getActiveLpuTab(): Promise<chrome.tabs.Tab | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs) return null;

  try {
    const [currentTabs, allTabs] = await Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      chrome.tabs.query({})
    ]);

    // 1. Current active tab on LPU
    if (currentTabs[0]?.url && isLpuUrl(currentTabs[0].url)) {
      return currentTabs[0];
    }

    // 2. Any active tab on LPU
    const activeLpuTab = allTabs.find((t) => t.active && t.url && isLpuUrl(t.url));
    if (activeLpuTab) return activeLpuTab;

    // 3. Any tab on LPU
    const anyLpuTab = allTabs.find((t) => t.url && isLpuUrl(t.url));
    if (anyLpuTab) return anyLpuTab;

    // 4. Fallback to current window's active tab
    return currentTabs[0] || allTabs[0] || null;
  } catch (err) {
    console.debug('[ONEE TabMessenger] Tab query error:', err);
    return null;
  }
}

export function isLpuUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return (
      url.hostname === 'ums.lpu.in' ||
      url.hostname.endsWith('.lpu.in') ||
      url.hostname.includes('lpu')
    );
  } catch {
    return false;
  }
}

export function isInjectableUrl(urlStr?: string): boolean {
  if (!urlStr) return false;
  return urlStr.startsWith('http://') || urlStr.startsWith('https://');
}

/**
 * Self-healing content script injector.
 * Injects content.js if the content script is missing, detached, or after page navigation.
 */
export async function ensureContentScriptActive(tabId: number): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.scripting) return false;

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.url || !isInjectableUrl(tab.url)) {
      return false;
    }
  } catch {
    return false;
  }

  // Step 1: Probe with a fast ping
  const isAlive = await probeContentScript(tabId, 250);
  if (isAlive) return true;

  console.info(`[ONEE Self-Healing] Content script unresponsive on Tab #${tabId}. Injecting content.js...`);

  // Step 2: Inject content script dynamically
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ['content.js']
    });

    // Step 3: Wait and verify handshake
    for (let attempt = 1; attempt <= 4; attempt++) {
      await new Promise((r) => setTimeout(r, 80 * attempt));
      const verified = await probeContentScript(tabId, 300);
      if (verified) {
        console.info(`[ONEE Self-Healing] Content script successfully reinjected on Tab #${tabId}!`);
        return true;
      }
    }
  } catch (err: any) {
    console.debug(`[ONEE Self-Healing] executeScript notice on Tab #${tabId}:`, err.message);
  }

  return false;
}

/**
 * Probes whether the content script in tabId responds to PING.
 */
function probeContentScript(tabId: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    let responded = false;
    const timer = setTimeout(() => {
      if (!responded) resolve(false);
    }, timeoutMs);

    try {
      chrome.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.PING }, (response) => {
        responded = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError || !response) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    } catch {
      clearTimeout(timer);
      resolve(false);
    }
  });
}

/**
 * Sends a message to the active/target tab with automatic self-healing,
 * reinjection on disconnect, and bounded retry backoff.
 */
export async function sendTabMessageWithAutoRecovery(
  msg: any,
  options: TabMessengerOptions = {}
): Promise<any> {
  const { maxRetries = 3, timeoutMs = 8000 } = options;

  const tab = await getActiveLpuTab();
  if (!tab || !tab.id) {
    return { success: false, error: 'NO_ACTIVE_TAB' };
  }

  const tabId = tab.id;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await new Promise<any>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ __timedOut: true });
        }, timeoutMs);

        chrome.tabs.sendMessage(tabId, msg, (res) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            resolve({ __error: chrome.runtime.lastError.message });
          } else {
            resolve(res);
          }
        });
      });

      // Successful response
      if (response && !response.__error && !response.__timedOut) {
        return response;
      }

      // If disconnected / receiving end does not exist, trigger self-healing reinjection
      const errorMsg = response?.__error || (response?.__timedOut ? 'TIMED_OUT' : 'UNKNOWN');
      const isDisconnected =
        errorMsg.includes('Receiving end does not exist') ||
        errorMsg.includes('Could not establish connection') ||
        errorMsg.includes('context invalidated') ||
        response?.__timedOut;

      if (isDisconnected && attempt < maxRetries) {
        console.debug(`[ONEE TabMessenger] Tab #${tabId} reconnecting (Attempt ${attempt + 1}/${maxRetries})`);
        const restored = await ensureContentScriptActive(tabId);
        if (restored) {
          // Add brief jitter pause before resending
          await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
          continue;
        }
      }

      if (attempt === maxRetries) {
        return { success: false, error: errorMsg };
      }
    } catch (err: any) {
      if (attempt === maxRetries) {
        return { success: false, error: err.message || 'COMMUNICATION_ERROR' };
      }
    }
  }

  return { success: false, error: 'MAX_RETRIES_EXCEEDED' };
}
