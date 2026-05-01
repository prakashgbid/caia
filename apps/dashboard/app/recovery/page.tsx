'use client';
import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:7776';

interface ConductorEvent {
  id: string;
  type: string;
  taskId?: string;
  timestamp: string;
  payload?: unknown;
}

interface Task {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

interface ConductorState {
  tasks: Record<string, Task>;
  events: ConductorEvent[];
  lastEventId: string;
  rebuiltAt?: string;
}

const EVENT_COLORS: Record<string, string> = {
  TASK_ADDED: '#63b3ed',
  TASK_STARTED: '#48bb78',
  TASK_COMPLETED: '#68d391',
  TASK_FAILED: '#fc8181',
  TASK_CANCELLED: '#718096',
  TASK_BLOCKED: '#f6ad55',
  TASK_UNBLOCKED: '#ecc94b',
  BYPASS_LOGGED: '#fc8181',
  DEGRADED_SPAWN: '#f6ad55',
  RECONCILE_DRIFT: '#f6ad55',
  LOCK_RELEASED: '#a0aec0',
  SNAPSHOT_REBUILT: '#b794f4',
};

const STATUS_COLORS: Record<string, string> = {
  completed: '#68d391',
  running: '#90cdf4',
  queued: '#63b3ed',
  blocked: '#f6ad55',
  failed: '#fc8181',
  cancelled: '#718096',
};

const ALL_STATUSES = ['completed', 'running', 'queued', 'blocked', 'failed', 'cancelled'] as const;

function StatCard({
  label,
  value,
  sub,
  color = '#f0f4f8',
  gauge,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  gauge?: number;
}) {
  return (
    <div style={{ background: '#1a202c', border: '1px solid #2d3748', borderRadius: 8, padding: '14px 16px' }}>
      <div style={{
        fontSize: 11, color: '#718096', textTransform: 'uppercase',
        letterSpacing: '0.05em', marginBottom: 8,
      }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#718096', marginTop: 4 }}>{sub}</div>}
      {gauge !== undefined && (
        <div style={{ marginTop: 10, height: 5, background: '#2d3748', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{
            width: `${Math.min(gauge, 100)}%`, height: '100%',
            background: color, borderRadius: 3, transition: 'width 0.4s',
          }} />
        </div>
      )}
    </div>
  );
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString();
}

function formatDateTime(ts: string): string {
  return new Date(ts).toLocaleString();
}

function timeSince(ts: string): string {
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

export default function RecoveryPage() {
  const [state, setState] = useState<ConductorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const { lastEvent, connected } = useWebSocket(`ws://localhost:7776/events`);

  const load = useCallback(() => {
    fetch(`${API}/status`)
      .then((r) => r.json())
      .then((s: unknown) => {
        setState(s as ConductorState);
        setLastUpdated(new Date());
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (lastEvent?.kind === 'SNAPSHOT_REBUILT') load();
  }, [lastEvent, load]);

  if (loading) {
    return <div style={{ padding: 24, color: '#718096' }}>Loading recovery status…</div>;
  }

  if (!state) {
    return (
      <div style={{ padding: 24, maxWidth: 960 }}>
        <div style={{
          background: '#1a1a2e', border: '1px solid #2d3748',
          borderRadius: 8, padding: '20px 24px', color: '#718096',
        }}>
          Conductor offline — recovery status unavailable.
        </div>
      </div>
    );
  }

  const tasks = Object.values(state.tasks);
  const statusCounts = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  const rebuildEvents = state.events.filter((e) => e.type === 'SNAPSHOT_REBUILT');
  const recentEvents = [...state.events].reverse().slice(0, 50);
  const wasRebuilt = !!state.rebuiltAt;

  return (
    <div style={{ maxWidth: 960 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
          🔄 Session Recovery
        </h2>
        <span
          data-test-live-indicator
          style={{ color: connected ? '#68d391' : '#fc8181', fontSize: 11 }}
          title={connected ? 'Listening for SNAPSHOT_REBUILT events' : 'Reconnecting…'}
        >
          {connected ? '● live' : '○ reconnecting'}
        </span>
        <button
          onClick={load}
          style={{
            marginLeft: 'auto', background: '#2d3748', border: '1px solid #4a5568',
            color: '#a0aec0', borderRadius: 4, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
          }}
        >
          Refresh
        </button>
        {lastUpdated && (
          <span style={{ fontSize: 11, color: '#4a5568' }}>
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Recovery status banner */}
      {wasRebuilt ? (
        <div style={{
          background: '#1a1440', border: '1px solid #b794f4',
          borderRadius: 8, padding: '14px 20px', marginBottom: 24,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 20 }}>🔮</span>
          <div>
            <div style={{ color: '#b794f4', fontWeight: 600, fontSize: 14 }}>
              State recovered from event log
            </div>
            <div style={{ color: '#805ad5', fontSize: 12, marginTop: 2 }}>
              Rebuilt {formatDateTime(state.rebuiltAt!)} · {timeSince(state.rebuiltAt!)}
              {' · '}{tasks.length} task{tasks.length !== 1 ? 's' : ''} restored
            </div>
          </div>
        </div>
      ) : (
        <div style={{
          background: '#0d1f12', border: '1px solid #276749',
          borderRadius: 8, padding: '14px 20px', marginBottom: 24,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 20 }}>✅</span>
          <div>
            <div style={{ color: '#68d391', fontWeight: 600, fontSize: 14 }}>
              State loaded from snapshot — no recovery required
            </div>
            <div style={{ color: '#276749', fontSize: 12, marginTop: 2 }}>
              {tasks.length} task{tasks.length !== 1 ? 's' : ''} in state
              · last event: {state.lastEventId || '—'}
            </div>
          </div>
        </div>
      )}

      {/* Task state grid */}
      <section style={{ marginBottom: 28 }}>
        <div style={{
          fontSize: 13, fontWeight: 600, color: '#a0aec0', marginBottom: 12,
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          Task state
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
          <StatCard label="Total tasks" value={tasks.length} color="#f0f4f8" />
          {ALL_STATUSES.map((s) => {
            const count = statusCounts[s] ?? 0;
            if (count === 0) return null;
            return (
              <StatCard
                key={s}
                label={s}
                value={count}
                color={STATUS_COLORS[s]}
                gauge={tasks.length > 0 ? Math.round((count / tasks.length) * 100) : 0}
              />
            );
          })}
        </div>
      </section>

      {/* Rebuild history */}
      {rebuildEvents.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: '#a0aec0', marginBottom: 12,
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            Rebuild history ({rebuildEvents.length})
          </div>
          <div style={{ background: '#1a202c', border: '1px solid #2d3748', borderRadius: 8, overflow: 'hidden' }}>
            {rebuildEvents.map((e, i) => (
              <div
                key={e.id}
                style={{
                  padding: '10px 16px',
                  borderBottom: i < rebuildEvents.length - 1 ? '1px solid #2d3748' : 'none',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}
              >
                <span style={{ color: '#b794f4', fontSize: 14 }}>🔮</span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#b794f4', fontSize: 13, fontWeight: 600 }}>SNAPSHOT_REBUILT</div>
                  <div style={{ color: '#718096', fontSize: 11, marginTop: 2 }}>
                    {formatDateTime(e.timestamp)}
                  </div>
                </div>
                <span style={{ color: '#4a5568', fontFamily: 'monospace', fontSize: 11 }}>{e.id}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent event log */}
      <section>
        <div style={{
          fontSize: 13, fontWeight: 600, color: '#a0aec0', marginBottom: 12,
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          Recent events ({state.events.length} total)
        </div>
        <div style={{ background: '#1a202c', border: '1px solid #2d3748', borderRadius: 8, padding: 16 }}>
          <div style={{ height: 320, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12 }}>
            {recentEvents.length === 0 ? (
              <div style={{ color: '#718096', padding: 8 }}>No events recorded</div>
            ) : (
              recentEvents.map((event) => (
                <div
                  key={event.id}
                  style={{
                    padding: '4px 8px',
                    borderBottom: '1px solid #2d3748',
                    display: 'flex', gap: 8, alignItems: 'baseline',
                    background: event.type === 'SNAPSHOT_REBUILT' ? '#1a1440' : 'transparent',
                  }}
                >
                  <span style={{ color: '#718096', minWidth: 80 }}>
                    {formatTime(event.timestamp)}
                  </span>
                  <span style={{ color: EVENT_COLORS[event.type] ?? '#a0aec0', minWidth: 180 }}>
                    {event.type}
                  </span>
                  {event.taskId && (
                    <span style={{ color: '#90cdf4' }}>{event.taskId}</span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
