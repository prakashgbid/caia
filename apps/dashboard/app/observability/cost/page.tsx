'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface AgentBreakdown {
  agentRole: string;
  costUsd: number;
  callCount: number;
  inputTokens: number;
  outputTokens: number;
}

interface ModelBreakdown {
  model: string;
  costUsd: number;
  callCount: number;
}

interface RecentRecord {
  taskId: string;
  agentRole: string;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  tsMsEpoch: number;
}

interface CostData {
  windowHours: number;
  totalCostUsd: number;
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byAgent: AgentBreakdown[];
  byModel: ModelBreakdown[];
  recent: RecentRecord[];
}

function fmt(usd: number): string {
  if (usd === 0) return '$0.0000';
  if (usd < 0.0001) return `$${usd.toExponential(2)}`;
  return `$${usd.toFixed(4)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function fmtAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

function StatCard({ label, value, sub, color = '#f0f4f8' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: '#1a202c', border: '1px solid #2d3748', borderRadius: 8, padding: '14px 18px', minWidth: 140 }}>
      <div style={{ fontSize: 11, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#718096', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const WINDOWS = [1, 6, 24, 168] as const;
const WINDOW_LABEL: Record<number, string> = { 1: '1h', 6: '6h', 24: '24h', 168: '7d' };

export default function CostBreakdownPage() {
  const [data, setData] = useState<CostData | null>(null);
  const [windowH, setWindowH] = useState(24);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(() => {
    fetch(`/api/metrics/cost?windowH=${windowH}`)
      .then((r) => r.json() as Promise<CostData | null>)
      .then((d) => {
        if (d) setData(d);
        setLoading(false);
        setLastUpdated(new Date());
      })
      .catch(() => setLoading(false));
  }, [windowH]);

  useEffect(() => {
    setLoading(true);
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  const maxAgentCost = data?.byAgent.reduce((m, a) => Math.max(m, a.costUsd), 0.0001) ?? 0.0001;
  const maxModelCost = data?.byModel.reduce((m, b) => Math.max(m, b.costUsd), 0.0001) ?? 0.0001;

  return (
    <div style={{ padding: 24, maxWidth: 1100, color: '#f0f4f8', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>💸 Cost Breakdown</h2>
        <Link href="/observability/spend" style={{ fontSize: 12, color: '#90cdf4', textDecoration: 'none', background: '#2d3748', padding: '4px 10px', borderRadius: 4 }}>
          💰 Spend caps →
        </Link>
        <Link href="/observability/conductor" style={{ fontSize: 12, color: '#90cdf4', textDecoration: 'none', background: '#2d3748', padding: '4px 10px', borderRadius: 4 }}>
          🔧 Conductor →
        </Link>
        <Link href="/observability/coding" style={{ fontSize: 12, color: '#90cdf4', textDecoration: 'none', background: '#2d3748', padding: '4px 10px', borderRadius: 4 }}>
          👷 Workers →
        </Link>
        {lastUpdated && (
          <span style={{ fontSize: 11, color: '#4a5568', marginLeft: 'auto' }}>
            Updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Window selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {WINDOWS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setWindowH(w)}
            style={{
              background: windowH === w ? '#2b6cb0' : '#2d3748',
              color: windowH === w ? '#f0f4f8' : '#a0aec0',
              border: 'none',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 12,
              fontWeight: windowH === w ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {WINDOW_LABEL[w]}
          </button>
        ))}
      </div>

      {loading && !data && <div style={{ color: '#718096' }}>Loading cost data…</div>}

      {!loading && !data && (
        <div style={{ background: '#1a1a2e', border: '1px solid #2d3748', borderRadius: 8, padding: '20px 24px', color: '#718096', fontSize: 13 }}>
          No cost data — orchestrator may be offline or no spend records yet.
        </div>
      )}

      {data && (
        <>
          {/* Summary cards */}
          <section style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#a0aec0', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Summary · last {WINDOW_LABEL[windowH]}
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <StatCard label="Total cost" value={fmt(data.totalCostUsd)} color="#f6ad55" />
              <StatCard label="LLM calls" value={String(data.totalCalls)} color="#90cdf4" sub="API requests" />
              <StatCard label="Input tokens" value={fmtTokens(data.totalInputTokens)} color="#68d391" />
              <StatCard label="Output tokens" value={fmtTokens(data.totalOutputTokens)} color="#b794f4" />
              {data.totalCalls > 0 && (
                <StatCard
                  label="Avg cost/call"
                  value={fmt(data.totalCostUsd / data.totalCalls)}
                  color="#a0aec0"
                />
              )}
            </div>
          </section>

          {/* Per-agent breakdown */}
          {data.byAgent.length > 0 && (
            <section style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#a0aec0', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                By agent
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#161b27', borderBottom: '2px solid #2d3748' }}>
                    <th style={{ padding: '7px 10px', textAlign: 'left', color: '#718096', fontWeight: 500 }}>Agent</th>
                    <th style={{ padding: '7px 10px', textAlign: 'right', color: '#718096', fontWeight: 500 }}>Cost</th>
                    <th style={{ padding: '7px 10px', textAlign: 'right', color: '#718096', fontWeight: 500 }}>Calls</th>
                    <th style={{ padding: '7px 10px', textAlign: 'right', color: '#718096', fontWeight: 500 }}>Tokens in</th>
                    <th style={{ padding: '7px 10px', textAlign: 'right', color: '#718096', fontWeight: 500 }}>Tokens out</th>
                    <th style={{ padding: '7px 10px', textAlign: 'left', color: '#718096', fontWeight: 500, width: 180 }}>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byAgent.map((a) => {
                    const pct = (a.costUsd / maxAgentCost) * 100;
                    const sharePct = data.totalCostUsd > 0 ? (a.costUsd / data.totalCostUsd) * 100 : 0;
                    return (
                      <tr key={a.agentRole} style={{ borderBottom: '1px solid #1e2536' }}>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: '#90cdf4' }}>{a.agentRole}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: '#f6ad55' }}>{fmt(a.costUsd)}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: '#a0aec0' }}>{a.callCount}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: '#68d391' }}>{fmtTokens(a.inputTokens)}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right', color: '#b794f4' }}>{fmtTokens(a.outputTokens)}</td>
                        <td style={{ padding: '6px 10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ flex: 1, height: 6, background: '#2d3748', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: '#f6ad55', borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: 11, color: '#718096', width: 36, textAlign: 'right' }}>
                              {sharePct.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {/* Per-model breakdown */}
          {data.byModel.length > 0 && (
            <section style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#a0aec0', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                By model
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {data.byModel.map((m) => {
                  const sharePct = data.totalCostUsd > 0 ? (m.costUsd / data.totalCostUsd) * 100 : 0;
                  const barPct = (m.costUsd / maxModelCost) * 100;
                  return (
                    <div
                      key={m.model}
                      style={{ background: '#1a202c', border: '1px solid #2d3748', borderRadius: 8, padding: '12px 14px', minWidth: 200 }}
                    >
                      <div style={{ fontSize: 11, color: '#718096', marginBottom: 6, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.model}
                      </div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: '#f6ad55', lineHeight: 1, marginBottom: 4 }}>
                        {fmt(m.costUsd)}
                      </div>
                      <div style={{ fontSize: 11, color: '#718096', marginBottom: 8 }}>
                        {m.callCount} calls · {sharePct.toFixed(1)}% of spend
                      </div>
                      <div style={{ height: 5, background: '#2d3748', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${barPct}%`, height: '100%', background: '#f6ad55', borderRadius: 3 }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Recent calls */}
          {data.recent.length > 0 && (
            <section>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#a0aec0', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Recent calls (last 50)
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#161b27', borderBottom: '2px solid #2d3748' }}>
                    <th style={{ padding: '6px 10px', textAlign: 'left', color: '#718096', fontWeight: 500 }}>Agent</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', color: '#718096', fontWeight: 500 }}>Model</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right', color: '#718096', fontWeight: 500 }}>Cost</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right', color: '#718096', fontWeight: 500 }}>In</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right', color: '#718096', fontWeight: 500 }}>Out</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', color: '#718096', fontWeight: 500 }}>Task</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right', color: '#718096', fontWeight: 500 }}>When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((r, i) => (
                    <tr key={`${r.taskId}-${i}`} style={{ borderBottom: '1px solid #1e2536' }}>
                      <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: '#90cdf4', fontSize: 11 }}>{r.agentRole}</td>
                      <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: '#a0aec0', fontSize: 11 }}>{r.model}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: '#f6ad55', fontWeight: 600 }}>{fmt(r.costUsd)}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: '#68d391' }}>{fmtTokens(r.inputTokens)}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: '#b794f4' }}>{fmtTokens(r.outputTokens)}</td>
                      <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: '#718096', fontSize: 10 }}>
                        {r.taskId.slice(0, 16)}{r.taskId.length > 16 ? '…' : ''}
                      </td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: '#4a5568', fontSize: 11 }}>{fmtAgo(r.tsMsEpoch)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {data.totalCalls === 0 && (
            <div style={{ background: '#1a202c', border: '1px solid #2d3748', borderRadius: 8, padding: '20px 24px', color: '#718096', fontSize: 13 }}>
              No spend records in the last {WINDOW_LABEL[windowH]}. LLM calls via the orchestrator will appear here.
            </div>
          )}
        </>
      )}
    </div>
  );
}
