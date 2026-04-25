'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';

interface BehaviorTest {
  id: string;
  name: string;
  feature: string;
  scope: string;
  projectSlug?: string;
  domainSlugs: string;
  expectedBehavior: string;
  lastSeenAt: string;
  last_status?: string;
}

interface Coverage {
  total: number;
  passing: number;
  failing: number;
  skipped: number;
  flaky: number;
  pass_rate: number;
  byFeature: Record<string, { total: number; passing: number; failing: number; skipped: number }>;
  byProject: Record<string, { total: number; passing: number; failing: number }>;
  trend_7d: Record<string, { pass: number; fail: number }>;
}

const STATUS_COLOR: Record<string, string> = {
  pass:  '#68d391',
  fail:  '#fc8181',
  skip:  '#718096',
  flaky: '#f6ad55',
  never: '#4a5568',
};

const STATUS_LABEL: Record<string, string> = {
  pass: '✓ Pass', fail: '✗ Fail', skip: '◌ Skip', flaky: '⚡ Flaky', never: '— Never run',
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? STATUS_COLOR.never;
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 10,
      background: `${color}22`, color, border: `1px solid ${color}55`,
      fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function TrendBar({ data }: { data: Record<string, { pass: number; fail: number }> }) {
  const days = Object.keys(data).sort();
  if (days.length === 0) return <span style={{ color: '#718096', fontSize: 12 }}>No runs yet</span>;

  const maxTotal = Math.max(...days.map(d => (data[d].pass ?? 0) + (data[d].fail ?? 0)), 1);

  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 40 }} aria-label="7-day test trend">
      {days.slice(-14).map(day => {
        const pass = data[day].pass ?? 0;
        const fail = data[day].fail ?? 0;
        const total = pass + fail;
        const height = Math.round((total / maxTotal) * 36) + 4;
        const failPct = total > 0 ? (fail / total) * 100 : 0;
        return (
          <div
            key={day}
            title={`${day}: ${pass} pass, ${fail} fail`}
            style={{
              width: 16, height, borderRadius: 2, flexShrink: 0,
              background: `linear-gradient(to top, #fc8181 ${failPct}%, #68d391 ${failPct}%)`,
              opacity: 0.85,
            }}
          />
        );
      })}
    </div>
  );
}

