import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createThread, listThreads, createReply, addReaction, removeReaction, getReactions } from '../src/posts/index.js'
import { getSupabaseAdmin } from '../src/client.js'

const SUPABASE_URL = process.env['SUPABASE_URL']

const USER_A = '00000000-0000-0000-0000-000000000020'
const USER_B = '00000000-0000-0000-0000-000000000021'

const createdThreadIds: string[] = []
const createdReplyIds: string[] = []

describe('posts', () => {
  beforeAll(async () => {
    if (!SUPABASE_URL) return
    const admin = getSupabaseAdmin()
    await admin.from('profiles').upsert([
      { id: USER_A, username: 'posts_user_a', display_name: 'Posts User A', tier: 'member', lifetime_points: 0 },
      { id: USER_B, username: 'posts_user_b', display_name: 'Posts User B', tier: 'member', lifetime_points: 0 },
    ])
  })

  afterEach(async () => {
    if (!SUPABASE_URL) return
    const admin = getSupabaseAdmin()
    if (createdReplyIds.length > 0) {
      await admin.from('replies').delete().in('id', createdReplyIds)
      createdReplyIds.length = 0
    }
    if (createdThreadIds.length > 0) {
      await admin.from('threads').delete().in('id', createdThreadIds)
      createdThreadIds.length = 0
    }
  })

  it('createThread inserts a thread', async () => {
    if (!SUPABASE_URL) return
    const thread = await createThread(USER_A, {
      title: 'Test Thread',
      body_md: 'This is the body',
      tags: ['poker', 'strategy'],
    })
    expect(thread).not.toBeNull()
    expect(thread?.title).toBe('Test Thread')
    expect(thread?.tags).toContain('poker')
    createdThreadIds.push(thread!.id)
  })

  it('listThreads returns paginated threads', async () => {
    if (!SUPABASE_URL) return
    const thread = await createThread(USER_A, {
      title: 'List Test Thread',
      body_md: 'Body',
    })
    createdThreadIds.push(thread!.id)

    const result = await listThreads({}, { limit: 10 })
    expect(result.data.length).toBeGreaterThan(0)
    expect(result.total).toBeGreaterThan(0)
  })

  it('createReply increments reply_count on thread', async () => {
    if (!SUPABASE_URL) return
    const thread = await createThread(USER_A, { title: 'Reply Thread', body_md: 'Body' })
    createdThreadIds.push(thread!.id)

    const reply = await createReply(USER_B, { thread_id: thread!.id, body_md: 'A reply' })
    expect(reply).not.toBeNull()
    expect(reply?.thread_id).toBe(thread!.id)
    createdReplyIds.push(reply!.id)
  })

  it('addReaction upserts reaction', async () => {
    if (!SUPABASE_URL) return
    const thread = await createThread(USER_A, { title: 'React Thread', body_md: 'Body' })
    createdThreadIds.push(thread!.id)

    const reaction = await addReaction(USER_B, 'thread', thread!.id, '👍')
    expect(reaction).not.toBeNull()
    expect(reaction?.emoji).toBe('👍')

    // Cleanup
    const admin = getSupabaseAdmin()
    await admin.from('reactions').delete().eq('target_id', thread!.id)
  })

  it('removeReaction deletes reaction', async () => {
    if (!SUPABASE_URL) return
    const thread = await createThread(USER_A, { title: 'Remove React Thread', body_md: 'Body' })
    createdThreadIds.push(thread!.id)

    await addReaction(USER_B, 'thread', thread!.id, '❤️')
    const removed = await removeReaction(USER_B, 'thread', thread!.id, '❤️')
    expect(removed).toBe(true)

    const reactions = await getReactions('thread', thread!.id)
    const found = reactions.find((r) => r.emoji === '❤️' && r.user_id === USER_B)
    expect(found).toBeUndefined()
  })
})
