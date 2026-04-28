'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useEventStream } from '../../hooks/useEventStream';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlatformStats {
  totalPrompts: number;
  activeTasks: number;
  blockedTasks: number;
  completedToday: number;
  avgTaskDurationMs: number;
  queueDepth: number;
  lastUpdated: number;
}

interface TaskRun {
  id: number;
  sessionId: string;
  title: string;
  kind: string;
  status: string;
  projectSlug?: string;
  startedAt: string;
  lastActivityAt: string;
  endedAt?: string;
  turnCount: number;
  subtask_progress: { done: number; total: number };
}

interface PipelineEvent {
  id: number;
  ts: string;
  stage: string;
  entityKind?: string;
  entityId?: string;
  promptText?: string;
  promptId?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function useLiveTimer(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return tick;
}

function durationSince(ts: string): string {
  return fmt(Date.now() - new Date(ts).getTime());
}

const STAGE_COLORS: Record<string, { bg: string; color: string }> = {
  ingested:             { bg: '#2d3748', color: '#a0aec0' },
  requirement_created:  { bg: '#1a2744', color: '#63b3ed' },
  story_decomposed:     { bg: '#2a1f4a', color: '#b794f4' },
  task_queued:          { bg: '#3d2a00', color: '#f6ad55' },
  task_running:         { bg: '#1a3350', color: '#90cdf4' },
  task_completed:       { bg: '#1a3320', color: '#68d391' },
  verified:             { bg: '#1a3320', color: '#68d391' },
  failed:               { bg: '#3d1515', color: '#fc8181' },
};

const ENTITY_ICONS: Record<string, string> = {
  prompt: '✦',
  requirement: '📝',
  story: '🌳',
  task: '📋',
  task_run: '📡',
  completeness: '✅',
};

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  status?: 'ok' | 'warn' | 'crit';
}

