/**
 * /oss-registry — Open-Source Package Registry
 *
 * UI/UX rewrite for the open-source registry — dark theme, responsive,
 * WCAG 2.1 AA, loading/error states per acceptance criteria.
 *
 * Two panels:
 *   1. Summary: total packages, kind breakdown, status breakdown, last updated
 *   2. Package browser: filterable list with kind/status selectors
 */
'use client';
import { useEffect, useState } from 'react';

const POLL_INTERVAL_MS = 30000;

/* ─── types ──────────────────────────────────────────────────────────────── */

interface OssSummary {
  totalPackages: number;
  kindBreakdown: Record<string, number>;
  statusBreakdown: Record<string, number>;
  lastUpdated: string;
}

interface OssPackage {
  name: string;
  version: string;
  description: string;
  kind: 'app' | 'package';
  status: 'stable' | 'beta' | 'alpha';
}

/* ─── colour tokens ──────────────────────────────────────────────────────── */
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

const STATUS_COLOR: Record<string, string> = {
  stable: '#68d391',
  beta: '#f6ad55',
  alpha: '#fc8181',
};

const KIND_EMOJI: Record<string, string> = {
  app: '🚀',
  package: '📦',
};

/* ─── helpers ────────────────────────────────────────────────────────────── */

async function jsonFetch<T>(url: string): Promise<{ data: T | null; ok: boolean }> {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return { data: null, ok: false };
    return { data: (await r.json()) as T, ok: true };
  } catch {
    return { data: null, ok: false };
  }
}

/* ─── shared sub-components ──────────────────────────────────────────────── */

