'use client';
import { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useWebSocket } from '../../hooks/useWebSocket';

type TaskRunStatus = 'pending' | 'running' | 'idle' | 'completed' | 'stalled' | 'aborted' | 'failed';

interface SubtaskProgress { done: number; total: number; }

interface TaskRun {
  id: number;
  sessionId: string;
  title: string;
  kind: string;
  status: TaskRunStatus;
  projectSlug?: string;
  domainSlugs: string;
  respawnOfSessionId?: string;
  startedAt: string;
  lastActivityAt: string;
  endedAt?: string;
  turnCount: number;
  completionSummary?: string;
  resultOk?: boolean;
  subtask_progress: SubtaskProgress;
}

const STATUS_CONFIG: Record<TaskRunStatus, { color: string; shape: string; label: string; bg: string }> = {
  pending:   { color: '#718096', shape: '○', label: 'Pending',   bg: '#2d3748' },
  running:   { color: '#68d391', shape: '▶', label: 'Running',   bg: '#1a3330' },
  idle:      { color: '#90cdf4', shape: '◐', label: 'Idle',      bg: '#1a2744' },
  completed: { color: '#68d391', shape: '✓', label: 'Done',      bg: '#1a3320' },
  stalled:   { color: '#f6ad55', shape: '⏸', label: 'Stalled',  bg: '#3d2a00' },
  aborted:   { color: '#fc8181', shape: '✕', label: 'Aborted',   bg: '#3d1515' },
  failed:    { color: '#fc8181', shape: '✗', label: 'Failed',    bg: '#3d1515' },
};

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  if (total === 0) return <span style={{ color: '#718096', fontSize: 11 }}>no subtasks</span>;
  const pct = Math.round((done / total) * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${done} of ${total} subtasks done`}
        style={{
          width: 60,
          height: 6,
          background: '#2d3748',
          borderRadius: 3,
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: '#68d391', transition: 'width 0.3s ease' }} />
      </div>
      <span style={{ fontSize: 11, color: '#a0aec0', whiteSpace: 'nowrap' }}>
        {done}/{total} · {pct}%
      </span>
    </div>
  );
}

function StatusDot({ status }: { status: TaskRunStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span
      aria-label={`Status: ${cfg.label}`}
      title={cfg.label}
      style={{ color: cfg.color, fontSize: 14, fontWeight: 700, flexShrink: 0 }}
    >
      {cfg.shape}
    </span>
  );
}

function StatusCounts({ runs }: { runs: TaskRun[] }) {
  const counts: Partial<Record<TaskRunStatus, number>> = {};
  for (const r of runs) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const chips: TaskRunStatus[] = ['running', 'idle', 'stalled', 'completed', 'failed', 'aborted', 'pending'];
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} aria-label="Status counts">
      {chips.filter(s => counts[s]).map(s => (
        <span
          key={s}
          style={{
            fontSize: 11,
            background: STATUS_CONFIG[s].bg,
            color: STATUS_CONFIG[s].color,
            border: `1px solid ${STATUS_CONFIG[s].color}40`,
            borderRadius: 12,
            padding: '2px 8px',
          }}
        >
          {STATUS_CONFIG[s].shape} {STATUS_CONFIG[s].label} {counts[s]}
        </span>
      ))}
    </div>
  );
}

function TaskRunsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { lastEvent, connected } = useWebSocket('ws://localhost:7776/events');

  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [pulsingIds, setPulsingIds] = useState<Set<string>>(new Set());

  // aria-live announcements
  const [announcement, setAnnouncement] = useState('');

  const statusFilter = searchParams.get('status') ?? '';
  const projectFilter = searchParams.get('project') ?? '';
  const search = searchParams.get('search') ?? '';

  const loadRuns = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (projectFilter) params.set('project', projectFilter);
    params.set('limit', '200');
    try {
      const res = await fetch(`/api/task-runs?${params.toString()}`);
      if (res.ok) {
        const data = await res.json() as TaskRun[];
        setRuns(Array.isArray(data) ? data : []);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [statusFilter, projectFilter]);

  useEffect(() => { void loadRuns(); }, [loadRuns]);

  // Live WS updates — re-render in place, pulse the row
  useEffect(() => {
    if (!lastEvent?.kind.startsWith('task_run.')) return;
    const payload = lastEvent.payload as TaskRun | undefined;
    if (!payload?.sessionId) return;
    setRuns(prev => {
      const idx = prev.findIndex(r => r.sessionId === payload.sessionId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...prev[idx], ...payload };
        return next;
      }
      return [payload, ...prev];
    });
    setPulsingIds(prev => new Set([...prev, payload.sessionId]));
    setAnnouncement(`Task ${payload.title} status changed to ${payload.status}`);
    setTimeout(() => {
      setPulsingIds(prev => { const n = new Set(prev); n.delete(payload.sessionId); return n; });
      setAnnouncement('');
    }, 2000);
  }, [lastEvent]);

  function setFilter(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (value) p.set(key, value); else p.delete(key);
    router.push(`/task-runs?${p.toString()}`);
  }

  const filtered = runs.filter(r => {
    if (search) {
      const q = search.toLowerCase();
      return r.title.toLowerCase().includes(q) || r.sessionId.includes(q) || (r.completionSummary ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  const allStatuses: TaskRunStatus[] = ['running', 'idle', 'pending', 'completed', 'stalled', 'aborted', 'failed'];

  return (
    <div>
      {/* aria-live region for status changes */}
      <div aria-live="polite" aria-atomic="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
        {announcement}
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>📡 Task Runs</h1>
        <span style={{ fontSize: 12, color: connected ? '#68d391' : '#fc8181' }}>
          {connected ? '● live' : '○ offline'}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => void loadRuns()}
          style={{ background: '#2d3748', color: '#a0aec0', border: '1px solid #4a5568', borderRadius: 4, padding: '5px 12px', cursor: 'pointer', fontSize: 13 }}
        >
          Refresh
        </button>
      </div>

      {/* Status count chips */}
      <div style={{ marginBottom: 16 }}>
        <StatusCounts runs={runs} />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={statusFilter}
          onChange={e => setFilter('status', e.target.value)}
          aria-label="Filter by status"
          style={{ background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
        >
          <option value="">All statuses</option>
          {allStatuses.map(s => (
            <option key={s} value={s}>{STATUS_CONFIG[s].shape} {STATUS_CONFIG[s].label}</option>
          ))}
        </select>

        <input
          type="search"
          placeholder="Search title / session ID..."
          value={search}
          onChange={e => setFilter('search', e.target.value)}
          aria-label="Search task runs"
          style={{ background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 4, padding: '4px 8px', fontSize: 13, width: 220 }}
        />

        {(statusFilter || search || projectFilter) && (
          <button
            onClick={() => router.push('/task-runs')}
            style={{ background: '#742a2a', color: '#fed7d7', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
          >
            Clear ×
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ color: '#718096', padding: 32, textAlign: 'center' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: '#718096', padding: 32, textAlign: 'center' }}>No task runs found.</div>
      ) : (
        <div role="list" aria-label="Task runs" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {filtered.map(run => {
            const cfg = STATUS_CONFIG[run.status] ?? STATUS_CONFIG.pending;
            const isPulsing = pulsingIds.has(run.sessionId);
            let domainList: string[] = [];
            try { domainList = JSON.parse(run.domainSlugs) as string[]; } catch { /* ignore */ }

            return (
              <Link
                key={run.sessionId}
                href={`/task-runs/${run.sessionId}`}
                role="listitem"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 14px',
                  background: isPulsing ? '#1a2744' : cfg.bg,
                  border: `1px solid ${isPulsing ? '#63b3ed' : '#2d3748'}`,
                  borderLeft: `3px solid ${cfg.color}`,
                  borderRadius: 6,
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: isPulsing ? 'none' : 'background 0.5s ease, border-color 0.5s ease',
                }}
                aria-label={`${run.title} — Status: ${cfg.label}, ${run.subtask_progress.done} of ${run.subtask_progress.total} subtasks done`}
              >
                <StatusDot status={run.status} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#f0f4f8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>
                      {run.title}
                    </span>
                    {run.projectSlug && (
                      <span style={{ fontSize: 10, background: '#2d3748', color: '#90cdf4', borderRadius: 3, padding: '1px 5px' }}>
                        {run.projectSlug}
                      </span>
                    )}
                    {domainList.map(d => (
                      <span key={d} style={{ fontSize: 10, background: '#1a2744', color: '#63b3ed', borderRadius: 3, padding: '1px 5px' }}>{d}</span>
                    ))}
                    {run.respawnOfSessionId && (
                      <span style={{ fontSize: 10, color: '#f6ad55', border: '1px solid #f6ad5540', borderRadius: 3, padding: '1px 5px' }}>
                        ↻ respawn
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <ProgressBar done={run.subtask_progress.done} total={run.subtask_progress.total} />
                    <span style={{ fontSize: 11, color: '#718096' }}>{run.turnCount} turns</span>
                    {run.kind !== 'task' && (
                      <span style={{ fontSize: 10, color: '#718096', fontFamily: 'monospace' }}>{run.kind}</span>
                    )}
                  </div>
                </div>

                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 11, color: '#a0aec0' }}>
                    <time dateTime={run.startedAt} title={new Date(run.startedAt).toLocaleString()}>
                      {relativeTime(run.startedAt)}
                    </time>
                  </div>
                  {run.endedAt && (
                    <div style={{ fontSize: 10, color: '#718096' }}>
                      ended <time dateTime={run.endedAt}>{relativeTime(run.endedAt)}</time>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function TaskRunsPage() {
  return (
    <Suspense fallback={<div style={{ color: '#718096', padding: 32 }}>Loading task runs…</div>}>
      <TaskRunsContent />
    </Suspense>
  );
}
