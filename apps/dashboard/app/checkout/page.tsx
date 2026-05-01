'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import {
  trackCartViewed,
  trackProductViewed,
  trackAddToCart,
  trackCartUpdated,
  trackCartAbandoned,
  trackCheckoutStarted,
  trackCheckoutAbandoned,
  trackCartRecovered,
  trackCartRecoveryEmailClicked,
} from '@chiefaia/analytics';

type Plan = 'pro' | 'enterprise';

interface PlanData {
  id: string;
  name: string;
  price: number;
  period: string;
  description: string;
  features: Array<{ text: string; included: boolean }>;
}

interface AnalyticsLogEntry {
  event: string;
  ts: number;
}

interface PersistedCart {
  cart_id: string;
  plan: Plan | null;
  timestamp: number;
}

const CART_PERSISTENCE_KEY = 'caia_checkout_cart';
const ABANDONMENT_MIN_MS = 2 * 60 * 1000;
const ABANDONMENT_MAX_MS = 24 * 60 * 60 * 1000;
const EXIT_INTENT_DELAY_MS = 15_000;

function loadPersistedCart(): PersistedCart | null {
  try {
    const raw = localStorage.getItem(CART_PERSISTENCE_KEY);
    return raw ? (JSON.parse(raw) as PersistedCart) : null;
  } catch {
    return null;
  }
}

function persistCart(cart_id: string, plan: Plan | null): void {
  try {
    localStorage.setItem(CART_PERSISTENCE_KEY, JSON.stringify({ cart_id, plan, timestamp: Date.now() }));
  } catch {}
}

function clearPersistedCart(): void {
  try { localStorage.removeItem(CART_PERSISTENCE_KEY); } catch {}
}