function Skeleton({ width = '100%', height = 16 }: { width?: string | number; height?: number }) {
  return (
    <div
      aria-hidden="true"
      style={{
        width,
        height,
        borderRadius: 4,
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
        background: C.panelAlt,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: '12px 16px',
      }}
      role="region"
      aria-label={label}
    >
      <div style={{ color: C.faint, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
        {label}
      </div>
      {loading
        ? <Skeleton height={28} width={60} />
        : <div style={{ color: C.text, fontSize: 24, fontWeight: 700 }}>{value}</div>
      }
    </div>
  );
}

function BreakdownList({ label, entries, loading }: {
  label: string;
  entries: [string, number][];
  loading?: boolean;
}) {
  return (
    <div style={{
      background: C.panelAlt,
      border: `1px solid ${C.border}`,
      borderRadius: 8,
      padding: '12px 16px',
    }}>
      <div style={{ color: C.faint, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        {label}
      </div>
      {loading
        ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Skeleton /><Skeleton /><Skeleton width="70%" />
          </div>
        )
        : entries.length === 0
          ? <p style={{ color: C.faint, fontSize: 12, fontStyle: 'italic', margin: 0 }}>empty</p>
          : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {entries.map(([k, c]) => (
                <li key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', fontSize: 12, borderBottom: `1px solid ${C.border}` }}>
                  <span style={{ color: C.muted }}>{k}</span>
                  <span style={{ color: C.text, fontWeight: 600 }}>{c}</span>
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
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <h2 id={id} style={{ margin: '0 0 12px', fontSize: 16, color: C.text, fontWeight: 600 }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      background: `${color}20`,
      color,
      border: `1px solid ${color}40`,
      borderRadius: 10,
      padding: '1px 8px',
      fontSize: 10,
      fontWeight: 600,
      display: 'inline-block',
    }}>
      {label}
    </span>
  );
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  color: '#a0aec0',
  fontWeight: 600,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid #2d3748',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 10px',
  color: '#e2e8f0',
  fontSize: 12,
  verticalAlign: 'top',
};

/* ─── PackageTable ───────────────────────────────────────────────────────── */

function PackageTable({ rows, loading }: { rows: OssPackage[] | null; loading?: boolean }) {
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={40} />)}
      </div>
    );
  }
  if (!rows || rows.length === 0) {
    return (
      <p role="status" style={{ color: C.faint, fontSize: 13, margin: 0, padding: '12px 0', fontStyle: 'italic' }}>
        No packages match the selected filters.
      </p>
    );
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', minWidth: 480 }}
        aria-label="OSS packages"
      >
        <thead>
          <tr style={{ background: C.panelAlt }}>
            {['Kind', 'Package', 'Version', 'Status'].map((h) => (
              <th key={h} scope="col" style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((pkg) => (
            <tr key={pkg.name} style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={tdStyle}>
                <span title={pkg.kind}>{KIND_EMOJI[pkg.kind] ?? '📦'} {pkg.kind}</span>
              </td>
              <td style={tdStyle}>
                <strong style={{ color: C.text, fontFamily: C.mono, fontSize: 11 }}>{pkg.name}</strong>
                {pkg.description && (
                  <div style={{ color: C.faint, fontSize: 11, marginTop: 3, fontFamily: 'inherit' }}>
                    {pkg.description}
                  </div>
                )}
              </td>
              <td style={{ ...tdStyle, fontFamily: C.mono, fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>
                {pkg.version}
              </td>
              <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                <Badge label={pkg.status} color={STATUS_COLOR[pkg.status] ?? C.muted} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── main page ──────────────────────────────────────────────────────────── */

export default function OssRegistryPage() {
  const [summary, setSummary] = useState<OssSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [packages, setPackages] = useState<OssPackage[] | null>(null);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      setFetchError(null);
      const [sRes, pRes] = await Promise.all([
        jsonFetch<OssSummary>('/api/oss-registry/'),
        jsonFetch<OssPackage[]>('/api/oss-registry/packages'),
      ]);
      if (cancelled) return;
      if (!sRes.ok || !pRes.ok) {
        setFetchError('Failed to load registry data from the server.');
      }
      setSummary(sRes.data);
      setPackages(pRes.data ?? []);
      setSummaryLoading(false);
      setPackagesLoading(false);
    };
    void refresh();
    const id = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPackagesLoading(true);
    (async () => {
      const params = new URLSearchParams();
      if (kindFilter) params.set('kind', kindFilter);
      if (statusFilter) params.set('status', statusFilter);
      const qs = params.toString();
      const res = await jsonFetch<OssPackage[]>(`/api/oss-registry/packages${qs ? `?${qs}` : ''}`);
      if (cancelled) return;
      setPackages(res.data ?? []);
      setPackagesLoading(false);
    })();
    return () => { cancelled = true; };
  }, [kindFilter, statusFilter]);

  const kindEntries = summary ? Object.entries(summary.kindBreakdown) : [];
  const statusEntries = summary ? Object.entries(summary.statusBreakdown) : [];

  const selectStyle: React.CSSProperties = {
    background: C.panelAlt,
    border: `1px solid ${C.border}`,
    borderRadius: 6,
    color: C.text,
    padding: '6px 10px',
    fontSize: 12,
    outline: 'none',
    cursor: 'pointer',
  };

  return (
    <>
      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @media (max-width: 640px) {
          .oss-summary-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>

      <div
        style={{
          background: C.bg,
          minHeight: '100vh',
          padding: '24px 20px',
          color: C.text,
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 4 }}>
            Open-Source Registry
          </h1>
          <p style={{ color: C.muted, fontSize: 13, marginBottom: 20 }}>
            CAIA published packages and apps available for open-source use.
          </p>

          {fetchError && (
            <div
              role="alert"
              style={{
                color: C.danger,
                background: `${C.danger}15`,
                border: `1px solid ${C.danger}40`,
                borderRadius: 6,
                padding: '10px 14px',
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {fetchError}
            </div>
          )}

          {/* ── Summary panel ── */}
          <Panel id="oss-summary-heading" title="Registry Summary">
            <div
              className="oss-summary-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 12,
                marginBottom: 16,
              }}
            >
              <StatCard label="Total Packages" value={summary?.totalPackages ?? 0} loading={summaryLoading} />
              <StatCard label="Apps" value={summary?.kindBreakdown['app'] ?? 0} loading={summaryLoading} />
              <StatCard label="Libraries" value={summary?.kindBreakdown['package'] ?? 0} loading={summaryLoading} />
              <StatCard
                label="Last Updated"
                value={summary?.lastUpdated ? new Date(summary.lastUpdated).toLocaleDateString() : '—'}
                loading={summaryLoading}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <BreakdownList
                label="By Kind"
                entries={kindEntries}
                loading={summaryLoading}
              />
              <BreakdownList
                label="By Status"
                entries={statusEntries}
                loading={summaryLoading}
              />
            </div>
          </Panel>

          {/* ── Package browser ── */}
          <Panel id="oss-packages-heading" title="Package Browser">
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ color: C.faint, fontSize: 11 }}>
                Kind
                <select
                  value={kindFilter}
                  onChange={(e) => setKindFilter(e.target.value)}
                  style={{ ...selectStyle, marginLeft: 6 }}
                  aria-label="Filter by kind"
                >
                  <option value="">All</option>
                  <option value="app">app</option>
                  <option value="package">package</option>
                </select>
              </label>

              <label style={{ color: C.faint, fontSize: 11 }}>
                Status
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{ ...selectStyle, marginLeft: 6 }}
                  aria-label="Filter by status"
                >
                  <option value="">All</option>
                  <option value="stable">stable</option>
                  <option value="beta">beta</option>
                  <option value="alpha">alpha</option>
                </select>
              </label>

              {(kindFilter || statusFilter) && (
                <button
                  onClick={() => { setKindFilter(''); setStatusFilter(''); }}
                  style={{
                    background: 'transparent',
                    border: `1px solid ${C.border}`,
                    borderRadius: 6,
                    color: C.muted,
                    padding: '4px 10px',
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  Clear filters
                </button>
              )}
            </div>

            <PackageTable rows={packages} loading={packagesLoading} />
          </Panel>
        </div>
      </div>
    </>
  );
}
