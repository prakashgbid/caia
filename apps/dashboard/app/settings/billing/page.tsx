'use client';
/**
 * /settings/billing — tier picker + plan status.
 *
 * UI primitives strictly from `@caia/ui` per the reuse-first gate
 * (PR #597). No raw shadcn / Tailwind imports here.
 */

import { useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
} from '@caia/ui';

// Tier table mirrored from `@caia/billing` so the page is a Client
// Component without needing to ship the whole billing package
// browser-side. Keep in sync with packages/billing/src/types.ts.
const TIERS = [
  {
    tier: 'free' as const,
    displayName: 'Free',
    priceUsdMonthly: 0,
    features: [
      '1 project',
      'Community support',
      'Subscription-only AI during BUILD',
    ],
  },
  {
    tier: 'professional' as const,
    displayName: 'Professional',
    priceUsdMonthly: 49,
    features: [
      '10 projects',
      'Email support',
      'Higher build throughput',
      'BYOK runtime credits',
    ],
  },
  {
    tier: 'team' as const,
    displayName: 'Team',
    priceUsdMonthly: 99,
    features: [
      'Unlimited projects',
      'Priority support',
      'SSO',
      'BYOK runtime credits',
      'Audit log export',
    ],
  },
];

type Tier = (typeof TIERS)[number]['tier'];

export default function BillingPage() {
  const [busyTier, setBusyTier] = useState<Tier | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async (tier: Exclude<Tier, 'free'>) => {
    setBusyTier(tier);
    setError(null);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, customerEmail: 'me@example.com' }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? `checkout failed (${res.status})`);
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyTier(null);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Billing</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Pick a CAIA subscription tier. Runtime credits for the apps you
        build are handled separately — see <a href="/settings/runtime-keys" className="underline">Runtime keys</a>.
      </p>
      {error && (
        <Card className="mb-4 border-destructive">
          <CardContent className="pt-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {TIERS.map((t) => (
          <Card key={t.tier}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                {t.displayName}
                {t.tier === 'professional' && <Badge>Popular</Badge>}
              </CardTitle>
              <CardDescription>
                {t.priceUsdMonthly === 0 ? 'Free forever' : `$${t.priceUsdMonthly} / month`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="text-sm space-y-1 mb-4">
                {t.features.map((f) => (
                  <li key={f}>• {f}</li>
                ))}
              </ul>
              {t.tier === 'free' ? (
                <Button variant="outline" disabled>
                  Current default
                </Button>
              ) : (
                <Button
                  onClick={() => start(t.tier as Exclude<Tier, 'free'>)}
                  disabled={busyTier !== null}
                >
                  {busyTier === t.tier ? 'Redirecting…' : `Choose ${t.displayName}`}
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
