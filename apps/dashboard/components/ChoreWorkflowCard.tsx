// VAL-2026-04-30-051730-10-chor — single-domain (backend) chore task visualizer
'use client';

export interface ChoreTask {
  id: string;
  prompt: string;
  status: 'queued' | 'triaging' | 'executing' | 'done' | 'failed';
  domain: string;
  startedAt: string;
  finishedAt?: string;
  sloMs: number;
  storyId?: string;
}

const STATUS_CFG: Record<
  ChoreTask['status'],
  { color: string; bg: string; label: string; shape: string }
> = {
  queued:    { color: '#90cdf4', bg: '#1a2744', label: 'Queued',    shape: '◌' },
  triaging:  { color: '#f6e05e', bg: '#3d3500', label: 'Triaging',  shape: '⟳' },
  executing: { color: '#f6ad55', bg: '#3d2a00', label: 'Executing', shape: '▶' },
  done:      { color: '#68d391', bg: '#1a3320', label: 'Done',      shape: '✓' },
  failed:    { color: '#fc8181', bg: '#3d1515', label: 'Failed',    shape: '✗' },
};

const STEPS = ['Queue', 'Triage', 'Backend', 'Done'] as const;
const STEP_AT: Record<ChoreTask['status'], number> = {
  queued: 0, triaging: 1, executing: 2, done: 3, failed: 3,
};

function elapsedMs(startedAt: string, finishedAt?: string): number {
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  return end - new Date(startedAt).getTime();
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function ProgressPipe({ status, sloMs, startedAt, finishedAt }: Pick<ChoreTask, 'status' | 'sloMs' | 'startedAt' | 'finishedAt'>) {
  const activeStep = STEP_AT[status];
  const elapsed = elapsedMs(startedAt, finishedAt);
  const pct = Math.min(100, Math.round((elapsed / sloMs) * 100));
  const sloColor = pct >= 100 ? '#fc8181' : pct >= 75 ? '#f6ad55' : '#68d391';

  return (
    <div style={{ marginTop: 10, marginBottom: 10 }}>
      {/* Step dots */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {STEPS.map((step, i) => {
          const done = i < activeStep;
          const active = i === activeStep;
          const last = i === STEPS.length - 1;
          return (
            <div key={step} style={{ display: 'flex', alignItems: 'center', flex: last ? 0 : 1 }}>
              <div
                title={step}
                aria-label={step}
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  border: `2px solid ${active ? '#90cdf4' : done ? '#68d391' : '#4a5568'}`,
                  background: done ? '#1a3320' : active ? '#1a2744' : '#1a1f2e',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 9,
                  color: active ? '#90cdf4' : done ? '#68d391' : '#4a5568',
                  flexShrink: 0,
                  transition: 'all 0.2s',
                  zIndex: 1,
                }}
              >
                {done ? '✓' : active && status === 'failed' ? '✗' : i + 1}
              </div>
              {!last && (
                <div
                  style={{
                    flex: 1,
                    height: 2,
                    background: done ? '#68d391' : '#2d3748',
                    transition: 'background 0.2s',
                    margin: '0 2px',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      {/* Step labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
        {STEPS.map(step => (
          <span key={step} style={{ fontSize: 9, color: '#718096', minWidth: 20, textAlign: 'center' }}>
            {step}
          </span>
        ))}
      </div>
      {/* SLO bar */}
      <div style={{ marginTop: 8 }}>
        <div
          role="progressbar"
          aria-valuenow={elapsed}
          aria-valuemin={0}
          aria-valuemax={sloMs}
          aria-label={`SLO usage: ${pct}% of ${sloMs}ms budget`}
          style={{ height: 3, background: '#2d3748', borderRadius: 2, overflow: 'hidden' }}
        >
          <div
            style={{ width: `${pct}%`, height: '100%', background: sloColor, transition: 'width 0.5s ease' }}
          />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
          <span style={{ fontSize: 9, color: sloColor }}>{elapsed}ms elapsed</span>
          <span style={{ fontSize: 9, color: '#718096' }}>SLO {sloMs}ms</span>
        </div>
      </div>
    </div>
  );
}

export function ChoreWorkflowCard({ task }: { task: ChoreTask }) {
  const cfg = STATUS_CFG[task.status];

  return (
    <article
      style={{
        background: '#1a1f2e',
        border: `1px solid #2d3748`,
        borderLeft: `3px solid ${cfg.color}`,
        borderRadius: 8,
        padding: '12px 16px',
        marginBottom: 10,
      }}
      aria-label={`Chore task ${task.id}: ${cfg.label}`}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span style={{ color: cfg.color, fontSize: 14, fontWeight: 700 }} aria-hidden="true">{cfg.shape}</span>
        <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#90cdf4' }}>{task.id}</span>
        <span
          style={{
            fontSize: 10,
            background: '#2d3748',
            color: '#68d391',
            border: '1px solid #68d39140',
            borderRadius: 3,
            padding: '1px 6px',
            fontFamily: 'monospace',
          }}
        >
          {task.domain}
        </span>
        <div style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 11,
            background: cfg.bg,
            color: cfg.color,
            border: `1px solid ${cfg.color}40`,
            borderRadius: 10,
            padding: '2px 8px',
            fontWeight: 600,
          }}
        >
          {cfg.label}
        </span>
        <time
          dateTime={task.startedAt}
          title={new Date(task.startedAt).toLocaleString()}
          style={{ fontSize: 10, color: '#718096' }}
        >
          {relativeTime(task.startedAt)}
        </time>
      </div>

      {/* Prompt */}
      <div
        style={{
          fontSize: 12,
          color: '#e2e8f0',
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          marginBottom: 2,
        }}
      >
        {task.prompt}
      </div>

      {/* Pipeline progress */}
      <ProgressPipe
        status={task.status}
        sloMs={task.sloMs}
        startedAt={task.startedAt}
        finishedAt={task.finishedAt}
      />

      {/* Story link */}
      {task.storyId && (
        <div style={{ fontSize: 10, color: '#718096' }}>
          Story:{' '}
          <a
            href={`/stories?id=${encodeURIComponent(task.storyId)}`}
            style={{ color: '#90cdf4', textDecoration: 'none' }}
          >
            {task.storyId}
          </a>
        </div>
      )}
    </article>
  );
}
