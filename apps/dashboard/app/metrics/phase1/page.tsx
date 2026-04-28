'use client';
/**
 * Phase-1 metrics panel (GATE-4-04).
 *
 * Lightweight counter dashboard showing prompts in flight, prompts by
 * status, bucket placements/min, and per-stage latency averages + p50.
 * Polls /api/metrics/phase1 every 5 s and refreshes immediately when
 * a Phase-1 WS event arrives.
 */
import { useCallback, useEffect, useState } from 'react';
import { useWebSocket } from '../../../hooks/useWebSocket';
import { PHASE1_STAGES } from '../../../components/Phase1Timeline';

const WS_URL = process.env['NEXT_PUBLIC_WS_URL'] ?? 'ws://localhost:7776/events';
const POLL_MS = 5_000;

interface MetricsBody {
  windowMinutes: number;
  promptsInFlight: number;
  promptsByStatus: Record<string, number>;
  bucketsCreatedLastWindow: number;
  bucketPlacementsPerMin: number;
  stageLatencyMsAvg: Record<string, number>;
  stageLatencyMsP50: Record<string, number>;
}

const PHASE1_TRIGGERS = [
  'pipeline.stage.advanced', 'po-agent.', 'ba-agent.', 'task-scheduler.',
  'ticket.', 'scaffolder.team.assembled', 'prompt.ingested', 'prompt.status_changed',
];
function isPhase1EventType(type: string | undefined): boolean {
  if (!type) return false;
  return PHASE1_TRIGGERS.some((p) => type === p || type.startsWith(p));
}

function fmtMs(v: number | undefined): string {
  if (v == null) return '—';
  if (v < 1000) return `${v}ms`;
  if (v < 60_000) return `${(v / 1000).toFixed(1)}s`;
  return `${(v / 60_000).toFixed(1)}m`;
}

function Card({ label, value, accent, testId }: { label: string; value: string; accent?: string; testId?: string }) {
  return (
    <div
      data-testid={testId}
      style={{
        background: '#1a1f2e',
        border: '1px solid #2d3748',
        borderRadius: 8,
        padding: '14px 16px',
        minWidth: 180,
        flex: 1,
      }}
    >
      <div style={{ color: '#a0aec0', fontSize: 11, marginBottom: 6 }}>{label}</div>
      <div style={{ color: accent ?? '#e2e8f0', fontSize: 28, fontWeight: 700, fontFamily: 'monospace' }}>{value}</div>
    </div>
  );
}

