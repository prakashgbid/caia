'use client';
import { useState, useCallback } from 'react';
import useSWR from 'swr';

// ─── Types ────────────────────────────────────────────────────────────────────

type Plan = 'free' | 'pro' | 'enterprise';
type Status = 'active' | 'cancelled' | 'expired';

interface Subscription {
  id: string;
  email: string;
  plan: Plan;
  status: Status;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}

interface SubscriptionsResponse {
  subscriptions: Subscription[];
  total: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    if (!r.ok) throw Object.assign(new Error('fetch error'), { status: r.status });
    return r.json() as Promise<SubscriptionsResponse>;
  });

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function planColor(plan: Plan): string {
  switch (plan) {
    case 'enterprise': return '#d4a017';
    case 'pro': return '#63b3ed';
    default: return '#68d391';
  }
}

function statusColor(status: Status): string {
  switch (status) {
    case 'active': return '#68d391';
    case 'cancelled': return '#fc8181';
    default: return '#718096';
  }
}

// ─── Subscribe Form ───────────────────────────────────────────────────────────

function SubscribeForm({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState<Plan>('free');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const isPaidPlan = plan === 'pro' || plan === 'enterprise';

  const handleStripeCheckout = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSubmitting(true);
      setResult(null);
      try {
        const origin = window.location.origin;
        const res = await fetch('/api/stripe/checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            plan,
            successUrl: `${origin}/billing/success?plan=${plan}&email=${encodeURIComponent(email)}`,
            cancelUrl: `${origin}/pricing?cancelled=1`,
          }),
        });
        const data = await res.json() as { url?: string; error?: string };
        if (!res.ok || !data.url) {
          setResult({ ok: false, msg: data.error ?? 'Failed to create checkout session' });
        } else {
          window.location.href = data.url;
        }
      } catch {
        setResult({ ok: false, msg: 'Network error' });
      } finally {
        setSubmitting(false);
      }
    },
    [email, plan],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (isPaidPlan) {
        await handleStripeCheckout(e);
        return;
      }
      setSubmitting(true);
      setResult(null);
      try {
        const res = await fetch('/api/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, plan }),
        });
        const data = await res.json() as { error?: string; id?: string };
        if (!res.ok) {
          setResult({ ok: false, msg: (data.error as string) ?? 'Failed to subscribe' });
        } else {
          setResult({ ok: true, msg: res.status === 200 ? 'Already subscribed — existing record returned.' : 'Subscribed successfully.' });
          setEmail('');
          setPlan('free');
          onSuccess();
        }
      } catch {
        setResult({ ok: false, msg: 'Network error' });
      } finally {
        setSubmitting(false);
      }
    },
    [email, plan, isPaidPlan, handleStripeCheckout, onSuccess],
  );

  return (
    <form
      onSubmit={(e) => { void handleSubmit(e); }}
      style={{
        background: '#1e2535',
        border: '1px solid #2d3748',
        borderRadius: 10,
        padding: '20px 24px',
        marginBottom: 28,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        maxWidth: 520,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#f0f4f8' }}>
          ✉️ New subscription
        </h2>
        <a
          href="/pricing"
          style={{
            fontSize: 11,
            color: '#63b3ed',
            textDecoration: 'none',
            background: '#1a2a3a',
            border: '1px solid #2b6cb033',
            borderRadius: 5,
            padding: '3px 8px',
          }}
        >
          💳 View pricing
        </a>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <input
          type="email"
          required
          placeholder="email@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{
            flex: 1,
            minWidth: 200,
            background: '#0f1117',
            border: '1px solid #4a5568',
            borderRadius: 6,
            color: '#f0f4f8',
            fontSize: 13,
            padding: '8px 12px',
            outline: 'none',
          }}
        />

        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value as Plan)}
          style={{
            background: '#0f1117',
            border: '1px solid #4a5568',
            borderRadius: 6,
            color: '#f0f4f8',
            fontSize: 13,
            padding: '8px 12px',
            cursor: 'pointer',
          }}
        >
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="enterprise">Enterprise</option>
        </select>

        <button
          type="submit"
          disabled={submitting}
          style={{
            background: submitting ? '#2d3748' : isPaidPlan ? '#d4a017' : '#2b6cb0',
            color: submitting ? '#718096' : isPaidPlan ? '#0f1117' : '#f0f4f8',
            border: 'none',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            padding: '8px 18px',
            cursor: submitting ? 'not-allowed' : 'pointer',
            transition: 'background 0.15s',
            whiteSpace: 'nowrap',
          }}
        >
          {submitting
            ? (isPaidPlan ? 'Redirecting…' : 'Subscribing…')
            : (isPaidPlan ? '💳 Pay with Stripe' : 'Subscribe')}
        </button>
      </div>

      {result && (
        <div
          style={{
            fontSize: 12,
            padding: '6px 10px',
            borderRadius: 5,
            background: result.ok ? '#276749' : '#742a2a',
            color: result.ok ? '#9ae6b4' : '#fed7d7',
            border: `1px solid ${result.ok ? '#48bb7855' : '#f5656555'}`,
          }}
        >
          {result.ok ? '✓' : '✗'} {result.msg}
        </div>
      )}
    </form>
  );
}

