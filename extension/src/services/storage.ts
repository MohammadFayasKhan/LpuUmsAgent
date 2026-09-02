/*
 * Helper functions for extension settings.
 *
 * We route all these calls through settingsRepo so that settings live in
 * chrome.storage.local instead of window.localStorage.
 *
 * This prevents any chance of host page scripts on ums.lpu.in reading our
 * extension settings or student preferences. We also never put passwords or
 * auth cookies in here.
 */

import { settingsRepo } from './repositories';

export async function hasSeenPrivacyNotice(): Promise<boolean> {
  return settingsRepo.hasSeenPrivacyNotice();
}

export async function markPrivacyNoticeSeen(): Promise<void> {
  return settingsRepo.markPrivacyNoticeSeen();
}

export async function getActiveAccountId(): Promise<string> {
  return settingsRepo.getActiveAccountId();
}

export async function setActiveAccountId(accountId: string): Promise<void> {
  return settingsRepo.setActiveAccountId(accountId);
}
