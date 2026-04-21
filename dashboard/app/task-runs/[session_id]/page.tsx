'use client';
import { useState, useEffect, Suspense, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useWebSocket } from '../../../hooks/useWebSocket';

type TaskRunStatus = 'pending' | 'running' | 'idle' | 'completed' | 'stalled' | 'aborted' | 'failed';

const STATUS_CONFIG: Record<TaskRunStatus, { color: string; shape: string; label: string; bg: string }> = {
  pending:   { color: '#718096', shape: '○', label: 'Pending',   bg: '#2d3748' },
  running:   { color: '#68d391', shape: '▶', label: 'Running',   bg: '#1a3330' },
  idle:      { color: '#90cdf4', shape: '◐', label: 'Idle',      bg: '#1a2744' },
  completed: { color: '#68d391', shape: '✓', label: 'Done',      bg: '#1a3320' },
  stalled:   { color: '#f6ad55', shape: '⏸', label: 'Stalled',  bg: '#3d2a00' },
  aborted:   { color: '#fc8181', shape: '✕', label: 'Aborted',   bg: '#3d1515' },
  failed:    { color: '#fc8181', shape: '✗', label: 'Failed',    bg: '#3d1515' },
};

interface SubtaskProgress { done: number; total: number; }

interface TaskRun {
  id: number;
  sessionId: string;
  title: string;
  kind: string;
  cwd?: string;
  prompt?: string;
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

interface TaskSubtask {
  id: number;
  ordinal?: number;
  title: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed';
  source?: string;
  evidenceKind?: string;
  evidenceValue?: string;
  startedAt?: string;
  completedAt?: string;
}

interface TaskRunEvent {
  id: number;
  at: string;
  turnCount?: number;
  eventKind: string;
  excerpt?: string;
  payload: string;
}

interface TaskRunDetail extends TaskRun {
  subtasks: TaskSubtask[];
  events: TaskRunEvent[];
  respawn: { prior: TaskRun | null; next: TaskRun | null };
}

type TabId = 'subtasks' | 'timeline' | 'prompt' | 'chain';

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function elapsed(start: string, end?: string): string {
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      aria-label={`Copy ${label ?? value}`}
      title={`Copy ${label ?? value}`}
      style={{
        background: 'none',
        border: '1px solid #4a5568',
        borderRadius: 3,
        color: copied ? '#68d391' : '#a0aec0',
        cursor: 'pointer',
        fontSize: 11,
        padding: '1px 6px',
        fontFamily: 'monospace',
      }}
    >
      {copied ? '✓' : value.slice(0, 16) + (value.length > 16 ? '…' : '')}
    </button>
  );
}

