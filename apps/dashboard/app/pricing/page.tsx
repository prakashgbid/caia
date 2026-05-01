'use client';
import { useState, useCallback, useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type PaidPlan = 'pro' | 'enterprise';

interface PlanFeature {
  text: string;
  included: boolean;
}

interface PlanConfig {
  id: 'free' | PaidPlan;
  name: string;
  price: string;
  period: string;
  description: string;
  accentColor: string;
  features: PlanFeature[];
  cta: string;
  popular?: boolean;
}

// ─── Plan Definitions ─────────────────────────────────────────────────────────

const PLANS: PlanConfig[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'For individuals exploring CAIA.',
    accentColor: '#68d391',
    cta: 'Get started free',
    features: [
      { text: 'Up to 10 pipeline runs / month', included: true },
      { text: 'Community support', included: true },
      { text: '1 active project', included: true },
      { text: 'Priority queue', included: false },
      { text: 'Advanced analytics', included: false },
      { text: 'Custom agents', included: false },
      { text: 'SLA guarantee', included: false },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$29',
    period: 'per month',
    description: 'For teams shipping production AI pipelines.',
    accentColor: '#63b3ed',
    cta: 'Upgrade to Pro',
    popular: true,
    features: [
      { text: 'Unlimited pipeline runs', included: true },
      { text: 'Priority email support', included: true },
      { text: 'Up to 10 active projects', included: true },
      { text: 'Priority queue', included: true },
      { text: 'Advanced analytics', included: true },
      { text: 'Custom agents', included: false },
      { text: 'SLA guarantee', included: false },
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: '$99',
    period: 'per month',
    description: 'For organizations requiring full control.',
    accentColor: '#d4a017',
    cta: 'Upgrade to Enterprise',
    features: [
      { text: 'Unlimited pipeline runs', included: true },
      { text: 'Dedicated support & SLA', included: true },
      { text: 'Unlimited active projects', included: true },
      { text: 'Priority queue', included: true },
      { text: 'Advanced analytics', included: true },
      { text: 'Custom agents', included: true },
      { text: 'SLA guarantee', included: true },
    ],
  },
];

// ─── Checkout Hook ────────────────────────────────────────────────────────────

function useCheckout() {
  const [loading, setLoading] = useState<PaidPlan | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startCheckout = useCallback(async (email: string, plan: PaidPlan) => {
    setLoading(plan);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, plan }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? 'Failed to create checkout session');
        return;
      }
      window.location.href = data.url;
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(null);
    }
  }, []);

  return { loading, error, startCheckout };
}

// ─── Plan Card ────────────────────────────────────────────────────────────────

function PlanCard({ plan }: { plan: PlanConfig }) {
  const [email, setEmail] = useState('');
  const { loading, error, startCheckout } = useCheckout();
  const isPaid = plan.id !== 'free';

  const handleUpgrade = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!isPaid) return;
      await startCheckout(email, plan.id as PaidPlan);
    },
    [email, isPaid, plan.id, startCheckout],
  );

  return (
    <div
      style={{
        background: '#1e2535',
        border: `1px solid ${plan.popular ? plan.accentColor + '66' : '#2d3748'}`,
        borderRadius: 12,
        padding: '28px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        flex: 1,
        minWidth: 260,
        maxWidth: 340,
        position: 'relative',
        boxShadow: plan.popular ? `0 0 0 1px ${plan.accentColor}33` : 'none',
      }}
    >
      {plan.popular && (
        <div
          style={{
            position: 'absolute',
            top: -12,
            left: '50%',
            transform: 'translateX(-50%)',
            background: plan.accentColor,
            color: '#0f1117',
            fontSize: 10,
            fontWeight: 800,
            padding: '3px 12px',
            borderRadius: 20,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          Most Popular
        </div>
      )}

      {/* Header */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: plan.accentColor, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {plan.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 36, fontWeight: 800, color: '#f0f4f8' }}>{plan.price}</span>
          <span style={{ fontSize: 13, color: '#718096' }}>/{plan.period}</span>
        </div>
        <div style={{ fontSize: 13, color: '#a0aec0', marginTop: 8 }}>{plan.description}</div>
      </div>

      {/* Features */}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {plan.features.map((f) => (
          <li key={f.text} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
            <span style={{ color: f.included ? plan.accentColor : '#4a5568', flexShrink: 0, marginTop: 1 }}>
              {f.included ? '✓' : '–'}
            </span>
            <span style={{ color: f.included ? '#e2e8f0' : '#718096' }}>{f.text}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      {isPaid ? (
        <form onSubmit={(e) => { void handleUpgrade(e); }} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 'auto' }}>
          <input
            type="email"
            required
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              background: '#0f1117',
              border: '1px solid #4a5568',
              borderRadius: 6,
              color: '#f0f4f8',
              fontSize: 13,
              padding: '8px 12px',
              outline: 'none',
              width: '100%',
              boxSizing: 'border-box',
            }}
          />
          <button
            type="submit"
            disabled={loading === plan.id}
            style={{
              background: loading === plan.id ? '#2d3748' : plan.accentColor,
              color: loading === plan.id ? '#718096' : '#0f1117',
              border: 'none',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              padding: '10px 16px',
              cursor: loading === plan.id ? 'not-allowed' : 'pointer',
              transition: 'background 0.15s, opacity 0.15s',
              width: '100%',
            }}
          >
            {loading === plan.id ? 'Processing…' : plan.cta}
          </button>
          {error && loading === null && (
            <div style={{ fontSize: 11, color: '#fc8181', background: '#742a2a22', border: '1px solid #742a2a', borderRadius: 5, padding: '5px 8px' }}>
              ✗ {error}
            </div>
          )}
        </form>
      ) : (
        <a
          href="/subscriptions"
          style={{
            display: 'block',
            marginTop: 'auto',
            background: 'transparent',
            border: `1px solid ${plan.accentColor}55`,
            borderRadius: 8,
            color: plan.accentColor,
            fontSize: 13,
            fontWeight: 600,
            padding: '10px 16px',
            textAlign: 'center',
            textDecoration: 'none',
            transition: 'background 0.15s',
          }}
        >
          {plan.cta}
        </a>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PricingPage() {
  const [wasCancelled, setWasCancelled] = useState(false);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setWasCancelled(sp.get('cancelled') === '1');
  }, []);

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <h1 style={{ margin: '0 0 12px', fontSize: 28, fontWeight: 800, color: '#f0f4f8' }}>
          💳 Choose your plan
        </h1>
        <p style={{ margin: 0, fontSize: 15, color: '#718096', maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
          Start free, upgrade when you need more. All paid plans include a 14-day money-back guarantee.
        </p>
      </div>

      {/* Cancelled banner */}
      {wasCancelled && (
        <div
          style={{
            background: '#422a1a',
            border: '1px solid #c05621',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 32,
            fontSize: 13,
            color: '#fbd38d',
            textAlign: 'center',
          }}
        >
          ⚠️ Checkout was cancelled — your plan has not changed. You can try again below.
        </div>
      )}

      {/* Plan cards */}
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start' }}>
        {PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} />
        ))}
      </div>

      {/* Footer note */}
      <div style={{ textAlign: 'center', marginTop: 40, fontSize: 12, color: '#718096' }}>
        Payments are processed securely by{' '}
        <span style={{ color: '#a0aec0', fontWeight: 600 }}>Stripe</span>.
        Subscriptions renew monthly and can be cancelled at any time via{' '}
        <a href="/subscriptions" style={{ color: '#63b3ed', textDecoration: 'none' }}>
          Subscriptions
        </a>.
      </div>
    </div>
  );
}
