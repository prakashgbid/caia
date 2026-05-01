import { NextResponse } from 'next/server';

export interface CartFunnel {
  cartViewed: number;
  itemAdded: number;
  checkoutStarted: number;
  checkoutCompleted: number;
  abandoned: number;
}

export interface CartEvent {
  id: string;
  type: 'cart_viewed' | 'cart_abandoned' | 'cart_recovered' | 'checkout_started' | 'checkout_abandoned' | 'checkout_completed';
  cartId: string;
  plan: string;
  value: number;
  status: 'abandoned' | 'recovered' | 'in-progress' | 'completed';
  timestamp: string;
}

export interface CartAbandonmentData {
  period: '24h' | '7d' | '30d';
  abandonmentRate: number;
  recoveryRate: number;
  totalSessions: number;
  abandonedSessions: number;
  recoveredSessions: number;
  revenueAtRisk: number;
  recoveredRevenue: number;
  avgTimeToAbandon: number;
  funnel: CartFunnel;
  recentEvents: CartEvent[];
  updatedAt: string;
}

const PLANS = ['Pro Monthly', 'Pro Annual', 'Enterprise'];
const PLAN_VALUES: Record<string, number> = { 'Pro Monthly': 29, 'Pro Annual': 290, 'Enterprise': 299 };

function randomId(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600_000).toISOString();
}

function buildMockData(period: '24h' | '7d' | '30d'): CartAbandonmentData {
  const multiplier = period === '24h' ? 1 : period === '7d' ? 7 : 30;
  const base = 48 * multiplier;

  const cartViewed = base + Math.floor(Math.random() * 20);
  const itemAdded = Math.floor(cartViewed * 0.61);
  const checkoutStarted = Math.floor(itemAdded * 0.54);
  const checkoutCompleted = Math.floor(checkoutStarted * 0.38);
  const abandoned = checkoutStarted - checkoutCompleted;

  const abandonmentRate = cartViewed > 0 ? Math.round((1 - checkoutCompleted / cartViewed) * 1000) / 10 : 0;
  const recoveredSessions = Math.floor(abandoned * 0.18);
  const recoveryRate = abandoned > 0 ? Math.round((recoveredSessions / abandoned) * 1000) / 10 : 0;

  const revenueAtRisk = abandoned * 29;
  const recoveredRevenue = recoveredSessions * 29;

  const recentEvents: CartEvent[] = Array.from({ length: 12 }, (_, i) => {
    const plan = PLANS[Math.floor(Math.random() * PLANS.length)]!;
    const types: CartEvent['type'][] = ['cart_abandoned', 'cart_recovered', 'checkout_abandoned', 'checkout_completed', 'cart_viewed'];
    const type = types[Math.floor(Math.random() * types.length)]!;
    const statusMap: Record<CartEvent['type'], CartEvent['status']> = {
      cart_abandoned: 'abandoned',
      cart_recovered: 'recovered',
      checkout_abandoned: 'abandoned',
      checkout_completed: 'completed',
      cart_viewed: 'in-progress',
      checkout_started: 'in-progress',
    };
    return {
      id: randomId(),
      type,
      cartId: `cart-${randomId()}`,
      plan,
      value: PLAN_VALUES[plan] ?? 29,
      status: statusMap[type],
      timestamp: hoursAgo(i * (period === '24h' ? 2 : period === '7d' ? 14 : 60)),
    };
  });

  return {
    period,
    abandonmentRate,
    recoveryRate,
    totalSessions: cartViewed,
    abandonedSessions: abandoned,
    recoveredSessions,
    revenueAtRisk,
    recoveredRevenue,
    avgTimeToAbandon: 4.2,
    funnel: { cartViewed, itemAdded, checkoutStarted, checkoutCompleted, abandoned },
    recentEvents,
    updatedAt: new Date().toISOString(),
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const period = (['24h', '7d', '30d'] as const).find((p) => p === searchParams.get('period')) ?? '7d';
  return NextResponse.json(buildMockData(period));
}
