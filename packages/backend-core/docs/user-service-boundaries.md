# UserService Refactor — Boundary Analysis

**Story:** story-story-vqb7mH-E798  
**Date:** 2026-05-01

## Current State

The `users` module (`src/users/`) exports 11 functions flat from three files:

| File | Functions | DB Table |
|------|-----------|----------|
| `profile.ts` | getProfile, getProfileByUsername, updateProfile, listProfiles, searchProfiles | `profiles` |
| `settings.ts` | getSettings, updateSettings | `notification_preferences` |
| `notifications.ts` | getNotifications, markRead, markAllRead, getUnreadCount | `delivered_notifications` |

All functions call `getSupabaseClient()` directly with no abstraction layer.

## Identified Boundaries

### Boundary 1 — Profile (Identity)

**Responsibility:** User identity and public profile data.  
**DB Table:** `profiles`  
**Functions:** getProfile, getProfileByUsername, updateProfile, listProfiles, searchProfiles  
**Cross-domain consumers:** events/rsvp.ts, follows/manage.ts, groups/membership.ts, points/tiers.ts all import `Profile` type.  
**Proposed module:** `src/users/profile.ts` (keep as-is — already well-bounded)

### Boundary 2 — Notification Preferences (Settings)

**Responsibility:** Per-user channel and category preferences for notifications.  
**DB Table:** `notification_preferences`  
**Functions:** getSettings, updateSettings  
**Concern:** This is user-scoped config for the `notifications` domain. It is currently under `users` but logically belongs with notification delivery policy.  
**Options:**
- Keep in `users` as `UserSettingsService` (simpler, current callers unaffected)
- Move to `notifications` module (better cohesion, small migration cost)

**Recommendation:** Keep in `users` but rename to make scope explicit: `getNotificationPreferences` / `updateNotificationPreferences`.

### Boundary 3 — Notification Inbox

**Responsibility:** Delivered notification records for a user (inbox view).  
**DB Table:** `delivered_notifications`  
**Functions:** getNotifications, markRead, markAllRead, getUnreadCount  
**Concern:** There is already a top-level `notifications` module (`src/notifications/`) for *sending*. Having inbox logic in `users` creates a split that callers must navigate.  
**Options:**
- Keep in `users` as inbox sub-module (notifications.ts)
- Move to `src/notifications/inbox.ts` under the existing notifications module

**Recommendation:** Move to `src/notifications/inbox.ts` — all inbox operations belong in the notifications domain. Export from `notifications` index, remove from `users` index.

## Proposed Post-Refactor Structure

```
src/users/
  profile.ts        ← no change (Boundary 1)
  preferences.ts    ← renamed from settings.ts, functions renamed (Boundary 2)
  index.ts          ← removes notifications exports, adds preferences exports

src/notifications/
  inbox.ts          ← moved from src/users/notifications.ts (Boundary 3)
  index.ts          ← adds inbox exports
```

## Characterisation Test Coverage

`tests/user-service-characterisation.test.ts` covers all 11 current functions. Before any refactor step:
1. Run tests to establish green baseline
2. Refactor one boundary at a time
3. Re-run after each boundary move — no behaviour change is acceptable

## Risk Notes

- `Profile` type is used by 4 other modules — do not move or rename without grep check
- `getSettings` / `updateSettings` names are generic — rename in the same commit as the file move to avoid confusion with unrelated settings
- The flat re-export in `index.ts` means current callers use `users.getNotifications(...)` — a move to notifications will require a call-site update across the app
