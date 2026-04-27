'use client';
import { useState, useEffect, useRef } from 'react';
import useSWR from 'swr';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Prompt {
  id: string;
  body: string;
  receivedAt: string;
  status: string;
  elapsedMs?: number | null;
}

interface PromptsResponse {
  prompts: Prompt[];
}

interface PipelineTaskRun {
  id: string;
  runIndex?: number;
  durationMs?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  filesChanged?: number | null;
  toolCallSummary?: Record<string, number> | null;
  status?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
}

interface PipelineCompletenessCheck {
  id: string;
  passed: boolean;
  criticalFindings?: number | null;
  summary?: string | null;
  checkedAt?: string | null;
}

interface PipelineTask {
  id: string;
  title: string;
  status: string;
  createdAt?: string | null;
  completedAt?: string | null;
  taskRuns?: PipelineTaskRun[];
  completenessChecks?: PipelineCompletenessCheck[];
}

interface PipelineStory {
  id: string;
  title: string;
  status?: string;
  tasks?: PipelineTask[];
}

interface PipelineRequirement {
  id: string;
  title: string;
  status: string;
  stateHistory?: string[];
  createdAt?: string | null;
  stories?: PipelineStory[];
}

interface PipelineData {
  promptId: string;
  promptBody: string;
  promptReceivedAt: string;
  promptStatus: string;
  requirements?: PipelineRequirement[];
  totalDurationMs?: number | null;
  totalTokensIn?: number | null;
  totalTokensOut?: number | null;
  totalFilesChanged?: number | null;
  overallStatus?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fetcher = (url: string) =>
  fetch(url).then(async r => {
    if (!r.ok) throw Object.assign(new Error('fetch error'), { status: r.status });
    return r.json();
  });

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return `${m}m ${s}s`;
}

function formatTokens(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

function promptStatusDot(status: string): { color: string; label: string } {
  switch (status) {
    case 'answered':
    case 'completed':
    case 'done':
      return { color: '#48bb78', label: 'done' };
    case 'analyzing':
    case 'decomposed':
    case 'running':
      return { color: '#ecc94b', label: 'running' };
    case 'failed':
      return { color: '#f56565', label: 'failed' };
    default:
      return { color: '#718096', label: 'pending' };
  }
}

function overallStatusBadge(status: string | undefined): { bg: string; text: string; emoji: string } {
  switch ((status ?? '').toLowerCase()) {
    case 'completed':
    case 'done':
    case 'answered':
      return { bg: '#276749', text: '#9ae6b4', emoji: '✅' };
    case 'running':
    case 'analyzing':
    case 'decomposed':
      return { bg: '#2b6cb0', text: '#bee3f8', emoji: '🔄' };
    case 'failed':
      return { bg: '#742a2a', text: '#fed7d7', emoji: '❌' };
    default:
      return { bg: '#2d3748', text: '#a0aec0', emoji: '⏳' };
  }
}

function taskStatusColor(status: string): string {
  switch (status?.toLowerCase()) {
    case 'completed': case 'done': return '#48bb78';
    case 'running': return '#4299e1';
    case 'failed': return '#f56565';
    case 'blocked': return '#ed8936';
    default: return '#718096';
  }
}

function copyToClipboard(text: string) {
  void navigator.clipboard.writeText(text).catch(() => {});
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonRow({ width = '100%' }: { width?: string }) {
  return (
    <div
      style={{
        height: 16,
        width,
        background: 'linear-gradient(90deg, #2d3748 25%, #3a4a5c 50%, #2d3748 75%)',
        backgroundSize: '200% 100%',
        borderRadius: 4,
        animation: 'shimmer 1.5s infinite',
        marginBottom: 8,
      }}
    />
  );
}

// ─── Pipeline Waterfall Nodes ─────────────────────────────────────────────────

function NodeConnector({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', marginLeft: 20, padding: '2px 0' }}>
      <div style={{ width: 2, height: 8, background: '#4a5568' }} />
      {label && (
        <span style={{ fontSize: 11, color: '#718096', fontFamily: 'monospace', padding: '1px 6px' }}>
          ↓ {label}
        </span>
      )}
      <div style={{ width: 2, height: 8, background: '#4a5568' }} />
    </div>
  );
}

function NodeCard({
  borderColor,
  children,
}: {
  borderColor: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: '#2d3748',
        border: '1px solid #4a5568',
        borderLeft: `4px solid ${borderColor}`,
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: 2,
      }}
    >
      {children}
    </div>
  );
}

