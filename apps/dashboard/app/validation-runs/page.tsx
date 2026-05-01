'use client';
import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useWebSocket } from '../../hooks/useWebSocket';

type ScenarioStatus = 'passed' | 'stalled' | 'failed' | 'running';

interface ValidationScenario {
  index: number;
  tag: string;
  prompt: string;
  status: ScenarioStatus;
  storyCount?: number;
  errorReason?: string;
}

interface ValidationRun {
  id: string;
  runAt: string;
  promptCount: number;
  scenarios: ValidationScenario[];
  summary: { passed: number; stalled: number; failed: number };
}

const SCENARIO_STATUS_CONFIG: Record<ScenarioStatus, { color: string; shape: string; label: string; bg: string }> = {
  passed:  { color: '#68d391', shape: '✓', label: 'Passed',  bg: '#1a3320' },
  stalled: { color: '#f6ad55', shape: '⏸', label: 'Stalled', bg: '#3d2a00' },
  failed:  { color: '#fc8181', shape: '✗', label: 'Failed',  bg: '#3d1515' },
  running: { color: '#90cdf4', shape: '▶', label: 'Running', bg: '#1a2744' },
};

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function SummaryBadge({ label, count, color, bg }: { label: string; count: number; color: string; bg: string }) {
  return (
    <span
      style={{
        fontSize: 12,
        background: bg,
        color,
        border: `1px solid ${color}40`,
        borderRadius: 12,
        padding: '2px 10px',
        fontWeight: 600,
      }}
    >
      {label}: {count}
    </span>
  );
}

function ScenarioRow({ scenario }: { scenario: ValidationScenario }) {
  const cfg = SCENARIO_STATUS_CONFIG[scenario.status] ?? SCENARIO_STATUS_CONFIG.failed;
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '8px 12px',
        background: cfg.bg,
        border: `1px solid #2d3748`,
        borderLeft: `3px solid ${cfg.color}`,
        borderRadius: 5,
        marginBottom: 4,
      }}
      aria-label={`Scenario ${scenario.index}: ${scenario.tag} — ${cfg.label}`}
    >
      <span
        style={{ color: cfg.color, fontSize: 14, fontWeight: 700, flexShrink: 0, marginTop: 1 }}
        aria-hidden="true"
        title={cfg.label}
      >
        {cfg.shape}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#cbd5e0' }}>#{scenario.index}</span>
          <span
            style={{
              fontSize: 11,
              background: '#2d3748',
              color: '#90cdf4',
              borderRadius: 3,
              padding: '1px 6px',
              fontFamily: 'monospace',
            }}
          >
            {scenario.tag}
          </span>
          {scenario.storyCount !== undefined && (
            <span style={{ fontSize: 11, color: '#68d391' }}>{scenario.storyCount} stories</span>
          )}
        </div>
        <div style={{ fontSize: 12, color: '#a0aec0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {scenario.prompt}
        </div>
        {scenario.errorReason && (
          <div style={{ fontSize: 11, color: '#fc8181', marginTop: 3 }}>{scenario.errorReason}</div>
        )}
      </div>
      <span style={{ fontSize: 11, color: cfg.color, flexShrink: 0, fontWeight: 600 }}>{cfg.label}</span>
    </li>
  );
}

