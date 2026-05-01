'use client';
/**
 * /work/prompts/[id]/pipeline/[stageId] — single pipeline stage detail (DASH-008).
 * Composes from existing endpoints. No new backend.
 * Spec: caia/docs/dashboard-url-schema.md §2.
 */
import { useEffect, useState } from 'react';
import { LineagePanel } from '../../../../../../components/LineagePanel';
import { EventTimeline } from '../../../../../../components/EventTimeline';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:7776';

interface StageInfo {
  id: string;
  name: string;
  agent?: string;
  status?: string;
  startedAt?: string;
  durationMs?: number;
  output?: unknown;
}

function fmtDuration(ms?: number): string {
  if (!ms || ms <= 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m`;
}

export default function StageDetail({ params }: { params: { id: string; stageId: string } }) {
  const { id: promptId, stageId } = params;
  const [stage, setStage] = useState<StageInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`${API}/prompts/${encodeURIComponent(promptId)}/pipeline`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        if (!alive || !data || typeof data !== 'object') return;
        const stages = Array.isArray((data as { stages?: unknown[] }).stages)
          ? ((data as { stages: StageInfo[] }).stages)
          : [];
        const found = stages.find((s) => s.id === stageId || s.name === stageId);
        if (found) setStage(found);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [promptId, stageId]);

  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
        🔀 Stage: <span style={{ color: '#90cdf4' }}>{stageId}</span>
      </h1>
      <p style={{ marginTop: 4, fontSize: 13, color: '#a0aec0' }}>
        Within prompt <code style={{ color: '#cbd5e0' }}>{promptId}</code>
      </p>

      <LineagePanel
        parents={[
          { kind: 'Prompt', id: promptId, href: `/work/prompts/${promptId}` },
          { kind: 'Pipeline', id: 'pipeline', href: `/work/prompts/${promptId}/pipeline` },
        ]}
      />

      {loading ? (
        <div style={{ color: '#718096', fontSize: 13 }}>Loading stage…</div>
      ) : (
        <section
          style={{
            padding: 16,
            background: '#1a1f2e',
            border: '1px solid #2d3748',
            borderRadius: 12,
            marginTop: 8,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
            <Field label="Agent" value={stage?.agent ?? '—'} />
            <Field label="Status" value={stage?.status ?? '—'} />
            <Field label="Duration" value={fmtDuration(stage?.durationMs)} />
            <Field label="Started" value={stage?.startedAt ?? '—'} />
          </div>
          {stage?.output !== undefined && (
            <div style={{ marginTop: 16 }}>
              <div style={{ color: '#718096', fontSize: 11, textTransform: 'uppercase', marginBottom: 6 }}>Output</div>
              <pre
                style={{
                  background: '#0f1117',
                  border: '1px solid #2d3748',
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 12,
                  color: '#cbd5e0',
                  overflow: 'auto',
                  maxHeight: 360,
                }}
              >
                {typeof stage.output === 'string' ? stage.output : JSON.stringify(stage.output, null, 2)}
              </pre>
            </div>
          )}
        </section>
      )}

      <EventTimeline filter={{ prompt_id: promptId }} title={`Events for stage ${stageId}`} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: '#718096', fontSize: 11, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color: '#f0f4f8', fontSize: 14, marginTop: 4 }}>{value}</div>
    </div>
  );
}
