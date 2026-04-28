'use client';
import useSWR from 'swr';

/**
 * DASH-314 — Quality dashboard (replaces retired conductor-specific
 * /coverage page).
 *
 * Aggregates orchestrator-level quality signals into a single view:
 *   - completeness summary (passing / failing entities, overall score)
 *   - completeness findings count by severity
 *   - test runs (behavior_tests if any) — currently a TODO until
 *     CI emits per-package coverage artifacts (DASH-314 Phase 2)
 *   - blocked tasks count
 *
 * The conductor-only `/coverage` page (which read a Jest/Istanbul
 * coverage-summary.json from `dashboard/public/reports/coverage/`) is
 * not appropriate at a CAIA-wide level — per-package coverage from CI
 * artifacts is a separate workstream tracked by DASH-314 Phase 2.
 */
const fetcher = (url: string) => fetch(url).then(r => r.json());

interface CompletenessSummary {
  total: number;
  passing: number;
  failing: number;
}
interface Finding {
  severity: string;
}
interface Metrics {
  totalTasks: number;
  completedTasks: number;
  totalRequirements: number;
  openBlockers: number;
}

function StatCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div style={{
      background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8,
      padding: 20, textAlign: 'center',
    }}>
      <div style={{ fontSize: 32, fontWeight: 700, color: color ?? '#e2e8f0' }}>{value}</div>
      <div style={{ fontSize: 12, color: '#718096', marginTop: 4 }}>{label}</div>
    </div>
  );
}

export default function QualityPage() {
  const { data: summary } = useSWR<CompletenessSummary>(
    '/api/completeness-summary-proxy', fetcher, { refreshInterval: 60000 }
  );
  const { data: findings } = useSWR<Finding[]>(
    '/api/completeness-findings-proxy', fetcher, { refreshInterval: 60000 }
  );
  const { data: metrics } = useSWR<Metrics>('/api/metrics', fetcher, { refreshInterval: 60000 });

  const overallScore = summary && summary.total > 0
    ? Math.round((summary.passing / summary.total) * 100) : 0;
  const completionPct = metrics && metrics.totalTasks > 0
    ? Math.round((metrics.completedTasks / metrics.totalTasks) * 100) : 0;

  const findingsBySeverity = (findings ?? []).reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, color: '#90cdf4' }}>📊 Quality</h1>
        <span style={{ color: '#718096', fontSize: 14 }}>
          orchestrator-wide quality signals
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 24 }}>
        <StatCard
          label="Completeness Score"
          value={summary ? `${overallScore}%` : '—'}
          color={overallScore >= 80 ? '#68d391' : overallScore >= 50 ? '#f6ad55' : '#fc8181'}
        />
        <StatCard label="Passing Entities" value={summary?.passing ?? '—'} color="#68d391" />
        <StatCard label="Failing Entities" value={summary?.failing ?? '—'} color="#fc8181" />
        <StatCard
          label="Task Completion"
          value={metrics ? `${completionPct}%` : '—'}
          color={completionPct >= 50 ? '#68d391' : '#f6ad55'}
        />
        <StatCard label="Open Blockers" value={metrics?.openBlockers ?? '—'} color="#fc8181" />
      </div>

      <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, color: '#e2e8f0', margin: '0 0 12px' }}>Findings by severity</h2>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {(['critical', 'warning', 'info'] as const).map(sev => (
            <div key={sev}>
              <span style={{
                background: sev === 'critical' ? '#fc8181' : sev === 'warning' ? '#f6ad55' : '#68d391',
                color: '#1a202c',
                borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700,
                textTransform: 'uppercase', marginRight: 8,
              }}>{sev}</span>
              <span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>
                {findingsBySeverity[sev] ?? 0}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8, padding: 16, color: '#a0aec0', fontSize: 13 }}>
        <strong style={{ color: '#90cdf4' }}>Phase 2 (planned):</strong> per-package coverage from
        CI artifacts (replaces the retired conductor-specific <code>/coverage</code> page). Until CI
        emits coverage-summary.json artifacts that aggregate across the workspace, this page
        surfaces orchestrator-wide quality signals only.
      </div>
    </div>
  );
}