export default function Phase1MetricsPage() {
  const [data, setData] = useState<MetricsBody | null>(null);
  const [windowMin, setWindowMin] = useState(15);
  const [err, setErr] = useState<string | null>(null);
  const { lastEvent, connected } = useWebSocket(WS_URL);

  const refetch = useCallback(async () => {
    try {
      const r = await fetch(`/api/metrics/phase1?windowMin=${windowMin}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json() as MetricsBody;
      setData(d);
      setErr(null);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
  }, [windowMin]);

  useEffect(() => { void refetch(); }, [refetch]);

  // Poll every 5s as a safety net.
  useEffect(() => {
    const t = setInterval(() => { void refetch(); }, POLL_MS);
    return () => clearInterval(t);
  }, [refetch]);

  // Refetch immediately on Phase-1 WS events.
  useEffect(() => {
    if (lastEvent && isPhase1EventType(lastEvent.type ?? lastEvent.kind)) void refetch();
  }, [lastEvent, refetch]);

  const promptStatusEntries = data
    ? Object.entries(data.promptsByStatus).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>📈 Phase 1 Metrics</h1>
        <span style={{ color: connected ? '#68d391' : '#fc8181', fontSize: 12 }}>
          {connected ? '● live' : '○ reconnecting…'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ color: '#a0aec0', fontSize: 12 }}>window</label>
          <select
            value={windowMin}
            onChange={(e) => setWindowMin(parseInt(e.target.value, 10))}
            data-testid="phase1-metrics-window-select"
            style={{ background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 4, padding: '4px 8px', fontSize: 12 }}
          >
            <option value={5}>5 min</option>
            <option value={15}>15 min</option>
            <option value={60}>1 hour</option>
            <option value={1440}>24 hours</option>
          </select>
        </div>
      </div>

      {err && <div style={{ color: '#fc8181', marginBottom: 12 }}>Error: {err}</div>}

      {data && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
            <Card testId="metric-prompts-in-flight" label="Prompts in flight" value={String(data.promptsInFlight)} accent="#90cdf4" />
            <Card testId="metric-buckets-window" label={`Buckets / ${data.windowMinutes}min`} value={String(data.bucketsCreatedLastWindow)} accent="#f6ad55" />
            <Card testId="metric-buckets-per-min" label="Bucket placements / min" value={data.bucketPlacementsPerMin.toFixed(2)} accent="#68d391" />
            <Card
              testId="metric-prompts-decomposed"
              label="Prompts decomposed (cumulative)"
              value={String(
                (data.promptsByStatus['po_decomposed'] ?? 0) +
                (data.promptsByStatus['ba_enriched'] ?? 0) +
                (data.promptsByStatus['bucket_placed'] ?? 0) +
                (data.promptsByStatus['ready_for_pickup'] ?? 0),
              )}
            />
            <Card
              testId="metric-prompts-ready"
              label="Prompts ready for pickup"
              value={String(data.promptsByStatus['ready_for_pickup'] ?? 0)}
              accent="#68d391"
            />
          </div>

          <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8, padding: 18, marginBottom: 24 }}>
            <h3 style={{ margin: '0 0 12px', color: '#e2e8f0', fontSize: 14 }}>Prompts by status</h3>
            {promptStatusEntries.length === 0 ? (
              <div style={{ color: '#4a5568', fontSize: 12, fontStyle: 'italic' }}>no prompts yet</div>
            ) : (
              <div data-testid="phase1-status-distribution">
                {promptStatusEntries.map(([status, count]) => {
                  const max = Math.max(...promptStatusEntries.map((e) => e[1]), 1);
                  return (
                    <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                      <div style={{ width: 140, color: '#a0aec0', fontSize: 12 }}>{status}</div>
                      <div style={{ flex: 1, background: '#2d3748', borderRadius: 4, height: 18, overflow: 'hidden' }}>
                        <div style={{ width: `${(count / max) * 100}%`, height: '100%', background: '#63b3ed', borderRadius: 4 }} />
                      </div>
                      <div style={{ width: 36, color: '#e2e8f0', fontSize: 12, textAlign: 'right' }}>{count}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8, padding: 18 }}>
            <h3 style={{ margin: '0 0 12px', color: '#e2e8f0', fontSize: 14 }}>Stage latency (last {data.windowMinutes} min)</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: '#a0aec0', textAlign: 'left', borderBottom: '1px solid #2d3748' }}>
                  <th style={{ padding: '6px 8px', fontWeight: 600 }}>Stage</th>
                  <th style={{ padding: '6px 8px', fontWeight: 600 }}>Avg</th>
                  <th style={{ padding: '6px 8px', fontWeight: 600 }}>P50</th>
                </tr>
              </thead>
              <tbody>
                {PHASE1_STAGES.map((s) => (
                  <tr key={s.key} data-testid={`phase1-latency-row-${s.key}`}>
                    <td style={{ padding: '6px 8px', color: '#e2e8f0' }}>{s.icon} {s.label}</td>
                    <td style={{ padding: '6px 8px', color: '#cbd5e0', fontFamily: 'monospace' }}>
                      {fmtMs(data.stageLatencyMsAvg[s.key])}
                    </td>
                    <td style={{ padding: '6px 8px', color: '#cbd5e0', fontFamily: 'monospace' }}>
                      {fmtMs(data.stageLatencyMsP50[s.key])}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!data && !err && <div style={{ color: '#a0aec0' }}>Loading metrics…</div>}
    </div>
  );
}
