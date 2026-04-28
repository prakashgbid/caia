'use client';
import useSWR from 'swr';
import { useEffect, useRef, useState } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';

const fetcher = (url: string) => fetch(url).then(r => r.json());

// DASH-305: kinds that should trigger a /completeness mutate when seen on
// the WS. Covers the full sentinel lifecycle so users see fresh data
// within ~250 ms of a run completing instead of up to a minute later.
const COMPLETENESS_REFRESH_KINDS = new Set<string>([
  'completeness.run_started',
  'completeness.run_completed',
  'completeness.finding_filed',
  'completeness.check.completed',
]);

interface RunSummary {
  id: number;
  runAt: string;
  entityKind: string;
  entityId: string;
  checksTotal: number;
  checksPassed: number;
  scorePct: number;
  status: string;
  durationMs: number | null;
}

interface Finding {
  id: number;
  runId: number;
  entityKind: string;
  entityId: string;
  checkKind: string;
  expected: string;
  actual: string;
  severity: string;
  message: string;
  evidenceUrl: string | null;
}

interface SummaryData {
  entities: RunSummary[];
  total: number;
  passing: number;
  failing: number;
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#fc8181',
  warning: '#f6ad55',
  info: '#68d391',
};

const STATUS_COLOR: Record<string, string> = {
  pass: '#68d391',
  fail: '#fc8181',
  error: '#f6ad55',
  pending: '#a0aec0',
};

