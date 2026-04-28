'use client';
import { useState, useEffect } from 'react';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:7776';

interface CheckResult {
  name: string;
  stage: string;
  passed: boolean;
  message: string;
  durationMs: number;
}

interface HealResult {
  action: string;
  triggeredBy: string;
  success: boolean;
  idempotent: boolean;
  message: string;
  durationMs: number;
}

interface CanaryResult {
  taskId: string | null;
  elapsedMs: number | null;
  passed: boolean;
  message: string;
}

interface PulseRun {
  id: string;
  ranAt: string;
  outcome: string;
  canaryId: string | null;
  canaryElapsedMs: number | null;
  checksJson: string;
  invariantsJson: string;
  healsJson: string;
  durationMs: number;
}

const OUTCOME_COLOR: Record<string, string> = {
  PASSING: '#16a34a',
  DEGRADED: '#d97706',
  CRITICAL: '#dc2626',
  'AUTO-HEALED': '#7c3aed',
};

const STAGE_ORDER = ['infra', 'executor', 'pipeline'];

function OutcomeChip({ outcome }: { outcome: string }) {
  return (
    <span style={{
      background: OUTCOME_COLOR[outcome] ?? '#6b7280',
      color: '#fff',
      fontSize: 13,
      fontWeight: 700,
      padding: '3px 12px',
      borderRadius: 14,
    }}>{outcome}</span>
  );
}

function parseChecks(json: string): CheckResult[] {
  try { return JSON.parse(json) as CheckResult[]; } catch { return []; }
}
function parseHeals(json: string): HealResult[] {
  try { return JSON.parse(json) as HealResult[]; } catch { return []; }
}

function canaryFromRun(run: PulseRun): CanaryResult {
  return {
    taskId: run.canaryId,
    elapsedMs: run.canaryElapsedMs,
    passed: run.canaryElapsedMs !== null && run.canaryElapsedMs < 25_000,
    message: run.canaryElapsedMs != null ? `${run.canaryElapsedMs}ms` : '—',
  };
}