function KpiCard({ label, value, subtitle, status = 'ok' }: KpiCardProps) {
  const borderColor = status === 'crit' ? '#fc8181' : status === 'warn' ? '#f6ad55' : '#68d391';
  const valueColor = status === 'crit' ? '#fc8181' : status === 'warn' ? '#f6ad55' : '#f0f4f8';
  return (
    <div style={{
      background: '#1a1f2e',
      border: `1px solid #2d3748`,
      borderTop: `3px solid ${borderColor}`,
      borderRadius: 8,
      padding: '16px 20px',
      flex: 1,
      minWidth: 120,
    }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: valueColor, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#718096', marginTop: 6 }}>{label}</div>
      {subtitle && <div style={{ fontSize: 11, color: '#4a5568', marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

// ─── Pipeline Activity Feed ────────────────────────────────────────────────────

function PipelineActivityFeed({ events }: { events: PipelineEvent[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, paused]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#f0f4f8' }}>⚡ Live Pipeline Activity</h2>
        <span style={{ fontSize: 11, color: '#718096', marginLeft: 'auto' }}>
          {paused ? '⏸ paused' : `${events.length} events`}
        </span>
      </div>
      <div
        ref={scrollRef}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
          padding: '4px 0',
        }}
        aria-label="Pipeline activity feed"
        aria-live="polite"
      >
        {events.length === 0 && (
          <div style={{ color: '#4a5568', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
            Waiting for pipeline events…
          </div>
        )}
        {events.map(ev => {
          const stageCfg = STAGE_COLORS[ev.stage] ?? { bg: '#2d3748', color: '#a0aec0' };
          const entityIcon = ev.entityKind ? (ENTITY_ICONS[ev.entityKind] ?? '○') : '○';
          return (
            <div key={ev.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 8px', borderRadius: 4, background: '#111520' }}>
              <span style={{ fontSize: 10, color: '#4a5568', whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'monospace', marginTop: 1 }}>
                {new Date(ev.ts).toLocaleTimeString()}
              </span>
              <span
                style={{
                  background: stageCfg.bg,
                  color: stageCfg.color,
                  fontSize: 9,
                  padding: '1px 5px',
                  borderRadius: 8,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  fontWeight: 600,
                  marginTop: 1,
                }}
              >
                {ev.stage.replace(/_/g, ' ')}
              </span>
              <span style={{ fontSize: 12, color: '#718096', flexShrink: 0 }}>{entityIcon}</span>
              {ev.entityId && (
                <span style={{ fontSize: 10, color: '#4a5568', fontFamily: 'monospace', flexShrink: 0, whiteSpace: 'nowrap' }}>
                  {ev.entityId.slice(0, 12)}
                </span>
              )}
              {ev.promptText && (
                <span style={{ fontSize: 11, color: '#a0aec0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {ev.promptText.slice(0, 60)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Task Bucket Distribution ─────────────────────────────────────────────────

interface TaskBucketProps {
  tasks: Array<{ id: string; title: string; status: string; dependsOn: string[] | string; createdAt: string }>;
}

function isSeq(t: { dependsOn: string[] | string }): boolean {
  const d = t.dependsOn;
  if (Array.isArray(d)) return d.length > 0;
  if (typeof d === 'string') { try { return (JSON.parse(d) as unknown[]).length > 0; } catch { return false; } }
  return false;
}

const STATUS_DOT: Record<string, string> = {
  queued: '○', running: '▶', done: '✓', failed: '✗', blocked: '!', cancelled: '−',
};
const STATUS_DOT_COLOR: Record<string, string> = {
  queued: '#718096', running: '#63b3ed', done: '#68d391', failed: '#fc8181', blocked: '#f6ad55', cancelled: '#718096',
};

function TaskBucketPanel({ tasks }: TaskBucketProps) {
  const sequential = tasks.filter(isSeq);
  const parallel = tasks.filter(t => !isSeq(t));

  function TaskMini({ t }: { t: typeof tasks[0] }) {
    return (
      <Link href={`/tasks/${t.id}`} style={{ textDecoration: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 4, background: '#111520' }}>
          <span style={{ fontSize: 12, color: STATUS_DOT_COLOR[t.status] ?? '#718096', flexShrink: 0 }}>
            {STATUS_DOT[t.status] ?? '○'}
          </span>
          <span style={{ fontSize: 12, color: '#d1d5db', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {t.title.slice(0, 44)}
          </span>
          <span style={{ fontSize: 10, color: '#4a5568', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {relativeTime(t.createdAt)}
          </span>
        </div>
      </Link>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#f0f4f8' }}>📦 Task Buckets</h2>

      {/* Sequential */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 14 }}>🔗</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#63b3ed' }}>Sequential</span>
          <span style={{ fontSize: 11, background: '#1a2744', color: '#63b3ed', borderRadius: 10, padding: '1px 7px' }}>
            {sequential.length}
          </span>
          <Link href="/tasks?bucket=sequential" style={{ fontSize: 11, color: '#4a5568', marginLeft: 'auto', textDecoration: 'none' }}>
            See all →
          </Link>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sequential.slice(0, 5).map(t => <TaskMini key={t.id} t={t} />)}
          {sequential.length === 0 && <div style={{ fontSize: 12, color: '#4a5568', padding: '4px 6px' }}>No sequential tasks</div>}
        </div>
      </div>

      {/* Parallel */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 14 }}>⚡</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#68d391' }}>Parallel</span>
          <span style={{ fontSize: 11, background: '#1a3320', color: '#68d391', borderRadius: 10, padding: '1px 7px' }}>
            {parallel.length}
          </span>
          <Link href="/tasks?bucket=parallel" style={{ fontSize: 11, color: '#4a5568', marginLeft: 'auto', textDecoration: 'none' }}>
            See all →
          </Link>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {parallel.slice(0, 5).map(t => <TaskMini key={t.id} t={t} />)}
          {parallel.length === 0 && <div style={{ fontSize: 12, color: '#4a5568', padding: '4px 6px' }}>No parallel tasks</div>}
        </div>
      </div>
    </div>
  );
}

// ─── Active Task Runs Table ────────────────────────────────────────────────────

function ActiveTaskRunsTable({ runs, tick }: { runs: TaskRun[]; tick: number }) {
  void tick; // used to force re-render every second
  return (
    <div>
      <h2 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 700, color: '#f0f4f8' }}>
        ▶ Active Task Runs
        {runs.length > 0 && (
          <span style={{ fontSize: 12, background: '#1a3350', color: '#90cdf4', borderRadius: 10, padding: '1px 8px', marginLeft: 10, fontWeight: 400 }}>
            {runs.length} running
          </span>
        )}
      </h2>
      {runs.length === 0 ? (
        <div style={{ color: '#4a5568', padding: '24px 0', textAlign: 'center', fontSize: 14 }}>
          No tasks currently running — queue is idle
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2d3748' }}>
                {['Task', 'Stage', 'Duration', 'Turns', 'Progress', ''].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#718096', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map(run => {
                const duration = durationSince(run.startedAt);
                const prog = run.subtask_progress;
                const pct = prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;

                return (
                  <tr
                    key={run.sessionId}
                    style={{
                      borderBottom: '1px solid #1a1f2e',
                      animation: 'pulse-running 2s infinite',
                    }}
                  >
                    <td style={{ padding: '8px 10px', maxWidth: 280 }}>
                      <Link href={`/task-runs/${run.sessionId}`} style={{ color: '#f0f4f8', textDecoration: 'none' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                          {run.title}
                        </span>
                      </Link>
                    </td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      <span style={{ background: '#1a3350', color: '#90cdf4', fontSize: 10, padding: '2px 6px', borderRadius: 8 }}>
                        executing
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', color: '#63b3ed', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                      {duration}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#718096', whiteSpace: 'nowrap' }}>
                      {run.turnCount}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 60, height: 5, background: '#2d3748', borderRadius: 3, overflow: 'hidden', flexShrink: 0 }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: '#63b3ed' }} />
                        </div>
                        {prog.total > 0 && (
                          <span style={{ fontSize: 10, color: '#718096', whiteSpace: 'nowrap' }}>
                            {prog.done}/{prog.total}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <Link href={`/task-runs/${run.sessionId}`} style={{ fontSize: 11, color: '#63b3ed', textDecoration: 'none' }}>
                        View →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function PlatformStatusPage() {
  const { lastEvent, connected } = useEventStream();
  const tick = useLiveTimer();

  const [stats, setStats] = useState<PlatformStats>({
    totalPrompts: 0, activeTasks: 0, blockedTasks: 0,
    completedToday: 0, avgTaskDurationMs: 0, queueDepth: 0, lastUpdated: 0,
  });
  const [activeRuns, setActiveRuns] = useState<TaskRun[]>([]);
  const [allTasks, setAllTasks] = useState<Array<{ id: string; title: string; status: string; dependsOn: string[] | string; createdAt: string }>>([]);
  const [pipelineEvents, setPipelineEvents] = useState<PipelineEvent[]>([]);
  const eventIdRef = useRef(0);

  // Fetch stats (every 30s)
  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/platform-stats');
      if (res.ok) setStats(await res.json() as PlatformStats);
    } catch { /* ignore */ }
  }, []);

  // Fetch active runs (every 10s)
  const loadActiveRuns = useCallback(async () => {
    try {
      const res = await fetch('/api/task-runs/active');
      if (res.ok) {
        const data = await res.json() as TaskRun[];
        setActiveRuns(Array.isArray(data) ? data : []);
      }
    } catch { /* ignore */ }
  }, []);

  // Fetch all tasks for bucket view (every 10s)
  const loadTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      if (res.ok) {
        const data = await res.json() as Array<{ id: string; title: string; status: string; dependsOn: string[] | string; createdAt: string }>;
        setAllTasks(Array.isArray(data) ? data : []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void loadStats();
    void loadActiveRuns();
    void loadTasks();
    const statsTimer = setInterval(() => void loadStats(), 30000);
    const runsTimer = setInterval(() => { void loadActiveRuns(); void loadTasks(); }, 10000);
    return () => { clearInterval(statsTimer); clearInterval(runsTimer); };
  }, [loadStats, loadActiveRuns, loadTasks]);

  // Collect pipeline events from WS
  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.kind === 'pipeline.stage.advanced') {
      const payload = lastEvent.payload as Record<string, unknown> | undefined;
      const ev: PipelineEvent = {
        id: ++eventIdRef.current,
        ts: lastEvent.ts ?? new Date().toISOString(),
        stage: (payload?.['stage'] as string | undefined) ?? 'unknown',
        entityKind: payload?.['entityKind'] as string | undefined,
        entityId: payload?.['entityId'] as string | undefined,
        promptText: payload?.['promptText'] as string | undefined,
        promptId: payload?.['promptId'] as string | undefined,
      };
      setPipelineEvents(prev => [...prev.slice(-49), ev]);
    }

    // Update active runs on task_run events
    if (lastEvent.kind.startsWith('task_run.')) {
      const payload = lastEvent.payload as TaskRun | undefined;
      if (payload?.sessionId) {
        setActiveRuns(prev => {
          if (payload.status === 'running') {
            const idx = prev.findIndex(r => r.sessionId === payload.sessionId);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...prev[idx], ...payload };
              return next;
            }
            return [payload, ...prev];
          }
          // Remove non-running
          return prev.filter(r => r.sessionId !== payload.sessionId);
        });
      }
    }

    // Update stats on relevant events
    if (lastEvent.kind.startsWith('task.') || lastEvent.kind.startsWith('prompt.')) {
      void loadStats();
    }
  }, [lastEvent, loadStats]);

  const kpiStatus = (val: number, warnAt: number, critAt: number): 'ok' | 'warn' | 'crit' =>
    val >= critAt ? 'crit' : val >= warnAt ? 'warn' : 'ok';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minHeight: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>⬡ Platform Status</h1>
        <span style={{ fontSize: 12, color: connected ? '#68d391' : '#fc8181' }}>
          {connected ? '● live' : '○ reconnecting…'}
        </span>
        {stats.lastUpdated > 0 && (
          <span style={{ fontSize: 11, color: '#4a5568', marginLeft: 'auto' }}>
            Updated {relativeTime(new Date(stats.lastUpdated).toISOString())}
          </span>
        )}
      </div>

      {/* KPI Cards row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KpiCard label="Total Prompts" value={stats.totalPrompts} />
        <KpiCard
          label="Active Tasks"
          value={stats.activeTasks}
          status={kpiStatus(stats.activeTasks, 10, 20)}
        />
        <KpiCard
          label="Blocked Tasks"
          value={stats.blockedTasks}
          status={kpiStatus(stats.blockedTasks, 3, 8)}
        />
        <KpiCard
          label="Done Today"
          value={stats.completedToday}
          status={stats.completedToday > 0 ? 'ok' : 'warn'}
        />
        <KpiCard
          label="Avg Task Duration"
          value={stats.avgTaskDurationMs > 0 ? fmt(stats.avgTaskDurationMs) : '—'}
        />
        <KpiCard
          label="Queue Depth"
          value={stats.queueDepth}
          status={kpiStatus(stats.queueDepth, 20, 50)}
        />
      </div>

      {/* Middle row: pipeline feed + bucket distribution */}
      <div style={{ display: 'flex', gap: 16, minHeight: 320 }}>
        {/* Pipeline Activity (60%) */}
        <div style={{
          flex: '0 0 60%',
          background: '#1a1f2e',
          border: '1px solid #2d3748',
          borderRadius: 8,
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <PipelineActivityFeed events={pipelineEvents} />
        </div>

        {/* Bucket Distribution (40%) */}
        <div style={{
          flex: '0 0 calc(40% - 16px)',
          background: '#1a1f2e',
          border: '1px solid #2d3748',
          borderRadius: 8,
          padding: '16px',
          overflowY: 'auto',
        }}>
          <TaskBucketPanel tasks={allTasks} />
        </div>
      </div>

      {/* Bottom row: active task runs */}
      <div style={{
        background: '#1a1f2e',
        border: '1px solid #2d3748',
        borderRadius: 8,
        padding: '16px',
      }}>
        <ActiveTaskRunsTable runs={activeRuns} tick={tick} />
      </div>
    </div>
  );
}
