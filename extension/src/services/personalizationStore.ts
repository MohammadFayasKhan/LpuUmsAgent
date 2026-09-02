/*
 * Local-First Personalization Store for ONEE.
 *
 * We keep personalization data on the user's device instead of sending
 * the complete chat history to the backend every time. This makes the
 * responses more useful without unnecessarily exposing old conversations.
 *
 * The store only keeps information that is actually useful for ONEE, such as
 * frequently used tasks and a few UI preferences. Sensitive UMS information
 * like passwords or session cookies should never be added here.
 *
 * When a new conversation starts, we can read this local profile to know
 * if the student prefers concise or detailed answers.
 */

import { personalizationRepo, settingsRepo } from './repositories';

export interface InteractionPreferences {
  showComputerUse: boolean;
  showFollowUps: boolean;
}

export interface PersonalizationProfile {
  activeAccountId: string;
  preferredResponseLength: 'short' | 'medium' | 'detailed';
  interactionPreferences: InteractionPreferences;
  frequentlyUsedTasks: string[];
  recentTopics: string[];
  lastActiveConversationId?: string;
  lastActiveAt: number;
}

export const DEFAULT_PROFILE: PersonalizationProfile = {
  activeAccountId: 'default',
  preferredResponseLength: 'medium',
  interactionPreferences: {
    showComputerUse: true,
    showFollowUps: true
  },
  frequentlyUsedTasks: ['attendance', 'lowest_subject', 'bunk_planner'],
  recentTopics: ['attendance'],
  lastActiveAt: Date.now()
};

class PersonalizationStore {
  public async getActiveAccountId(): Promise<string> {
    return settingsRepo.getActiveAccountId();
  }

  public async setActiveAccountId(accountId: string): Promise<void> {
    return settingsRepo.setActiveAccountId(accountId);
  }

  public async getProfile(accountId?: string): Promise<PersonalizationProfile> {
    const accId = accountId || (await this.getActiveAccountId());
    return personalizationRepo.getProfile(accId);
  }

  public async updateProfile(
    updates: Partial<PersonalizationProfile>,
    accountId?: string
  ): Promise<PersonalizationProfile> {
    const accId = accountId || (await this.getActiveAccountId());
    return personalizationRepo.updateProfile(updates, accId);
  }

  public async recordTaskUsage(taskName: string, accountId?: string): Promise<void> {
    const profile = await this.getProfile(accountId);
    const normalized = taskName.trim().toLowerCase();
    if (!normalized) return;

    const currentTasks = profile.frequentlyUsedTasks || [];
    const updatedTasks = [normalized, ...currentTasks.filter((t) => t !== normalized)].slice(0, 8);

    await this.updateProfile({ frequentlyUsedTasks: updatedTasks }, profile.activeAccountId);
  }

  public async resetProfile(accountId?: string): Promise<void> {
    const accId = accountId || (await this.getActiveAccountId());
    return personalizationRepo.resetProfile(accId);
  }
}

export const personalizationStore = new PersonalizationStore();
