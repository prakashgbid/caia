/**
 * /architecture — AKG (Architecture Knowledge Graph) dashboard (ARCH-007).
 *
 * UI/UX rewrite for the open-source registry — dark theme, responsive,
 * WCAG 2.1 AA, loading/error states per acceptance criteria.
 *
 * Five panels:
 *   1. Summary cards: total artifacts, total edges, kind breakdown,
 *      project breakdown, recent extract-run count
 *   2. Per-domain browser: pick a tech_sub_domain, see artifacts of every
 *      kind tagged with it
 *   3. Recent artifacts (most-recently extracted/upserted)
 *   4. Recent extract runs (extractor invocations, timing, counts)
 *   5. Edge inspector: paste a fromId/toId to see edges
 *
 * Polls every 30s. Fail-soft: any panel that 404s/500s renders an empty
 * card with a "data unavailable" notice.
 */
'use client';
import { useEffect, useState, useId } from 'react';
import Link from 'next/link';

const POLL_INTERVAL_MS = 30000;

/* ─── types ──────────────────────────────────────────────────────────────── */

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

interface EdgeRow {
  from_id: string;
  to_id: string;
  kind: string;
  weight: number | null;
  notes: string | null;
}

/* ─── constants ──────────────────────────────────────────────────────────── */

const TECH_SUB_DOMAINS = [
  'frontend', 'design-system', 'accessibility', 'web-analytics',
  'bff', 'backend', 'api-gateway', 'agent-runtime', 'event-driven',
  'auth', 'observability', 'database', 'data-migration',
  'testing', 'ci-cd', 'security', 'performance',
];

/* ─── colour tokens ──────────────────────────────────────────────────────── */
// Matches the rest of the Conductor dashboard (globals.css + Sidebar).
const C = {
  bg: '#0f1117',
  panel: '#1a202c',
  panelAlt: '#1a1f2e',
  border: '#2d3748',
  text: '#e2e8f0',
  muted: '#a0aec0',
  faint: '#718096',
  accent: '#90cdf4',
  link: '#63b3ed',
  success: '#68d391',
  warning: '#f6ad55',
  danger: '#fc8181',
  mono: "'Courier New', monospace",
  tag: '#2d3748',
  tagText: '#90cdf4',
} as const;

/* ─── helpers ────────────────────────────────────────────────────────────── */

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
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

const KIND_EMOJI: Record<string, string> = {
  component: '🧩', api: '🔌', service: '🛠️', schema: '🗄️',
  migration: '📜', package: '📦', theme: '🎨', plugin: '🔧',
  integration: '🤝', domain_module: '🏛️', observability_signal: '📈', adr: '📝',
};
const kindEmoji = (k: string) => KIND_EMOJI[k] ?? '❔';

/* ─── shared sub-components ──────────────────────────────────────────────── */

function Skeleton({ width = '100%', height = 16 }: { width?: string | number; height?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width, height, borderRadius: 4,
        background: 'linear-gradient(90deg, #2d3748 25%, #3a4a5c 50%, #2d3748 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.4s infinite',
      }}
    />
  );
}

