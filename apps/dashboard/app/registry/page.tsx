/**
 * /registry — Feature Registry dashboard (FREG-007).
 *
 * Five panels:
 *   1. Summary cards: registry size, recent additions, classification mix
 *   2. Latency stats: p50 / p95 / p99 over the last 24h
 *   3. Top match queries: most-frequently-matched feature_ids
 *   4. Recent registry rows (JSON-decoded view)
 *   5. Recent search log (most recent registry.search calls + verdicts)
 *
 * Polls every 30s. Fail-soft: any panel that 404s or 500s renders an empty
 * card with a "data unavailable" notice — orchestrator may not have FREG
 * routes yet on a degraded boot.
 */
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Summary {
  registrySize: number;
  projectBreakdown: Array<{ project: string; c: number }>;
  sourceBreakdown: Array<{ source: string; c: number }>;
  classificationCounts24h: Array<{ classification: string; c: number }>;
  recentlyAddedCount: number;
}
interface LatencyStats {
  windowHours: number;
  sampleCount: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  meanMs: number | null;
  maxMs: number | null;
}
interface RecentRow {
  id: string;
  project: string;
  name: string;
  description: string;
  route_path: string | null;
  agent_name: string | null;
  source: string;
  created_at: number;
  updated_at: number;
  story_id: string | null;
  embedding_model: string;
}
interface LogRow {
  id: string;
  query: string;
  project: string | null;
  classification: string;
  top_match_id: string | null;
  top_score: number | null;
  threshold_used: number;
  latency_ms: number;
  embedder_tokens: number;
  hit_count: number;
  caller: string;
  created_at: number;
}
interface TopMatch {
  feature_id: string;
  feature_name: string;
  project: string;
  match_count: number;
  avg_score: number;
}

const POLL_INTERVAL_MS = 30000;

async function jsonOrNull<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

function formatMs(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${v.toFixed(0)}ms`;
}

function formatScore(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return v.toFixed(3);
}

function relTime(epochMs: number): string {
  const delta = Date.now() - epochMs;
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / 86_400_000)}d ago`;
}

const verdictColor = (v: string) => {
  if (v === 'enhance') return '#48bb78';
  if (v === 'ambiguous') return '#ecc94b';
  if (v === 'new') return '#90cdf4';
  return '#a0aec0';
};

