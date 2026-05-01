'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:7776';

interface GeneralMetrics {
  integrationHealthPct: number;
  taskCompletionRate: number;
  openBlockerCount: number;
  bypassCount: number;
  avgResolutionTimeMs: number;
  totalTasks: number;
  completedTasks: number;
  totalRequirements: number;
  doneRequirements: number;
}

interface Phase1Metrics {
  windowMinutes: number;
  promptsInFlight: number;
  promptsByStatus: Record<string, number>;
  bucketsCreatedLastWindow: number;
  bucketPlacementsPerMin: number;
  stageLatencyMsAvg: Record<string, number>;
  stageLatencyMsP50: Record<string, number>;
}

function fmt(ms: number): string {
  if (ms === 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function StatCard({
  label,
  value,
  sub,
  color = '#f0f4f8',
  gauge,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  gauge?: number;
}) {
  return (
    <div
      style={{
        background: '#1a202c',
        border: '1px solid #2d3748',
        borderRadius: 8,
        padding: '14px 16px',
      }}
    >
      <div style={{ fontSize: 11, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#718096', marginTop: 4 }}>{sub}</div>}
      {gauge !== undefined && (
        <div style={{ marginTop: 10, height: 5, background: '#2d3748', borderRadius: 3, overflow: 'hidden' }}>
          <div
            style={{
              width: `${Math.min(gauge, 100)}%`,
              height: '100%',
              background: color,
              borderRadius: 3,
              transition: 'width 0.4s',
            }}
          />
        </div>
      )}
    </div>
  );
}

const STATUS_ORDER = [
  'ingested', 'scaffolded', 'po_decomposed', 'ba_enriched',
  'bucket_placed', 'ready_for_pickup', 'failed', 'unknown',
];

function statusColor(s: string): string {
  if (s === 'failed') return '#fc8181';
  if (s === 'ready_for_pickup') return '#68d391';
  if (s === 'ba_enriched' || s === 'bucket_placed') return '#90cdf4';
  return '#a0aec0';
}

export default function ConductorPage() {
  const [general, setGeneral] = useState<GeneralMetrics | null>(null);
  const [phase1, setPhase1] = useState<Phase1Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(() => {
    Promise.all([
      fetch('/api/metrics').then((r) => r.json() as Promise<GeneralMetrics | null>),
      fetch(`${API}/metrics/phase1?windowMin=15`).then((r) => r.json() as Promise<Phase1Metrics | null>),
    ]).then(([g, p]) => {
      if (g) setGeneral(g);
      if (p) setPhase1(p);
      setLoading(false);
      setLastUpdated(new Date());
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) {
    return <div style={{ padding: 24, color: '#718096' }}>Loading conductor metrics…</div>;
  }

  const stages = phase1
    ? STATUS_ORDER.filter((s) => phase1.promptsByStatus[s] !== undefined)
    : [];

  const latencyStages = phase1
    ? Object.keys(phase1.stageLatencyMsAvg).sort()
    : [];

  return (
    <div style={{ padding: 24, maxWidth: 960 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
          🔧 Conductor Metrics
        </h2>
        <Link
          href="/observability/spend"
          style={{ fontSize: 12, color: '#90cdf4', textDecoration: 'none', background: '#2d3748', padding: '4px 10px', borderRadius: 4 }}
        >
          💰 Spend →
        </Link>
        <Link
          href="/observability/cost"
          style={{ fontSize: 12, color: '#90cdf4', textDecoration: 'none', background: '#2d3748', padding: '4px 10px', borderRadius: 4 }}
        >
          💸 Cost breakdown →
        </Link>
        <Link
          href="/observability/health"
          style={{ fontSize: 12, color: '#90cdf4', textDecoration: 'none', background: '#2d3748', padding: '4px 10px', borderRadius: 4 }}
        >
          👁 Events →
        </Link>
        {lastUpdated && (
          <span style={{ fontSize: 11, color: '#4a5568', marginLeft: 'auto' }}>
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Task health */}
      {general && (
        <section style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#a0aec0', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Task health
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12 }}>
            <StatCard
              label="Integration health"
              value={`${general.integrationHealthPct}%`}
              sub={`${general.doneRequirements} / ${general.totalRequirements} requirements done`}
              color={general.integrationHealthPct >= 80 ? '#68d391' : general.integrationHealthPct >= 50 ? '#f6ad55' : '#fc8181'}
              gauge={general.integrationHealthPct}
            />
            <StatCard
              label="Task completion"
              value={`${general.taskCompletionRate}%`}
              sub={`${general.completedTasks} / ${general.totalTasks} tasks`}
              color="#63b3ed"
              gauge={general.taskCompletionRate}
            />
            <StatCard
              label="Open blockers"
              value={general.openBlockerCount}
              color={general.openBlockerCount > 0 ? '#fc8181' : '#68d391'}
              sub="active"
            />
            <StatCard
              label="Bypass count"
              value={general.bypassCount}
              color={general.bypassCount > 5 ? '#f6ad55' : '#718096'}
              sub="tasks with bypass"
            />
            <StatCard
              label="Avg resolution"
              value={fmt(general.avgResolutionTimeMs)}
              color="#b794f4"
              sub="for resolved blockers"
            />
          </div>
        </section>
      )}

      {/* Phase 1 pipeline */}
      {phase1 && (
        <section style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#a0aec0', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Phase 1 pipeline · last {phase1.windowMinutes} min
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 12, marginBottom: 20 }}>
            <StatCard
              label="Prompts in flight"
              value={phase1.promptsInFlight}
              color={phase1.promptsInFlight > 0 ? '#90cdf4' : '#718096'}
            />
            <StatCard
              label="Buckets created"
              value={phase1.bucketsCreatedLastWindow}
              sub={`last ${phase1.windowMinutes} min`}
              color="#68d391"
            />
            <StatCard
              label="Placements / min"
              value={phase1.bucketPlacementsPerMin.toFixed(2)}
              color="#a0aec0"
            />
          </div>

          {/* Prompt status breakdown */}
          {stages.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: '#718096', marginBottom: 8 }}>Prompt status breakdown</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {stages.map((s) => (
                  <div
                    key={s}
                    style={{
                      background: '#1a202c',
                      border: `1px solid ${statusColor(s)}44`,
                      borderRadius: 6,
                      padding: '6px 12px',
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: statusColor(s), fontWeight: 600 }}>
                      {phase1.promptsByStatus[s]}
                    </span>
                    <span style={{ color: '#718096', marginLeft: 6 }}>{s.replace(/_/g, ' ')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stage latency table */}
          {latencyStages.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: '#718096', marginBottom: 8 }}>Stage latency (last {phase1.windowMinutes} min)</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#161b27', borderBottom: '2px solid #2d3748' }}>
                    <th style={{ padding: '6px 10px', textAlign: 'left', color: '#718096', fontWeight: 500 }}>Stage</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right', color: '#718096', fontWeight: 500 }}>Avg</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right', color: '#718096', fontWeight: 500 }}>P50</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', color: '#718096', fontWeight: 500 }}>Bar</th>
                  </tr>
                </thead>
                <tbody>
                  {latencyStages.map((s) => {
                    const avg = phase1.stageLatencyMsAvg[s] ?? 0;
                    const p50 = phase1.stageLatencyMsP50[s] ?? 0;
                    const maxVal = Math.max(...latencyStages.map((x) => phase1.stageLatencyMsAvg[x] ?? 0), 1);
                    const pct = Math.round((avg / maxVal) * 180);
                    return (
                      <tr key={s} style={{ borderBottom: '1px solid #1a202c' }}>
                        <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: '#a0aec0' }}>
                          {s.replace(/_/g, ' ')}
                        </td>
                        <td style={{ padding: '5px 10px', textAlign: 'right', color: '#f0f4f8', fontWeight: 600 }}>
                          {fmt(avg)}
                        </td>
                        <td style={{ padding: '5px 10px', textAlign: 'right', color: '#a0aec0' }}>
                          {fmt(p50)}
                        </td>
                        <td style={{ padding: '5px 10px' }}>
                          <div
                            style={{
                              width: `${pct}px`,
                              height: 6,
                              background: avg > 60_000 ? '#fc8181' : avg > 15_000 ? '#f6ad55' : '#63b3ed',
                              borderRadius: 3,
                            }}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {!general && !phase1 && (
        <div
          style={{
            background: '#1a1a2e',
            border: '1px solid #2d3748',
            borderRadius: 8,
            padding: '20px 24px',
            color: '#718096',
            fontSize: 13,
          }}
        >
          No metrics available — orchestrator may be offline.
        </div>
      )}
    </div>
  );
}
