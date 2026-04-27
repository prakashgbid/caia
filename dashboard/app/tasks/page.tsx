'use client';
import { useEffect, useState, useMemo, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';

interface Task {
  id: string;
  title: string;
  status: string;
  spawnedBy: string;
  projectId?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  dependsOn: string[] | string;
  domainSlug?: string | null;
  rootPromptId?: string | null;
  priorityBucket?: string;
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  queued:    { bg: '#2d3748', color: '#a0aec0' },
  running:   { bg: '#1a3350', color: '#90cdf4' },
  done:      { bg: '#1a3320', color: '#68d391' },
  failed:    { bg: '#3d1515', color: '#fc8181' },
  cancelled: { bg: '#2d3748', color: '#718096' },
  blocked:   { bg: '#3d2a00', color: '#f6ad55' },
};

const STAGE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  queued:    { label: 'Scheduled',  color: '#a0aec0', bg: '#2d3748' },
  running:   { label: 'Executing',  color: '#63b3ed', bg: '#1a2744' },
  done:      { label: 'Verified',   color: '#68d391', bg: '#1a3320' },
  failed:    { label: 'Failed',     color: '#fc8181', bg: '#3d1515' },
  cancelled: { label: 'Cancelled',  color: '#718096', bg: '#2d3748' },
  blocked:   { label: 'Blocked',    color: '#f6ad55', bg: '#3d2a00' },
};

function stagePct(status: string): number {
  switch (status) {
    case 'queued':    return 10;
    case 'running':   return 40;
    case 'done':      return 100;
    case 'blocked':   return 10;
    case 'failed':    return 100;
    default:          return 0;
  }
}

function isSequential(task: Task): boolean {
  const dep = task.dependsOn;
  if (Array.isArray(dep)) return dep.length > 0;
  if (typeof dep === 'string') {
    try { return (JSON.parse(dep) as unknown[]).length > 0; } catch { return false; }
  }
  return false;
}