function ProgressDonut({ done, total }: { done: number; total: number }) {
  if (total === 0) return <span style={{ color: '#718096', fontSize: 12 }}>0 subtasks</span>;
  const pct = done / total;
  const r = 16;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg width={40} height={40} aria-hidden="true" focusable="false">
        <circle cx={20} cy={20} r={r} fill="none" stroke="#2d3748" strokeWidth={4} />
        <circle
          cx={20} cy={20} r={r}
          fill="none"
          stroke="#68d391"
          strokeWidth={4}
          strokeDasharray={`${dash} ${circ - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 20 20)"
        />
        <text x={20} y={25} textAnchor="middle" fill="#f0f4f8" fontSize={10} fontWeight={700}>
          {Math.round(pct * 100)}%
        </text>
      </svg>
      <span style={{ fontSize: 13, color: '#a0aec0' }}>
        <strong style={{ color: '#f0f4f8' }}>{done}</strong>/{total} done
      </span>
    </div>
  );
}

const SUBTASK_STATUS_ICON: Record<string, string> = {
  pending: '○',
  in_progress: '▶',
  done: '✓',
  failed: '✗',
};

const SUBTASK_STATUS_COLOR: Record<string, string> = {
  pending: '#718096',
  in_progress: '#90cdf4',
  done: '#68d391',
  failed: '#fc8181',
};

const SOURCE_COLOR: Record<string, string> = {
  todo: '#63b3ed',
  sub_agent: '#f6ad55',
  commit: '#9f7aea',
  manual: '#718096',
};

const EVENT_KIND_COLOR: Record<string, string> = {
  poll_snapshot: '#718096',
  subtask_started: '#68d391',
  subtask_done: '#38a169',
  respawn: '#f6ad55',
  abort: '#fc8181',
  stall_detected: '#e53e3e',
};

function SubtasksTab({ subtasks }: { subtasks: TaskSubtask[] }) {
  const groups: Record<string, TaskSubtask[]> = {};
  for (const s of subtasks) {
    const src = s.source ?? 'manual';
    if (!groups[src]) groups[src] = [];
    groups[src].push(s);
  }
  const done = subtasks.filter(s => s.status === 'done').length;

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <ProgressDonut done={done} total={subtasks.length} />
      </div>

      {subtasks.length === 0 ? (
        <p style={{ color: '#718096' }}>No subtasks recorded yet.</p>
      ) : (
        Object.entries(groups).map(([src, items]) => (
          <div key={src} style={{ marginBottom: 20 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 13, color: SOURCE_COLOR[src] ?? '#a0aec0', textTransform: 'uppercase', letterSpacing: 1 }}>
              {src} ({items.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {items.map(st => {
                const dur = st.startedAt && st.completedAt
                  ? elapsed(st.startedAt, st.completedAt)
                  : st.startedAt ? `${elapsed(st.startedAt)}…` : null;
                return (
                  <div key={st.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px',
                    background: '#1a1f2e',
                    border: '1px solid #2d3748',
                    borderLeft: `3px solid ${SUBTASK_STATUS_COLOR[st.status] ?? '#718096'}`,
                    borderRadius: 4,
                  }}>
                    <span aria-label={`Status: ${st.status}`} style={{ color: SUBTASK_STATUS_COLOR[st.status] ?? '#718096', fontSize: 14, flexShrink: 0 }}>
                      {SUBTASK_STATUS_ICON[st.status] ?? '○'}
                    </span>
                    <span style={{ flex: 1, fontSize: 13, color: '#e2e8f0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {st.title}
                    </span>
                    {st.evidenceKind === 'commit_sha' && st.evidenceValue && (
                      <CopyButton value={st.evidenceValue} label="commit SHA" />
                    )}
                    {st.evidenceKind === 'file_path' && st.evidenceValue && (
                      <span style={{ fontSize: 11, color: '#90cdf4', fontFamily: 'monospace' }}>{st.evidenceValue}</span>
                    )}
                    {dur && <span style={{ fontSize: 11, color: '#718096', flexShrink: 0 }}>{dur}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function TimelineTab({ events }: { events: TaskRunEvent[] }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {events.length === 0 ? (
        <p style={{ color: '#718096' }}>No events recorded.</p>
      ) : (
        events.map(evt => {
          const color = EVENT_KIND_COLOR[evt.eventKind] ?? '#718096';
          const isExpanded = expanded.has(evt.id);
          let payload: unknown = {};
          try { payload = JSON.parse(evt.payload); } catch { /* ignore */ }
          const hasPayload = Object.keys(payload as object).length > 0;

          return (
            <div key={evt.id} style={{
              padding: '8px 10px',
              background: '#1a1f2e',
              borderLeft: `3px solid ${color}`,
              borderRadius: 4,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, background: '#0f1117', color, borderRadius: 3, padding: '1px 5px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                  {evt.eventKind}
                </span>
                {evt.turnCount !== undefined && (
                  <span style={{ fontSize: 10, color: '#718096' }}>turn {evt.turnCount}</span>
                )}
                <span style={{ flex: 1 }} />
                <time dateTime={evt.at} style={{ fontSize: 11, color: '#718096', flexShrink: 0 }}>
                  {relativeTime(evt.at)}
                </time>
                {hasPayload && (
                  <button
                    onClick={() => setExpanded(prev => { const n = new Set(prev); isExpanded ? n.delete(evt.id) : n.add(evt.id); return n; })}
                    aria-expanded={isExpanded}
                    aria-label={isExpanded ? 'Collapse payload' : 'Expand payload'}
                    style={{ background: 'none', border: '1px solid #4a5568', borderRadius: 3, color: '#a0aec0', cursor: 'pointer', fontSize: 11, padding: '1px 5px' }}
                  >
                    {isExpanded ? '▲' : '▼'}
                  </button>
                )}
              </div>
              {evt.excerpt && <p style={{ margin: '6px 0 0', fontSize: 12, color: '#a0aec0', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{evt.excerpt}</p>}
              {isExpanded && (
                <pre style={{ margin: '6px 0 0', fontSize: 11, color: '#68d391', background: '#0f1117', borderRadius: 4, padding: 8, overflow: 'auto', maxHeight: 200 }}>
                  {JSON.stringify(payload, null, 2)}
                </pre>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function PromptTab({ prompt }: { prompt?: string }) {
  const [collapsed, setCollapsed] = useState(true);
  if (!prompt) return <p style={{ color: '#718096' }}>No prompt recorded for this session.</p>;
  const preview = prompt.slice(0, 300);
  const isLong = prompt.length > 300;

  return (
    <div>
      <div style={{
        background: '#0f1117',
        border: '1px solid #2d3748',
        borderRadius: 6,
        padding: '12px 14px',
        fontFamily: 'monospace',
        fontSize: 12,
        color: '#e2e8f0',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        maxHeight: collapsed && isLong ? 160 : undefined,
        overflow: collapsed && isLong ? 'hidden' : undefined,
        position: 'relative',
      }}>
        {collapsed && isLong ? preview + '…' : prompt}
      </div>
      {isLong && (
        <button
          onClick={() => setCollapsed(v => !v)}
          aria-expanded={!collapsed}
          style={{ marginTop: 8, background: '#2d3748', color: '#a0aec0', border: 'none', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 12 }}
        >
          {collapsed ? 'Show full prompt' : 'Collapse'}
        </button>
      )}
    </div>
  );
}

function ChainTab({ sessionId }: { sessionId: string }) {
  const [chain, setChain] = useState<(TaskRun & { isCurrent: boolean; subtask_progress: SubtaskProgress })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetch(`/api/task-runs/${sessionId}/respawn-chain`)
      .then(r => r.json())
      .then((data: unknown) => { setChain(Array.isArray(data) ? data as (TaskRun & { isCurrent: boolean; subtask_progress: SubtaskProgress })[] : []); })
      .catch(() => setChain([]))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) return <p style={{ color: '#718096' }}>Loading chain…</p>;
  if (chain.length <= 1) return <p style={{ color: '#718096' }}>This session has no respawn chain.</p>;

  return (
    <div>
      <p style={{ fontSize: 12, color: '#718096', marginTop: 0 }}>
        {chain.length} sessions in chain — showing continuity across respawns
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {chain.map((r, i) => {
          const cfg = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.pending;
          return (
            <div key={r.sessionId} style={{
              padding: '10px 14px',
              background: r.isCurrent ? '#1a2744' : '#1a1f2e',
              border: `1px solid ${r.isCurrent ? '#63b3ed' : '#2d3748'}`,
              borderLeft: `3px solid ${cfg.color}`,
              borderRadius: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: '#718096' }}>#{i + 1}</span>
                <span style={{ fontSize: 13, color: r.isCurrent ? '#90cdf4' : '#e2e8f0', fontWeight: r.isCurrent ? 700 : 400 }}>
                  {r.title}
                </span>
                {r.isCurrent && <span style={{ fontSize: 10, color: '#90cdf4', border: '1px solid #63b3ed40', borderRadius: 3, padding: '1px 5px' }}>current</span>}
                <div style={{ flex: 1 }} />
                <span aria-label={`Status: ${cfg.label}`} style={{ color: cfg.color, fontSize: 13 }}>{cfg.shape} {cfg.label}</span>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: '#718096' }}>
                  {r.subtask_progress.done}/{r.subtask_progress.total} subtasks
                </span>
                <span style={{ fontSize: 11, color: '#718096' }}>{r.turnCount} turns</span>
                <time dateTime={r.startedAt} style={{ fontSize: 11, color: '#718096' }}>{relativeTime(r.startedAt)}</time>
                {!r.isCurrent && (
                  <Link href={`/task-runs/${r.sessionId}`} style={{ fontSize: 11, color: '#63b3ed' }}>view →</Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TaskRunDetailContent() {
  const { session_id } = useParams<{ session_id: string }>();
  const { lastEvent } = useWebSocket('ws://localhost:7776/events');

  const [run, setRun] = useState<TaskRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('subtasks');

  const loadRun = useCallback(async () => {
    try {
      const res = await fetch(`/api/task-runs/${session_id}`);
      if (res.ok) setRun(await res.json() as TaskRunDetail);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [session_id]);

  useEffect(() => { void loadRun(); }, [loadRun]);

  // Live updates
  useEffect(() => {
    if (!lastEvent?.kind.startsWith('task_run.') || lastEvent.id !== session_id) return;
    void loadRun();
  }, [lastEvent, session_id, loadRun]);

  if (loading) return <div style={{ color: '#718096', padding: 32 }}>Loading…</div>;
  if (!run) return <div style={{ color: '#fc8181', padding: 32 }}>Task run not found: {session_id}</div>;

  const cfg = STATUS_CONFIG[run.status] ?? STATUS_CONFIG.pending;
  const tabs: { id: TabId; label: string }[] = [
    { id: 'subtasks', label: `Subtasks (${run.subtasks.length})` },
    { id: 'timeline', label: `Timeline (${run.events.length})` },
    { id: 'prompt', label: 'Prompt' },
    { id: 'chain', label: 'Chain' },
  ];

  return (
    <div>
      {/* Back link */}
      <div style={{ marginBottom: 16 }}>
        <Link href="/task-runs" style={{ color: '#63b3ed', fontSize: 13, textDecoration: 'none' }}>← Task Runs</Link>
      </div>

      {/* Top info card */}
      <div style={{ background: '#1a1f2e', border: `1px solid ${cfg.color}40`, borderLeft: `4px solid ${cfg.color}`, borderRadius: 8, padding: '16px 20px', marginBottom: 20 }}>
        {/* Title + status */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#f0f4f8', flex: 1 }}>{run.title}</h1>
          <span
            role="status"
            aria-label={`Status: ${cfg.label}`}
            style={{
              background: cfg.bg,
              color: cfg.color,
              border: `1px solid ${cfg.color}60`,
              borderRadius: 6,
              padding: '4px 12px',
              fontSize: 13,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {cfg.shape} {cfg.label}
          </span>
        </div>

        {/* Meta row */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10, fontSize: 12, color: '#a0aec0' }}>
          <div>
            <span style={{ color: '#718096' }}>session: </span>
            <CopyButton value={run.sessionId} label="session ID" />
          </div>
          {run.cwd && <div><span style={{ color: '#718096' }}>cwd: </span><span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>{run.cwd}</span></div>}
          {run.projectSlug && <div><span style={{ color: '#718096' }}>project: </span><span style={{ color: '#90cdf4' }}>{run.projectSlug}</span></div>}
          <div>
            <span style={{ color: '#718096' }}>started: </span>
            <time dateTime={run.startedAt}>{relativeTime(run.startedAt)}</time>
          </div>
          {run.endedAt && <div><span style={{ color: '#718096' }}>ended: </span><time dateTime={run.endedAt}>{relativeTime(run.endedAt)}</time></div>}
          <div><span style={{ color: '#718096' }}>elapsed: </span>{elapsed(run.startedAt, run.endedAt)}</div>
          <div><span style={{ color: '#718096' }}>turns: </span>{run.turnCount}</div>
          {run.resultOk !== undefined && run.resultOk !== null && (
            <div>
              <span style={{ color: '#718096' }}>result: </span>
              <span style={{ color: run.resultOk ? '#68d391' : '#fc8181', fontWeight: 700 }}>
                {run.resultOk ? '✓ ok' : '✗ failed'}
              </span>
            </div>
          )}
        </div>

        {/* Respawn info */}
        {run.respawn.prior && (
          <div style={{ fontSize: 12, color: '#f6ad55', marginBottom: 6, padding: '6px 10px', background: '#3d2a0040', borderRadius: 4 }}>
            ↻ Respawn of{' '}
            <Link href={`/task-runs/${run.respawn.prior.sessionId}`} style={{ color: '#f6ad55', fontWeight: 700 }}>
              {run.respawn.prior.title}
            </Link>
            {' '}· original completed {run.respawn.prior.subtask_progress?.done ?? 0} subtasks
          </div>
        )}
        {run.respawn.next && (
          <div style={{ fontSize: 12, color: '#90cdf4', marginBottom: 6, padding: '6px 10px', background: '#1a274440', borderRadius: 4 }}>
            Respawned as{' '}
            <Link href={`/task-runs/${run.respawn.next.sessionId}`} style={{ color: '#90cdf4', fontWeight: 700 }}>
              {run.respawn.next.title}
            </Link>
          </div>
        )}

        {/* Completion summary */}
        {run.completionSummary && (
          <div style={{ fontSize: 12, color: '#a0aec0', marginTop: 8, fontFamily: 'monospace', background: '#0f1117', borderRadius: 4, padding: '8px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 80, overflow: 'auto' }}>
            {run.completionSummary}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Task run details"
        style={{ display: 'flex', gap: 0, borderBottom: '1px solid #2d3748', marginBottom: 20 }}
      >
        {tabs.map(tab => (
          <button
            key={tab.id}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #63b3ed' : '2px solid transparent',
              color: activeTab === tab.id ? '#90cdf4' : '#a0aec0',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 600 : 400,
              padding: '8px 16px',
              transition: 'color 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div role="tabpanel" id="panel-subtasks" aria-labelledby="tab-subtasks" hidden={activeTab !== 'subtasks'}>
        <SubtasksTab subtasks={run.subtasks} />
      </div>
      <div role="tabpanel" id="panel-timeline" aria-labelledby="tab-timeline" hidden={activeTab !== 'timeline'}>
        <TimelineTab events={run.events} />
      </div>
      <div role="tabpanel" id="panel-prompt" aria-labelledby="tab-prompt" hidden={activeTab !== 'prompt'}>
        <PromptTab prompt={run.prompt} />
      </div>
      <div role="tabpanel" id="panel-chain" aria-labelledby="tab-chain" hidden={activeTab !== 'chain'}>
        <ChainTab sessionId={run.sessionId} />
      </div>
    </div>
  );
}

export default function TaskRunDetailPage() {
  return (
    <Suspense fallback={<div style={{ color: '#718096', padding: 32 }}>Loading…</div>}>
      <TaskRunDetailContent />
    </Suspense>
  );
}
