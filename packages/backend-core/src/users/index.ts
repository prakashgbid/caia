export { UserService, userService } from './user-service.js'
export { UserProfileService, userProfileService } from './user-profile-service.js'
export { UserSettingsService, userSettingsService } from './user-settings-service.js'
export { UserNotificationsService, userNotificationsService } from './user-notifications-service.js'

// Backward-compatible named exports — delegate to singleton
import { userService } from './user-service.js'
import type { PaginationParams, UpdateProfileInput, UpdateNotificationPreferencesInput } from '../types.js'

export const getProfile = (userId: string) => userService.getProfile(userId)
export const getProfileByUsername = (username: string) => userService.getProfileByUsername(username)
export const updateProfile = (userId: string, input: UpdateProfileInput) =>
  userService.updateProfile(userId, input)
export const listProfiles = (params?: PaginationParams) => userService.listProfiles(params)
export const searchProfiles = (query: string, limit?: number) =>
  userService.searchProfiles(query, limit)

export const getSettings = (userId: string) => userService.getSettings(userId)
export const updateSettings = (userId: string, settings: UpdateNotificationPreferencesInput) =>
  userService.updateSettings(userId, settings)

export const getNotifications = (userId: string, params?: PaginationParams) =>
  userService.getNotifications(userId, params)
export const markRead = (notificationId: string, userId: string) =>
  userService.markRead(notificationId, userId)
export const markAllRead = (userId: string) => userService.markAllRead(userId)
export const getUnreadCount = (userId: string) => userService.getUnreadCount(userId)
