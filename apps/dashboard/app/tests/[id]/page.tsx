'use client';
import { useState, useEffect } from 'react';
import { use } from 'react';
import Link from 'next/link';

interface BehaviorTest {
  id: string;
  name: string;
  feature: string;
  scope: string;
  projectSlug?: string;
  domainSlugs: string;
  sourcePath?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  expectedBehavior: string;
  layoutContract?: string;
  notes?: string;
}

interface BehaviorTestRun {
  id: number;
  testId: string;
  runAt: string;
  durationMs?: number;
  status: 'pass' | 'fail' | 'skip' | 'flaky';
  evidenceUrl?: string;
  failureExcerpt?: string;
  gitSha?: string;
  ci: boolean;
  failures?: Array<{
    id: number;
    kind: string;
    message: string;
    stackExcerpt?: string;
    conductorBlockerId?: string;
  }>;
}

const STATUS_COLOR: Record<string, string> = {
  pass: '#68d391', fail: '#fc8181', skip: '#718096', flaky: '#f6ad55', never: '#4a5568',
};

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function RunTimeline({ runs }: { runs: BehaviorTestRun[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {runs.map(run => {
        const color = STATUS_COLOR[run.status] ?? STATUS_COLOR.never;
        return (
          <div
            key={run.id}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '10px 14px', borderRadius: 6,
              background: '#1a1f2e', borderLeft: `3px solid ${color}`,
              border: `1px solid #2d3748`, borderLeftColor: color,
            }}
          >
            <span style={{ color, fontWeight: 700, fontSize: 14, flexShrink: 0 }}>
              {run.status === 'pass' ? '✓' : run.status === 'fail' ? '✗' : run.status === 'flaky' ? '⚡' : '◌'}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color, fontWeight: 600 }}>{run.status.toUpperCase()}</span>
                {run.durationMs && (
                  <span style={{ fontSize: 11, color: '#718096' }}>{run.durationMs}ms</span>
                )}
                {run.ci && <span style={{ fontSize: 10, background: '#2d3748', color: '#a0aec0', borderRadius: 3, padding: '1px 5px' }}>CI</span>}
                {run.gitSha && (
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#718096' }}>{run.gitSha.slice(0, 8)}</span>
                )}
                {run.evidenceUrl && (
                  <a href={run.evidenceUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: '#63b3ed' }}>
                    evidence ↗
                  </a>
                )}
              </div>
              {run.failureExcerpt && (
                <pre style={{
                  margin: '6px 0 0', fontSize: 11, color: '#fc8181',
                  background: '#2d1515', border: '1px solid #742a2a',
                  borderRadius: 4, padding: '6px 8px',
                  overflow: 'auto', maxHeight: 120, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                }}>
                  {run.failureExcerpt}
                </pre>
              )}
              {run.failures && run.failures.length > 0 && run.failures.map(f => (
                <div key={f.id} style={{ marginTop: 4, fontSize: 11, color: '#f6ad55' }}>
                  [{f.kind}] {f.message}
                  {f.conductorBlockerId && (
                    <Link
                      href={`/blockers/${f.conductorBlockerId}`}
                      style={{ marginLeft: 6, color: '#63b3ed', textDecoration: 'none' }}
                    >
                      → blocker
                    </Link>
                  )}
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: '#718096', flexShrink: 0 }}>
              <time dateTime={run.runAt} title={new Date(run.runAt).toLocaleString()}>
                {relativeTime(run.runAt)}
              </time>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function TestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [test, setTest] = useState<BehaviorTest | null>(null);
  const [runs, setRuns] = useState<BehaviorTestRun[]>([]);
  const [isFlaky, setIsFlaky] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/behavior-tests/${id}/runs?limit=50`);
        if (res.ok) {
          const data = await res.json() as { test: BehaviorTest; runs: BehaviorTestRun[]; is_flaky: boolean };
          setTest(data.test);
          setRuns(data.runs);
          setIsFlaky(data.is_flaky);
        }
      } catch { /* ignore */ }
      finally { setLoading(false); }
    }
    void load();
  }, [id]);

  if (loading) return <div style={{ color: '#718096', padding: 32 }}>Loading…</div>;
  if (!test) return <div style={{ color: '#fc8181', padding: 32 }}>Test not found.</div>;

  let parsedContract: Record<string, unknown> | null = null;
  if (test.layoutContract) {
    try { parsedContract = JSON.parse(test.layoutContract) as Record<string, unknown>; } catch { /* ignore */ }
  }

  let domainList: string[] = [];
  try { domainList = JSON.parse(test.domainSlugs) as string[]; } catch { /* ignore */ }

  const lastStatus = runs[0]?.status ?? 'never';
  const passCount = runs.filter(r => r.status === 'pass').length;
  const failCount = runs.filter(r => r.status === 'fail').length;

  return (
    <div>
      {/* Back link */}
      <Link href="/tests" style={{ fontSize: 13, color: '#63b3ed', textDecoration: 'none', display: 'inline-block', marginBottom: 16 }}>
        ← Back to Tests
      </Link>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#f0f4f8' }}>{test.name}</h1>
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 10,
              background: `${STATUS_COLOR[lastStatus]}22`, color: STATUS_COLOR[lastStatus],
              border: `1px solid ${STATUS_COLOR[lastStatus]}55`, fontWeight: 700,
            }}>
              {lastStatus.toUpperCase()}
            </span>
            {isFlaky && (
              <span style={{ fontSize: 11, background: '#3d2a00', color: '#f6ad55', border: '1px solid #f6ad5544', borderRadius: 10, padding: '2px 8px' }}>
                ⚡ FLAKY
              </span>
            )}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#718096', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span>Feature: <strong style={{ color: '#90cdf4' }}>{test.feature}</strong></span>
            <span>·</span>
            <span>Scope: <code style={{ fontSize: 11, color: '#e2e8f0' }}>{test.scope}</code></span>
            {test.projectSlug && <><span>·</span><span>Project: <strong style={{ color: '#90cdf4' }}>{test.projectSlug}</strong></span></>}
            {test.sourcePath && <><span>·</span><code style={{ fontSize: 10, color: '#718096' }}>{test.sourcePath}</code></>}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Total Runs', value: runs.length, color: '#90cdf4' },
          { label: 'Pass Count', value: passCount, color: '#68d391' },
          { label: 'Fail Count', value: failCount, color: failCount > 0 ? '#fc8181' : '#718096' },
          { label: 'Last Seen',  value: relativeTime(test.lastSeenAt), color: '#a0aec0' },
        ].map(s => (
          <div key={s.label} style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8, padding: '12px 16px' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Expected behavior */}
      <section aria-labelledby="expected-heading" style={{ marginBottom: 20 }}>
        <h2 id="expected-heading" style={{ fontSize: 14, fontWeight: 600, color: '#a0aec0', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
          Expected Behavior
        </h2>
        <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8, padding: '14px 16px', fontSize: 14, color: '#e2e8f0', lineHeight: 1.6 }}>
          {test.expectedBehavior}
        </div>
      </section>

      {/* Layout contract */}
      {parsedContract && (
        <section aria-labelledby="contract-heading" style={{ marginBottom: 20 }}>
          <h2 id="contract-heading" style={{ fontSize: 14, fontWeight: 600, color: '#a0aec0', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            Layout Contract
          </h2>
          <pre style={{
            background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8,
            padding: '14px 16px', fontSize: 12, color: '#68d391',
            overflow: 'auto', margin: 0,
          }}>
            {JSON.stringify(parsedContract, null, 2)}
          </pre>
        </section>
      )}

      {/* Domain tags */}
      {domainList.length > 0 && (
        <div style={{ marginBottom: 20, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {domainList.map(d => (
            <Link key={d} href={`/domains/${d}`} style={{ fontSize: 10, background: '#1a2744', color: '#63b3ed', borderRadius: 3, padding: '2px 7px', textDecoration: 'none', border: '1px solid #63b3ed33' }}>
              {d}
            </Link>
          ))}
        </div>
      )}

      {/* Notes */}
      {test.notes && (
        <section style={{ marginBottom: 20 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: '#a0aec0', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Notes</h2>
          <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8, padding: '14px 16px', fontSize: 13, color: '#a0aec0' }}>
            {test.notes}
          </div>
        </section>
      )}

      {/* Run timeline */}
      <section aria-labelledby="runs-heading">
        <h2 id="runs-heading" style={{ fontSize: 14, fontWeight: 600, color: '#a0aec0', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
          Run History ({runs.length})
        </h2>
        {runs.length === 0 ? (
          <div style={{ color: '#718096', textAlign: 'center', padding: 32, background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 8 }}>
            No runs recorded yet. Run the gate to populate history.
          </div>
        ) : (
          <RunTimeline runs={runs} />
        )}
      </section>
    </div>
  );
}
