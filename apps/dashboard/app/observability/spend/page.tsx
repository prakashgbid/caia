'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface SpendData {
  todayUsd: number;
  weekUsd: number;
  pause: {
    paused: boolean;
    reason?: string;
    pausedAt?: string;
    by?: string;
  };
}

function fmt(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: '#1a202c',
        border: '1px solid #2d3748',
        borderRadius: 8,
        padding: '16px 20px',
        minWidth: 160,
      }}
    >
      <div style={{ fontSize: 11, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#718096', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export default function SpendPage() {
  const [data, setData] = useState<SpendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/spend')
      .then((r) => r.json() as Promise<SpendData | null>)
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
        setError('Could not reach orchestrator spend endpoint.');
      });
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  async function handleResume() {
    setResuming(true);
    try {
      const res = await fetch(
        (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:7776') + '/spend/resume',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ by: 'dashboard-operator' }),
        },
      );
      if (res.ok) load();
    } catch {
      // ignore
    }
    setResuming(false);
  }

  if (loading) {
    return <div style={{ padding: 24, color: '#718096' }}>Loading spend data…</div>;
  }

  if (error || !data) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ margin: '0 0 8px', color: '#f0f4f8' }}>Cost &amp; Spend</h2>
        <div
          style={{
            background: '#2d2020',
            border: '1px solid #744949',
            borderRadius: 8,
            padding: '12px 16px',
            color: '#fc8181',
            fontSize: 13,
          }}
        >
          {error ?? 'Spend data unavailable — the /spend/today endpoint may not be wired in this deployment.'}
        </div>
      </div>
    );
  }

  const { todayUsd, weekUsd, pause } = data;
  const dayCapUsd = 25;
  const weekCapUsd = 100;
  const dayPct = Math.min((todayUsd / dayCapUsd) * 100, 100);
  const weekPct = Math.min((weekUsd / weekCapUsd) * 100, 100);

  function barColor(pct: number): string {
    if (pct >= 90) return '#fc8181';
    if (pct >= 70) return '#f6ad55';
    return '#68d391';
  }

  return (
    <div style={{ padding: 24, maxWidth: 860 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 4, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
            💰 Cost &amp; Spend
          </h2>
          <Link
            href="/observability/cost"
            style={{ fontSize: 12, color: '#90cdf4', textDecoration: 'none', background: '#2d3748', padding: '4px 10px', borderRadius: 4 }}
          >
            💸 Per-agent breakdown →
          </Link>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#718096' }}>
          Live spend against daily/weekly caps. Refreshes every 15 s.
        </p>
      </div>

      {/* Pause banner */}
      {pause.paused && (
        <div
          style={{
            background: '#2d1e1e',
            border: '1px solid #fc8181',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, color: '#fc8181', marginBottom: 2 }}>
              ⏸ Orchestrator paused — spend cap breached
            </div>
            <div style={{ fontSize: 12, color: '#a0aec0' }}>
              {pause.reason ?? 'No reason provided'}
              {pause.pausedAt ? ` · paused at ${new Date(pause.pausedAt).toLocaleTimeString()}` : ''}
              {pause.by ? ` · by ${pause.by}` : ''}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleResume()}
            disabled={resuming}
            style={{
              background: resuming ? '#2d3748' : '#2b6cb0',
              color: '#f0f4f8',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: resuming ? 'not-allowed' : 'pointer',
              flexShrink: 0,
            }}
          >
            {resuming ? 'Resuming…' : 'Resume'}
          </button>
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 28 }}>
        <StatCard
          label="Today's spend"
          value={fmt(todayUsd)}
          sub={`of ${fmt(dayCapUsd)} daily cap`}
          color={dayPct >= 90 ? '#fc8181' : dayPct >= 70 ? '#f6ad55' : '#68d391'}
        />
        <StatCard
          label="This week's spend"
          value={fmt(weekUsd)}
          sub={`of ${fmt(weekCapUsd)} weekly cap`}
          color={weekPct >= 90 ? '#fc8181' : weekPct >= 70 ? '#f6ad55' : '#68d391'}
        />
        <StatCard
          label="Orchestrator"
          value={pause.paused ? 'Paused' : 'Running'}
          color={pause.paused ? '#fc8181' : '#68d391'}
        />
      </div>

      {/* Progress bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 28 }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13, color: '#a0aec0' }}>
            <span>Daily budget</span>
            <span style={{ fontWeight: 600, color: '#f0f4f8' }}>
              {dayPct.toFixed(1)}% — {fmt(todayUsd)} / {fmt(dayCapUsd)}
            </span>
          </div>
          <div style={{ height: 10, background: '#2d3748', borderRadius: 5, overflow: 'hidden' }}>
            <div
              style={{
                width: `${dayPct}%`,
                height: '100%',
                background: barColor(dayPct),
                borderRadius: 5,
                transition: 'width 0.4s',
              }}
            />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 13, color: '#a0aec0' }}>
            <span>Weekly budget</span>
            <span style={{ fontWeight: 600, color: '#f0f4f8' }}>
              {weekPct.toFixed(1)}% — {fmt(weekUsd)} / {fmt(weekCapUsd)}
            </span>
          </div>
          <div style={{ height: 10, background: '#2d3748', borderRadius: 5, overflow: 'hidden' }}>
            <div
              style={{
                width: `${weekPct}%`,
                height: '100%',
                background: barColor(weekPct),
                borderRadius: 5,
                transition: 'width 0.4s',
              }}
            />
          </div>
        </div>
      </div>

      {/* Cap thresholds reference */}
      <div
        style={{
          background: '#1a202c',
          border: '1px solid #2d3748',
          borderRadius: 8,
          padding: '14px 16px',
          fontSize: 12,
          color: '#718096',
        }}
      >
        <div style={{ fontWeight: 600, color: '#a0aec0', marginBottom: 8 }}>Default spend caps (SAFETY-004)</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px' }}>
          <span>Global daily cap</span><span style={{ color: '#f0f4f8', fontWeight: 600 }}>$25.00</span>
          <span>Global weekly cap</span><span style={{ color: '#f0f4f8', fontWeight: 600 }}>$100.00</span>
          <span>Per-project weekly cap</span><span style={{ color: '#f0f4f8', fontWeight: 600 }}>$30.00</span>
          <span>Per-task daily cap</span><span style={{ color: '#f0f4f8', fontWeight: 600 }}>$1.50</span>
        </div>
      </div>
    </div>
  );
}