function StatCard({ label, value, loading }: { label: string; value: string | number; loading?: boolean }) {
  return (
    <div
      style={{
        background: C.panelAlt, border: `1px solid ${C.border}`,
        borderRadius: 8, padding: '12px 16px',
      }}
      role="region"
      aria-label={label}
    >
      <div style={{ color: C.faint, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </div>
      {loading
        ? <Skeleton height={28} width={60} />
        : <div style={{ color: C.text, fontSize: 24, fontWeight: 700 }}>{value}</div>}
    </div>
  );
}

function BreakdownCard({ label, rows, loading }: {
  label: string;
  rows: Array<{ k: string; c: number }>;
  loading?: boolean;
}) {
  return (
    <div style={{
      background: C.panelAlt, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: '12px 16px', gridColumn: 'span 1',
    }}>
      <div style={{ color: C.faint, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        {label}
      </div>
      {loading
        ? <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><Skeleton /><Skeleton /><Skeleton width="70%" /></div>
        : rows.length === 0
          ? <div style={{ color: C.faint, fontSize: 12, fontStyle: 'italic' }}>empty</div>
          : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {rows.map((r) => (
                <li key={r.k} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12, borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ color: C.muted }}>{r.k}</span>
                  <span style={{ color: C.text, fontWeight: 600 }}>{r.c}</span>
                </li>
              ))}
            </ul>
          )
      }
    </div>
  );
}

function Panel({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section
      aria-labelledby={id}
      style={{
        background: C.panel, border: `1px solid ${C.border}`,
        borderRadius: 8, padding: 16, marginBottom: 16,
      }}
    >
      <h2 id={id} style={{ margin: '0 0 12px', fontSize: 16, color: C.text, fontWeight: 600 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p role="status" style={{ color: C.faint, fontSize: 13, margin: 0, padding: '12px 0', fontStyle: 'italic' }}>
      {text}
    </p>
  );
}

function Tag({ label }: { label: string }) {
  return (
    <span style={{
      background: C.tag, color: C.tagText, borderRadius: 10,
      padding: '1px 7px', fontSize: 10, fontWeight: 500, marginRight: 4,
      display: 'inline-block', marginBottom: 2,
    }}>
      {label}
    </span>
  );
}

/* ─── ArtifactTable ──────────────────────────────────────────────────────── */

function ArtifactTable({ rows, loading }: { rows: ArtifactRow[] | null; loading?: boolean }) {
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={32} />)}
      </div>
    );
  }
  if (!rows || rows.length === 0) {
    return <Empty text="No artifacts yet — run the extractors." />;
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', minWidth: 560 }}
        aria-label="Architecture artifacts"
      >
        <thead>
          <tr style={{ background: C.panelAlt }}>
            {['Kind', 'Name', 'Locator', 'Tech sub-domains', 'Source', 'Updated'].map((h) => (
              <th key={h} scope="col" style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const tsds = tryParse<string[]>(r.tech_sub_domains_json, []);
            const locator = r.route_signature ?? r.entry_path ?? r.table_name ?? r.package_name ?? '—';
            return (
              <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={tdStyle}>{kindEmoji(r.kind)} {r.kind}</td>
                <td style={tdStyle}>
                  <strong style={{ color: C.text }}>{r.name}</strong>
                  {r.description && (
                    <div style={{ color: C.faint, fontSize: 11, marginTop: 2 }}>{r.description}</div>
                  )}
                </td>
                <td style={{ ...tdStyle, fontFamily: C.mono, fontSize: 11, color: C.muted }}>{locator}</td>
                <td style={tdStyle}>{tsds.map((t) => <Tag key={t} label={t} />)}</td>
                <td style={{ ...tdStyle, color: C.faint }}>{r.source}</td>
                <td style={{ ...tdStyle, color: C.faint, whiteSpace: 'nowrap' }}>{relTime(r.updated_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── EdgeInspector ──────────────────────────────────────────────────────── */

function EdgeInspector() {
  const fromLabelId = useId();
  const toLabelId = useId();
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [edges, setEdges] = useState<EdgeRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    if (!fromId && !toId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (fromId) params.set('fromId', fromId.trim());
      if (toId) params.set('toId', toId.trim());
      const r = await fetch(`/api/architecture/edges?${params.toString()}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as { rows: EdgeRow[] };
      setEdges(data.rows ?? []);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setEdges(null);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: C.panelAlt, border: `1px solid ${C.border}`, borderRadius: 6,
    color: C.text, padding: '6px 10px', fontSize: 12, fontFamily: C.mono,
    width: '100%', outline: 'none',
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginBottom: 12, alignItems: 'end' }}>
        <div>
          <label id={fromLabelId} style={{ color: C.faint, fontSize: 11, display: 'block', marginBottom: 4 }}>
            From artifact ID
          </label>
          <input
            aria-labelledby={fromLabelId}
            value={fromId}
            onChange={(e) => setFromId(e.target.value)}
            placeholder="art_…"
            style={inputStyle}
            onKeyDown={(e) => e.key === 'Enter' && void lookup()}
          />
        </div>
        <div>
          <label id={toLabelId} style={{ color: C.faint, fontSize: 11, display: 'block', marginBottom: 4 }}>
            To artifact ID
          </label>
          <input
            aria-labelledby={toLabelId}
            value={toId}
            onChange={(e) => setToId(e.target.value)}
            placeholder="art_…"
            style={inputStyle}
            onKeyDown={(e) => e.key === 'Enter' && void lookup()}
          />
        </div>
        <button
          onClick={() => void lookup()}
          disabled={loading || (!fromId && !toId)}
          aria-busy={loading}
          style={{
            background: C.accent, color: C.panel, border: 'none', borderRadius: 6,
            padding: '7px 16px', fontSize: 12, fontWeight: 600, cursor: loading ? 'wait' : 'pointer',
            opacity: (!fromId && !toId) ? 0.5 : 1,
          }}
        >
          {loading ? 'Looking…' : 'Lookup'}
        </button>
      </div>

      {error && (
        <div role="alert" style={{ color: C.danger, background: `${C.danger}15`, border: `1px solid ${C.danger}40`, borderRadius: 6, padding: '8px 12px', fontSize: 12, marginBottom: 8 }}>
          Failed to load edges: {error}
        </div>
      )}

      {edges === null && !loading && !error && (
        <Empty text="Enter a fromId and/or toId above to inspect edges." />
      )}

      {edges !== null && edges.length === 0 && (
        <Empty text="No edges found for these IDs." />
      )}

      {edges && edges.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', minWidth: 400 }} aria-label="AKG edges">
            <thead>
              <tr style={{ background: C.panelAlt }}>
                {['From', 'Kind', 'To', 'Weight', 'Notes'].map((h) => (
                  <th key={h} scope="col" style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {edges.map((e, i) => (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ ...tdStyle, fontFamily: C.mono, fontSize: 11, color: C.muted }}>{e.from_id}</td>
                  <td style={{ ...tdStyle, color: C.accent }}>{e.kind}</td>
                  <td style={{ ...tdStyle, fontFamily: C.mono, fontSize: 11, color: C.muted }}>{e.to_id}</td>
                  <td style={tdStyle}>{e.weight ?? '—'}</td>
                  <td style={{ ...tdStyle, color: C.faint }}>{e.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── main page ──────────────────────────────────────────────────────────── */

export default function ArchitecturePage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [recent, setRecent] = useState<ArtifactRow[] | null>(null);
  const [recentLoading, setRecentLoading] = useState(true);
  const [domainArtifacts, setDomainArtifacts] = useState<ArtifactRow[] | null>(null);
  const [domainLoading, setDomainLoading] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<string>('frontend');
  const [domainSearch, setDomainSearch] = useState('');
  const [extractRuns, setExtractRuns] = useState<ExtractRun[] | null>(null);
  const [runsLoading, setRunsLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<number>(0);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      setFetchError(null);
      try {
        const [s, r, e] = await Promise.all([
          jsonOrNull<Summary>('/api/architecture/summary'),
          jsonOrNull<{ rows: ArtifactRow[] }>('/api/architecture/recent?limit=15'),
          jsonOrNull<{ rows: ExtractRun[] }>('/api/architecture/extract-runs?limit=10'),
        ]);
        if (cancelled) return;
        setSummary(s);
        setRecent(r?.rows ?? []);
        setExtractRuns(e?.rows ?? []);
        setLoadedAt(Date.now());
      } catch (err) {
        if (!cancelled) setFetchError(String((err as Error)?.message ?? err));
      } finally {
        if (!cancelled) {
          setSummaryLoading(false);
          setRecentLoading(false);
          setRunsLoading(false);
        }
      }
    };
    void refresh();
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDomainLoading(true);
    (async () => {
      const r = await jsonOrNull<{ rows: ArtifactRow[] }>(
        `/api/architecture/by-domain?techSubDomain=${encodeURIComponent(selectedDomain)}`,
      );
      if (cancelled) return;
      setDomainArtifacts(r?.rows ?? []);
      setDomainLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedDomain]);

  const filteredDomainArtifacts = domainSearch.trim()
    ? (domainArtifacts ?? []).filter((a) =>
        a.name.toLowerCase().includes(domainSearch.toLowerCase()) ||
        a.description.toLowerCase().includes(domainSearch.toLowerCase()),
      )
    : domainArtifacts;

  return (
    <>
      {/* Shimmer animation — injected once */}
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @media (max-width: 640px) {
          .arch-summary-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .arch-breakdown-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <main style={{ padding: '16px', maxWidth: 1280, margin: '0 auto' }}>

        {/* ── Header ── */}
        <header style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: C.accent }}>
                🏛️ Architecture Registry
              </h1>
              <p style={{ color: C.muted, margin: '4px 0 0', fontSize: 13, lineHeight: 1.5 }}>
                AKG (Architecture Knowledge Graph). Auto-extracted via ts-morph + drizzle introspect + package scanner.
                Powers the EA Agent&apos;s per-domain <code style={{ fontFamily: C.mono, color: C.accent }}>architecturalInstructions[]</code>.
                Polls every {POLL_INTERVAL_MS / 1000}s.
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: C.faint }}>
                See also:{' '}
                <Link href="/registry" style={{ color: C.link }}>Feature Registry</Link>
                {' '}— sister track at user-feature granularity
              </p>
            </div>
            <div style={{ fontSize: 11, color: C.faint, textAlign: 'right', whiteSpace: 'nowrap' }}>
              Last loaded: {loadedAt ? relTime(loadedAt) : '—'}
            </div>
          </div>

          {fetchError && (
            <div
              role="alert"
              style={{
                marginTop: 12, color: C.danger,
                background: `${C.danger}15`, border: `1px solid ${C.danger}40`,
                borderRadius: 6, padding: '8px 12px', fontSize: 12,
              }}
            >
              ⚠️ Failed to load data: {fetchError}. Is the orchestrator running?
            </div>
          )}
        </header>

        {/* ── Panel 1: Summary ── */}
        <Panel id="arch-summary" title="Summary">
          <div
            className="arch-summary-grid"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}
          >
            <StatCard label="Total artifacts" value={summary?.totalArtifacts ?? '—'} loading={summaryLoading} />
            <StatCard label="Total edges"     value={summary?.totalEdges ?? '—'}     loading={summaryLoading} />
            <StatCard label="Extract runs (24h)" value={summary?.recentExtractRunCount24h ?? '—'} loading={summaryLoading} />
            <StatCard label="Kinds"           value={summary?.kindBreakdown.length ?? '—'}  loading={summaryLoading} />
          </div>
          <div
            className="arch-breakdown-grid"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}
          >
            <BreakdownCard
              label="By kind"
              rows={summary?.kindBreakdown.map((k) => ({ k: `${kindEmoji(k.kind)} ${k.kind}`, c: k.c })) ?? []}
              loading={summaryLoading}
            />
            <BreakdownCard
              label="By project"
              rows={summary?.projectBreakdown.map((p) => ({ k: p.project, c: p.c })) ?? []}
              loading={summaryLoading}
            />
            <BreakdownCard
              label="By source"
              rows={summary?.sourceBreakdown.map((s) => ({ k: s.source, c: s.c })) ?? []}
              loading={summaryLoading}
            />
          </div>
        </Panel>

        {/* ── Panel 2: Per-domain browser ── */}
        <Panel id="arch-domain" title="Browse by tech sub-domain">
          <div role="group" aria-label="Tech sub-domain filter" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {TECH_SUB_DOMAINS.map((tsd) => (
              <button
                key={tsd}
                onClick={() => { setSelectedDomain(tsd); setDomainSearch(''); }}
                aria-pressed={tsd === selectedDomain}
                style={{
                  padding: '4px 12px', borderRadius: 14, fontSize: 12, cursor: 'pointer',
                  border: tsd === selectedDomain ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
                  background: tsd === selectedDomain ? `${C.accent}20` : C.panelAlt,
                  color: tsd === selectedDomain ? C.accent : C.muted,
                  fontWeight: tsd === selectedDomain ? 600 : 400,
                  transition: 'all 0.12s',
                }}
              >
                {tsd}
              </button>
            ))}
          </div>

          {/* search within domain */}
          <input
            type="search"
            aria-label={`Search artifacts in ${selectedDomain}`}
            placeholder={`Search in ${selectedDomain}…`}
            value={domainSearch}
            onChange={(e) => setDomainSearch(e.target.value)}
            style={{
              background: C.panelAlt, border: `1px solid ${C.border}`, borderRadius: 6,
              color: C.text, padding: '6px 10px', fontSize: 12, width: '100%',
              marginBottom: 12, outline: 'none',
            }}
          />

          <ArtifactTable rows={filteredDomainArtifacts} loading={domainLoading} />
        </Panel>

        {/* ── Panel 3: Recent artifacts ── */}
        <Panel id="arch-recent" title="Recently extracted artifacts">
          <ArtifactTable rows={recent} loading={recentLoading} />
        </Panel>

        {/* ── Panel 4: Recent extract runs ── */}
        <Panel id="arch-runs" title="Recent extract runs">
          {runsLoading ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={32} />)}
            </div>
          ) : !extractRuns || extractRuns.length === 0 ? (
            <Empty text="No extract runs recorded yet." />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', minWidth: 560 }}
                aria-label="Extract runs"
              >
                <thead>
                  <tr style={{ background: C.panelAlt }}>
                    {['Extractor', 'Started', 'Duration', 'Commit', '+Artifacts', 'Updated', '+Edges', 'Status'].map((h) => (
                      <th key={h} scope="col" style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {extractRuns.map((r) => (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={tdStyle}>{r.extractor}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: C.faint }}>{relTime(r.started_at)}</td>
                      <td style={tdStyle}>{r.duration_ms != null ? `${r.duration_ms}ms` : '—'}</td>
                      <td style={{ ...tdStyle, fontFamily: C.mono, fontSize: 11, color: C.muted }}>
                        {r.commit_sha?.slice(0, 8) ?? '—'}
                      </td>
                      <td style={{ ...tdStyle, color: C.success }}>{r.artifacts_inserted}</td>
                      <td style={tdStyle}>{r.artifacts_updated}</td>
                      <td style={{ ...tdStyle, color: C.accent }}>{r.edges_inserted}</td>
                      <td style={{ ...tdStyle, color: r.error ? C.danger : C.success }}>
                        {r.error
                          ? <span title={r.error} aria-label={`Error: ${r.error}`}>✗ error</span>
                          : '✓ ok'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* ── Panel 5: Edge inspector ── */}
        <Panel id="arch-edges" title="Edge inspector">
          <EdgeInspector />
        </Panel>
      </main>
    </>
  );
}

/* ─── table style constants ──────────────────────────────────────────────── */

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', fontWeight: 600, fontSize: 11,
  color: '#a0aec0', textTransform: 'uppercase', letterSpacing: '0.04em',
  borderBottom: `2px solid #2d3748`,
};

const tdStyle: React.CSSProperties = {
  padding: '8px 10px', verticalAlign: 'top', color: '#e2e8f0',
};
