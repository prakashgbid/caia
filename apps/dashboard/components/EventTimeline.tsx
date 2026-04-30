'use client';

/**
 * EventTimeline — drill-down event feed (DASH-009).
 *
 * Renders the recent event history for a scoped entity (prompt, story,
 * task, agent, build, …) at the bottom of detail pages. Pulls from the
 * existing `GET /events?<scope>=<id>&since=<ts>` endpoint and live-updates
 * via the existing WebSocket subscription. No new backend code.
 *
 * Spec: caia/docs/dashboard-ui-conventions.md §3 (drill-down pattern).
 *
 * Usage:
 *   <EventTimeline filter={{ prompt_id: id }} />
 *   <EventTimeline filter={{ story_id: id }} />
 *   <EventTimeline filter={{ task_id: id }} />
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:7776';
const WS_URL = process.env['NEXT_PUBLIC_WS_URL'] ?? 'ws://localhost:7776/events';

const MAX_EVENTS = 200;
const SHOWN_LIMIT = 50;

type EventFilter = Partial<{
  prompt_id: string;
  story_id: string;
  task_id: string;
  agent_id: string;
  build_id: string;
  project_id: string;
}>;

interface TimelineEvent {
  id?: string | number;
  type?: string;
  kind?: string;
  occurred_at?: string;
  ts?: number | string;
  payload?: Record<string, unknown>;
  message?: string;
  prompt_id?: string;
  story_id?: string;
  task_id?: string;
  agent_id?: string;
  build_id?: string;
  project_id?: string;
}

interface EventTimelineProps {
  /** Server-side filter passed to GET /events. */
  filter: EventFilter;
  /** Optional override for the visible count. */
  limit?: number;
  /** Optional title (default: "Event timeline"). */
  title?: string;
}

function buildEventsUrl(filter: EventFilter): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filter)) {
    if (v) qs.set(k, String(v));
  }
  qs.set('limit', String(MAX_EVENTS));
  return `${API}/events?${qs.toString()}`;
}

function eventMatchesFilter(ev: TimelineEvent, filter: EventFilter): boolean {
  for (const [k, v] of Object.entries(filter)) {
    if (!v) continue;
    const got = (ev as Record<string, unknown>)[k];
    if (got !== undefined && got !== null && String(got) !== v) return false;
    // Also check inside payload for legacy/inline shapes.
    const pload = (ev.payload ?? {}) as Record<string, unknown>;
    if (got === undefined && pload[k] !== undefined && String(pload[k]) !== v) {
      return false;
    }
  }
  return true;
}

function formatTime(ev: TimelineEvent): string {
  const raw = ev.occurred_at ?? ev.ts;
  if (!raw) return '';
  try {
    const d = typeof raw === 'number' ? new Date(raw) : new Date(String(raw));
    return d.toLocaleTimeString();
  } catch {
    return String(raw);
  }
}

function eventKey(ev: TimelineEvent, idx: number): string {
  if (ev.id != null) return `id-${ev.id}`;
  return `i-${idx}-${ev.type ?? ev.kind ?? ''}-${ev.occurred_at ?? ev.ts ?? ''}`;
}

export function EventTimeline({ filter, limit = SHOWN_LIMIT, title = 'Event timeline' }: EventTimelineProps) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const { lastEvent, connected } = useWebSocket(WS_URL);
  const lastWsRef = useRef<typeof lastEvent>(null);

  // Initial fetch.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(buildEventsUrl(filter))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: unknown) => {
        if (!alive) return;
        const list: TimelineEvent[] = Array.isArray(data)
          ? (data as TimelineEvent[])
          : data && typeof data === 'object' && 'events' in data
            ? ((data as { events: TimelineEvent[] }).events)
            : [];
        setEvents(list.slice(0, MAX_EVENTS));
        setErr(null);
      })
      .catch((e) => {
        if (alive) setErr(String((e as Error)?.message ?? e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filter)]);

  // Live updates.
  useEffect(() => {
    if (!lastEvent || lastEvent === lastWsRef.current) return;
    lastWsRef.current = lastEvent;
    const ev = lastEvent as unknown as TimelineEvent;
    if (!eventMatchesFilter(ev, filter)) return;
    setEvents((prev) => {
      // Dedupe by id when present.
      if (ev.id != null && prev.some((e) => e.id === ev.id)) return prev;
      return [ev, ...prev].slice(0, MAX_EVENTS);
    });
  }, [lastEvent, filter]);

  const visible = useMemo(() => events.slice(0, limit), [events, limit]);

  return (
    <section
      aria-label={title}
      style={{
        marginTop: 32,
        padding: 16,
        background: '#1a1f2e',
        border: '1px solid #2d3748',
        borderRadius: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#f0f4f8' }}>
          ⚡ {title}
        </h2>
        <span style={{ fontSize: 11, color: connected ? '#68d391' : '#fc8181' }}>
          {connected ? '● live' : '○ off'}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: '#718096' }}>
          {events.length} event{events.length === 1 ? '' : 's'}
          {events.length > limit ? ` (showing ${limit})` : ''}
        </span>
      </div>

      {loading && (
        <div style={{ color: '#718096', fontSize: 13 }}>Loading events…</div>
      )}
      {!loading && err && (
        <div style={{ color: '#fc8181', fontSize: 13 }}>Failed to load events: {err}</div>
      )}
      {!loading && !err && visible.length === 0 && (
        <div style={{ color: '#718096', fontSize: 13 }}>No events for this scope yet.</div>
      )}

      {!loading && visible.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {visible.map((ev, idx) => {
            const type = ev.type ?? ev.kind ?? 'event';
            const time = formatTime(ev);
            const msg =
              ev.message ??
              (ev.payload && typeof (ev.payload as Record<string, unknown>)['message'] === 'string'
                ? ((ev.payload as Record<string, unknown>)['message'] as string)
                : '');
            return (
              <li
                key={eventKey(ev, idx)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 200px 1fr',
                  gap: 12,
                  padding: '6px 0',
                  borderTop: idx === 0 ? 'none' : '1px solid #2d3748',
                  fontSize: 13,
                }}
              >
                <span style={{ color: '#718096', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>{time}</span>
                <span style={{ color: '#90cdf4', fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}>{type}</span>
                <span style={{ color: '#cbd5e0', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {msg || '—'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default EventTimeline;
