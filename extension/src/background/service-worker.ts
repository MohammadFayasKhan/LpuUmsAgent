/*
 * Background Service Worker for ONEE -> LPU Agent.
 *
 * In Chrome Manifest V3, background scripts run as ephemeral service workers.
 * The browser can terminate this worker after 30 seconds of inactivity to save memory.
 *
 * Because of that lifecycle, we do two key things here:
 * 1. Maintain a long-lived Port connection with the side panel. The side panel
 *    sends occasional heartbeats so it knows immediately if the worker restarts.
 * 2. Never store critical agent state solely in worker memory. Everything important
 *    is saved in chrome.storage or IndexedDB.
 *
 * This worker also acts as the privileged bridge for operations content scripts
 * cannot do directly, such as capturing screenshots of the active tab.
 */

import { MESSAGE_TYPES } from '../shared/messages';

// Set of active Port connections from open side panels
const connectedPorts = new Set<chrome.runtime.Port>();

/*
 * When the extension is installed or updated, configure Chrome to open the
 * side panel automatically when the user clicks the toolbar icon.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch (err) {
    console.warn('[ONEE SW] Failed to set side panel behavior:', err);
  }

  if (details.reason === 'install' || details.reason === 'update') {
    try {
      await chrome.storage.local.set({
        __onee_installed_at__: Date.now(),
        __onee_version__: '1.1.0'
      });
    } catch {}
  }
});

/*
 * Fallback click handler for older Chrome versions where openPanelOnActionClick
 * is not supported.
 */
chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (chrome.sidePanel && chrome.sidePanel.open && tab.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  } catch (err) {
    console.warn('[ONEE SW] Failed to open side panel via action click:', err);
  }
});

/*
 * Long-lived Port connection from the side panel.
 * Allows instant bidirectional messaging and lets the side panel detect when
 * the service worker disconnects or wakes back up.
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'onee-sidepanel-port') {
    connectedPorts.add(port);

    port.onMessage.addListener((msg) => {
      if (msg.type === MESSAGE_TYPES.KEEP_ALIVE) {
        try {
          port.postMessage({ type: 'ONEE_KEEP_ALIVE_ACK', timestamp: Date.now() });
        } catch {}
      } else if (msg.type === MESSAGE_TYPES.HANDSHAKE) {
        try {
          port.postMessage({ type: 'ONEE_HANDSHAKE_ACK', status: 'READY', timestamp: Date.now() });
        } catch {}
      }
    });

    port.onDisconnect.addListener(() => {
      connectedPorts.delete(port);
    });
  }
});

/*
 * Helper to broadcast messages to all connected side panel instances.
 */
function broadcastToPorts(msg: any) {
  connectedPorts.forEach((port) => {
    try {
      port.postMessage(msg);
    } catch {
      connectedPorts.delete(port);
    }
  });
}

/*
 * Track tab switching and URL changes so the side panel knows whether the student
 * is currently viewing UMS or has navigated away to another website.
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url) {
      const payload = { type: 'ONEE_TAB_CHANGED', url: tab.url, tabId: tab.id };
      broadcastToPorts(payload);
      chrome.runtime.sendMessage(payload).catch(() => {});
    }
  } catch {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const payload = { type: 'ONEE_TAB_CHANGED', url: tab.url, tabId };
    broadcastToPorts(payload);
    chrome.runtime.sendMessage(payload).catch(() => {});
  }
});

/*
 * Privileged Message Handler:
 * 1. CAPTURE_VISIBLE_TAB: Takes a JPEG screenshot of the active visible tab.
 *    Content scripts cannot capture screenshots themselves, so this request is
 *    delegated to the service worker which holds the activeTab permission.
 * 2. REINJECT_CONTENT_SCRIPT: Used during development or after a tab refresh
 *    to re-attach our DOM observer without requiring a full browser restart.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === MESSAGE_TYPES.CAPTURE_VISIBLE_TAB) {
    try {
      chrome.tabs.captureVisibleTab(null as any, { format: 'jpeg', quality: 75 }, (dataUrl) => {
        if (chrome.runtime.lastError || !dataUrl) {
          sendResponse({ success: false, error: chrome.runtime.lastError?.message || 'Screenshot failed' });
        } else {
          sendResponse({ success: true, screenshot: dataUrl });
        }
      });
    } catch (err: any) {
      sendResponse({ success: false, error: err.message });
    }
    return true; // Keep channel open for asynchronous sendResponse
  }

  if (message.type === MESSAGE_TYPES.REINJECT_CONTENT_SCRIPT) {
    const tabId = message.tabId;
    if (tabId && chrome.scripting) {
      chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        files: ['content.js']
      }).then(() => {
        sendResponse({ success: true });
      }).catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
  }

  if (message.type === MESSAGE_TYPES.DEV_RELOAD) {
    broadcastToPorts({ type: MESSAGE_TYPES.DEV_RELOAD });
    sendResponse({ success: true });
    return false;
  }
});
