// VAL-2026-04-30-051730-10-chor — chore task monitor page
'use client';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useWebSocket } from '../../hooks/useWebSocket';
import { ChoreWorkflowCard, type ChoreTask } from '../../components/ChoreWorkflowCard';

const STATUS_LABELS: Record<ChoreTask['status'], string> = {
  queued: 'Queued',
  triaging: 'Triaging',
  executing: 'Executing',
  done: 'Done',
  failed: 'Failed',
};

function ChoresContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { connected, lastEvent } = useWebSocket('ws://localhost:7776/events');

  const [tasks, setTasks] = useState<ChoreTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [announcement, setAnnouncement] = useState('');

  const search = searchParams.get('search') ?? '';
  const statusFilter = (searchParams.get('status') ?? '') as ChoreTask['status'] | '';

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/chores');
      if (res.ok) {
        const data = await res.json() as ChoreTask[];
        setTasks(Array.isArray(data) ? data : []);
        setAnnouncement(`Loaded ${data.length} chore task${data.length !== 1 ? 's' : ''}`);
        setTimeout(() => setAnnouncement(''), 2000);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  // Live update via WebSocket: refresh on chore.* events
  useEffect(() => {
    if (!lastEvent?.kind.startsWith('chore.')) return;
    void loadTasks();
  }, [lastEvent, loadTasks]);

  function setParam(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (value) p.set(key, value); else p.delete(key);
    router.push(`/chores?${p.toString()}`);
  }

  const filtered = tasks.filter(t => {
    const q = search.toLowerCase();
    const matchSearch = !q || t.id.toLowerCase().includes(q) || t.prompt.toLowerCase().includes(q);
    const matchStatus = !statusFilter || t.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const counts = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div
        aria-live="polite"
        aria-atomic="true"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}
      >
        {announcement}
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>⚙️ Chore Tasks</h1>
        <span style={{ fontSize: 12, color: connected ? '#68d391' : '#fc8181' }}>
          {connected ? '● live' : '○ offline'}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => void loadTasks()}
          style={{
            background: '#2d3748',
            color: '#a0aec0',
            border: '1px solid #4a5568',
            borderRadius: 4,
            padding: '5px 12px',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Refresh
        </button>
      </div>

      {/* Status summary chips */}
      {!loading && tasks.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {(Object.keys(STATUS_LABELS) as ChoreTask['status'][]).map(s => {
            const n = counts[s] ?? 0;
            if (n === 0) return null;
            return (
              <button
                key={s}
                onClick={() => setParam('status', statusFilter === s ? '' : s)}
                style={{
                  fontSize: 11,
                  padding: '2px 10px',
                  borderRadius: 10,
                  border: `1px solid ${statusFilter === s ? '#90cdf4' : '#4a5568'}`,
                  background: statusFilter === s ? '#1a2744' : '#2d3748',
                  color: statusFilter === s ? '#90cdf4' : '#a0aec0',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
                aria-pressed={statusFilter === s}
              >
                {STATUS_LABELS[s]}: {n}
              </button>
            );
          })}
          {statusFilter && (
            <button
              onClick={() => setParam('status', '')}
              style={{
                fontSize: 11,
                padding: '2px 10px',
                borderRadius: 10,
                border: '1px solid #742a2a',
                background: '#742a2a',
                color: '#fed7d7',
                cursor: 'pointer',
              }}
            >
              Clear ×
            </button>
          )}
        </div>
      )}

      {/* Search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <input
          type="search"
          placeholder="Filter by task ID or prompt…"
          value={search}
          onChange={e => setParam('search', e.target.value)}
          aria-label="Search chore tasks"
          style={{
            background: '#2d3748',
            color: '#e2e8f0',
            border: '1px solid #4a5568',
            borderRadius: 4,
            padding: '4px 10px',
            fontSize: 13,
            width: 300,
          }}
        />
        {search && (
          <button
            onClick={() => setParam('search', '')}
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
            Clear ×
          </button>
        )}
        <span style={{ fontSize: 12, color: '#718096', marginLeft: 4 }}>
          {filtered.length} task{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Single-domain info banner */}
      <div
        style={{
          background: '#1a2744',
          border: '1px solid #2b4080',
          borderRadius: 6,
          padding: '8px 12px',
          marginBottom: 16,
          fontSize: 12,
          color: '#90cdf4',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span>🏷️</span>
        <span>
          Chore tasks are single-domain tasks routed directly to the <strong>backend</strong> specialist.
          Target SLO: <strong>20s</strong>. No multi-agent collaboration required.
        </span>
      </div>

      {/* Task list */}
      {loading ? (
        <div style={{ color: '#718096', padding: 32, textAlign: 'center' }}>Loading chore tasks…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: '#718096', padding: 32, textAlign: 'center' }}>
          {search || statusFilter ? 'No tasks match the filter.' : 'No chore tasks recorded yet.'}
        </div>
      ) : (
        <section aria-label="Chore tasks">
          {filtered.map(task => (
            <ChoreWorkflowCard key={task.id} task={task} />
          ))}
        </section>
      )}
    </div>
  );
}

export default function ChoresPage() {
  return (
    <Suspense fallback={<div style={{ color: '#718096', padding: 32 }}>Loading chore tasks…</div>}>
      <ChoresContent />
    </Suspense>
  );
}