// ─── Filters ──────────────────────────────────────────────────────────────────

interface Filters {
  status: string;
  plan: string;
  email: string;
}

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
      <span style={{ fontSize: 12, color: '#718096', fontWeight: 600 }}>Filter:</span>

      <select
        value={filters.status}
        onChange={(e) => onChange({ ...filters, status: e.target.value })}
        style={{
          background: '#1e2535',
          border: '1px solid #4a5568',
          borderRadius: 5,
          color: '#e2e8f0',
          fontSize: 12,
          padding: '4px 8px',
          cursor: 'pointer',
        }}
      >
        <option value="">All statuses</option>
        <option value="active">Active</option>
        <option value="cancelled">Cancelled</option>
        <option value="expired">Expired</option>
      </select>

      <select
        value={filters.plan}
        onChange={(e) => onChange({ ...filters, plan: e.target.value })}
        style={{
          background: '#1e2535',
          border: '1px solid #4a5568',
          borderRadius: 5,
          color: '#e2e8f0',
          fontSize: 12,
          padding: '4px 8px',
          cursor: 'pointer',
        }}
      >
        <option value="">All plans</option>
        <option value="free">Free</option>
        <option value="pro">Pro</option>
        <option value="enterprise">Enterprise</option>
      </select>

      <input
        type="text"
        placeholder="Filter by email…"
        value={filters.email}
        onChange={(e) => onChange({ ...filters, email: e.target.value })}
        style={{
          background: '#1e2535',
          border: '1px solid #4a5568',
          borderRadius: 5,
          color: '#e2e8f0',
          fontSize: 12,
          padding: '4px 10px',
          outline: 'none',
          width: 180,
        }}
      />

      {(filters.status || filters.plan || filters.email) && (
        <button
          type="button"
          onClick={() => onChange({ status: '', plan: '', email: '' })}
          style={{
            background: 'transparent',
            border: '1px solid #4a5568',
            borderRadius: 5,
            color: '#a0aec0',
            fontSize: 11,
            padding: '4px 8px',
            cursor: 'pointer',
          }}
        >
          ✕ Clear
        </button>
      )}
    </div>
  );
}

// ─── Subscription Row ─────────────────────────────────────────────────────────

