'use client';
import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useWebSocket } from '../../hooks/useWebSocket';

// Actor emoji mapping
const ACTOR_EMOJI: Record<string, string> = {
  ai: '🤖',
  user: '👤',
  system: '⚙️',
  pump: '⏰',
  watchdog: '🩺',
  hook: '🪝',
};

// Kind prefix to color
const KIND_COLOR_MAP: Array<[string, string]> = [
  ['task.', '#4CAF50'],
  ['requirement.', '#2196F3'],
  ['blocker.', '#f44336'],
  ['question.', '#FF9800'],
  ['adr.', '#9C27B0'],
  ['feature.', '#00BCD4'],
  ['suggestion.', '#FF5722'],
  ['pump.', '#607D8B'],
  ['user.', '#3F51B5'],
];

function getKindColor(kind: string): string {
  for (const [prefix, color] of KIND_COLOR_MAP) {
    if (kind.startsWith(prefix)) return color;
  }
  return '#718096';
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

interface TimelineEvent {
  id: string;
  kind: string;
  actor: string;
  summary: string;
  subjectKind: string;
  subjectId: string;
  projectId?: string;
  payload: string;
  createdAt: string;
}

interface TimelineResponse {
  events: TimelineEvent[];
  nextCursor: string | null;
}

function TimelineContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { lastEvent, connected } = useWebSocket('ws://localhost:7776/events');

  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [newEventIds, setNewEventIds] = useState<Set<string>>(new Set());
  const loadingRef = useRef(false);
  const cursorRef = useRef<string | null>(null);

  // Filter state from URL
  const actor = searchParams.get('actor') ?? '';
  const kind = searchParams.get('kind') ?? '';
  const project = searchParams.get('project') ?? '';
  const subject = searchParams.get('subject') ?? '';
  const search = searchParams.get('search') ?? '';
  const domain = searchParams.get('domain') ?? '';

  const loadEvents = useCallback(async (reset: boolean, currentCursor: string | null) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);

    const params = new URLSearchParams();
    if (actor) params.set('actor', actor);
    if (kind) params.set('kind', kind);
    if (project) params.set('projectId', project);
    if (subject) params.set('subject', subject);
    if (search) params.set('search', search);
    if (domain) params.set('domain', domain);
    if (!reset && currentCursor) params.set('cursor', currentCursor);
    params.set('limit', '50');

    try {
      const res = await fetch(`/api/timeline?${params.toString()}`);
      if (res.ok) {
        const data = await res.json() as TimelineResponse;
        setEvents(prev => reset ? (data.events ?? []) : [...prev, ...(data.events ?? [])]);
        cursorRef.current = data.nextCursor;
        setCursor(data.nextCursor);
        setHasMore(!!data.nextCursor);
      } else {
        // Backend may return array (old format) — handle gracefully
        const data = await res.json() as TimelineEvent[] | TimelineResponse;
        const evts = Array.isArray(data) ? data : (data.events ?? []);
        setEvents(prev => reset ? evts : [...prev, ...evts]);
        setHasMore(false);
      }
    } catch {
      setHasMore(false);
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [actor, kind, project, subject, search]);

  // Reload on filter change
  useEffect(() => {
    setCursor(null);
    cursorRef.current = null;
    setEvents([]);
    setHasMore(true);
    void loadEvents(true, null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor, kind, project, subject, search, domain]);

  // Stream live WS events to top
  useEffect(() => {
    if (!lastEvent || lastEvent.kind === 'connected') return;
    const newEvt: TimelineEvent = {
      id: lastEvent.id ?? `evt_${Date.now()}`,
      kind: lastEvent.kind,
      actor: 'system',
      summary: `${lastEvent.kind} event`,
      subjectKind: '',
      subjectId: '',
      projectId: lastEvent.projectId,
      payload: JSON.stringify(lastEvent.payload ?? {}),
      createdAt: lastEvent.ts,
    };
    setEvents(prev => [newEvt, ...prev]);
    setNewEventIds(prev => new Set([...prev, newEvt.id]));
    setTimeout(() => {
      setNewEventIds(prev => {
        const n = new Set(prev);
        n.delete(newEvt.id);
        return n;
      });
    }, 2000);
  }, [lastEvent]);

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !loadingRef.current) {
        void loadEvents(false, cursorRef.current);
      }
    }, { threshold: 0.1 });
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [hasMore, loadEvents]);

  function setFilter(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    router.push(`/timeline?${p.toString()}`);
  }

  async function exportCsv() {
    const params = new URLSearchParams();
    if (actor) params.set('actor', actor);
    if (kind) params.set('kind', kind);
    if (project) params.set('projectId', project);
    if (domain) params.set('domain', domain);
    params.set('limit', '500');

    try {
      const res = await fetch(`/api/timeline/export?${params.toString()}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'conductor-timeline.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { /* silent */ }
  }

  const hasFilters = actor || kind || project || subject || search || domain;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>🕒 Timeline</h1>
        <span style={{ fontSize: 12, color: connected ? '#68d391' : '#fc8181' }}>
          {connected ? '● live' : '○ offline'}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => void exportCsv()}
          style={{
            background: '#2d3748',
            color: '#a0aec0',
            border: '1px solid #4a5568',
            borderRadius: 4,
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Export CSV
        </button>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={actor}
          onChange={e => setFilter('actor', e.target.value)}
          style={{ background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
          aria-label="Filter by actor"
        >
          <option value="">All actors</option>
          <option value="ai">🤖 AI</option>
          <option value="user">👤 User</option>
          <option value="system">⚙️ System</option>
          <option value="pump">⏰ Pump</option>
          <option value="watchdog">🩺 Watchdog</option>
          <option value="hook">🪝 Hook</option>
        </select>

        <select
          value={kind}
          onChange={e => setFilter('kind', e.target.value)}
          style={{ background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
          aria-label="Filter by event type"
        >
          <option value="">All types</option>
          <option value="task.*">Tasks</option>
          <option value="requirement.*">Requirements</option>
          <option value="blocker.*">Blockers</option>
          <option value="question.*">Questions</option>
          <option value="adr.*">ADRs</option>
          <option value="feature.*">Features</option>
          <option value="suggestion.*">Suggestions</option>
          <option value="pump.*">Pump</option>
          <option value="user.*">User actions</option>
        </select>

        <input
          type="search"
          placeholder="Domain slug filter..."
          value={domain}
          onChange={e => setFilter('domain', e.target.value)}
          style={{
            background: '#2d3748',
            color: '#e2e8f0',
            border: '1px solid #4a5568',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 13,
            width: 160,
          }}
          aria-label="Filter by domain slug"
          list="domain-suggestions"
        />

        <input
          type="search"
          placeholder="Full-text search..."
          value={search}
          onChange={e => setFilter('search', e.target.value)}
          style={{
            background: '#2d3748',
            color: '#e2e8f0',
            border: '1px solid #4a5568',
            borderRadius: 4,
            padding: '4px 8px',
            fontSize: 13,
            width: 200,
          }}
          aria-label="Search timeline events"
        />

        {hasFilters && (
          <button
            onClick={() => router.push('/timeline')}
            style={{
              background: '#742a2a',
              color: '#fed7d7',
              border: 'none',
              borderRadius: 4,
              padding: '4px 10px',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            Clear filters ×
          </button>
        )}
      </div>

      {/* Event feed */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {events.map(evt => (
          <div
            key={evt.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: '10px 12px',
              background: newEventIds.has(evt.id) ? '#1a2744' : '#1a1f2e',
              borderRadius: 6,
              borderLeft: `3px solid ${getKindColor(evt.kind)}`,
              transition: 'background 0.5s ease',
            }}
          >
            <span
              style={{ fontSize: 18, flexShrink: 0, width: 24, textAlign: 'center' }}
              title={evt.actor}
              aria-label={`Actor: ${evt.actor}`}
            >
              {ACTOR_EMOJI[evt.actor] ?? '⚙️'}
            </span>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: 11,
                    color: getKindColor(evt.kind),
                    fontFamily: 'monospace',
                    background: '#0f1117',
                    padding: '1px 5px',
                    borderRadius: 3,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {evt.kind}
                </span>
                {evt.subjectId && (
                  <a
                    href={evt.subjectKind ? `/${evt.subjectKind}s/${evt.subjectId}` : '#'}
                    style={{ fontSize: 11, color: '#63b3ed', textDecoration: 'none' }}
                    title={evt.subjectId}
                  >
                    {evt.subjectId.slice(0, 12)}
                  </a>
                )}
                {evt.projectId && (
                  <span
                    style={{
                      fontSize: 10,
                      background: '#2d3748',
                      padding: '1px 5px',
                      borderRadius: 3,
                      color: '#a0aec0',
                    }}
                  >
                    {evt.projectId}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 13, color: '#e2e8f0', wordBreak: 'break-word' }}>
                {evt.summary || evt.kind}
              </div>
            </div>

            <time
              dateTime={evt.createdAt}
              title={new Date(evt.createdAt).toLocaleString()}
              style={{ fontSize: 11, color: '#718096', flexShrink: 0, whiteSpace: 'nowrap' }}
            >
              {relativeTime(evt.createdAt)}
            </time>
          </div>
        ))}

        {loading && (
          <div style={{ padding: 16, textAlign: 'center', color: '#718096', fontSize: 13 }}>
            Loading...
          </div>
        )}

        {!loading && hasMore && <div ref={sentinelRef} style={{ height: 20 }} aria-hidden="true" />}

        {!hasMore && events.length === 0 && !loading && (
          <div style={{ padding: 32, textAlign: 'center', color: '#718096' }}>
            No events match your filters.
          </div>
        )}
      </div>
    </div>
  );
}

export default function TimelinePage() {
  return (
    <Suspense fallback={<div style={{ color: '#718096', padding: 32 }}>Loading timeline...</div>}>
      <TimelineContent />
    </Suspense>
  );
}