function CheckHeatmap({ runs }: { runs: PulseRun[] }) {
  if (runs.length === 0) return <div style={{ color: '#9ca3af' }}>No data yet</div>;
  const checks = parseChecks(runs[0]?.checksJson ?? '[]').map(c => c.name);
  const recent = runs.slice(0, 48).reverse();
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 11, whiteSpace: 'nowrap' }}>
        <thead>
          <tr>
            <th style={{ padding: '4px 8px', textAlign: 'left', fontWeight: 600, color: '#6b7280' }}>Check</th>
            {recent.map(r => (
              <th key={r.id} style={{ padding: '2px 3px', textAlign: 'center', fontWeight: 400, color: '#9ca3af', fontSize: 10 }}>
                {new Date(r.ranAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {checks.map(name => (
            <tr key={name}>
              <td style={{ padding: '2px 8px', color: '#374151', fontFamily: 'monospace' }}>{name}</td>
              {recent.map(run => {
                const check = parseChecks(run.checksJson).find(c => c.name === name);
                const passed = check?.passed ?? true;
                return (
                  <td key={run.id} title={check?.message ?? ''}
                    style={{ padding: '2px 3px', textAlign: 'center' }}>
                    <div style={{
                      width: 14, height: 14, borderRadius: 3,
                      background: passed ? '#bbf7d0' : '#fecaca',
                      margin: '0 auto',
                    }} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CanarySparkline({ runs }: { runs: PulseRun[] }) {
  const points = runs.slice(0, 48).reverse()
    .map(r => r.canaryElapsedMs)
    .filter((v): v is number => v !== null && v > 0);
  if (points.length === 0) return <div style={{ color: '#9ca3af', fontSize: 12 }}>No canary data</div>;
  const maxVal = Math.max(...points, 1);
  const width = 300;
  const height = 50;
  const step = width / (points.length - 1 || 1);
  const svgPoints = points.map((v, i) => `${i * step},${height - (v / maxVal) * (height - 4)}`).join(' ');
  return (
    <div>
      <svg width={width} height={height} style={{ display: 'block' }}>
        <polyline
          points={svgPoints}
          fill="none"
          stroke="#6366f1"
          strokeWidth={2}
        />
      </svg>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
        Canary latency (last {points.length} runs) — max {Math.max(...points)}ms
      </div>
    </div>
  );
}

function HealCounters({ runs }: { runs: PulseRun[] }) {
  const counts: Record<string, number> = {};
  for (const run of runs) {
    for (const h of parseHeals(run.healsJson)) {
      if (h.success && !h.idempotent) {
        counts[h.action] = (counts[h.action] ?? 0) + 1;
      }
    }
  }
  const entries = Object.entries(counts);
  if (entries.length === 0) return <div style={{ color: '#9ca3af', fontSize: 12 }}>No heals applied</div>;
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {entries.map(([action, count]) => (
        <div key={action} style={{ background: '#f3e8ff', borderRadius: 8, padding: '6px 12px', fontSize: 12 }}>
          <span style={{ fontWeight: 700, color: '#7c3aed' }}>{count}×</span>{' '}
          <span style={{ color: '#374151' }}>{action}</span>
        </div>
      ))}
    </div>
  );
}

export default function PulsePage() {
  const [runs, setRuns] = useState<PulseRun[]>([]);
  const [selected, setSelected] = useState<PulseRun | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API}/pulse/runs?limit=288`);
        if (res.ok) {
          const d = await res.json() as { runs: PulseRun[] };
          setRuns(d.runs ?? []);
          if (d.runs?.[0]) setSelected(d.runs[0]);
        }
      } finally {
        setLoading(false);
      }
    }
    void load();
    const interval = setInterval(load, 30_000); // auto-refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const latest = runs[0] ?? null;
  const checks = selected ? parseChecks(selected.checksJson) : [];
  const heals = selected ? parseHeals(selected.healsJson) : [];
  const canary = selected ? canaryFromRun(selected) : null;

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui', fontSize: 14, maxWidth: 1200 }}>
      <h2 style={{ marginBottom: 4 }}>Pipeline Pulse</h2>
      <p style={{ color: '#6b7280', marginBottom: 20, fontSize: 13 }}>
        3-layer health check: synthetic canary · state invariants · 15 micro-probes
      </p>

      {loading && <div style={{ color: '#9ca3af' }}>Loading…</div>}

      {/* Last outcome card */}
      {latest && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 20,
          background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
          padding: '16px 20px', marginBottom: 24,
        }}>
          <OutcomeChip outcome={latest.outcome} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>Last run: {new Date(latest.ranAt).toLocaleString()}</div>
            <div style={{ color: '#6b7280', fontSize: 12 }}>
              Duration {latest.durationMs}ms · Canary {latest.canaryElapsedMs != null ? `${latest.canaryElapsedMs}ms` : '—'}
              · Run ID: <code>{latest.id}</code>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* Canary sparkline */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Canary Latency (24h)</div>
          <CanarySparkline runs={runs} />
        </div>

        {/* Heal counters */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Heal Actions (cumulative)</div>
          <HealCounters runs={runs} />
        </div>
      </div>

      {/* Check heatmap */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Per-Stage Check Heatmap (last 48 runs)</div>
        <CheckHeatmap runs={runs} />
      </div>

      {/* Run list + detail */}
      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', fontWeight: 600, borderBottom: '1px solid #e5e7eb', fontSize: 12 }}>
            Recent Runs ({runs.length})
          </div>
          <div style={{ overflowY: 'auto', maxHeight: 480 }}>
            {runs.slice(0, 100).map(run => (
              <div key={run.id}
                onClick={() => setSelected(run)}
                style={{
                  padding: '8px 14px', cursor: 'pointer',
                  background: selected?.id === run.id ? '#eff6ff' : 'transparent',
                  borderBottom: '1px solid #f3f4f6',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: OUTCOME_COLOR[run.outcome] ?? '#9ca3af' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{run.outcome}</div>
                  <div style={{ fontSize: 11, color: '#9ca3af' }}>
                    {new Date(run.ranAt).toLocaleTimeString()} · {run.durationMs}ms
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Run detail panel */}
        {selected && (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <OutcomeChip outcome={selected.outcome} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{new Date(selected.ranAt).toLocaleString()}</div>
                <div style={{ fontSize: 11, color: '#9ca3af' }}>ID: {selected.id}</div>
              </div>
            </div>

            {/* Canary */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Canary</div>
              {canary && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ color: canary.passed ? '#16a34a' : '#dc2626', fontWeight: 700 }}>
                    {canary.passed ? '✓' : '✗'}
                  </span>
                  <span>{canary.message}</span>
                  {canary.taskId && <span style={{ color: '#9ca3af', fontSize: 11 }}>task: {canary.taskId}</span>}
                </div>
              )}
            </div>

            {/* Checks by stage */}
            {STAGE_ORDER.map(stage => {
              const stageChecks = checks.filter(c => c.stage === stage);
              if (stageChecks.length === 0) return null;
              return (
                <div key={stage} style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, textTransform: 'capitalize' }}>
                    {stage} checks
                  </div>
                  {stageChecks.map(c => (
                    <div key={c.name} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, marginBottom: 4 }}>
                      <span style={{ color: c.passed ? '#16a34a' : '#dc2626', fontWeight: 700, flexShrink: 0 }}>
                        {c.passed ? '✓' : '✗'}
                      </span>
                      <span style={{ fontFamily: 'monospace', color: '#374151', flexShrink: 0, minWidth: 200 }}>{c.name}</span>
                      <span style={{ color: '#6b7280' }}>{c.message}</span>
                      <span style={{ color: '#9ca3af', marginLeft: 'auto', flexShrink: 0 }}>{c.durationMs}ms</span>
                    </div>
                  ))}
                </div>
              );
            })}

            {/* Heals */}
            {heals.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Heals Applied</div>
                {heals.map((h, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, marginBottom: 4 }}>
                    <span style={{ color: h.success ? '#7c3aed' : '#dc2626', fontWeight: 700, flexShrink: 0 }}>
                      {h.success ? '🔧' : '✗'}
                    </span>
                    <span style={{ fontFamily: 'monospace', color: '#374151', flexShrink: 0, minWidth: 160 }}>{h.action}</span>
                    <span style={{ color: '#6b7280' }}>{h.message}</span>
                    {h.idempotent && <span style={{ color: '#9ca3af', fontSize: 10, marginLeft: 4 }}>(no-op)</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