function SubscriptionRow({
  sub,
  onCancel,
}: {
  sub: Subscription;
  onCancel: (id: string) => void;
}) {
  const [cancelling, setCancelling] = useState(false);

  const handleCancel = useCallback(async () => {
    if (!confirm(`Cancel subscription for ${sub.email}?`)) return;
    setCancelling(true);
    try {
      await fetch(`/api/subscriptions/${sub.id}`, { method: 'DELETE' });
      onCancel(sub.id);
    } finally {
      setCancelling(false);
    }
  }, [sub.email, sub.id, onCancel]);

  return (
    <tr
      style={{
        borderBottom: '1px solid #2d3748',
        transition: 'background 0.1s',
      }}
    >
      <td style={{ padding: '10px 12px', fontSize: 13, color: '#e2e8f0', fontFamily: 'monospace', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {sub.email}
      </td>
      <td style={{ padding: '10px 12px' }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: planColor(sub.plan),
            background: planColor(sub.plan) + '22',
            border: `1px solid ${planColor(sub.plan)}55`,
            borderRadius: 10,
            padding: '2px 8px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {sub.plan}
        </span>
      </td>
      <td style={{ padding: '10px 12px' }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: statusColor(sub.status),
            background: statusColor(sub.status) + '22',
            border: `1px solid ${statusColor(sub.status)}55`,
            borderRadius: 10,
            padding: '2px 8px',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {sub.status}
        </span>
      </td>
      <td style={{ padding: '10px 12px', fontSize: 12, color: '#718096', whiteSpace: 'nowrap' }}>
        {relativeTime(sub.createdAt)}
      </td>
      <td style={{ padding: '10px 12px', fontSize: 12, color: '#718096', fontFamily: 'monospace' }}>
        {sub.id.slice(0, 18)}
      </td>
      <td style={{ padding: '10px 12px' }}>
        {sub.status === 'active' && (
          <button
            type="button"
            onClick={() => { void handleCancel(); }}
            disabled={cancelling}
            style={{
              background: 'transparent',
              border: '1px solid #744242',
              borderRadius: 5,
              color: '#fc8181',
              fontSize: 11,
              padding: '3px 10px',
              cursor: cancelling ? 'not-allowed' : 'pointer',
              opacity: cancelling ? 0.6 : 1,
            }}
          >
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
      </td>
    </tr>
  );
}

// ─── Subscription Table ───────────────────────────────────────────────────────

function SubscriptionTable({
  subs,
  onCancel,
}: {
  subs: Subscription[];
  onCancel: (id: string) => void;
}) {
  if (subs.length === 0) {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: '40px 20px',
          color: '#718096',
          fontSize: 14,
          background: '#1e2535',
          border: '1px solid #2d3748',
          borderRadius: 8,
        }}
      >
        <div style={{ fontSize: 28, marginBottom: 10 }}>📭</div>
        No subscriptions found.
      </div>
    );
  }

  return (
    <div
      style={{
        background: '#1e2535',
        border: '1px solid #2d3748',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #2d3748', background: '#151b2a' }}>
            {['Email', 'Plan', 'Status', 'Created', 'ID', ''].map((h) => (
              <th
                key={h}
                style={{
                  padding: '9px 12px',
                  textAlign: 'left',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#718096',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {subs.map((sub) => (
            <SubscriptionRow key={sub.id} sub={sub} onCancel={onCancel} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Summary Pills ────────────────────────────────────────────────────────────

function SummaryPills({ subs }: { subs: Subscription[] }) {
  const active = subs.filter((s) => s.status === 'active').length;
  const cancelled = subs.filter((s) => s.status === 'cancelled').length;
  const byPlan = (plan: Plan) => subs.filter((s) => s.plan === plan && s.status === 'active').length;

  const pills: Array<{ label: string; count: number; color: string }> = [
    { label: 'Total', count: subs.length, color: '#a0aec0' },
    { label: 'Active', count: active, color: '#68d391' },
    { label: 'Cancelled', count: cancelled, color: '#fc8181' },
    { label: 'Free', count: byPlan('free'), color: '#68d391' },
    { label: 'Pro', count: byPlan('pro'), color: '#63b3ed' },
    { label: 'Enterprise', count: byPlan('enterprise'), color: '#d4a017' },
  ];

  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
      {pills.map(({ label, count, color }) => (
        <div
          key={label}
          style={{
            background: '#1e2535',
            border: `1px solid ${color}44`,
            borderRadius: 8,
            padding: '6px 14px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            minWidth: 70,
          }}
        >
          <span style={{ fontSize: 18, fontWeight: 700, color }}>{count}</span>
          <span style={{ fontSize: 10, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SubscriptionsPage() {
  const [filters, setFilters] = useState<Filters>({ status: '', plan: '', email: '' });
  const [refreshKey, setRefreshKey] = useState(0);

  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.plan) qs.set('plan', filters.plan);
  if (filters.email) qs.set('email', filters.email);
  const qsStr = qs.toString();

  const { data, error, isLoading, mutate } = useSWR<SubscriptionsResponse>(
    [`/api/subscriptions`, qsStr, refreshKey],
    ([base, q]) => fetcher(`${base as string}${(q as string) ? '?' + (q as string) : ''}`),
    { refreshInterval: 30_000 },
  );

  const subs = data?.subscriptions ?? [];

  const handleCancel = useCallback(
    (id: string) => {
      void mutate(
        (prev) =>
          prev
            ? {
                ...prev,
                subscriptions: prev.subscriptions.map((s) =>
                  s.id === id ? { ...s, status: 'cancelled' as Status, cancelledAt: new Date().toISOString() } : s,
                ),
              }
            : prev,
        false,
      );
    },
    [mutate],
  );

  const handleSubscribeSuccess = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
              📬 Subscriptions
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: '#718096' }}>
              Manage email subscriptions via the BFF route at{' '}
              <code style={{ fontSize: 12, color: '#90cdf4', background: '#1a202c', padding: '1px 5px', borderRadius: 3 }}>
                POST /subscribe
              </code>
            </p>
          </div>
          <a
            href="/pricing"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'linear-gradient(135deg, #2b6cb0, #1a4a80)',
              color: '#f0f4f8',
              borderRadius: 8,
              padding: '8px 16px',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              border: '1px solid #4a90d9',
            }}
          >
            💳 Upgrade plan
          </a>
        </div>
      </div>

      <SubscribeForm onSuccess={handleSubscribeSuccess} />

      {subs.length > 0 && <SummaryPills subs={subs} />}

      <FilterBar filters={filters} onChange={setFilters} />

      {isLoading ? (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: '#718096',
            fontSize: 14,
            background: '#1e2535',
            border: '1px solid #2d3748',
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 22, marginBottom: 8, opacity: 0.6 }}>⏳</div>
          Loading subscriptions…
        </div>
      ) : error ? (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 20px',
            color: '#fc8181',
            fontSize: 14,
            background: '#1e2535',
            border: '1px solid #744242',
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 22, marginBottom: 8 }}>⚠️</div>
          Could not load subscriptions — orchestrator may be offline.
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => { void mutate(); }}
              style={{
                background: 'transparent',
                border: '1px solid #4a5568',
                borderRadius: 5,
                color: '#a0aec0',
                fontSize: 12,
                padding: '4px 12px',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        </div>
      ) : (
        <SubscriptionTable subs={subs} onCancel={handleCancel} />
      )}
    </div>
  );
}
