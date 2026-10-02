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
/**
 * Automatically cleans up duplicate tabs for the seating plan or dashboard,
 * keeping only the single active tab.
 */
export async function closeDuplicateLpuTabs(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.tabs) return;
  try {
    const allTabs = await chrome.tabs.query({});
    const seatingTabs = allTabs.filter(
      (t) => t.id && t.url && t.url.toLowerCase().includes('seatingplan')
    );

    if (seatingTabs.length > 1) {
      // Find the active or first seating tab to keep
      const keepTab = seatingTabs.find((t) => t.active) || seatingTabs[0];
      const tabsToClose = seatingTabs.filter((t) => t.id && t.id !== keepTab.id).map((t) => t.id as number);
      if (tabsToClose.length > 0) {
        await chrome.tabs.remove(tabsToClose);
        console.info(`[ONEE TabMessenger] Cleaned up ${tabsToClose.length} duplicate seating plan tab(s).`);
      }
    }
  } catch (err) {
    console.debug('[ONEE TabMessenger] Tab deduplication notice:', err);
  }
}

/**
 * Opens or focuses the Seating Plan / Date Sheet in a dedicated NEW TAB.
 * Guarantees that the student's existing Attendance tab and session remain completely untouched.
 */
export async function openSeatingPlanTab(active = true): Promise<chrome.tabs.Tab | null> {
  const seatingUrl = 'https://studentums.lpu.in/dashboard/examination/conduct/seatingplan';
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    if (typeof window !== 'undefined') {
      window.open(seatingUrl, '_blank', 'noopener,noreferrer');
    }
    return null;
  }

  try {
    const allTabs = await chrome.tabs.query({});
    const existingSeatingTab = allTabs.find(
      (t) => t.id && t.url && t.url.toLowerCase().includes('seatingplan')
    );

    if (existingSeatingTab && existingSeatingTab.id) {
      if (active) {
        await chrome.tabs.update(existingSeatingTab.id, { active: true });
      }
      return existingSeatingTab;
    }

    const newTab = await chrome.tabs.create({
      url: seatingUrl,
      active
    });
    return newTab;
  } catch (err) {
    console.warn('[ONEE TabMessenger] Error opening seating plan tab:', err);
    return null;
  }
}

/**
 * Opens or focuses the Student Time Table report in a dedicated NEW TAB.
 * Guarantees that the student's active Dashboard and Attendance session remain intact.
 */
export async function openTimetableTab(active = true): Promise<chrome.tabs.Tab | null> {
  const timetableUrl = 'https://ums.lpu.in/lpuums/Reports/frmStudentTimeTable.aspx';
  if (typeof chrome === 'undefined' || !chrome.tabs) {
    if (typeof window !== 'undefined') {
      window.open(timetableUrl, '_blank', 'noopener,noreferrer');
    }
    return null;
  }

  try {
    const allTabs = await chrome.tabs.query({});
    const existingTab = allTabs.find(
      (t) => t.id && t.url && t.url.toLowerCase().includes('frmstudenttimetable')
    );

    if (existingTab && existingTab.id) {
      if (active) {
        await chrome.tabs.update(existingTab.id, { active: true });
      }
      return existingTab;
    }

    const newTab = await chrome.tabs.create({
      url: timetableUrl,
      active
    });

    // Wait for the new tab to complete loading (or max 4000ms)
    if (newTab && newTab.id) {
      await new Promise<void>((resolve) => {
        let listener: ((tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => void) | null = null;
        const timer = setTimeout(() => {
          if (listener && chrome.tabs?.onUpdated) {
            chrome.tabs.onUpdated.removeListener(listener);
          }
          resolve();
        }, 4000);

        listener = (tabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
          if (tabId === newTab.id && changeInfo.status === 'complete') {
            clearTimeout(timer);
            if (listener && chrome.tabs?.onUpdated) {
              chrome.tabs.onUpdated.removeListener(listener);
            }
            resolve();
          }
        };

        if (chrome.tabs?.onUpdated) {
          chrome.tabs.onUpdated.addListener(listener);
        }
      });
    }

    return newTab;
  } catch (err) {
    console.warn('[ONEE TabMessenger] Error opening timetable tab:', err);
    return null;
  }
}

/**
 * Finds the most relevant tab for ONEE automation.
 * Priority:
 * 1. Active tab on timetable or seating plan / date sheet
 * 2. Active tab in current window if on LPU domain
 * 3. Any timetable or seating plan tab across all windows
 * 4. Any active tab on LPU domain across all windows
 * 5. Any tab on LPU domain
 * 6. Currently active tab in current window
 */
export async function getActiveLpuTab(): Promise<chrome.tabs.Tab | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs) return null;

  try {
    const [currentTabs, allTabs] = await Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }),
      chrome.tabs.query({})
    ]);

    // 1. Any active tab on Timetable or Seating Plan / Date Sheet
    const activeSpecialTab = allTabs.find(
      (t) =>
        t.active &&
        t.url &&
        (t.url.toLowerCase().includes('frmstudenttimetable') ||
          t.url.toLowerCase().includes('seatingplan'))
    );
    if (activeSpecialTab) return activeSpecialTab;

    // 2. Current active tab on LPU
    if (currentTabs[0]?.url && isLpuUrl(currentTabs[0].url)) {
      return currentTabs[0];
    }

    // 3. Any Timetable or Seating Plan tab across all windows
    const anySpecialTab = allTabs.find(
      (t) =>
        t.url &&
        (t.url.toLowerCase().includes('frmstudenttimetable') ||
          t.url.toLowerCase().includes('seatingplan'))
    );
    if (anySpecialTab) return anySpecialTab;

    // 4. Any active tab on LPU
    const activeLpuTab = allTabs.find((t) => t.active && t.url && isLpuUrl(t.url));
    if (activeLpuTab) return activeLpuTab;

    // 5. Any tab on LPU
    const anyLpuTab = allTabs.find((t) => t.url && isLpuUrl(t.url));
    if (anyLpuTab) return anyLpuTab;

    // 6. Fallback to current window's active tab
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
  const { maxRetries = 3, timeoutMs = 15000 } = options;

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

/**
 * Broadcasts a message (such as HIDE_CURSOR or STOP_ACTION) to ALL tabs matching LPU domains across all windows.
 * This guarantees that when an action finishes or is cancelled, cursor overlays in all tabs (dashboard,
 * seating plan, etc.) are properly dismissed.
 */
export async function broadcastTabMessage(msg: any): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.tabs) return;

  try {
    const allTabs = await chrome.tabs.query({});
    const lpuTabs = allTabs.filter((t) => t.id && t.url && isLpuUrl(t.url));

    await Promise.allSettled(
      lpuTabs.map(
        (t) =>
          new Promise<void>((resolve) => {
            try {
              chrome.tabs.sendMessage(t.id!, msg, () => {
                if (chrome.runtime?.lastError) {
                  // Silently ignore inactive/unresponsive frames
                }
                resolve();
              });
            } catch {
              resolve();
            }
          })
      )
    );
  } catch (err) {
    console.debug('[ONEE TabMessenger] broadcastTabMessage notice:', err);
  }
}
