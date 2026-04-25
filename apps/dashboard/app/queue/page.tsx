'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';

interface QueueTask {
  id: string;
  title: string;
  status: string;
  priorityScore: number;
  priorityBucket: string;
  positionOrdinal: number;
  priorityRationaleJson?: string | null;
  lastPrioritizedAt?: string | null;
  domainSlug?: string | null;
  projectId?: string | null;
  paused: boolean;
}

interface QueueResponse {
  total: number;
  grouped: Record<string, QueueTask[]>;
  rows: QueueTask[];
}

const BUCKET_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  P0: { bg: '#2d1515', border: '#fc8181', label: '#fc8181' },
  P1: { bg: '#2d2010', border: '#f6ad55', label: '#f6ad55' },
  P2: { bg: '#102030', border: '#63b3ed', label: '#63b3ed' },
  P3: { bg: '#1a1f2e', border: '#4a5568', label: '#718096' },
};

function RationaleTooltip({ json }: { json: string | null | undefined }) {
  if (!json) return null;
  let rationale: Record<string, unknown>;
  try { rationale = JSON.parse(json) as Record<string, unknown>; }
  catch { return null; }
  const summary = rationale['summary'] as string | undefined;
  return (
    <span
      title={summary}
      style={{ cursor: 'help', marginLeft: 6, color: '#718096', fontSize: 12 }}
    >
      ⓘ
    </span>
  );
}

function BucketSection({
  bucket,
  tasks,
  onRescore,
  onOverride,
}: {
  bucket: string;
  tasks: QueueTask[];
  onRescore: (id: string) => void;
  onOverride: (id: string, newOrdinal: number) => void;
}) {
  const colors = BUCKET_COLORS[bucket] ?? BUCKET_COLORS['P3'];

  if (tasks.length === 0) {
    return (
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ color: colors.label, fontWeight: 700, fontSize: 14 }}>{bucket}</span>
          <span style={{ color: '#4a5568', fontSize: 12 }}>— empty</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
        borderBottom: `1px solid ${colors.border}`, paddingBottom: 6,
      }}>
        <span style={{
          background: colors.border, color: '#1a202c',
          borderRadius: 4, padding: '2px 8px', fontWeight: 700, fontSize: 13,
        }}>{bucket}</span>
        <span style={{ color: '#a0aec0', fontSize: 12 }}>{tasks.length} task{tasks.length !== 1 ? 's' : ''}</span>
      </div>

      {tasks.map((task) => (
        <div
          key={task.id}
          style={{
            background: colors.bg,
            border: `1px solid ${colors.border}33`,
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          {/* Score badge */}
          <span style={{
            background: '#2d3748', color: '#e2e8f0',
            borderRadius: 4, padding: '2px 7px', fontSize: 12, fontWeight: 600,
            minWidth: 36, textAlign: 'center', flexShrink: 0,
          }}>
            {task.priorityScore}
          </span>

          {/* Title + domain */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: '#e2e8f0', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {task.title}
              <RationaleTooltip json={task.priorityRationaleJson} />
            </div>
            <div style={{ color: '#4a5568', fontSize: 11, marginTop: 2 }}>
              {task.id}
              {task.domainSlug && <span style={{ marginLeft: 8, color: '#718096' }}>{task.domainSlug}</span>}
              {task.paused && <span style={{ marginLeft: 8, color: '#f6ad55' }}>paused</span>}
            </div>
          </div>

          {/* Ordinal */}
          <span style={{ color: '#4a5568', fontSize: 11, flexShrink: 0 }}>
            #{task.positionOrdinal}
          </span>

          {/* Actions */}
          <button
            onClick={() => onRescore(task.id)}
            style={{
              background: '#2d3748', border: '1px solid #4a5568', color: '#a0aec0',
              borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer',
              flexShrink: 0,
            }}
            title="Re-score this task"
          >
            ↻
          </button>
        </div>
      ))}
    </div>
  );
}

function QueueContent() {
  const [data, setData] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [rescoring, setRescoring] = useState(false);
  const [lastRescored, setLastRescored] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/priority/queue')
      .then(r => r.json())
      .then((d: unknown) => setData(d as QueueResponse))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRescore = async (taskId: string) => {
    await fetch(`/api/priority/score/${taskId}`, { method: 'POST' });
    load();
    setLastRescored(`${taskId} rescored at ${new Date().toLocaleTimeString()}`);
  };

  const handleRescoreAll = async () => {
    setRescoring(true);
    const res = await fetch('/api/priority/score-all', { method: 'POST' });
    const result = await res.json() as { rescored: number };
    setLastRescored(`All tasks rescored (${result.rescored} tasks) at ${new Date().toLocaleTimeString()}`);
    load();
    setRescoring(false);
  };

  const handleOverride = async (taskId: string, newOrdinal: number) => {
    await fetch('/api/priority/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId, new_ordinal: newOrdinal, reason: 'Manual override via queue dashboard' }),
    });
    load();
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
          🎯 Priority Queue
        </h1>
        {data && (
          <span style={{ color: '#718096', fontSize: 13 }}>
            {data.total} active tasks
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {lastRescored && (
            <span style={{ color: '#68d391', fontSize: 11 }}>{lastRescored}</span>
          )}
          <button
            onClick={load}
            style={{
              background: '#2d3748', border: '1px solid #4a5568', color: '#a0aec0',
              borderRadius: 4, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
            }}
          >
            Refresh
          </button>
          <button
            onClick={handleRescoreAll}
            disabled={rescoring}
            style={{
              background: rescoring ? '#2d3748' : '#2b6cb0',
              border: 'none', color: '#e2e8f0',
              borderRadius: 4, padding: '6px 12px', fontSize: 12,
              cursor: rescoring ? 'not-allowed' : 'pointer', opacity: rescoring ? 0.6 : 1,
            }}
          >
            {rescoring ? 'Rescoring...' : 'Rescore All'}
          </button>
        </div>
      </div>

      {/* Score legend */}
      <div style={{
        background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 6,
        padding: '10px 14px', marginBottom: 20,
        display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12, color: '#718096',
      }}>
        <span><span style={{ color: '#fc8181', fontWeight: 700 }}>P0</span> score ≥ 90 or 5+ dependents — front of queue</span>
        <span><span style={{ color: '#f6ad55', fontWeight: 700 }}>P1</span> score 70–89 — before P2/P3</span>
        <span><span style={{ color: '#63b3ed', fontWeight: 700 }}>P2</span> score 40–69 — normal queue</span>
        <span><span style={{ color: '#718096', fontWeight: 700 }}>P3</span> score &lt; 40 — deferred</span>
        <span>Score = urgency(25%) + blast-radius(20%) + domain-criticality(15%) + user-visible(15%) + risk(15%) + confidence(10%) − effort(10%)</span>
      </div>

      {/* Queue sections */}
      {loading ? (
        <div style={{ color: '#718096', padding: 24 }}>Loading queue...</div>
      ) : data ? (
        <div>
          {(['P0', 'P1', 'P2', 'P3'] as const).map(bucket => (
            <BucketSection
              key={bucket}
              bucket={bucket}
              tasks={data.grouped[bucket] ?? []}
              onRescore={handleRescore}
              onOverride={handleOverride}
            />
          ))}
        </div>
      ) : (
        <div style={{ color: '#fc8181' }}>Failed to load queue</div>
      )}
    </div>
  );
}

export default function QueuePage() {
  return (
    <Suspense fallback={<div style={{ color: '#718096' }}>Loading...</div>}>
      <QueueContent />
    </Suspense>
  );
}