function getOrCreateCartId(): string {
  const key = 'caia_checkout_cart_id';
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const id = `cart_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  sessionStorage.setItem(key, id);
  return id;
}

function planToCartItem(plan: PlanData) {
  return {
    product_id: plan.id,
    product_name: plan.name,
    price: plan.price,
    currency: 'USD',
    quantity: 1,
  };
}

const EVENT_LABELS: Record<string, string> = {
  cart_viewed: 'Cart Viewed',
  product_viewed: 'Plan Viewed',
  add_to_cart: 'Plan Added',
  cart_updated: 'Cart Updated',
  checkout_started: 'Checkout Started',
  cart_abandoned: 'Cart Abandoned',
  checkout_abandoned: 'Checkout Abandoned',
  cart_recovered: 'Cart Recovered',
  cart_recovery_email_clicked: 'Recovery Email Clicked',
};

function AnalyticsEventLog({ events }: { events: AnalyticsLogEntry[] }) {
  if (events.length === 0) return null;
  return (
    <div
      style={{
        marginTop: 32,
        padding: '10px 16px',
        background: '#0d1117',
        border: '1px solid #1e2535',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        fontSize: 11,
        color: '#4a5568',
      }}
    >
      <span style={{ color: '#2d3748', fontWeight: 600, flexShrink: 0 }}>Analytics:</span>
      {events.map((e, i) => (
        <span key={e.ts} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {i > 0 && <span style={{ color: '#2d3748' }}>→</span>}
          <span
            style={{
              background: '#1a202c',
              border: '1px solid #2d3748',
              borderRadius: 4,
              padding: '2px 7px',
              color: '#718096',
              fontFamily: 'monospace',
            }}
          >
            {EVENT_LABELS[e.event] ?? e.event}
          </span>
        </span>
      ))}
    </div>
  );
}

function useCheckout() {
  const [plans, setPlans] = useState<PlanData[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/checkout/plans')
      .then((r) => r.json() as Promise<{ plans: PlanData[] }>)
      .then((d) => setPlans(d.plans.filter((p) => p.id !== 'free')))
      .catch(() => setError('Failed to load plans'))
      .finally(() => setLoading(false));
  }, []);

  const startCheckout = useCallback(async (email: string, plan: Plan) => {
    setCheckoutLoading(plan);
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
      setCheckoutLoading(null);
    }
  }, []);

  return { plans, loading, checkoutLoading, error, setError, startCheckout };
}

function CheckoutForm({ plan, onSubmit, loading, error }: {
  plan: PlanData;
  onSubmit: (email: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}) {
  const [email, setEmail] = useState('');

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    void onSubmit(email);
  }, [email, onSubmit]);

  const planColor = plan.id === 'enterprise' ? '#d4a017' : '#63b3ed';

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <input
        type="email"
        required
        placeholder="your@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={loading}
        style={{
          background: '#0f1117',
          border: '1px solid #4a5568',
          borderRadius: 6,
          color: '#f0f4f8',
          fontSize: 13,
          padding: '10px 12px',
          outline: 'none',
          opacity: loading ? 0.6 : 1,
          cursor: loading ? 'not-allowed' : 'text',
        }}
      />
      <button
        type="submit"
        disabled={loading || !email}
        style={{
          background: loading ? '#2d3748' : planColor,
          color: loading ? '#718096' : '#0f1117',
          border: 'none',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 700,
          padding: '10px 16px',
          cursor: loading || !email ? 'not-allowed' : 'pointer',
          opacity: loading || !email ? 0.6 : 1,
          transition: 'opacity 0.15s',
        }}
      >
        {loading ? 'Processing…' : `Continue to ${plan.name}`}
      </button>
      {error && (
        <div style={{
          fontSize: 12,
          color: '#fc8181',
          background: '#742a2a22',
          border: '1px solid #742a2a',
          borderRadius: 5,
          padding: '6px 8px',
        }}>
          ✗ {error}
        </div>
      )}
    </form>
  );
}

function PlanCard({ plan, isSelected, onSelect, onCheckout, loading, error }: {
  plan: PlanData;
  isSelected: boolean;
  onSelect: () => void;
  onCheckout: (email: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}) {
  const planColor = plan.id === 'enterprise' ? '#d4a017' : '#63b3ed';

  return (
    <div
      style={{
        background: '#1e2535',
        border: `1px solid ${isSelected ? planColor : '#2d3748'}`,
        borderRadius: 12,
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        flex: 1,
        minWidth: 280,
        maxWidth: 360,
        position: 'relative',
        boxShadow: isSelected ? `0 0 0 1px ${planColor}33` : 'none',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        cursor: 'pointer',
      }}
      onClick={onSelect}
    >
      {/* Header */}
      <div>
        <div style={{
          fontSize: 12,
          fontWeight: 700,
          color: planColor,
          marginBottom: 6,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          {plan.name}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
          <span style={{ fontSize: 32, fontWeight: 800, color: '#f0f4f8' }}>
            ${(plan.price / 100).toFixed(0)}
          </span>
          <span style={{ fontSize: 12, color: '#718096' }}>/month</span>
        </div>
        <div style={{ fontSize: 13, color: '#a0aec0', marginTop: 8 }}>{plan.description}</div>
      </div>

      {/* Features */}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {plan.features.map((f) => (
          <li key={f.text} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12 }}>
            <span style={{ color: f.included ? planColor : '#4a5568', flexShrink: 0, marginTop: 2 }}>
              {f.included ? '✓' : '–'}
            </span>
            <span style={{ color: f.included ? '#e2e8f0' : '#718096' }}>{f.text}</span>
          </li>
        ))}
      </ul>

      {/* Selection indicator & checkout form */}
      <div style={{
        borderTop: '1px solid #2d3748',
        paddingTop: 16,
        marginTop: 'auto',
      }}>
        {isSelected ? (
          <CheckoutForm
            plan={plan}
            onSubmit={onCheckout}
            loading={loading}
            error={error}
          />
        ) : (
          <button
            type="button"
            style={{
              width: '100%',
              background: 'transparent',
              border: `1px solid ${planColor}55`,
              borderRadius: 6,
              color: planColor,
              fontSize: 12,
              fontWeight: 600,
              padding: '8px 12px',
              cursor: 'pointer',
              transition: 'background 0.15s, border-color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = `${planColor}11`;
              e.currentTarget.style.borderColor = `${planColor}77`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.borderColor = `${planColor}55`;
            }}
          >
            Select Plan
          </button>
        )}
      </div>
    </div>
  );
}

function ReturnVisitorBanner({ planName, onDismiss }: { planName: string | null; onDismiss: () => void }) {
  return (
    <div style={{
      background: '#0d1f2d',
      border: '1px solid #2c5282',
      borderRadius: 8,
      padding: '12px 16px',
      marginBottom: 24,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      fontSize: 13,
      color: '#90cdf4',
      gap: 12,
    }}>
      <span>
        ↩ Welcome back!{' '}
        {planName
          ? <><strong style={{ color: '#bee3f8' }}>{planName}</strong> is ready — just enter your email to complete.</>
          : 'Pick up where you left off.'}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{ background: 'transparent', border: 'none', color: '#718096', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
      >
        ×
      </button>
    </div>
  );
}

function ExitIntentBanner({ planName, onStay, onDismiss }: {
  planName: string | null;
  onStay: () => void;
  onDismiss: () => void;
}) {
  return (
    <>
      <style>{`@keyframes caia-slide-up{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      <div
        role="dialog"
        aria-live="polite"
        style={{
          position: 'fixed',
          bottom: 0, left: 0, right: 0,
          background: '#111a14',
          border: '1px solid #276749',
          borderBottom: 'none',
          borderRadius: '12px 12px 0 0',
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 20,
          zIndex: 1000,
          boxShadow: '0 -4px 32px rgba(0,0,0,0.5)',
          animation: 'caia-slide-up 0.25s ease-out',
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#f0f4f8', marginBottom: 4 }}>Wait — before you go!</div>
          <div style={{ fontSize: 12, color: '#a0aec0' }}>
            {planName
              ? `Your ${planName} plan is selected. Complete your upgrade in under 2 minutes.`
              : 'Your plan is ready. Complete your upgrade in under 2 minutes.'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={onStay}
            style={{ background: '#276749', color: '#f0fff4', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, padding: '8px 14px', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Continue upgrade
          </button>
          <button
            type="button"
            onClick={onDismiss}
            style={{ background: 'transparent', color: '#718096', border: '1px solid #4a5568', borderRadius: 6, fontSize: 12, padding: '8px 12px', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            No thanks
          </button>
        </div>
      </div>
    </>
  );
}

export default function CheckoutPage() {
  const { plans, loading, checkoutLoading, error, setError, startCheckout } = useCheckout();
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [wasCancelled, setWasCancelled] = useState(false);
  const [analyticsLog, setAnalyticsLog] = useState<AnalyticsLogEntry[]>([]);
  const [showReturnBanner, setShowReturnBanner] = useState(false);
  const [returnedPlanName, setReturnedPlanName] = useState<string | null>(null);
  const [showExitIntent, setShowExitIntent] = useState(false);
  const cartIdRef = useRef<string>('');
  const cartViewedAtRef = useRef<number>(0);
  const checkoutCompletedRef = useRef(false);
  const selectedPlanRef = useRef<Plan | null>(null);
  const exitIntentShownRef = useRef(false);
  const pageLoadTimeRef = useRef(Date.now());

  // Keep selectedPlanRef in sync for use inside event listener closures
  useEffect(() => { selectedPlanRef.current = selectedPlan; }, [selectedPlan]);

  const logEvent = useCallback((event: string) => {
    setAnalyticsLog((prev) => [...prev, { event, ts: Date.now() }]);
  }, []);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setWasCancelled(sp.get('cancelled') === '1');
  }, []);

  // Detect returning visitor from abandoned cart (localStorage survives tab close)
  useEffect(() => {
    const persisted = loadPersistedCart();
    if (!persisted) return;
    const age = Date.now() - persisted.timestamp;
    if (age > ABANDONMENT_MAX_MS) { clearPersistedCart(); return; }
    if (age < ABANDONMENT_MIN_MS) return;
    setShowReturnBanner(true);
    if (persisted.plan) setSelectedPlan(persisted.plan);
  }, []);

  // Initialise cart on mount (after plans load), fire recovery events, track abandonment on unload
  useEffect(() => {
    if (loading || plans.length === 0) return;

    cartIdRef.current = getOrCreateCartId();
    cartViewedAtRef.current = Date.now();

    const sp = new URLSearchParams(window.location.search);
    const fromEmail = sp.get('from_email') === '1';
    const persisted = loadPersistedCart();
    const age = persisted ? Date.now() - persisted.timestamp : 0;
    const isReturning = !!persisted && age >= ABANDONMENT_MIN_MS && age <= ABANDONMENT_MAX_MS;

    if (isReturning && persisted) {
      trackCartRecovered({ cart_id: persisted.cart_id, currency: 'USD' });
      logEvent('cart_recovered');
      if (fromEmail) {
        trackCartRecoveryEmailClicked({ cart_id: persisted.cart_id });
        logEvent('cart_recovery_email_clicked');
      }
      const planData = plans.find((p) => p.id === persisted.plan);
      if (planData) setReturnedPlanName(planData.name);
    }

    trackCartViewed({
      cart_id: cartIdRef.current,
      item_count: selectedPlanRef.current ? 1 : 0,
      currency: 'USD',
    });
    logEvent('cart_viewed');
    persistCart(cartIdRef.current, selectedPlanRef.current);

    const handleBeforeUnload = () => {
      if (checkoutCompletedRef.current) return;
      persistCart(cartIdRef.current, selectedPlanRef.current);
      const timeInCart = Math.round((Date.now() - cartViewedAtRef.current) / 1000);
      trackCartAbandoned({
        cart_id: cartIdRef.current,
        time_in_cart_seconds: timeInCart,
        currency: 'USD',
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, plans]);

  // Exit intent: fires when cursor leaves viewport toward browser chrome after 15s
  useEffect(() => {
    const handleMouseLeave = (e: MouseEvent) => {
      if (exitIntentShownRef.current) return;
      if (e.clientY > 10) return;
      if (Date.now() - pageLoadTimeRef.current < EXIT_INTENT_DELAY_MS) return;
      exitIntentShownRef.current = true;
      setShowExitIntent(true);
    };
    document.addEventListener('mouseleave', handleMouseLeave);
    return () => document.removeEventListener('mouseleave', handleMouseLeave);
  }, []);

  // Track checkout-cancelled (Stripe redirect back with ?cancelled=1)
  useEffect(() => {
    if (!wasCancelled || !cartIdRef.current) return;
    trackCheckoutAbandoned({ cart_id: cartIdRef.current, step: 'stripe' });
    logEvent('checkout_abandoned');
  }, [wasCancelled, logEvent]);

  const handlePlanSelect = useCallback((plan: PlanData) => {
    const cartId = cartIdRef.current;
    const item = planToCartItem(plan);

    trackProductViewed({
      product_id: plan.id,
      product_name: plan.name,
      price: plan.price,
      currency: 'USD',
    });
    logEvent('product_viewed');

    if (selectedPlan && selectedPlan !== plan.id) {
      trackCartUpdated({
        cart_id: cartId,
        value: plan.price,
        item_count: 1,
        currency: 'USD',
        items: [item],
      });
      logEvent('cart_updated');
    } else {
      trackAddToCart(item);
      logEvent('add_to_cart');
    }

    setSelectedPlan(plan.id as Plan);
    selectedPlanRef.current = plan.id as Plan;
    persistCart(cartIdRef.current, plan.id as Plan);
    setError(null);
  }, [selectedPlan, setError, logEvent]);

  const handleCheckout = useCallback(async (email: string) => {
    if (!selectedPlan) return;
    const plan = plans.find((p) => p.id === selectedPlan);
    if (!plan) return;

    trackCheckoutStarted({
      cart_id: cartIdRef.current,
      value: plan.price,
      item_count: 1,
      currency: 'USD',
      items: [planToCartItem(plan)],
    });
    logEvent('checkout_started');

    checkoutCompletedRef.current = true;
    clearPersistedCart();
    await startCheckout(email, selectedPlan);
    // If startCheckout returns without redirect (error), reset so abandonment fires
    checkoutCompletedRef.current = false;
  }, [selectedPlan, plans, startCheckout, logEvent]);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '60vh',
        fontSize: 13,
        color: '#718096',
      }}>
        Loading plans…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <h1 style={{ margin: '0 0 12px', fontSize: 28, fontWeight: 800, color: '#f0f4f8' }}>
          Complete your upgrade
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: '#718096', maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
          Select your plan and enter your email to proceed with payment via Stripe.
        </p>
      </div>

      {/* Returning visitor recovery banner */}
      {showReturnBanner && (
        <ReturnVisitorBanner
          planName={returnedPlanName}
          onDismiss={() => setShowReturnBanner(false)}
        />
      )}

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
          ⚠️ Checkout was cancelled. You can try again below.
        </div>
      )}

      {/* Plan cards */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'stretch' }}>
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            isSelected={selectedPlan === plan.id}
            onSelect={() => handlePlanSelect(plan)}
            onCheckout={handleCheckout}
            loading={checkoutLoading === plan.id}
            error={checkoutLoading === plan.id ? error : null}
          />
        ))}
      </div>

      {/* Analytics event log */}
      <AnalyticsEventLog events={analyticsLog} />

      {/* Footer */}
      <div style={{ textAlign: 'center', marginTop: 40, fontSize: 12, color: '#718096' }}>
        Payments are processed securely by{' '}
        <span style={{ color: '#a0aec0', fontWeight: 600 }}>Stripe</span>. Subscriptions renew monthly and can be cancelled anytime via{' '}
        <a href="/subscriptions" style={{ color: '#63b3ed', textDecoration: 'none' }}>
          Subscriptions
        </a>.
      </div>

      {/* Help */}
      <div style={{ textAlign: 'center', marginTop: 24, marginBottom: showExitIntent ? 80 : 0, fontSize: 12, color: '#718096' }}>
        <a href="/pricing" style={{ color: '#63b3ed', textDecoration: 'none', marginRight: 12 }}>
          ← Back to pricing
        </a>
        <a href="/subscriptions" style={{ color: '#63b3ed', textDecoration: 'none' }}>
          View subscriptions →
        </a>
      </div>

      {/* Exit intent banner */}
      {showExitIntent && (
        <ExitIntentBanner
          planName={plans.find((p) => p.id === selectedPlan)?.name ?? null}
          onStay={() => setShowExitIntent(false)}
          onDismiss={() => setShowExitIntent(false)}
        />
      )}
    </div>
  );
}