function ProgressBar({ status }: { status: string }) {
  const pct = stagePct(status);
  const color = status === 'done' ? '#68d391' : status === 'failed' ? '#fc8181' : '#63b3ed';
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${pct}% complete`}
      style={{ width: 72, height: 5, background: '#2d3748', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}
    >
      <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s ease' }} />
    </div>
  );
}

function TasksContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const project = searchParams.get('project') ?? '';
  const status = searchParams.get('status') ?? '';
  const bucket = searchParams.get('bucket') ?? '';
  const domain = searchParams.get('domain') ?? '';
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch('/api/tasks')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setTasks(data as Task[]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function setFilter(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    router.push(`/tasks?${p.toString()}`);
  }

  // Derive domain options
  const domains = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach(t => { if (t.domainSlug) set.add(t.domainSlug); });
    return [...set].sort();
  }, [tasks]);

  // Status counts
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    tasks.forEach(t => { counts[t.status] = (counts[t.status] ?? 0) + 1; });
    return counts;
  }, [tasks]);

  const filtered = useMemo(() => {
    return tasks.filter(t => {
      if (project && t.projectId !== project) return false;
      if (status && t.status !== status) return false;
      if (domain && t.domainSlug !== domain) return false;
      if (bucket === 'sequential' && !isSequential(t)) return false;
      if (bucket === 'parallel' && isSequential(t)) return false;
      return true;
    });
  }, [tasks, project, status, domain, bucket]);

  const allStatuses = ['queued', 'running', 'done', 'failed', 'cancelled', 'blocked'];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>📋 Tasks</h1>
        <span style={{ fontSize: 13, color: '#718096' }}>{filtered.length} / {tasks.length} tasks</span>
        {(status || bucket || domain) && (
          <button
            onClick={() => router.push('/tasks')}
            style={{ background: '#742a2a', color: '#fed7d7', border: 'none', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', fontSize: 12 }}
          >
            Clear filters ×
          </button>
        )}
      </div>

      {/* Status count chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {allStatuses.filter(s => statusCounts[s]).map(s => {
          const cfg = STATUS_COLORS[s] ?? STATUS_COLORS.queued;
          return (
            <button
              key={s}
              onClick={() => setFilter('status', status === s ? '' : s)}
              style={{
                background: status === s ? cfg.bg : '#1a1f2e',
                color: cfg.color,
                border: `1px solid ${cfg.color}40`,
                borderRadius: 12,
                padding: '2px 10px',
                fontSize: 11,
                cursor: 'pointer',
                fontWeight: status === s ? 700 : 400,
              }}
            >
              {s} {statusCounts[s]}
            </button>
          );
        })}
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={status}
          onChange={e => setFilter('status', e.target.value)}
          aria-label="Filter by status"
          style={{ background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
        >
          <option value="">All statuses</option>
          {allStatuses.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select
          value={bucket}
          onChange={e => setFilter('bucket', e.target.value)}
          aria-label="Filter by bucket"
          style={{ background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
        >
          <option value="">All buckets</option>
          <option value="sequential">🔗 Sequential</option>
          <option value="parallel">⚡ Parallel</option>
        </select>

        {domains.length > 0 && (
          <select
            value={domain}
            onChange={e => setFilter('domain', e.target.value)}
            aria-label="Filter by domain"
            style={{ background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
          >
            <option value="">All domains</option>
            {domains.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}
      </div>

      {/* Task list */}
      {loading ? (
        <div style={{ color: '#718096', padding: 32 }}>Loading...</div>
      ) : (
        <div role="list" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {filtered.map(task => {
            const statusCfg = STATUS_COLORS[task.status] ?? STATUS_COLORS.queued;
            const stageCfg = STAGE_CONFIG[task.status] ?? STAGE_CONFIG.queued;
            const seq = isSequential(task);
            const promptId = task.rootPromptId && task.rootPromptId !== 'untraced' ? task.rootPromptId : null;

            return (
              <Link key={task.id} href={`/tasks/${task.id}`} style={{ textDecoration: 'none' }}>
                <div
                  role="listitem"
                  style={{
                    background: '#1a1f2e',
                    borderRadius: 6,
                    padding: '10px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    border: '1px solid #2d3748',
                    borderLeft: `3px solid ${statusCfg.color}`,
                    cursor: 'pointer',
                  }}
                >
                  {/* Status badge */}
                  <span
                    style={{
                      background: statusCfg.bg,
                      color: statusCfg.color,
                      fontSize: 10,
                      padding: '2px 7px',
                      borderRadius: 10,
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      fontWeight: 600,
                    }}
                  >
                    {task.status}
                  </span>

                  {/* Pipeline stage badge */}
                  <span
                    style={{
                      background: stageCfg.bg,
                      color: stageCfg.color,
                      fontSize: 10,
                      padding: '2px 7px',
                      borderRadius: 10,
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      border: `1px solid ${stageCfg.color}30`,
                    }}
                  >
                    {stageCfg.label}
                  </span>

                  {/* Bucket indicator */}
                  <span
                    title={seq ? 'Sequential — has dependencies' : 'Parallel — independent'}
                    style={{ fontSize: 13, flexShrink: 0, color: seq ? '#63b3ed' : '#68d391' }}
                    aria-label={seq ? 'Sequential task' : 'Parallel task'}
                  >
                    {seq ? '🔗' : '⚡'}
                  </span>

                  {/* Progress bar */}
                  <ProgressBar status={task.status} />

                  {/* Title */}
                  <span style={{ flex: 1, color: '#f0f4f8', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {task.title}
                  </span>

                  {/* Domain chip */}
                  {task.domainSlug && (
                    <span style={{ fontSize: 10, background: '#1a2744', color: '#63b3ed', borderRadius: 3, padding: '1px 6px', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {task.domainSlug}
                    </span>
                  )}

                  {/* Root prompt chip */}
                  {promptId && (
                    <span
                      onClick={e => { e.preventDefault(); e.stopPropagation(); window.location.href = `/pipeline?promptId=${promptId}`; }}
                      title={`Prompt: ${promptId}`}
                      style={{
                        fontSize: 10,
                        background: '#2a1f4a',
                        color: '#b794f4',
                        borderRadius: 3,
                        padding: '1px 6px',
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                        maxWidth: 140,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        cursor: 'pointer',
                        border: '1px solid #b794f430',
                      }}
                    >
                      ✦ {promptId.slice(0, 12)}…
                    </span>
                  )}

                  {/* Spawned by */}
                  <span style={{ fontSize: 11, color: '#718096', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {task.spawnedBy}
                  </span>

                  {/* ID */}
                  <span style={{ fontSize: 11, color: '#4a5568', whiteSpace: 'nowrap', fontFamily: 'monospace', flexShrink: 0 }}>
                    {task.id.slice(0, 10)}
                  </span>
                </div>
              </Link>
            );
          })}
          {filtered.length === 0 && !loading && (
            <div style={{ color: '#718096', padding: 32, textAlign: 'center' }}>
              {tasks.length === 0 ? 'No tasks' : 'No tasks match the current filters'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div style={{ color: '#718096', padding: 32 }}>Loading...</div>}>
      <TasksContent />
    </Suspense>
  );
}
