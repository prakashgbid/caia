'use client';
import { use, useState, useEffect } from 'react';
import Link from 'next/link';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:7776';

interface BuildStep {
  id: string;
  stepName: string;
  command: string;
  stepOrder: number;
  status: string;
  exitCode?: number;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  stderrTail?: string;
  errorSignature?: string;
}

interface BuildRun {
  id: string;
  trigger: string;
  gitSha?: string;
  branch?: string;
  status: string;
  outcome?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  stepsTotal: number;
  stepsFailed: number;
}

const STATUS_COLOR: Record<string, string> = {
  success: '#16a34a',
  failed: '#dc2626',
  running: '#2563eb',
  pending: '#9ca3af',
};

export default function BuildDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [build, setBuild] = useState<BuildRun | null>(null);
  const [steps, setSteps] = useState<BuildStep[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/builds/${id}`)
      .then(r => r.json())
      .then((d: { build: BuildRun; steps: BuildStep[] }) => {
        setBuild(d.build);
        setSteps(d.steps ?? []);
        // Auto-expand first failing step
        const failing = d.steps.find(s => s.status === 'failed');
        if (failing) setExpanded(failing.id);
      })
      .catch(() => {});
  }, [id]);

  if (!build) return <div style={{ padding: 20, color: '#9ca3af' }}>Loading…</div>;

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui', fontSize: 14 }}>
      <div style={{ marginBottom: 12 }}>
        <Link href="/builds" style={{ color: '#2563eb', fontSize: 13 }}>← Builds</Link>
      </div>

      <h2 style={{ margin: '0 0 4px' }}>Build {build.id.slice(0, 14)}</h2>
      <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 20 }}>
        {build.trigger} · {build.branch ?? '?'} · {build.gitSha ?? '?'} ·{' '}
        {build.durationMs ? `${(build.durationMs / 1000).toFixed(1)}s` : 'running'} ·{' '}
        {new Date(build.startedAt).toLocaleString()}
      </div>

      {/* Flame chart (horizontal bar per step) */}
      {steps.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Flame chart</div>
          {steps.map(s => {
            const pct = build.durationMs && s.durationMs
              ? Math.round((s.durationMs / build.durationMs) * 100)
              : 0;
            return (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <div style={{ width: 120, fontSize: 11, textAlign: 'right', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.stepName}
                </div>
                <div style={{ flex: 1, background: '#f3f4f6', height: 20, borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
                  <div style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: STATUS_COLOR[s.status] ?? '#9ca3af',
                    borderRadius: 4,
                    minWidth: 2,
                  }} />
                </div>
                <div style={{ width: 50, fontSize: 11, color: '#6b7280' }}>
                  {s.durationMs ? `${(s.durationMs / 1000).toFixed(1)}s` : '—'}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Steps detail */}
      <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8 }}>Steps</div>
      {steps.map(s => (
        <div key={s.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
          <div
            onClick={() => setExpanded(e => e === s.id ? null : s.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              background: s.status === 'failed' ? '#fff5f5' : '#f9fafb',
              cursor: 'pointer',
            }}
          >
            <span style={{ color: STATUS_COLOR[s.status] ?? '#9ca3af', fontWeight: 700, fontSize: 14 }}>
              {s.status === 'success' ? '✓' : s.status === 'failed' ? '✗' : '○'}
            </span>
            <span style={{ fontWeight: 600 }}>{s.stepName}</span>
            <span style={{ color: '#9ca3af', fontSize: 11, fontFamily: 'monospace' }}>{s.command}</span>
            <span style={{ marginLeft: 'auto', color: '#6b7280', fontSize: 11 }}>
              {s.durationMs ? `${(s.durationMs / 1000).toFixed(1)}s` : ''} {s.exitCode !== undefined ? `exit ${s.exitCode}` : ''}
            </span>
          </div>
          {expanded === s.id && (s.stderrTail || s.errorSignature) && (
            <div style={{ padding: '10px 14px', background: '#1e1e1e', color: '#d4d4d4', fontFamily: 'monospace', fontSize: 11 }}>
              {s.errorSignature && (
                <div style={{ color: '#f48771', marginBottom: 6, fontWeight: 700 }}>
                  Error: {s.errorSignature}
                </div>
              )}
              {s.stderrTail && (
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {s.stderrTail.replace(/\|/g, '\n')}
                </pre>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
