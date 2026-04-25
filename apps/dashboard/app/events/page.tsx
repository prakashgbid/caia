'use client';
import { useState, useEffect, useRef, useCallback } from 'react';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:7776';
const WS_URL = API.replace('http', 'ws') + '/events';

interface ConductorEvent {
  id: string;
  type: string;
  occurred_at: string;
  actor: string;
  correlation_id?: string;
  entity_id?: string;
  entity_type?: string;
  project_slug?: string;
  payload: Record<string, unknown>;
  severity: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  debug: '#6b7280',
  info: '#2563eb',
  warning: '#d97706',
  error: '#dc2626',
};

function severityBadge(s: string) {
  return (
    <span style={{
      background: SEVERITY_COLOR[s] ?? '#6b7280',
      color: '#fff',
      fontSize: 10,
      padding: '1px 5px',
      borderRadius: 4,
      fontWeight: 700,
      letterSpacing: 0.5,
    }}>{s.toUpperCase()}</span>
  );
}

export default function EventsPage() {
  const [events, setEvents] = useState<ConductorEvent[]>([]);
  const [filter, setFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  // Load historical events on mount
  useEffect(() => {
    fetch(`${API}/events?limit=200`)
      .then(r => r.json())
      .then((d: { events: ConductorEvent[] }) => {
        setEvents(d.events.slice().reverse());
      })
      .catch(() => {});
  }, []);

  // Live WS stream
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();

      ws.onmessage = (msg) => {
        if (pausedRef.current) return;
        try {
          const e = JSON.parse(msg.data as string) as ConductorEvent;
          if (!e.type || !e.occurred_at) return; // skip non-event pings
          setEvents(prev => [e, ...prev].slice(0, 1000));
        } catch { /* ignore */ }
      };
    };
    connect();
    return () => wsRef.current?.close();
  }, []);

  const filtered = events.filter(e => {
    const typeOk = !filter || e.type.includes(filter) || (e.entity_id ?? '').includes(filter);
    const actorOk = !actorFilter || e.actor === actorFilter;
    return typeOk && actorOk;
  });

  const actors = [...new Set(events.map(e => e.actor))].sort();

  return (
    <div style={{ padding: 20, fontFamily: 'monospace', fontSize: 13 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontFamily: 'system-ui' }}>Event Stream</h2>
        <span style={{ color: connected ? '#16a34a' : '#dc2626', fontSize: 12 }}>
          {connected ? '● live' : '○ disconnected'}
        </span>
        <button onClick={() => setPaused(p => !p)} style={{ marginLeft: 'auto', padding: '4px 12px', cursor: 'pointer' }}>
          {paused ? '▶ Resume' : '⏸ Pause'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          placeholder="Filter by type or entity_id..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ flex: 1, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontFamily: 'monospace', fontSize: 12 }}
        />
        <select
          value={actorFilter}
          onChange={e => setActorFilter(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}
        >
          <option value="">All actors</option>
          {actors.map(a => <option key={a}>{a}</option>)}
        </select>
        <button onClick={() => setEvents([])} style={{ padding: '6px 12px', cursor: 'pointer' }}>Clear</button>
      </div>

      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
        {filtered.length} event{filtered.length !== 1 ? 's' : ''} {filter || actorFilter ? '(filtered)' : ''}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: '6px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>Time</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>Severity</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>Type</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>Actor</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>Entity</th>
              <th style={{ padding: '6px 8px', textAlign: 'left' }}>Payload</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(e => (
              <tr key={e.id} style={{ borderBottom: '1px solid #f3f4f6', background: e.severity === 'error' ? '#fff5f5' : undefined }}>
                <td style={{ padding: '5px 8px', color: '#6b7280', whiteSpace: 'nowrap' }}>
                  {new Date(e.occurred_at).toLocaleTimeString()}
                </td>
                <td style={{ padding: '5px 8px' }}>{severityBadge(e.severity)}</td>
                <td style={{ padding: '5px 8px', fontWeight: 600 }}>{e.type}</td>
                <td style={{ padding: '5px 8px', color: '#4b5563' }}>{e.actor}</td>
                <td style={{ padding: '5px 8px', color: '#6b7280' }}>
                  {e.entity_type && <span>{e.entity_type}/</span>}
                  {e.entity_id && <span style={{ fontFamily: 'monospace' }}>{e.entity_id?.slice(0, 12)}</span>}
                </td>
                <td style={{ padding: '5px 8px', color: '#6b7280', maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {JSON.stringify(e.payload)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
            No events yet — actions will appear here in real-time.
          </div>
        )}
      </div>
    </div>
  );
}
