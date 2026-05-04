/**
 * /test-isolation — FIX-013 dashboard panel.
 *
 * Renders the per-test resource usage snapshot from
 * /api/test-isolation. Refreshes every 5s in the foreground; pauses
 * when the tab is hidden (Page Visibility API).
 *
 * Why a dedicated page (not a card on /metrics):
 *   - Test-infra ops want a single URL to point at when something
 *     looks off ("the runner is slow today" — open this page first).
 *   - The shard breakdown table can grow long; better its own viewport.
 */

'use client';
import { useEffect, useState } from 'react';

interface TestIsolationSnapshot {
  generatedAt: string;
  browserless: {
    isAvailable: boolean;
    running: number;
    queued: number;
    maxConcurrent: number;
    maxQueued: number;
    cpu: number;
    memory: number;
    reason: string;
  } | null;
  sqlite: {
    total: number;
    stale: number;
    bytes: number;
    recent: Array<{ name: string; bytes: number; mtimeMs: number }>;
  };
  ports: { inProcess: number[] | null };
  lastShardSummary: {
    schemaVersion: number;
    generatedAt: string;
    runId: string | null;
    totals: {
      passed: number;
      failed: number;
      skipped: number;
      flaky: number;
      durationMs: number;
      shardCount: number;
      unknownShards: number;
    };
  } | null;
}

const REFRESH_MS = 5_000;

export default function TestIsolationPage() {
  const [snap, setSnap] = useState<TestIsolationSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        const res = await fetch('/api/test-isolation', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as TestIsolationSnapshot;
        if (!cancelled) {
          setSnap(json);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled && document.visibilityState === 'visible') {
          timer = setTimeout(load, REFRESH_MS);
        }
      }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible' && !timer) {
        load();
      }
    }

    load();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div style={{ padding: 24, color: '#e2e8f0' }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8', marginBottom: 16 }}>
        🧪 Test isolation
      </h1>
      {error ? (
        <Banner color="#fc8181">Error fetching snapshot: {error}</Banner>
      ) : null}
      {!snap ? (
        <p style={{ color: '#a0aec0' }}>Loading...</p>
      ) : (
        <>
          <BrowserlessCard pressure={snap.browserless} />
          <SqliteCard sqlite={snap.sqlite} />
          <ShardSummaryCard summary={snap.lastShardSummary} />
          <Footer generatedAt={snap.generatedAt} />
        </>
      )}
    </div>
  );
}

function BrowserlessCard({ pressure }: { pressure: TestIsolationSnapshot['browserless'] }) {
  return (
    <Card title="Browserless (FIX-007)">
      {pressure === null ? (
        <p style={{ color: '#a0aec0', margin: 0 }}>
          Unreachable. Is the container up? Check{' '}
          <code style={{ background: '#2d3748', padding: '2px 4px', borderRadius: 3 }}>
            ssh stolution &apos;docker logs stolution-browserless&apos;
          </code>
          .
        </p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          <Stat
            label="Active"
            value={`${pressure.running} / ${pressure.maxConcurrent}`}
            warn={pressure.running >= pressure.maxConcurrent * 0.9}
          />
          <Stat label="Queued" value={`${pressure.queued} / ${pressure.maxQueued}`} warn={pressure.queued > 0} />
          <Stat label="CPU" value={`${pressure.cpu}%`} warn={pressure.cpu > 80} />
          <Stat label="Memory" value={`${pressure.memory}%`} warn={pressure.memory > 80} />
        </div>
      )}
    </Card>
  );
}

function SqliteCard({ sqlite }: { sqlite: TestIsolationSnapshot['sqlite'] }) {
  return (
    <Card title="Per-test SQLite files (FIX-008)">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 12 }}>
        <Stat label="Total" value={String(sqlite.total)} />
        <Stat label="Stale (>1h)" value={String(sqlite.stale)} warn={sqlite.stale > 0} />
        <Stat label="Disk usage" value={formatBytes(sqlite.bytes)} />
      </div>
      {sqlite.recent.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#a0aec0' }}>
              <th style={{ padding: 6 }}>file</th>
              <th style={{ padding: 6 }}>size</th>
              <th style={{ padding: 6 }}>mtime</th>
            </tr>
          </thead>
          <tbody>
            {sqlite.recent.map((row) => (
              <tr key={row.name} style={{ borderTop: '1px solid #2d3748' }}>
                <td style={{ padding: 6, fontFamily: 'monospace' }}>{row.name}</td>
                <td style={{ padding: 6 }}>{formatBytes(row.bytes)}</td>
                <td style={{ padding: 6 }}>{new Date(row.mtimeMs).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={{ color: '#718096', margin: 0, fontStyle: 'italic' }}>(no test DB files in tmpdir)</p>
      )}
    </Card>
  );
}

function ShardSummaryCard({ summary }: { summary: TestIsolationSnapshot['lastShardSummary'] }) {
  if (!summary) {
    return (
      <Card title="Last shard run (FIX-012)">
        <p style={{ color: '#a0aec0', margin: 0 }}>
          No <code>shard-summary.json</code> on disk yet. The merge job uploads
          it as an artifact; populate <code>SHARD_SUMMARY_PATH</code> to point
          this panel at the latest copy.
        </p>
      </Card>
    );
  }
  const { totals } = summary;
  const ok = totals.failed === 0;
  return (
    <Card title="Last shard run (FIX-012)">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
        <Stat label="Passed" value={String(totals.passed)} />
        <Stat label="Failed" value={String(totals.failed)} warn={!ok} />
        <Stat label="Skipped" value={String(totals.skipped)} />
        <Stat label="Flaky" value={String(totals.flaky)} warn={totals.flaky > 0} />
        <Stat label="Duration" value={`${(totals.durationMs / 1000).toFixed(1)}s`} />
      </div>
      <p style={{ color: '#a0aec0', fontSize: 11, marginTop: 12, marginBottom: 0 }}>
        {totals.shardCount} shards · run id {summary.runId ?? 'unknown'} · generated {summary.generatedAt}
        {totals.unknownShards > 0 ? ` · ${totals.unknownShards} unknown` : ''}
      </p>
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: '#1a202c',
        border: '1px solid #2d3748',
        borderRadius: 6,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <h2 style={{ margin: 0, marginBottom: 12, fontSize: 14, fontWeight: 600, color: '#cbd5e0' }}>{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: '#a0aec0', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, color: warn ? '#fc8181' : '#f0f4f8' }}>{value}</div>
    </div>
  );
}

function Banner({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{ background: '#1a202c', border: `1px solid ${color}`, color, padding: 8, borderRadius: 4, marginBottom: 12 }}>
      {children}
    </div>
  );
}

function Footer({ generatedAt }: { generatedAt: string }) {
  return (
    <p style={{ color: '#718096', fontSize: 11, marginTop: 24 }}>
      Snapshot generated {generatedAt} · refreshes every {REFRESH_MS / 1000}s while tab is visible
    </p>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