function ValidationRunCard({ run, isExpanded, onToggle }: {
  run: ValidationRun;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { passed, stalled, failed } = run.summary;
  const total = run.promptCount;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
  const healthColor = passRate >= 80 ? '#68d391' : passRate >= 50 ? '#f6ad55' : '#fc8181';

  return (
    <article
      style={{
        background: '#1a1f2e',
        border: '1px solid #2d3748',
        borderRadius: 8,
        marginBottom: 12,
        overflow: 'hidden',
      }}
      aria-label={`Validation run ${run.id}`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          padding: '12px 16px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'inherit',
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: '#90cdf4', flex: 1 }}
        >
          {run.id}
        </span>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <SummaryBadge label="✓" count={passed} color="#68d391" bg="#1a3320" />
          {stalled > 0 && <SummaryBadge label="⏸" count={stalled} color="#f6ad55" bg="#3d2a00" />}
          {failed > 0 && <SummaryBadge label="✗" count={failed} color="#fc8181" bg="#3d1515" />}
        </div>

        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: healthColor,
            minWidth: 48,
            textAlign: 'right',
          }}
          aria-label={`Pass rate: ${passRate}%`}
        >
          {passRate}%
        </span>

        <time
          dateTime={run.runAt}
          title={new Date(run.runAt).toLocaleString()}
          style={{ fontSize: 11, color: '#718096', flexShrink: 0 }}
        >
          {relativeTime(run.runAt)}
        </time>

        <span
          style={{ fontSize: 10, color: '#718096', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.15s' }}
          aria-hidden="true"
        >
          ▶
        </span>
      </button>

      {isExpanded && (
        <div style={{ padding: '0 16px 16px' }}>
          <div
            role="progressbar"
            aria-valuenow={passed}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-label={`${passed} of ${total} scenarios passed`}
            style={{
              height: 4,
              background: '#2d3748',
              borderRadius: 2,
              overflow: 'hidden',
              marginBottom: 12,
            }}
          >
            <div style={{ width: `${passRate}%`, height: '100%', background: healthColor, transition: 'width 0.3s ease' }} />
          </div>

          {run.scenarios.length === 0 ? (
            <p style={{ color: '#718096', fontSize: 13 }}>No scenario data available.</p>
          ) : (
            <ul
              role="list"
              aria-label={`Scenarios for ${run.id}`}
              style={{ listStyle: 'none', padding: 0, margin: 0 }}
            >
              {run.scenarios.map(s => (
                <ScenarioRow key={s.index} scenario={s} />
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

function ValidationRunsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { connected } = useWebSocket('ws://localhost:7776/events');

  const [runs, setRuns] = useState<ValidationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');

  const search = searchParams.get('search') ?? '';

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/validation-runs');
      if (res.ok) {
        const data = await res.json() as ValidationRun[];
        setRuns(Array.isArray(data) ? data : []);
        // Auto-expand the first run so users see content immediately
        if (Array.isArray(data) && data.length > 0 && expandedIds.size === 0) {
          setExpandedIds(new Set([data[0]!.id]));
        }
        setAnnouncement(`Loaded ${data.length} validation runs`);
        setTimeout(() => setAnnouncement(''), 2000);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { void loadRuns(); }, [loadRuns]);

  function toggleExpanded(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function setSearchFilter(value: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (value) p.set('search', value); else p.delete('search');
    router.push(`/validation-runs?${p.toString()}`);
  }

  const filtered = runs.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.id.toLowerCase().includes(q) ||
      r.scenarios.some(s => s.tag.toLowerCase().includes(q) || s.prompt.toLowerCase().includes(q));
  });

  const totalPassed = filtered.reduce((s, r) => s + r.summary.passed, 0);
  const totalStalled = filtered.reduce((s, r) => s + r.summary.stalled, 0);
  const totalFailed = filtered.reduce((s, r) => s + r.summary.failed, 0);

  return (
    <div>
      <div aria-live="polite" aria-atomic="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
        {announcement}
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>🧬 Validation Runs</h1>
        <span style={{ fontSize: 12, color: connected ? '#68d391' : '#fc8181' }}>
          {connected ? '● live' : '○ offline'}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => void loadRuns()}
          style={{ background: '#2d3748', color: '#a0aec0', border: '1px solid #4a5568', borderRadius: 4, padding: '5px 12px', cursor: 'pointer', fontSize: 13 }}
        >
          Refresh
        </button>
      </div>

      {/* Aggregate summary */}
      {!loading && filtered.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <SummaryBadge label="Passed" count={totalPassed} color="#68d391" bg="#1a3320" />
          {totalStalled > 0 && <SummaryBadge label="Stalled" count={totalStalled} color="#f6ad55" bg="#3d2a00" />}
          {totalFailed > 0 && <SummaryBadge label="Failed" count={totalFailed} color="#fc8181" bg="#3d1515" />}
          <span style={{ fontSize: 12, color: '#718096', alignSelf: 'center' }}>{filtered.length} run{filtered.length !== 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Search */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <input
          type="search"
          placeholder="Filter by run ID or tag…"
          value={search}
          onChange={e => setSearchFilter(e.target.value)}
          aria-label="Search validation runs"
          style={{
            background: '#2d3748',
            color: '#e2e8f0',
            border: '1px solid #4a5568',
            borderRadius: 4,
            padding: '4px 10px',
            fontSize: 13,
            width: 280,
          }}
        />
        {search && (
          <button
            onClick={() => setSearchFilter('')}
            style={{ background: '#742a2a', color: '#fed7d7', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 13 }}
          >
            Clear ×
          </button>
        )}
      </div>

      {/* Runs list */}
      {loading ? (
        <div style={{ color: '#718096', padding: 32, textAlign: 'center' }}>Loading validation runs…</div>
      ) : filtered.length === 0 ? (
        <div style={{ color: '#718096', padding: 32, textAlign: 'center' }}>
          {search ? 'No runs match the filter.' : 'No validation runs recorded yet.'}
        </div>
      ) : (
        <section aria-label="Validation runs">
          {filtered.map(run => (
            <ValidationRunCard
              key={run.id}
              run={run}
              isExpanded={expandedIds.has(run.id)}
              onToggle={() => toggleExpanded(run.id)}
            />
          ))}
        </section>
      )}
    </div>
  );
}

export default function ValidationRunsPage() {
  return (
    <Suspense fallback={<div style={{ color: '#718096', padding: 32 }}>Loading validation runs…</div>}>
      <ValidationRunsContent />
    </Suspense>
  );
}
