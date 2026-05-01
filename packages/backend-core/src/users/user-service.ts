import { UserProfileService } from './user-profile-service.js'
import { UserSettingsService } from './user-settings-service.js'
import { UserNotificationsService } from './user-notifications-service.js'
import type {
  Profile,
  UpdateProfileInput,
  PaginationParams,
  PaginatedResult,
  NotificationPreferences,
  UpdateNotificationPreferencesInput,
  DeliveredNotification,
} from '../types.js'

export class UserService {
  private readonly profiles = new UserProfileService()
  private readonly settings = new UserSettingsService()
  private readonly notifications = new UserNotificationsService()

  // ---------------------------------------------------------------------------
  // Profile domain — delegated to UserProfileService
  // ---------------------------------------------------------------------------

  getProfile(userId: string): Promise<Profile | null> {
    return this.profiles.getProfile(userId)
  }

  getProfileByUsername(username: string): Promise<Profile | null> {
    return this.profiles.getProfileByUsername(username)
  }

  updateProfile(userId: string, input: UpdateProfileInput): Promise<Profile | null> {
    return this.profiles.updateProfile(userId, input)
  }

  listProfiles(params?: PaginationParams): Promise<PaginatedResult<Profile>> {
    return this.profiles.listProfiles(params)
  }

  searchProfiles(query: string, limit?: number): Promise<Profile[]> {
    return this.profiles.searchProfiles(query, limit)
  }

  // ---------------------------------------------------------------------------
  // Settings domain — delegated to UserSettingsService
  // ---------------------------------------------------------------------------

  getSettings(userId: string): Promise<NotificationPreferences | null> {
    return this.settings.getSettings(userId)
  }

  updateSettings(
    userId: string,
    s: UpdateNotificationPreferencesInput,
  ): Promise<NotificationPreferences | null> {
    return this.settings.updateSettings(userId, s)
  }

  // ---------------------------------------------------------------------------
  // Notifications domain — delegated to UserNotificationsService
  // ---------------------------------------------------------------------------

  getNotifications(
    userId: string,
    params?: PaginationParams,
  ): Promise<PaginatedResult<DeliveredNotification>> {
    return this.notifications.getNotifications(userId, params)
  }

  markRead(notificationId: string, userId: string): Promise<boolean> {
    return this.notifications.markRead(notificationId, userId)
  }

  markAllRead(userId: string): Promise<boolean> {
    return this.notifications.markAllRead(userId)
  }

  getUnreadCount(userId: string): Promise<number> {
    return this.notifications.getUnreadCount(userId)
  }
}

export const userService = new UserService()
