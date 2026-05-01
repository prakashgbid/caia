'use client';
import { useEffect } from 'react';
import { trackCheckoutAbandoned } from '@chiefaia/analytics';

function getCartId(): string | undefined {
  return sessionStorage.getItem('caia_checkout_cart_id') ?? undefined;
}

export default function BillingCancelPage() {
  useEffect(() => {
    trackCheckoutAbandoned({ cart_id: getCartId(), step: 'stripe', currency: 'USD' });
  }, []);

  return (
    <div
      style={{
        maxWidth: 480,
        margin: '60px auto',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
      }}
    >
      <div style={{ fontSize: 52 }}>↩️</div>

      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#f0f4f8' }}>
        Checkout cancelled
      </h1>

      <p style={{ margin: 0, fontSize: 13, color: '#a0aec0', lineHeight: 1.6, maxWidth: 360 }}>
        No payment was taken. Your plan has not changed. You can retry or return to the
        dashboard at any time.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <a
          href="/pricing"
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
          Back to Pricing
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
