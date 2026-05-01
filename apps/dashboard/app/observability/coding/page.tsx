'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface WorkerCounts {
  idle: number;
  busy: number;
  crashed: number;
  released: number;
}

interface BucketCard {
  bucketId: string;
  queueDepth: number;
  throughputPerHour: number;
  oldestReadyAgeS: number | null;
  workersAssigned: number;
  engaged: boolean;
  ts: number;
}

interface WorkerSummary {
  counts: WorkerCounts;
  perBucket: BucketCard[];
  generatedAt: number;
}

interface WorkerRow {
  id: string;
  kind: string;
  capabilities: string[];
  status: string;
  currentStoryId: string | null;
  lastHeartbeatAt: number;
  registeredAt: number;
  releasedAt: number | null;
  uptimeMs: number | null;
  metadata: Record<string, unknown>;
}

interface WorkerList {
  workers: WorkerRow[];
  total: number;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function fmtAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 5_000) return 'just now';
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

function statusColor(s: string): string {
  if (s === 'idle') return '#68d391';
  if (s === 'busy') return '#63b3ed';
  if (s === 'crashed') return '#fc8181';
  if (s === 'released') return '#718096';
  return '#a0aec0';
}

function PoolCard({ label, value, color, sub }: { label: string; value: number; color: string; sub?: string }) {
  return (
    <div style={{ background: '#1a202c', border: `1px solid ${color}44`, borderRadius: 8, padding: '14px 18px', minWidth: 120 }}>
      <div style={{ fontSize: 11, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#718096', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function CodingObservabilityPage() {
  const [summary, setSummary] = useState<WorkerSummary | null>(null);
  const [workerList, setWorkerList] = useState<WorkerList | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(() => {
    Promise.all([
      fetch('/api/workers/summary').then((r) => r.json() as Promise<WorkerSummary | null>),
      fetch('/api/workers/list').then((r) => r.json() as Promise<WorkerList | null>),
    ]).then(([s, l]) => {
      if (s) setSummary(s);
      if (l) setWorkerList(l);
      setLoading(false);
      setLastUpdated(new Date());
    }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  const activeWorkers = workerList?.workers.filter((w) => w.status !== 'released') ?? [];
  const crashedWorkers = workerList?.workers.filter((w) => w.status === 'crashed') ?? [];

  return (
    <div style={{ padding: 24, maxWidth: 1100, color: '#f0f4f8', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
          👷 Coding Worker Pool
        </h2>
        <Link
          href="/observability/conductor"
          style={{ fontSize: 12, color: '#90cdf4', textDecoration: 'none', background: '#2d3748', padding: '4px 10px', borderRadius: 4 }}
        >
          🔧 Conductor →
        </Link>
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

      {loading && <div style={{ color: '#718096' }}>Loading worker metrics…</div>}

      {!loading && !summary && !workerList && (
        <div style={{ background: '#1a1a2e', border: '1px solid #2d3748', borderRadius: 8, padding: '20px 24px', color: '#718096', fontSize: 13 }}>
          No worker data — orchestrator may be offline.
        </div>
      )}

      {/* Pool status cards */}
      {summary && (
        <section style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#a0aec0', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Pool status
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <PoolCard label="Idle" value={summary.counts.idle} color="#68d391" sub="ready for work" />
            <PoolCard label="Busy" value={summary.counts.busy} color="#63b3ed" sub="coding now" />
            <PoolCard label="Crashed" value={summary.counts.crashed} color="#fc8181" sub="needs recovery" />
            <PoolCard label="Released" value={summary.counts.released} color="#718096" sub="gracefully stopped" />
            <PoolCard
              label="Total active"
              value={summary.counts.idle + summary.counts.busy + summary.counts.crashed}
              color="#b794f4"
              sub="idle + busy + crashed"
            />
          </div>
        </section>
      )}

      {/* Crashed workers callout */}
      {crashedWorkers.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={{
            background: '#2d1515',
            border: '1px solid #fc818166',
            borderRadius: 8,
            padding: '14px 18px',
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#fc8181', marginBottom: 8 }}>
              ⚠ {crashedWorkers.length} crashed worker{crashedWorkers.length > 1 ? 's' : ''} — no heartbeat detected
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {crashedWorkers.map((w) => (
                <div key={w.id} style={{ fontSize: 12, color: '#feb2b2', fontFamily: 'monospace' }}>
                  {w.id} · {w.kind} · last seen {fmtAgo(w.lastHeartbeatAt)}
                  {w.currentStoryId && (
                    <span style={{ color: '#fc8181', marginLeft: 8 }}>story: {w.currentStoryId}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Per-bucket health */}
      {summary && summary.perBucket.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#a0aec0', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Bucket health
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
            {summary.perBucket.map((b) => (
              <div
                key={b.bucketId}
                style={{
                  background: '#1a202c',
                  border: `1px solid ${b.engaged ? '#68d39144' : '#2d3748'}`,
                  borderRadius: 8,
                  padding: '12px 14px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#a0aec0', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                    {b.bucketId}
                  </span>
                  <span style={{
                    fontSize: 10,
                    background: b.engaged ? '#1a3a2a' : '#2d3748',
                    color: b.engaged ? '#68d391' : '#718096',
                    padding: '2px 6px',
                    borderRadius: 10,
                  }}>
                    {b.engaged ? 'active' : 'idle'}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 12 }}>
                  <div>
                    <div style={{ color: '#718096', fontSize: 10 }}>Queue depth</div>
                    <div style={{ color: b.queueDepth > 10 ? '#f6ad55' : '#f0f4f8', fontWeight: 600 }}>{b.queueDepth}</div>
                  </div>
                  <div>
                    <div style={{ color: '#718096', fontSize: 10 }}>Workers</div>
                    <div style={{ color: '#90cdf4', fontWeight: 600 }}>{b.workersAssigned}</div>
                  </div>
                  <div>
                    <div style={{ color: '#718096', fontSize: 10 }}>Throughput/h</div>
                    <div style={{ color: '#68d391', fontWeight: 600 }}>{b.throughputPerHour.toFixed(1)}</div>
                  </div>
                  <div>
                    <div style={{ color: '#718096', fontSize: 10 }}>Oldest ready</div>
                    <div style={{ color: b.oldestReadyAgeS != null && b.oldestReadyAgeS > 300 ? '#fc8181' : '#a0aec0', fontWeight: 600 }}>
                      {b.oldestReadyAgeS != null ? fmtDuration(b.oldestReadyAgeS * 1000) : '—'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Worker list */}
      {workerList && activeWorkers.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#a0aec0', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Active workers ({activeWorkers.length})
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#161b27', borderBottom: '2px solid #2d3748' }}>
                <th style={{ padding: '7px 10px', textAlign: 'left', color: '#718096', fontWeight: 500 }}>ID</th>
                <th style={{ padding: '7px 10px', textAlign: 'left', color: '#718096', fontWeight: 500 }}>Kind</th>
                <th style={{ padding: '7px 10px', textAlign: 'left', color: '#718096', fontWeight: 500 }}>Status</th>
                <th style={{ padding: '7px 10px', textAlign: 'left', color: '#718096', fontWeight: 500 }}>Story</th>
                <th style={{ padding: '7px 10px', textAlign: 'right', color: '#718096', fontWeight: 500 }}>Uptime</th>
                <th style={{ padding: '7px 10px', textAlign: 'right', color: '#718096', fontWeight: 500 }}>Heartbeat</th>
              </tr>
            </thead>
            <tbody>
              {activeWorkers.map((w) => (
                <tr key={w.id} style={{ borderBottom: '1px solid #1e2536' }}>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: '#a0aec0', fontSize: 11 }}>
                    {w.id.slice(0, 16)}…
                  </td>
                  <td style={{ padding: '6px 10px', color: '#90cdf4' }}>
                    {w.kind}
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    <span style={{
                      background: `${statusColor(w.status)}22`,
                      color: statusColor(w.status),
                      padding: '2px 8px',
                      borderRadius: 10,
                      fontSize: 11,
                      fontWeight: 600,
                    }}>
                      {w.status}
                    </span>
                  </td>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: '#718096', fontSize: 11 }}>
                    {w.currentStoryId ? w.currentStoryId.slice(0, 18) + '…' : '—'}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: '#a0aec0' }}>
                    {w.uptimeMs != null ? fmtDuration(w.uptimeMs) : fmtDuration(Date.now() - w.registeredAt)}
                  </td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: '#718096' }}>
                    {fmtAgo(w.lastHeartbeatAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Empty state */}
      {!loading && workerList && activeWorkers.length === 0 && (
        <div style={{ background: '#1a202c', border: '1px solid #2d3748', borderRadius: 8, padding: '20px 24px', color: '#718096', fontSize: 13 }}>
          No active workers registered. Start a coding worker to see it here.
        </div>
      )}
    </div>
  );
}
