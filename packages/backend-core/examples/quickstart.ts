/**
 * Quickstart: basic usage of @pokerzeno/backend-core
 *
 * Prerequisites:
 *   1. Copy .env.example → .env and fill in SUPABASE_URL + keys
 *   2. Run schema migrations on your Supabase project
 *   3. npm install
 *
 * Run:
 *   npx tsx examples/quickstart.ts
 */

import 'dotenv/config'
import { auth, users, groups, posts, points, follows, notifications } from '../src/index.js'

async function main() {
  // ── Auth ──────────────────────────────────────────────────────────────────

  console.log('1. Sign up...')
  const signupResult = await auth.signUpWithEmail(
    `demo_${Date.now()}@example.com`,
    'SecurePass123!',
    'demo_user',
  )
  if (signupResult.error) {
    console.error('Signup failed:', signupResult.error)
    return
  }
  const userId = signupResult.user!.id
  console.log('   User ID:', userId)

  // ── Profile ───────────────────────────────────────────────────────────────

  console.log('2. Update profile...')
  const profile = await users.updateProfile(userId, {
    bio: 'Poker enthusiast from Austin',
    location_state: 'Texas',
    location_city: 'Austin',
  })
  console.log('   Display name:', profile?.display_name)

  // ── Groups ────────────────────────────────────────────────────────────────

  console.log('3. Create a group...')
  const group = await groups.createGroup(userId, {
    name: 'Austin Poker Club',
    slug: `austin-poker-${Date.now()}`,
    tier_level: 'city',
    privacy: 'public',
    description: 'Weekly Texas Hold\'em meetups',
  })
  console.log('   Group:', group?.name)

  const role = await groups.getMemberRole(userId, group!.id)
  console.log('   Creator role:', role) // 'host'

  // ── Posts ─────────────────────────────────────────────────────────────────

  console.log('4. Create a thread...')
  const thread = await posts.createThread(userId, {
    group_id: group!.id,
    title: 'Best opening hands for beginners',
    body_md: '## Pocket Aces\nAlways raise pre-flop...',
    tags: ['beginner', 'strategy'],
  })
  console.log('   Thread ID:', thread?.id)

  // ── Points ────────────────────────────────────────────────────────────────

  console.log('5. Award points...')
  await points.awardPoints(userId, 'post_created', 10)
  await points.awardPoints(userId, 'group_created', 25)

  const promoted = await points.checkAndPromote(userId)
  console.log('   Tier promoted:', promoted)

  const leaderboard = await points.getLeaderboard(5)
  console.log('   Leaderboard top:', leaderboard.slice(0, 3).map(p => `${p.username} (${p.lifetime_points}pts)`))

  // ── Notifications ─────────────────────────────────────────────────────────

  console.log('6. Send notification...')
  const notif = await notifications.sendNotification(
    userId,
    'welcome',
    'Welcome to the community!',
    'Start by creating your first thread.',
    '/community',
  )
  console.log('   Notification:', notif?.title)

  const prefs = await notifications.getPreferences(userId)
  console.log('   Notification channels:', prefs.channels)

  // ── Follows ───────────────────────────────────────────────────────────────

  // (demonstrating the API shape — requires a second user in practice)
  const DEMO_TARGET = '00000000-0000-0000-0000-000000000001'
  const isFollowed = await follows.isFollowing(userId, DEMO_TARGET)
  console.log('7. Is following demo target:', isFollowed)

  console.log('\nDone.')
}

main().catch(console.error)
