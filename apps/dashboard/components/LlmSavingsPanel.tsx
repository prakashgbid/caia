'use client';
// LAI-006 — Token-savings dashboard panel.
//
// Polls /api/llm-metrics (which proxies to the orchestrator's /llm/metrics)
// and shows:
//   - % of LLM calls served by local Ollama vs Claude
//   - estimated dollars saved vs the all-Claude baseline
//   - cache hit rate (if @chiefaia/llm-cache is wired)
//   - per-task-type breakdown of calls + savings

import { useEffect, useState } from 'react';

interface PerTask {
  taskType: string;
  calls: number;
  localCalls: number;
  claudeCalls: number;
  cacheHits: number;
  avgDurationMs: number;
  estimatedCostUsd: number;
  baselineCostUsd: number;
  savedUsd: number;
  localShare: number;
}

interface Snapshot {
  totalCalls: number;
  localCalls: number;
  claudeCalls: number;
  cacheHits: number;
  cacheHitRate: number;
  localShare: number;
  avgDurationMs: number;
  estimatedCostUsd: number;
  baselineCostUsd: number;
  savedUsd: number;
  perTask: PerTask[];
}

const REFRESH_MS = 5_000;

const cardStyle: React.CSSProperties = {
  background: '#1a202c',
  border: '1px solid #2d3748',
  borderRadius: 6,
  padding: 16,
};

const statStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 700,
  color: '#90cdf4',
  marginTop: 4,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 1,
  color: '#718096',
};

function formatPercent(x: number): string {
  if (!Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(1)}%`;
}

function formatUsd(x: number): string {
  if (!Number.isFinite(x)) return '—';
  return `$${x.toFixed(4)}`;
}

export function LlmSavingsPanel(): JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = (): void => {
      fetch('/api/llm-metrics')
        .then((r) => r.json())
        .then((data: unknown) => {
          if (cancelled) return;
          if (data && typeof data === 'object' && 'totalCalls' in data) {
            setSnapshot(data as Snapshot);
            setError(null);
          } else {
            setSnapshot(null);
            setError('orchestrator unreachable');
          }
        })
        .catch(() => {
          if (cancelled) return;
          setError('orchestrator unreachable');
        });
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!snapshot) {
    return (
      <div style={{ ...cardStyle, color: '#718096' }}>
        <strong style={{ color: '#f0f4f8' }}>LLM routing — local vs Claude</strong>
        <div style={{ marginTop: 8 }}>
          {error ?? 'loading…'}
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ color: '#f0f4f8', fontSize: 14 }}>
          LLM routing — local vs Claude
        </strong>
        <span style={{ fontSize: 11, color: '#718096' }}>
          {snapshot.totalCalls} calls · refresh {REFRESH_MS / 1000}s
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginTop: 16,
        }}
      >
        <div>
          <div style={labelStyle}>Local share</div>
          <div style={statStyle}>{formatPercent(snapshot.localShare)}</div>
          <div style={{ fontSize: 11, color: '#718096' }}>
            {snapshot.localCalls} local · {snapshot.claudeCalls} Claude
          </div>
        </div>

        <div>
          <div style={labelStyle}>Saved vs all-Claude</div>
          <div style={statStyle}>{formatUsd(snapshot.savedUsd)}</div>
          <div style={{ fontSize: 11, color: '#718096' }}>
            actual {formatUsd(snapshot.estimatedCostUsd)} of{' '}
            {formatUsd(snapshot.baselineCostUsd)}
          </div>
        </div>

        <div>
          <div style={labelStyle}>Cache hit rate</div>
          <div style={statStyle}>{formatPercent(snapshot.cacheHitRate)}</div>
          <div style={{ fontSize: 11, color: '#718096' }}>
            {snapshot.cacheHits} hits
          </div>
        </div>

        <div>
          <div style={labelStyle}>Avg latency</div>
          <div style={statStyle}>{Math.round(snapshot.avgDurationMs)}ms</div>
          <div style={{ fontSize: 11, color: '#718096' }}>across all calls</div>
        </div>
      </div>

      {snapshot.perTask.length > 0 && (
        <table
          style={{
            width: '100%',
            marginTop: 20,
            fontSize: 12,
            borderCollapse: 'collapse',
          }}
        >
          <thead>
            <tr style={{ color: '#a0aec0', textAlign: 'left' }}>
              <th style={{ padding: '4px 8px', borderBottom: '1px solid #2d3748' }}>
                Task type
              </th>
              <th
                style={{
                  padding: '4px 8px',
                  borderBottom: '1px solid #2d3748',
                  textAlign: 'right',
                }}
              >
                Calls
              </th>
              <th
                style={{
                  padding: '4px 8px',
                  borderBottom: '1px solid #2d3748',
                  textAlign: 'right',
                }}
              >
                Local %
              </th>
              <th
                style={{
                  padding: '4px 8px',
                  borderBottom: '1px solid #2d3748',
                  textAlign: 'right',
                }}
              >
                Saved
              </th>
              <th
                style={{
                  padding: '4px 8px',
                  borderBottom: '1px solid #2d3748',
                  textAlign: 'right',
                }}
              >
                Avg ms
              </th>
            </tr>
          </thead>
          <tbody>
            {snapshot.perTask.map((t) => (
              <tr key={t.taskType} style={{ color: '#e2e8f0' }}>
                <td style={{ padding: '4px 8px' }}>{t.taskType}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                  {t.calls}
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                  {formatPercent(t.localShare)}
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                  {formatUsd(t.savedUsd)}
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right' }}>
                  {Math.round(t.avgDurationMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