function EntityLabel({ text, color }: { text: string; color: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        letterSpacing: '0.08em',
        textTransform: 'uppercase' as const,
        fontWeight: 700,
        color,
        marginBottom: 4,
        display: 'block',
      }}
    >
      {text}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const color = taskStatusColor(status);
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        color,
        background: color + '22',
        border: `1px solid ${color}55`,
        borderRadius: 10,
        padding: '1px 7px',
        marginLeft: 6,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.05em',
      }}
    >
      {status}
    </span>
  );
}

function IdChip({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span
      title="Click to copy"
      onClick={() => {
        copyToClipboard(id);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={{
        fontFamily: 'monospace',
        fontSize: 10,
        color: copied ? '#68d391' : '#718096',
        cursor: 'pointer',
        marginLeft: 8,
        background: '#1a202c',
        padding: '1px 5px',
        borderRadius: 3,
      }}
    >
      {copied ? '✓ copied' : id.slice(0, 12)}
    </span>
  );
}

// ─── Task Run Card ────────────────────────────────────────────────────────────

function TaskRunNode({ run, index }: { run: PipelineTaskRun; index: number }) {
  const isDone = run.status === 'completed' || run.status === 'done';
  const isFailed = run.status === 'failed';
  const borderColor = isFailed ? '#f56565' : isDone ? '#48bb78' : '#ed8936';

  const toolCalls = run.toolCallSummary
    ? Object.entries(run.toolCallSummary)
        .map(([tool, count]) => `${tool}(${count})`)
        .join(' ')
    : null;

  return (
    <div style={{ marginLeft: 24 }}>
      <NodeCard borderColor={borderColor}>
        <EntityLabel text="Task Run" color={borderColor} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' as const, marginBottom: 4 }}>
          <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>
            Run #{index + 1}
          </span>
          <IdChip id={run.id} />
          {run.status && <StatusPill status={run.status} />}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' as const }}>
          {run.durationMs != null && (
            <span style={{ fontSize: 12, color: '#a0aec0' }}>⏱ {formatDuration(run.durationMs)}</span>
          )}
          {(run.tokensIn != null || run.tokensOut != null) && (
            <span style={{ fontSize: 12, color: '#a0aec0' }}>
              🔢 {formatTokens(run.tokensIn)} in / {formatTokens(run.tokensOut)} out
            </span>
          )}
          {run.filesChanged != null && run.filesChanged > 0 && (
            <span style={{ fontSize: 12, color: '#a0aec0' }}>📁 {run.filesChanged} files</span>
          )}
        </div>
        {toolCalls && (
          <div style={{ fontSize: 11, color: '#718096', marginTop: 4, fontFamily: 'monospace' }}>
            Tool calls: {toolCalls}
          </div>
        )}
      </NodeCard>
    </div>
  );
}

// ─── Completeness Check Card ──────────────────────────────────────────────────

function CompletenessNode({ check }: { check: PipelineCompletenessCheck }) {
  const color = check.passed ? '#48bb78' : '#f56565';
  return (
    <div style={{ marginLeft: 24 }}>
      <NodeCard borderColor={color}>
        <EntityLabel text="Completeness Check" color={color} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' as const }}>
          <span style={{ fontSize: 13, color, fontWeight: 600 }}>
            {check.passed ? '✓ PASSED' : '✗ FAILED'}
          </span>
          <IdChip id={check.id} />
          {check.criticalFindings != null && (
            <span style={{ fontSize: 12, color: '#a0aec0' }}>
              — {check.criticalFindings} critical finding{check.criticalFindings !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {check.summary && (
          <div style={{ fontSize: 12, color: '#a0aec0', marginTop: 4 }}>{check.summary}</div>
        )}
      </NodeCard>
    </div>
  );
}

// ─── Task Card ────────────────────────────────────────────────────────────────

function TaskNode({ task }: { task: PipelineTask }) {
  const [expanded, setExpanded] = useState(true);
  const color = '#38b2ac';

  const runs = task.taskRuns ?? [];
  const completeness = task.completenessChecks ?? [];

  return (
    <div style={{ marginLeft: 24 }}>
      <NodeCard borderColor={color}>
        <EntityLabel text="Task" color={color} />
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', flexWrap: 'wrap' as const }}
          onClick={() => setExpanded(e => !e)}
        >
          <span style={{ fontSize: 12, color: '#718096' }}>{expanded ? '▾' : '▸'}</span>
          <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500, flex: 1 }}>{task.title}</span>
          <IdChip id={task.id} />
          <StatusPill status={task.status} />
        </div>
      </NodeCard>

      {expanded && (runs.length > 0 || completeness.length > 0) && (
        <div>
          {runs.map((run, i) => (
            <div key={run.id}>
              <NodeConnector label={i === 0 ? undefined : `re-run #${i + 1}`} />
              <TaskRunNode run={run} index={i} />
            </div>
          ))}
          {completeness.map(check => (
            <div key={check.id}>
              <NodeConnector />
              <CompletenessNode check={check} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Story Card ───────────────────────────────────────────────────────────────

function StoryNode({ story }: { story: PipelineStory }) {
  const [expanded, setExpanded] = useState(true);
  const color = '#667eea';
  const tasks = story.tasks ?? [];

  return (
    <div style={{ marginLeft: 24 }}>
      <NodeCard borderColor={color}>
        <EntityLabel text="Story" color={color} />
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: tasks.length > 0 ? 'pointer' : 'default', flexWrap: 'wrap' as const }}
          onClick={() => tasks.length > 0 && setExpanded(e => !e)}
        >
          {tasks.length > 0 && <span style={{ fontSize: 12, color: '#718096' }}>{expanded ? '▾' : '▸'}</span>}
          <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500, flex: 1 }}>{story.title}</span>
          <IdChip id={story.id} />
          {story.status && <StatusPill status={story.status} />}
        </div>
      </NodeCard>

      {expanded && tasks.length > 0 && (
        <div>
          {tasks.map((task, i) => (
            <div key={task.id}>
              {i > 0 && <NodeConnector />}
              <TaskNode task={task} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Requirement Card ─────────────────────────────────────────────────────────

function RequirementNode({ req }: { req: PipelineRequirement }) {
  const [expanded, setExpanded] = useState(true);
  const color = '#9f7aea';
  const stories = req.stories ?? [];

  const stateHistory = req.stateHistory ?? [];

  return (
    <div>
      <NodeCard borderColor={color}>
        <EntityLabel text="Requirement" color={color} />
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: stories.length > 0 ? 'pointer' : 'default', flexWrap: 'wrap' as const }}
          onClick={() => stories.length > 0 && setExpanded(e => !e)}
        >
          {stories.length > 0 && <span style={{ fontSize: 12, color: '#718096' }}>{expanded ? '▾' : '▸'}</span>}
          <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500, flex: 1 }}>{req.title}</span>
          <IdChip id={req.id} />
          <StatusPill status={req.status} />
        </div>
        {stateHistory.length > 0 && (
          <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' as const }}>
            {stateHistory.map((state, i) => (
              <span
                key={i}
                style={{
                  fontSize: 10,
                  color: '#a0aec0',
                  background: '#1a202c',
                  border: '1px solid #4a5568',
                  borderRadius: 10,
                  padding: '1px 7px',
                }}
              >
                {state}
              </span>
            ))}
          </div>
        )}
      </NodeCard>

      {expanded && stories.length > 0 && (
        <div>
          {stories.map((story, i) => (
            <div key={story.id}>
              <NodeConnector />
              <StoryNode story={story} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Prompt Node ─────────────────────────────────────────────────────────────

function PromptNode({ data }: { data: PipelineData }) {
  const color = '#4299e1';
  return (
    <NodeCard borderColor={color}>
      <EntityLabel text="Prompt" color={color} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' as const, marginBottom: 6 }}>
        <IdChip id={data.promptId} />
        {data.promptStatus && <StatusPill status={data.promptStatus} />}
        <span style={{ fontSize: 11, color: '#718096', marginLeft: 'auto' }}>
          {new Date(data.promptReceivedAt).toLocaleString()}
        </span>
      </div>
      <div style={{ fontSize: 14, color: '#e2e8f0', lineHeight: 1.5 }}>
        &ldquo;{data.promptBody}&rdquo;
      </div>
    </NodeCard>
  );
}

// ─── Summary Bar ──────────────────────────────────────────────────────────────

function SummaryBar({ data }: { data: PipelineData }) {
  const badge = overallStatusBadge(data.overallStatus ?? data.promptStatus);

  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        alignItems: 'center',
        flexWrap: 'wrap' as const,
        background: '#2d3748',
        border: '1px solid #4a5568',
        borderRadius: 8,
        padding: '10px 16px',
        marginBottom: 16,
        fontSize: 13,
        color: '#e2e8f0',
      }}
    >
      {data.totalDurationMs != null && (
        <span>⏱ Total: <strong>{formatDuration(data.totalDurationMs)}</strong></span>
      )}
      {(data.totalTokensIn != null || data.totalTokensOut != null) && (
        <span>
          🔢 <strong>{formatTokens(data.totalTokensIn)}</strong> in / <strong>{formatTokens(data.totalTokensOut)}</strong> out tokens
        </span>
      )}
      {data.totalFilesChanged != null && data.totalFilesChanged > 0 && (
        <span>📁 <strong>{data.totalFilesChanged}</strong> files</span>
      )}
      <span style={{ marginLeft: 'auto' }}>
        Status:{' '}
        <span
          style={{
            background: badge.bg,
            color: badge.text,
            borderRadius: 10,
            padding: '2px 10px',
            fontWeight: 700,
            fontSize: 12,
          }}
        >
          {badge.emoji} {(data.overallStatus ?? data.promptStatus ?? 'unknown').toUpperCase()}
        </span>
      </span>
    </div>
  );
}

// ─── Pipeline Detail Panel ────────────────────────────────────────────────────

function PipelineDetail({ promptId }: { promptId: string }) {
  const { data, error, isLoading } = useSWR<PipelineData>(
    `/api/prompts/${promptId}/pipeline`,
    fetcher,
    { refreshInterval: 5_000, shouldRetryOnError: false }
  );

  if (isLoading) {
    return (
      <div style={{ padding: 24 }}>
        <SkeletonRow width="60%" />
        <SkeletonRow width="90%" />
        <SkeletonRow width="40%" />
        <SkeletonRow width="75%" />
        <SkeletonRow width="55%" />
      </div>
    );
  }

  // 404 — pipeline data not yet built
  if (error?.status === 404) {
    return (
      <div style={{ padding: 32, textAlign: 'center' as const, color: '#a0aec0', fontSize: 14 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔗</div>
        Pipeline data not yet available for this prompt.
      </div>
    );
  }

  // 503 / network error
  if (error) {
    return (
      <div style={{ padding: 32, textAlign: 'center' as const }}>
        <div style={{ color: '#f56565', marginBottom: 12, fontSize: 14 }}>
          Failed to load pipeline data.
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            background: '#2d3748',
            color: '#e2e8f0',
            border: '1px solid #4a5568',
            borderRadius: 6,
            padding: '8px 16px',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          ↺ Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 32, textAlign: 'center' as const, color: '#718096', fontSize: 14 }}>
        No data returned.
      </div>
    );
  }

  const requirements = data.requirements ?? [];

  return (
    <div style={{ padding: '0 24px 24px' }}>
      <SummaryBar data={data} />

      {/* Waterfall */}
      <div style={{ display: 'flex', flexDirection: 'column' as const }}>
        <PromptNode data={data} />

        {requirements.length === 0 && (
          <div style={{ marginTop: 16, padding: 16, color: '#718096', fontSize: 13, textAlign: 'center' as const }}>
            <NodeConnector label="pending" />
            <div style={{ color: '#a0aec0' }}>No requirements decomposed yet.</div>
          </div>
        )}

        {requirements.map((req, i) => (
          <div key={req.id}>
            <NodeConnector label={i === 0 ? undefined : undefined} />
            <RequirementNode req={req} />
          </div>
        ))}

        {/* Show linkage pending message if no promptId in data */}
        {!data.promptId && (
          <div
            style={{
              marginTop: 16,
              padding: 16,
              color: '#718096',
              fontSize: 13,
              background: '#2d3748',
              borderRadius: 8,
              border: '1px solid #4a5568',
              textAlign: 'center' as const,
            }}
          >
            Pipeline linkage pending — this prompt was processed before pipeline tracking was enabled.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Left Panel: Prompt List ──────────────────────────────────────────────────

function PromptList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { data, isLoading } = useSWR<PromptsResponse>(
    '/api/prompts?limit=50',
    fetcher,
    { refreshInterval: 10_000 }
  );

  const prompts = data?.prompts ?? [];

  // Auto-select most recent on first load
  const didAutoSelect = useRef(false);
  useEffect(() => {
    if (!didAutoSelect.current && prompts.length > 0 && !selectedId) {
      didAutoSelect.current = true;
      onSelect(prompts[0]!.id);
    }
  }, [prompts, selectedId, onSelect]);

  if (isLoading && prompts.length === 0) {
    return (
      <div style={{ padding: 16 }}>
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} style={{ marginBottom: 8 }}>
            <SkeletonRow width="80%" />
            <SkeletonRow width="55%" />
          </div>
        ))}
      </div>
    );
  }

  if (prompts.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center' as const, color: '#718096', fontSize: 13 }}>
        No prompts found.
      </div>
    );
  }

  return (
    <div>
      {prompts.map(p => {
        const { color: dotColor } = promptStatusDot(p.status);
        const isSelected = p.id === selectedId;
        const truncated = p.body.length > 90 ? p.body.slice(0, 90) + '…' : p.body;

        return (
          <div
            key={p.id}
            onClick={() => onSelect(p.id)}
            style={{
              padding: '10px 14px',
              cursor: 'pointer',
              background: isSelected ? '#3a4a5c' : 'transparent',
              borderLeft: isSelected ? '3px solid #4299e1' : '3px solid transparent',
              borderBottom: '1px solid #2d3748',
              transition: 'background 0.1s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: dotColor,
                  flexShrink: 0,
                }}
                title={p.status}
              />
              <span style={{ fontSize: 11, color: '#718096', flex: 1, textAlign: 'right' as const }}>
                {relativeTime(p.receivedAt)}
              </span>
            </div>
            <div
              style={{
                fontSize: 13,
                color: isSelected ? '#e2e8f0' : '#a0aec0',
                lineHeight: 1.4,
                wordBreak: 'break-word' as const,
                marginBottom: 6,
              }}
            >
              {truncated}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <span
                style={{
                  fontSize: 10,
                  color: '#718096',
                  background: '#1a202c',
                  border: '1px solid #4a5568',
                  borderRadius: 10,
                  padding: '1px 6px',
                }}
              >
                {p.status}
              </span>
              {p.elapsedMs != null && (
                <span
                  style={{
                    fontSize: 10,
                    color: '#718096',
                    background: '#1a202c',
                    border: '1px solid #4a5568',
                    borderRadius: 10,
                    padding: '1px 6px',
                  }}
                >
                  {formatDuration(p.elapsedMs)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PipelinePage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <>
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>

      <div
        style={{
          display: 'flex',
          height: '100%',
          overflow: 'hidden',
          gap: 0,
          margin: -24, // cancel parent padding so we control it
        }}
      >
        {/* Left panel */}
        <div
          style={{
            width: 320,
            flexShrink: 0,
            borderRight: '1px solid #2d3748',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '16px 14px 12px',
              borderBottom: '1px solid #2d3748',
              flexShrink: 0,
            }}
          >
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#f0f4f8' }}>
              ⇢ Pipeline
            </h1>
            <div style={{ fontSize: 12, color: '#718096', marginTop: 4 }}>
              Select a prompt to trace its pipeline
            </div>
          </div>

          <PromptList selectedId={selectedId} onSelect={setSelectedId} />
        </div>

        {/* Right panel */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 0 0' }}>
          {selectedId ? (
            <PipelineDetail key={selectedId} promptId={selectedId} />
          ) : (
            <div
              style={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#718096',
                fontSize: 15,
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 32 }}>⇢</span>
              <span>Select a prompt to see its full pipeline</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
