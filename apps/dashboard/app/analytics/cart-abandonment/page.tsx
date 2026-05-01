'use client';
import { useState, useEffect, useCallback } from 'react';
import type { CartAbandonmentData } from '../../api/analytics/cart-abandonment/route';

type Period = '24h' | '7d' | '30d';

const PERIOD_LABELS: Record<Period, string> = { '24h': 'Last 24 h', '7d': 'Last 7 days', '30d': 'Last 30 days' };

function fmtUsd(n: number): string {
  return `$${n.toLocaleString()}`;
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function pctColor(pct: number, inverted = false): string {
  if (inverted) {
    if (pct >= 80) return '#fc8181';
    if (pct >= 60) return '#f6ad55';
    return '#68d391';
  }
  if (pct >= 60) return '#68d391';
  if (pct >= 30) return '#f6ad55';
  return '#fc8181';
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div style={{ background: '#1a202c', border: '1px solid #2d3748', borderRadius: 8, padding: '16px 20px', minWidth: 160, flex: '1 1 160px' }}>
      <div style={{ fontSize: 11, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#718096', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function FunnelBar({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#a0aec0', marginBottom: 4 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600, color: '#f0f4f8' }}>
          {count.toLocaleString()} <span style={{ color: '#718096', fontWeight: 400 }}>({pct.toFixed(1)}%)</span>
        </span>
      </div>
      <div style={{ height: 10, background: '#2d3748', borderRadius: 5, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 5, transition: 'width 0.5s' }} />
      </div>
    </div>
  );
}

const EVENT_LABELS: Record<string, string> = {
  cart_viewed: 'Cart viewed',
  cart_abandoned: 'Cart abandoned',
  cart_recovered: 'Cart recovered',
  checkout_started: 'Checkout started',
  checkout_abandoned: 'Checkout abandoned',
  checkout_completed: 'Checkout completed',
};

const STATUS_COLORS: Record<string, string> = {
  abandoned: '#fc8181',
  recovered: '#68d391',
  completed: '#63b3ed',
  'in-progress': '#f6ad55',
};

export default function CartAbandonmentPage() {
  const [period, setPeriod] = useState<Period>('7d');
  const [data, setData] = useState<CartAbandonmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/analytics/cart-abandonment?period=${period}`)
      .then((r) => r.json() as Promise<CartAbandonmentData>)
      .then((d) => { setData(d); setLoading(false); setError(null); })
      .catch(() => { setLoading(false); setError('Could not load cart abandonment data.'); });
  }, [period]);

  useEffect(() => {
    setLoading(true);
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  if (loading && !data) {
    return <div style={{ padding: 24, color: '#718096' }}>Loading cart abandonment data…</div>;
  }

  if (error || !data) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ margin: '0 0 8px', color: '#f0f4f8' }}>🛒 Cart Abandonment</h2>
        <div style={{ background: '#2d2020', border: '1px solid #744949', borderRadius: 8, padding: '12px 16px', color: '#fc8181', fontSize: 13 }}>
          {error ?? 'Data unavailable.'}
        </div>
      </div>
    );
  }

  const { funnel, recentEvents, abandonmentRate, recoveryRate, totalSessions, abandonedSessions, revenueAtRisk, recoveredRevenue, updatedAt } = data;

  return (
    <div style={{ padding: 24, maxWidth: 920 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 4, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>🛒 Cart Abandonment</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['24h', '7d', '30d'] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                style={{
                  background: period === p ? '#2b6cb0' : '#2d3748',
                  color: period === p ? '#f0f4f8' : '#a0aec0',
                  border: 'none',
                  borderRadius: 4,
                  padding: '4px 10px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 13, color: '#718096' }}>
          Checkout funnel analytics · refreshes every 30 s · updated {relativeTime(updatedAt)}
        </p>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 28 }}>
        <StatCard
          label="Abandonment rate"
          value={fmtPct(abandonmentRate)}
          sub={`${abandonedSessions.toLocaleString()} of ${totalSessions.toLocaleString()} sessions`}
          color={pctColor(100 - abandonmentRate)}
        />
        <StatCard
          label="Recovery rate"
          value={fmtPct(recoveryRate)}
          sub={`${data.recoveredSessions.toLocaleString()} recovered`}
          color={pctColor(recoveryRate)}
        />
        <StatCard
          label="Revenue at risk"
          value={fmtUsd(revenueAtRisk)}
          sub={`${fmtUsd(recoveredRevenue)} recovered`}
          color={revenueAtRisk > 1000 ? '#f6ad55' : '#68d391'}
        />
        <StatCard
          label="Avg time to abandon"
          value={`${data.avgTimeToAbandon} min`}
          sub="from cart viewed"
          color="#90cdf4"
        />
      </div>

      {/* Funnel */}
      <div style={{ background: '#1a202c', border: '1px solid #2d3748', borderRadius: 8, padding: '20px 24px', marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#f0f4f8', marginBottom: 16 }}>Checkout Funnel</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <FunnelBar label="Cart viewed" count={funnel.cartViewed} max={funnel.cartViewed} color="#63b3ed" />
          <FunnelBar label="Item added" count={funnel.itemAdded} max={funnel.cartViewed} color="#90cdf4" />
          <FunnelBar label="Checkout started" count={funnel.checkoutStarted} max={funnel.cartViewed} color="#f6ad55" />
          <FunnelBar label="Checkout completed" count={funnel.checkoutCompleted} max={funnel.cartViewed} color="#68d391" />
          <FunnelBar label="Abandoned at checkout" count={funnel.abandoned} max={funnel.cartViewed} color="#fc8181" />
        </div>

        {/* Drop-off summary */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #2d3748', display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12 }}>
          <span style={{ color: '#718096' }}>
            Item add rate: <span style={{ color: '#f0f4f8', fontWeight: 600 }}>
              {funnel.cartViewed > 0 ? fmtPct((funnel.itemAdded / funnel.cartViewed) * 100) : '—'}
            </span>
          </span>
          <span style={{ color: '#718096' }}>
            Checkout start rate: <span style={{ color: '#f0f4f8', fontWeight: 600 }}>
              {funnel.itemAdded > 0 ? fmtPct((funnel.checkoutStarted / funnel.itemAdded) * 100) : '—'}
            </span>
          </span>
          <span style={{ color: '#718096' }}>
            Conversion rate: <span style={{ color: '#f0f4f8', fontWeight: 600 }}>
              {funnel.checkoutStarted > 0 ? fmtPct((funnel.checkoutCompleted / funnel.checkoutStarted) * 100) : '—'}
            </span>
          </span>
        </div>
      </div>

      {/* Recent events */}
      <div style={{ background: '#1a202c', border: '1px solid #2d3748', borderRadius: 8, padding: '20px 24px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#f0f4f8', marginBottom: 16 }}>Recent Events</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr 80px 90px 80px', gap: 12, fontSize: 11, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.05em', paddingBottom: 8, borderBottom: '1px solid #2d3748', marginBottom: 4 }}>
            <span>Event</span>
            <span>Cart / Plan</span>
            <span>Value</span>
            <span>Status</span>
            <span>When</span>
          </div>
          {recentEvents.map((evt) => (
            <div
              key={evt.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1.4fr 80px 90px 80px',
                gap: 12,
                fontSize: 13,
                padding: '8px 0',
                borderBottom: '1px solid #1a202c',
                alignItems: 'center',
              }}
            >
              <span style={{ color: '#a0aec0' }}>{EVENT_LABELS[evt.type] ?? evt.type}</span>
              <span style={{ color: '#f0f4f8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span style={{ color: '#718096', fontSize: 11 }}>{evt.cartId} · </span>
                {evt.plan}
              </span>
              <span style={{ color: '#68d391', fontWeight: 600 }}>{fmtUsd(evt.value)}</span>
              <span
                style={{
                  display: 'inline-block',
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 600,
                  background: (STATUS_COLORS[evt.status] ?? '#718096') + '22',
                  color: STATUS_COLORS[evt.status] ?? '#718096',
                  textTransform: 'capitalize',
                }}
              >
                {evt.status}
              </span>
              <span style={{ color: '#718096', fontSize: 12 }}>{relativeTime(evt.timestamp)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer note */}
      <div style={{ marginTop: 16, fontSize: 12, color: '#4a5568' }}>
        Events are tracked via GA4 analytics events (CART_VIEWED, CART_ABANDONED, CHECKOUT_STARTED, etc.).
        Connect to your GA4 Data API or a backend aggregator to replace mock data.
      </div>
    </div>
  );
}
