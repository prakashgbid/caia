/**
 * /architecture — AKG (Architecture Knowledge Graph) dashboard (ARCH-007).
 *
 * Five panels:
 *   1. Summary cards: total artifacts, total edges, kind breakdown,
 *      project breakdown, recent extract-run count
 *   2. Per-domain browser: pick a tech_sub_domain, see artifacts of every
 *      kind tagged with it
 *   3. Recent artifacts (most-recently extracted/upserted)
 *   4. Recent extract runs (extractor invocations, timing, counts)
 *   5. Edge inspector: hand-paste a fromId/toId to see edges
 *
 * Polls every 30s. Fail-soft: any panel that 404s/500s renders an empty
 * card with a "data unavailable" notice.
 */
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

const POLL_INTERVAL_MS = 30000;

interface Summary {
  totalArtifacts: number;
  totalEdges: number;
  kindBreakdown: Array<{ kind: string; c: number }>;
  projectBreakdown: Array<{ project: string; c: number }>;
  sourceBreakdown: Array<{ source: string; c: number }>;
  recentExtractRunCount24h: number;
}
interface ArtifactRow {
  id: string;
  kind: string;
  project: string;
  name: string;
  description: string;
  entry_path: string | null;
  route_signature: string | null;
  table_name: string | null;
  package_name: string | null;
  design_system_tier: string | null;
  tech_sub_domains_json: string;
  tags_json: string;
  source: string;
  created_at: number;
  updated_at: number;
}
interface ExtractRun {
  id: string;
  extractor: string;
  started_at: number;
  finished_at: number | null;
  duration_ms: number | null;
  commit_sha: string | null;
  artifacts_inserted: number;
  artifacts_updated: number;
  artifacts_unchanged: number;
  edges_inserted: number;
  edges_updated: number;
  error: string | null;
}

const TECH_SUB_DOMAINS = [
  'frontend',
  'design-system',
  'accessibility',
  'web-analytics',
  'bff',
  'backend',
  'api-gateway',
  'agent-runtime',
  'event-driven',
  'auth',
  'observability',
  'database',
  'data-migration',
  'testing',
  'ci-cd',
  'security',
  'performance',
];

async function jsonOrNull<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