function FeatureMatrix({ byFeature, tests }: { byFeature: Coverage['byFeature']; tests: BehaviorTest[] }) {
  const features = Object.keys(byFeature).sort();
  if (features.length === 0) return <p style={{ color: '#718096' }}>No tests registered yet.</p>;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} role="grid" aria-label="Feature coverage matrix">
      <thead>
        <tr style={{ borderBottom: '1px solid #2d3748' }}>
          <th style={{ textAlign: 'left', padding: '8px 12px', color: '#a0aec0', fontWeight: 600 }}>Feature</th>
          <th style={{ textAlign: 'right', padding: '8px 8px', color: '#a0aec0', fontWeight: 600 }}>Total</th>
          <th style={{ textAlign: 'right', padding: '8px 8px', color: '#68d391', fontWeight: 600 }}>Pass</th>
          <th style={{ textAlign: 'right', padding: '8px 8px', color: '#fc8181', fontWeight: 600 }}>Fail</th>
          <th style={{ textAlign: 'right', padding: '8px 8px', color: '#718096', fontWeight: 600 }}>Skip</th>
          <th style={{ textAlign: 'left', padding: '8px 12px', color: '#a0aec0', fontWeight: 600 }}>Tests</th>
        </tr>
      </thead>
      <tbody>
        {features.map(feat => {
          const stats = byFeature[feat];
          const featureTests = tests.filter(t => t.feature === feat);
          const passRate = stats.total > 0 ? Math.round((stats.passing / stats.total) * 100) : 0;
          const barColor = stats.failing > 0 ? '#fc8181' : stats.passing > 0 ? '#68d391' : '#718096';

          return (
            <tr key={feat} style={{ borderBottom: '1px solid #1e2533' }}>
              <td style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: `${passRate}%`, minWidth: 4, height: 6, background: barColor,
                    borderRadius: 3, transition: 'width 0.3s',
                    boxShadow: stats.failing > 0 ? `0 0 6px ${barColor}66` : 'none',
                  }} aria-hidden="true" />
                  <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{feat}</span>
                </div>
              </td>
              <td style={{ textAlign: 'right', padding: '10px 8px', color: '#a0aec0' }}>{stats.total}</td>
              <td style={{ textAlign: 'right', padding: '10px 8px', color: '#68d391', fontWeight: stats.passing > 0 ? 700 : 400 }}>{stats.passing}</td>
              <td style={{ textAlign: 'right', padding: '10px 8px', color: stats.failing > 0 ? '#fc8181' : '#4a5568', fontWeight: stats.failing > 0 ? 700 : 400 }}>{stats.failing}</td>
              <td style={{ textAlign: 'right', padding: '10px 8px', color: '#718096' }}>{stats.skipped ?? (stats.total - stats.passing - stats.failing)}</td>
              <td style={{ padding: '10px 12px' }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {featureTests.map(t => (
                    <Link
                      key={t.id}
                      href={`/tests/${t.id}`}
                      style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 4,
                        background: `${STATUS_COLOR[t.last_status ?? 'never']}22`,
                        color: STATUS_COLOR[t.last_status ?? 'never'],
                        border: `1px solid ${STATUS_COLOR[t.last_status ?? 'never']}44`,
                        textDecoration: 'none',
                        maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                      title={t.name}
                      aria-label={`${t.name}: ${t.last_status ?? 'never run'}`}
                    >
                      {t.name.slice(0, 30)}
                    </Link>
                  ))}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function TestsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [tests, setTests] = useState<BehaviorTest[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);

  const featureFilter  = searchParams.get('feature') ?? '';
  const statusFilter   = searchParams.get('status') ?? '';
  const projectFilter  = searchParams.get('project') ?? '';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [testsRes, covRes] = await Promise.all([
        fetch(`/api/behavior-tests?${new URLSearchParams({ ...(featureFilter && { feature: featureFilter }), ...(statusFilter && { status: statusFilter }), ...(projectFilter && { project: projectFilter }) }).toString()}`),
        fetch('/api/behavior-tests/coverage'),
      ]);
      if (testsRes.ok) setTests(await testsRes.json() as BehaviorTest[]);
      if (covRes.ok)   setCoverage(await covRes.json() as Coverage);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [featureFilter, statusFilter, projectFilter]);

  useEffect(() => { void load(); }, [load]);

  function setFilter(key: string, val: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (val) p.set(key, val); else p.delete(key);
    router.push(`/tests?${p.toString()}`);
  }

  const allFeatures = [...new Set(tests.map(t => t.feature))].sort();

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>🧪 Behavior Tests</h1>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => void load()}
          style={{ background: '#2d3748', color: '#a0aec0', border: '1px solid #4a5568', borderRadius: 4, padding: '5px 12px', cursor: 'pointer', fontSize: 13 }}
        >
          Refresh
        </button>
      </div>

      {/* Stat cards */}
      {coverage && (
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 12, marginBottom: 24 }}
          role="region"
          aria-label="Test coverage summary"
        >
          {[
            { label: 'Total Tests',  value: coverage.total,    color: '#90cdf4' },
            { label: 'Pass Rate',    value: `${coverage.pass_rate}%`, color: coverage.pass_rate >= 80 ? '#68d391' : '#fc8181' },
            { label: 'Passing',      value: coverage.passing,  color: '#68d391' },
            { label: 'Failing',      value: coverage.failing,  color: coverage.failing > 0 ? '#fc8181' : '#718096' },
            { label: 'Flaky',        value: coverage.flaky,    color: coverage.flaky > 0 ? '#f6ad55' : '#718096' },
            { label: 'Skipped',      value: coverage.skipped,  color: '#718096' },
          ].map(stat => (
            <div
              key={stat.label}
              style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8, padding: '12px 16px' }}
            >
              <div style={{ fontSize: 22, fontWeight: 700, color: stat.color }}>{stat.value}</div>
              <div style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* 7-day trend */}
      {coverage && Object.keys(coverage.trend_7d).length > 0 && (
        <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8, padding: '16px 20px', marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: '#718096', marginBottom: 10, fontWeight: 600 }}>7-DAY TREND</div>
          <TrendBar data={coverage.trend_7d} />
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          value={featureFilter}
          onChange={e => setFilter('feature', e.target.value)}
          aria-label="Filter by feature"
          style={{ background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
        >
          <option value="">All features</option>
          {allFeatures.map(f => <option key={f} value={f}>{f}</option>)}
        </select>

        <select
          value={statusFilter}
          onChange={e => setFilter('status', e.target.value)}
          aria-label="Filter by status"
          style={{ background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
        >
          <option value="">All statuses</option>
          {['pass', 'fail', 'skip', 'flaky', 'never'].map(s => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>

        {(featureFilter || statusFilter || projectFilter) && (
          <button
            onClick={() => router.push('/tests')}
            style={{ background: '#742a2a', color: '#fed7d7', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
          >
            Clear ×
          </button>
        )}
      </div>

      {/* Feature matrix */}
      {loading ? (
        <div style={{ color: '#718096', padding: 32, textAlign: 'center' }}>Loading…</div>
      ) : (
        <>
          {coverage && !featureFilter && !statusFilter && (
            <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8, padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: '#718096', marginBottom: 14, fontWeight: 600 }}>FEATURE × STATUS MATRIX</div>
              <FeatureMatrix byFeature={coverage.byFeature} tests={tests} />
            </div>
          )}

          {/* Flat test list when filtered */}
          {(featureFilter || statusFilter) && (
            <div role="list" aria-label="Behavior tests" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {tests.length === 0 ? (
                <div style={{ color: '#718096', textAlign: 'center', padding: 32 }}>No tests match these filters.</div>
              ) : tests.map(t => (
                <Link
                  key={t.id}
                  href={`/tests/${t.id}`}
                  role="listitem"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                    background: '#1a1f2e', border: '1px solid #2d3748',
                    borderLeft: `3px solid ${STATUS_COLOR[t.last_status ?? 'never']}`,
                    borderRadius: 6, textDecoration: 'none', color: 'inherit',
                  }}
                  aria-label={`${t.name}: ${t.last_status ?? 'never run'}`}
                >
                  <StatusBadge status={t.last_status ?? 'never'} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>
                      {t.feature} · {t.scope}
                    </div>
                  </div>
                  {t.projectSlug && (
                    <span style={{ fontSize: 10, background: '#2d3748', color: '#90cdf4', borderRadius: 3, padding: '1px 5px' }}>
                      {t.projectSlug}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function TestsPage() {
  return (
    <Suspense fallback={<div style={{ color: '#718096', padding: 32 }}>Loading tests…</div>}>
      <TestsContent />
    </Suspense>
  );
}
