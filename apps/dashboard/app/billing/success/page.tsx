'use client';
import { useEffect, useState } from 'react';
import { trackCheckoutCompleted } from '@chiefaia/analytics';

const PLAN_PRICES: Record<string, number> = { pro: 2900, enterprise: 9900 };

function readAndClearCartId(): string | undefined {
  const key = 'caia_checkout_cart_id';
  const id = sessionStorage.getItem(key) ?? undefined;
  sessionStorage.removeItem(key);
  return id;
}

export default function BillingSuccessPage() {
  const [params, setParams] = useState<{ plan: string; email: string } | null>(null);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const plan = sp.get('plan') ?? 'pro';
    const email = sp.get('email') ?? '';
    setParams({ plan, email });

    const cartId = readAndClearCartId();
    const price = PLAN_PRICES[plan] ?? 2900;
    const planName = plan === 'enterprise' ? 'Enterprise' : 'Pro';

    trackCheckoutCompleted({
      cart_id: cartId,
      value: price,
      item_count: 1,
      currency: 'USD',
      items: [{ product_id: plan, product_name: planName, price, currency: 'USD', quantity: 1 }],
    });
  }, []);

  const planLabel = params?.plan === 'enterprise' ? 'Enterprise' : 'Pro';
  const planColor = params?.plan === 'enterprise' ? '#d4a017' : '#63b3ed';

  return (
    <div
      style={{
        maxWidth: 520,
        margin: '60px auto',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
      }}
    >
      <div style={{ fontSize: 56 }}>🎉</div>

      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: '#f0f4f8' }}>
        Payment successful!
      </h1>

      <div
        style={{
          background: '#1e2535',
          border: `1px solid ${planColor}44`,
          borderRadius: 10,
          padding: '16px 24px',
          width: '100%',
        }}
      >
        <div style={{ fontSize: 13, color: '#718096', marginBottom: 8 }}>Active plan</div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: planColor,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          {planLabel}
        </div>
        {params?.email && (
          <div style={{ fontSize: 12, color: '#a0aec0', marginTop: 6, fontFamily: 'monospace' }}>
            {params.email}
          </div>
        )}
      </div>

      <p style={{ margin: 0, fontSize: 13, color: '#a0aec0', lineHeight: 1.6, maxWidth: 400 }}>
        Your subscription is now active. It may take a few seconds for the system to sync via
        Stripe webhooks. Check{' '}
        <a href="/subscriptions" style={{ color: '#63b3ed', textDecoration: 'none' }}>
          Subscriptions
        </a>{' '}
        to confirm your plan status.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <a
          href="/subscriptions"
          style={{
            background: '#2b6cb0',
            color: '#f0f4f8',
            borderRadius: 8,
            padding: '10px 20px',
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          View Subscriptions
        </a>
        <a
          href="/timeline"
          style={{
            background: 'transparent',
            border: '1px solid #4a5568',
            color: '#a0aec0',
            borderRadius: 8,
            padding: '10px 20px',
            fontSize: 13,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Go to Dashboard
        </a>
      </div>
    </div>
  );
}