function relTime(epochMs: number): string {
  const delta = Date.now() - epochMs;
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / 86_400_000)}d ago`;
}

function tryParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

const kindEmoji = (k: string): string => {
  switch (k) {
    case 'component': return '🧩';
    case 'api': return '🔌';
    case 'service': return '🛠️';
    case 'schema': return '🗄️';
    case 'migration': return '📜';
    case 'package': return '📦';
    case 'theme': return '🎨';
    case 'plugin': return '🔧';
    case 'integration': return '🤝';
    case 'domain_module': return '🏛️';
    case 'observability_signal': return '📈';
    case 'adr': return '📝';
    default: return '❔';
  }
};

export default function ArchitecturePage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recent, setRecent] = useState<ArtifactRow[] | null>(null);
  const [domainArtifacts, setDomainArtifacts] = useState<ArtifactRow[] | null>(null);
  const [selectedDomain, setSelectedDomain] = useState<string>('frontend');
  const [extractRuns, setExtractRuns] = useState<ExtractRun[] | null>(null);
  const [loadedAt, setLoadedAt] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const [s, r, e] = await Promise.all([
        jsonOrNull<Summary>('/api/architecture/summary'),
        jsonOrNull<{ rows: ArtifactRow[] }>('/api/architecture/recent?limit=15'),
        jsonOrNull<{ rows: ExtractRun[] }>('/api/architecture/extract-runs?limit=10'),
      ]);
      if (cancelled) return;
      setSummary(s);
      setRecent(r?.rows ?? null);
      setExtractRuns(e?.rows ?? null);
      setLoadedAt(Date.now());
    };
    refresh();
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Per-domain artifact loader
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await jsonOrNull<{ rows: ArtifactRow[] }>(
        `/api/architecture/by-domain?techSubDomain=${encodeURIComponent(selectedDomain)}`,
      );
      if (cancelled) return;
      setDomainArtifacts(r?.rows ?? null);
    })();
    return () => { cancelled = true; };
  }, [selectedDomain]);

  return (
    <main style={{ padding: 16, maxWidth: 1280, margin: '0 auto', fontFamily: 'system-ui' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Architecture Registry</h1>
          <p style={{ color: '#cbd5e1', margin: '4px 0' }}>
            AKG (Architecture Knowledge Graph). Auto-extracted via ts-morph + drizzle introspect + package scanner.
            Powers the EA Agent's per-domain architecturalInstructions[]. Polls every {POLL_INTERVAL_MS / 1000}s.
          </p>
          <p style={{ color: '#cbd5e1', margin: '4px 0', fontSize: 12 }}>
            See also: <Link href="/registry" style={{ textDecoration: 'underline' }}>/registry</Link> (Feature Registry — sister track at user-feature granularity)
          </p>
        </div>
        <div style={{ color: '#cbd5e1', fontSize: 12 }}>
          Last loaded: {loadedAt ? relTime(loadedAt) : '—'}
        </div>
      </header>

      {/* Panel 1: Summary */}
      <section style={panelStyle}>
        <h2 style={panelTitle}>Summary</h2>
        {!summary ? (
          <div style={emptyStyle}>Data unavailable (orchestrator may not be running).</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <Card label="Total artifacts" value={summary.totalArtifacts.toString()} />
            <Card label="Total edges" value={summary.totalEdges.toString()} />
            <Card label="Extract runs (24h)" value={summary.recentExtractRunCount24h.toString()} />
            <Card label="Kinds" value={summary.kindBreakdown.length.toString()} />
            <BreakdownCard label="By kind" rows={summary.kindBreakdown.map((k) => ({ k: `${kindEmoji(k.kind)} ${k.kind}`, c: k.c }))} />
            <BreakdownCard label="By project" rows={summary.projectBreakdown.map((p) => ({ k: p.project, c: p.c }))} />
            <BreakdownCard label="By source" rows={summary.sourceBreakdown.map((s) => ({ k: s.source, c: s.c }))} />
          </div>
        )}
      </section>

      {/* Panel 2: Per-domain browser */}
      <section style={panelStyle}>
        <h2 style={panelTitle}>Browse by tech sub-domain</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {TECH_SUB_DOMAINS.map((tsd) => (
            <button
              key={tsd}
              onClick={() => setSelectedDomain(tsd)}
              style={{
                padding: '4px 10px',
                borderRadius: 12,
                border: tsd === selectedDomain ? '2px solid #319795' : '1px solid #ddd',
                background: tsd === selectedDomain ? '#e6fffa' : '#f7fafc',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {tsd}
            </button>
          ))}
        </div>
        {domainArtifacts === null ? (
          <div style={emptyStyle}>Loading…</div>
        ) : domainArtifacts.length === 0 ? (
          <div style={emptyStyle}>No artifacts tagged with `{selectedDomain}` yet.</div>
        ) : (
          <ArtifactTable rows={domainArtifacts} />
        )}
      </section>

      {/* Panel 3: Recent artifacts */}
      <section style={panelStyle}>
        <h2 style={panelTitle}>Recently extracted artifacts</h2>
        {!recent ? (
          <div style={emptyStyle}>Data unavailable.</div>
        ) : recent.length === 0 ? (
          <div style={emptyStyle}>No artifacts yet — run the extractors.</div>
        ) : (
          <ArtifactTable rows={recent} />
        )}
      </section>

      {/* Panel 4: Recent extract runs */}
      <section style={panelStyle}>
        <h2 style={panelTitle}>Recent extract runs</h2>
        {!extractRuns ? (
          <div style={emptyStyle}>Data unavailable.</div>
        ) : extractRuns.length === 0 ? (
          <div style={emptyStyle}>No extract runs recorded yet.</div>
        ) : (
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f7fafc' }}>
                <th style={th}>Extractor</th>
                <th style={th}>Started</th>
                <th style={th}>Duration</th>
                <th style={th}>Commit</th>
                <th style={th}>+Artifacts</th>
                <th style={th}>Updated</th>
                <th style={th}>+Edges</th>
                <th style={th}>Error</th>
              </tr>
            </thead>
            <tbody>
              {extractRuns.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={td}>{r.extractor}</td>
                  <td style={td}>{relTime(r.started_at)}</td>
                  <td style={td}>{r.duration_ms != null ? `${r.duration_ms}ms` : '—'}</td>
                  <td style={td}>{r.commit_sha?.slice(0, 8) ?? '—'}</td>
                  <td style={td}>{r.artifacts_inserted}</td>
                  <td style={td}>{r.artifacts_updated}</td>
                  <td style={td}>{r.edges_inserted}</td>
                  <td style={{ ...td, color: r.error ? '#e53e3e' : '#666' }}>{r.error ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

const panelStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
  color: '#1a202c',
};
const panelTitle: React.CSSProperties = { margin: '0 0 12px 0', fontSize: 18, color: '#1a202c' };
const emptyStyle: React.CSSProperties = { color: '#4a5568', fontStyle: 'italic', padding: 12 };
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontWeight: 600, borderBottom: '2px solid #e2e8f0' };
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top' };

function Card(props: { label: string; value: string }) {
  return (
    <div style={{ background: '#f7fafc', borderRadius: 6, padding: 12 }}>
      <div style={{ color: '#666', fontSize: 12 }}>{props.label}</div>
      <div style={{ fontWeight: 700, fontSize: 22 }}>{props.value}</div>
    </div>
  );
}

function BreakdownCard(props: { label: string; rows: Array<{ k: string; c: number }> }) {
  return (
    <div style={{ background: '#f7fafc', borderRadius: 6, padding: 12, gridColumn: 'span 2' }}>
      <div style={{ color: '#666', fontSize: 12, marginBottom: 6 }}>{props.label}</div>
      <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', fontSize: 12 }}>
        {props.rows.map((r) => (
          <li key={r.k} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{r.k}</span>
            <span style={{ color: '#666' }}>{r.c}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ArtifactTable(props: { rows: ArtifactRow[] }) {
  return (
    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: '#f7fafc' }}>
          <th style={th}>Kind</th>
          <th style={th}>Name</th>
          <th style={th}>Locator</th>
          <th style={th}>Tech sub-domains</th>
          <th style={th}>Source</th>
          <th style={th}>Updated</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((r) => {
          const tsds = tryParse<string[]>(r.tech_sub_domains_json, []);
          const locator =
            r.route_signature ??
            r.entry_path ??
            r.table_name ??
            r.package_name ??
            '—';
          return (
            <tr key={r.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={td}>{kindEmoji(r.kind)} {r.kind}</td>
              <td style={td}>
                <strong>{r.name}</strong>
                <div style={{ color: '#666', fontSize: 11 }}>{r.description}</div>
              </td>
              <td style={{ ...td, fontFamily: 'monospace', fontSize: 11 }}>{locator}</td>
              <td style={td}>
                {tsds.map((t) => (
                  <span key={t} style={{ background: '#edf2f7', borderRadius: 8, padding: '1px 6px', marginRight: 4, fontSize: 10 }}>
                    {t}
                  </span>
                ))}
              </td>
              <td style={td}>{r.source}</td>
              <td style={td}>{relTime(r.updated_at)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