function ScoreBar({ pct, status }: { pct: number; status: string }) {
  const color = status === 'pass' ? '#68d391' : status === 'fail' ? '#fc8181' : '#f6ad55';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: '#2d3748', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 12, color, fontWeight: 600, minWidth: 36, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

export default function CompletenessPage() {
  // DASH-305: WS-driven refresh replaces 60s polling. Drop the SWR
  // refreshInterval and instead call mutate() when a completeness.* event
  // arrives. Keep a long fallback interval (5 min) only as a belt-and-
  // braces guard for the WS being down for an extended period.
  const FALLBACK_MS = 5 * 60 * 1000;
  const { data: summary, isLoading: loadingSummary, mutate: mutateSummary } = useSWR<SummaryData>('/api/completeness-summary-proxy', fetcher, { refreshInterval: FALLBACK_MS });
  const { data: findings, mutate: mutateFindings } = useSWR<Finding[]>('/api/completeness-findings-proxy', fetcher, { refreshInterval: FALLBACK_MS });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { data: runs, mutate: mutateRuns } = useSWR<RunSummary[]>('/api/completeness-runs-proxy', fetcher, { refreshInterval: FALLBACK_MS });

  const [severityFilter, setSeverityFilter] = useState('');
  const [entityKindFilter, setEntityKindFilter] = useState('');
  const [liveTick, setLiveTick] = useState(0);

  const { lastEvent, connected } = useWebSocket('ws://localhost:7776/events');
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!lastEvent?.kind) return;
    if (!COMPLETENESS_REFRESH_KINDS.has(lastEvent.kind)) return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      setLiveTick(t => t + 1);
      void mutateSummary();
      void mutateFindings();
      void mutateRuns();
    }, 250);
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [lastEvent, mutateSummary, mutateFindings, mutateRuns]);

  const allFindings = findings ?? [];
  const filteredFindings = allFindings
    .filter(f => !severityFilter || f.severity === severityFilter)
    .filter(f => !entityKindFilter || f.entityKind === entityKindFilter)
    .slice(0, 100);

  const entityKinds = [...new Set(allFindings.map(f => f.entityKind))];

  const overallScore = summary && summary.total > 0
    ? Math.round((summary.passing / summary.total) * 100)
    : 0;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, color: '#90cdf4' }}>✅ Completeness</h1>
        <span style={{ color: '#718096', fontSize: 14 }}>trust-nothing verification</span>
        <span
          data-test-live-indicator
          data-live-tick={liveTick}
          title={connected ? 'Subscribed to completeness.* events' : 'Reconnecting to event stream'}
          style={{ color: connected ? '#68d391' : '#fc8181', fontSize: 11, marginLeft: 'auto' }}
        >
          {connected ? '● live' : '○ reconnecting'}
        </span>
      </div>

      {/* Overall score card */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8, padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 36, fontWeight: 700, color: overallScore >= 80 ? '#68d391' : overallScore >= 50 ? '#f6ad55' : '#fc8181' }}>
            {loadingSummary ? '—' : `${overallScore}%`}
          </div>
          <div style={{ fontSize: 12, color: '#718096', marginTop: 4 }}>Overall Score</div>
        </div>
        <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8, padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 36, fontWeight: 700, color: '#e2e8f0' }}>{summary?.total ?? '—'}</div>
          <div style={{ fontSize: 12, color: '#718096', marginTop: 4 }}>Total Entities</div>
        </div>
        <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8, padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 36, fontWeight: 700, color: '#68d391' }}>{summary?.passing ?? '—'}</div>
          <div style={{ fontSize: 12, color: '#718096', marginTop: 4 }}>Passing</div>
        </div>
        <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8, padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 36, fontWeight: 700, color: '#fc8181' }}>{summary?.failing ?? '—'}</div>
          <div style={{ fontSize: 12, color: '#718096', marginTop: 4 }}>Failing</div>
        </div>
      </div>

      {/* Entity score matrix */}
      {summary && summary.entities.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, color: '#e2e8f0', margin: '0 0 12px' }}>Entity Scores</h2>
          <div data-test-region="entity-matrix" style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2d3748' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#718096', fontWeight: 600 }}>Entity</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#718096', fontWeight: 600 }}>Kind</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#718096', fontWeight: 600 }}>Score</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#718096', fontWeight: 600 }}>Status</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', color: '#718096', fontWeight: 600 }}>Last Run</th>
                </tr>
              </thead>
              <tbody>
                {summary.entities.slice(0, 50).map((e) => (
                  <tr key={`${e.entityKind}-${e.entityId}`} style={{ borderBottom: '1px solid #1a1f2e' }}>
                    <td style={{ padding: '8px 12px', color: '#e2e8f0', fontFamily: 'monospace', fontSize: 11 }}>
                      {e.entityId.slice(0, 12)}...
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ background: '#2d3748', borderRadius: 4, padding: '2px 6px', fontSize: 11, color: '#a0aec0' }}>
                        {e.entityKind}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', minWidth: 120 }}>
                      <ScoreBar pct={e.scorePct} status={e.status} />
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ color: STATUS_COLOR[e.status] ?? '#a0aec0', fontWeight: 600, fontSize: 12 }}>
                        {e.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', color: '#718096', fontSize: 11 }}>
                      {new Date(e.runAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Findings list */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <h2 style={{ fontSize: 16, color: '#e2e8f0', margin: 0 }}>Open Findings ({allFindings.length})</h2>
          <select
            value={severityFilter}
            onChange={e => setSeverityFilter(e.target.value)}
            style={{ background: '#1a1f2e', border: '1px solid #4a5568', color: '#e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}
            aria-label="Filter by severity"
          >
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
          <select
            value={entityKindFilter}
            onChange={e => setEntityKindFilter(e.target.value)}
            style={{ background: '#1a1f2e', border: '1px solid #4a5568', color: '#e2e8f0', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}
            aria-label="Filter by entity kind"
          >
            <option value="">All kinds</option>
            {entityKinds.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>

        {filteredFindings.length === 0 ? (
          <div data-empty-state style={{ color: '#68d391', padding: 32, textAlign: 'center', border: '1px dashed #4a5568', borderRadius: 8 }}>
            No findings matching filters. Run the completeness sentinel to generate findings.
          </div>
        ) : (
          <div data-test-region="findings-list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filteredFindings.map(f => (
              <div key={f.id} style={{
                background: '#1a1f2e',
                border: `1px solid ${SEVERITY_COLOR[f.severity] ?? '#4a5568'}44`,
                borderLeft: `3px solid ${SEVERITY_COLOR[f.severity] ?? '#4a5568'}`,
                borderRadius: 6,
                padding: '10px 14px',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: SEVERITY_COLOR[f.severity] + '22',
                    color: SEVERITY_COLOR[f.severity],
                    textTransform: 'uppercase',
                    flexShrink: 0,
                    marginTop: 2,
                  }}>
                    {f.severity}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: '#e2e8f0', marginBottom: 4 }}>{f.message}</div>
                    <div style={{ fontSize: 11, color: '#718096' }}>
                      <span style={{ marginRight: 12 }}>
                        <span style={{ color: '#4a5568' }}>kind:</span> {f.entityKind}/{f.entityId.slice(0, 12)}
                      </span>
                      <span style={{ marginRight: 12 }}>
                        <span style={{ color: '#4a5568' }}>check:</span> {f.checkKind}
                      </span>
                      {f.evidenceUrl && (
                        <a href={f.evidenceUrl} style={{ color: '#90cdf4', fontSize: 11 }} target="_blank" rel="noopener noreferrer">
                          evidence →
                        </a>
                      )}
                    </div>
                    {f.expected !== f.actual && (
                      <div style={{ marginTop: 4, fontSize: 11, fontFamily: 'monospace' }}>
                        <span style={{ color: '#718096' }}>expected: </span>
                        <span style={{ color: '#68d391' }}>{f.expected.slice(0, 100)}</span>
                        <span style={{ color: '#718096', marginLeft: 8 }}>actual: </span>
                        <span style={{ color: '#fc8181' }}>{f.actual.slice(0, 100)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