export default function FeatureRegistryDashboard() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [latency, setLatency] = useState<LatencyStats | null>(null);
  const [recent, setRecent] = useState<RecentRow[] | null>(null);
  const [log, setLog] = useState<LogRow[] | null>(null);
  const [topMatches, setTopMatches] = useState<TopMatch[] | null>(null);

  async function refresh() {
    const [s, lat, r, l, tm] = await Promise.all([
      jsonOrNull<Summary>('/api/feature-registry/summary'),
      jsonOrNull<LatencyStats>('/api/feature-registry/latency?windowHours=24'),
      jsonOrNull<{ rows: RecentRow[] }>('/api/feature-registry/recent?limit=15'),
      jsonOrNull<{ rows: LogRow[] }>('/api/feature-registry/search-log?limit=20'),
      jsonOrNull<{ rows: TopMatch[] }>('/api/feature-registry/top-matches?windowHours=24&limit=10'),
    ]);
    setSummary(s);
    setLatency(lat);
    setRecent(r?.rows ?? null);
    setLog(l?.rows ?? null);
    setTopMatches(tm?.rows ?? null);
  }

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ padding: 20, color: '#e2e8f0', maxWidth: 1400 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
          🗂️ Feature Registry
        </h1>
        <Link href="/metrics" style={{ color: '#90cdf4', fontSize: 12, textDecoration: 'none' }}>
          ← Metrics
        </Link>
        <span style={{ color: '#718096', fontSize: 12, marginLeft: 'auto' }}>
          polls every {POLL_INTERVAL_MS / 1000}s
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <Card label="Registry size" value={summary?.registrySize ?? '—'} />
        <Card label="Added (last 7d)" value={summary?.recentlyAddedCount ?? '—'} />
        <Card label="Search latency p50" value={formatMs(latency?.p50Ms)} />
        <Card label="Search latency p95" value={formatMs(latency?.p95Ms)} />
        <Card label="Searches (24h)" value={latency?.sampleCount ?? '—'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <Panel title="Classification mix (last 24h)">
          {summary?.classificationCounts24h.length ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {summary.classificationCounts24h.map((c) => (
                <li key={c.classification} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                  <span style={{ color: verdictColor(c.classification), textTransform: 'capitalize' }}>
                    {c.classification}
                  </span>
                  <span>{c.c}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="No searches in the last 24h" />
          )}
        </Panel>

        <Panel title="Project breakdown">
          {summary?.projectBreakdown.length ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {summary.projectBreakdown.map((p) => (
                <li key={p.project} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                  <span>{p.project}</span>
                  <span>{p.c}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="Registry is empty" />
          )}
        </Panel>

        <Panel title="Top matches (last 24h)">
          {topMatches?.length ? (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: '#a0aec0', textAlign: 'left', borderBottom: '1px solid #2d3748' }}>
                  <th style={{ padding: '4px 8px' }}>Feature</th>
                  <th style={{ padding: '4px 8px' }}>Matches</th>
                  <th style={{ padding: '4px 8px' }}>Avg score</th>
                </tr>
              </thead>
              <tbody>
                {topMatches.map((m) => (
                  <tr key={m.feature_id} style={{ borderBottom: '1px solid #1a202c' }}>
                    <td style={{ padding: '4px 8px' }}>
                      <span style={{ color: '#e2e8f0' }}>{m.feature_name ?? '(deleted)'}</span>
                      <span style={{ color: '#718096', marginLeft: 6 }}>{m.project}</span>
                    </td>
                    <td style={{ padding: '4px 8px' }}>{m.match_count}</td>
                    <td style={{ padding: '4px 8px' }}>{formatScore(m.avg_score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty text="No matches in the window" />
          )}
        </Panel>

        <Panel title="Source breakdown">
          {summary?.sourceBreakdown.length ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {summary.sourceBreakdown.map((s) => (
                <li key={s.source} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                  <span style={{ color: '#a0aec0' }}>{s.source}</span>
                  <span>{s.c}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="Registry is empty" />
          )}
        </Panel>
      </div>

      <Panel title="Recent registry rows">
        {recent?.length ? (
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#a0aec0', textAlign: 'left', borderBottom: '1px solid #2d3748' }}>
                <th style={{ padding: '4px 8px' }}>Name</th>
                <th style={{ padding: '4px 8px' }}>Project</th>
                <th style={{ padding: '4px 8px' }}>Locator</th>
                <th style={{ padding: '4px 8px' }}>Source</th>
                <th style={{ padding: '4px 8px' }}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #1a202c' }}>
                  <td style={{ padding: '4px 8px' }}>{r.name}</td>
                  <td style={{ padding: '4px 8px', color: '#a0aec0' }}>{r.project}</td>
                  <td style={{ padding: '4px 8px', color: '#718096' }}>
                    {r.route_path ?? r.agent_name ?? '—'}
                  </td>
                  <td style={{ padding: '4px 8px', color: '#a0aec0' }}>{r.source}</td>
                  <td style={{ padding: '4px 8px', color: '#a0aec0' }}>{relTime(r.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty text="Registry is empty — run the backfill script (FREG-004)" />
        )}
      </Panel>

      <Panel title="Recent search log">
        {log?.length ? (
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#a0aec0', textAlign: 'left', borderBottom: '1px solid #2d3748' }}>
                <th style={{ padding: '4px 8px' }}>Query</th>
                <th style={{ padding: '4px 8px' }}>Verdict</th>
                <th style={{ padding: '4px 8px' }}>Top score</th>
                <th style={{ padding: '4px 8px' }}>Latency</th>
                <th style={{ padding: '4px 8px' }}>Tokens</th>
                <th style={{ padding: '4px 8px' }}>When</th>
              </tr>
            </thead>
            <tbody>
              {log.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #1a202c' }}>
                  <td style={{ padding: '4px 8px', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.query}>
                    {r.query}
                  </td>
                  <td style={{ padding: '4px 8px', color: verdictColor(r.classification), textTransform: 'capitalize' }}>
                    {r.classification}
                  </td>
                  <td style={{ padding: '4px 8px' }}>{formatScore(r.top_score)}</td>
                  <td style={{ padding: '4px 8px' }}>{formatMs(r.latency_ms)}</td>
                  <td style={{ padding: '4px 8px', color: '#a0aec0' }}>{r.embedder_tokens}</td>
                  <td style={{ padding: '4px 8px', color: '#a0aec0' }}>{relTime(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty text="No search calls yet — PO Agent will populate this once it runs" />
        )}
      </Panel>
    </div>
  );
}

function Card({ label, value }: { label: string; value: number | string }) {
  return (
    <div
      style={{
        background: '#1a202c',
        border: '1px solid #2d3748',
        borderRadius: 6,
        padding: 12,
      }}
    >
      <div style={{ color: '#a0aec0', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
      <div style={{ color: '#f0f4f8', fontSize: 24, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: '#1a202c',
        border: '1px solid #2d3748',
        borderRadius: 6,
        padding: 12,
        marginBottom: 12,
      }}
    >
      <h2 style={{ margin: '0 0 8px 0', fontSize: 14, color: '#cbd5e0' }}>{title}</h2>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p style={{ color: '#718096', fontSize: 12, margin: 0, padding: '8px 0' }}>{text}</p>;
}
