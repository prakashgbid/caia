import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createEvent, getEvent, listEvents, rsvp, getRsvp } from '../src/events/index.js'
import { getSupabaseAdmin } from '../src/client.js'

const SUPABASE_URL = process.env['SUPABASE_URL']

const HOST_ID = '00000000-0000-0000-0000-000000000040'
const ATTENDEE_ID = '00000000-0000-0000-0000-000000000041'

const createdEventIds: string[] = []

const futureDate = (daysFromNow: number): string => {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString()
}

describe('events', () => {
  beforeAll(async () => {
    if (!SUPABASE_URL) return
    const admin = getSupabaseAdmin()
    await admin.from('profiles').upsert([
      { id: HOST_ID, username: 'event_host', display_name: 'Event Host', tier: 'member', lifetime_points: 0 },
      { id: ATTENDEE_ID, username: 'event_attendee', display_name: 'Event Attendee', tier: 'member', lifetime_points: 0 },
    ])
  })

  afterEach(async () => {
    if (!SUPABASE_URL || createdEventIds.length === 0) return
    const admin = getSupabaseAdmin()
    await admin.from('events').delete().in('id', createdEventIds)
    createdEventIds.length = 0
  })

  it('createEvent creates an event', async () => {
    if (!SUPABASE_URL) return
    const event = await createEvent(HOST_ID, {
      kind: 'online_tournament',
      title: 'Weekly Poker Tournament',
      starts_at: futureDate(3),
      ends_at: futureDate(4),
    })
    expect(event).not.toBeNull()
    expect(event?.title).toBe('Weekly Poker Tournament')
    expect(event?.is_cancelled).toBe(false)
    createdEventIds.push(event!.id)
  })

  it('getEvent retrieves event by id', async () => {
    if (!SUPABASE_URL) return
    const event = await createEvent(HOST_ID, {
      kind: 'webinar',
      title: 'Get Event Test',
      starts_at: futureDate(5),
      ends_at: futureDate(6),
    })
    createdEventIds.push(event!.id)

    const fetched = await getEvent(event!.id)
    expect(fetched?.id).toBe(event!.id)
  })

  it('rsvp upserts attendance and getRsvp retrieves it', async () => {
    if (!SUPABASE_URL) return
    const event = await createEvent(HOST_ID, {
      kind: 'local_meetup',
      title: 'RSVP Test Event',
      starts_at: futureDate(7),
      ends_at: futureDate(8),
    })
    createdEventIds.push(event!.id)

    const result = await rsvp(ATTENDEE_ID, event!.id, 'yes')
    expect(result?.status).toBe('yes')

    const fetched = await getRsvp(ATTENDEE_ID, event!.id)
    expect(fetched?.status).toBe('yes')

    const admin = getSupabaseAdmin()
    await admin.from('rsvps').delete().eq('event_id', event!.id)
  })

  it('listEvents with upcoming filter only returns future events', async () => {
    if (!SUPABASE_URL) return
    const event = await createEvent(HOST_ID, {
      kind: 'workshop',
      title: 'Upcoming Filter Test',
      starts_at: futureDate(10),
      ends_at: futureDate(11),
    })
    createdEventIds.push(event!.id)

    const result = await listEvents({ upcoming: true })
    expect(result.data.every((e) => new Date(e.starts_at) > new Date())).toBe(true)

    const found = result.data.find((e) => e.id === event!.id)
    expect(found).toBeDefined()
  })
})
