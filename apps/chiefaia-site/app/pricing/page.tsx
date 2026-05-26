/**
 * /pricing — subscription tier placeholder.
 *
 * Prices are NOT operator-confirmed yet. Render as TBD per the doctrine in
 * `agent-memory/feedback_action_research_outputs.md` — no fabricated dollar
 * figures. Copy describing each tier IS operator-confirmed (subscription-only,
 * Claude Max underlying, professional + team + free).
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  buttonVariants,
  cn,
} from '@caia/ui';
import { pricingTiers } from '../../lib/site-config';

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Subscription tiers for ChiefAIA. Free for the sample brief, professional for solo operators, team for shared agent fleets. Pricing TBD — operator has not signed off on dollar figures yet.',
  alternates: { canonical: '/pricing' },
};

export const dynamic = 'force-static';

export default function PricingPage() {
  return (
    <div className="space-y-12">
      <header className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Pricing
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          Subscription — Claude Max underlying
        </h1>
        <p className="max-w-3xl text-muted-foreground">
          ChiefAIA is subscription-only. Tier names and feature sets below are
          operator-confirmed; per-tier prices are TBD until the operator signs
          off, so dollar figures show as placeholders here on purpose.
        </p>
      </header>

      <section
        aria-label="Pricing tiers"
        className="grid gap-6 md:grid-cols-3"
      >
        {pricingTiers.map((tier) => (
          <Card
            key={tier.slug}
            className={cn(
              'flex h-full flex-col',
              tier.highlighted && 'border-primary shadow-md'
            )}
            data-testid={`pricing-${tier.slug}`}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{tier.name}</CardTitle>
                {tier.highlighted ? (
                  <Badge variant="secondary">Most popular</Badge>
                ) : null}
              </div>
              <CardDescription>{tier.description}</CardDescription>
              <p
                className="mt-4 text-3xl font-semibold text-foreground"
                aria-label={`${tier.name} price ${tier.priceLabel}`}
              >
                {tier.priceLabel}
              </p>
              <p className="text-xs text-muted-foreground">
                Operator has not confirmed pricing yet · placeholder
              </p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span aria-hidden>•</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter className="mt-auto">
              <Link
                href={tier.ctaHref}
                className={cn(
                  buttonVariants({
                    variant: tier.highlighted ? 'default' : 'outline',
                    size: 'default',
                  }),
                  'w-full'
                )}
              >
                {tier.ctaLabel}
              </Link>
            </CardFooter>
          </Card>
        ))}
      </section>

      <section
        aria-labelledby="pricing-faq"
        className="space-y-4 rounded-xl border border-border bg-card p-8 text-card-foreground"
      >
        <h2 id="pricing-faq" className="text-xl font-semibold">
          What&apos;s confirmed vs. what&apos;s TBD
        </h2>
        <dl className="space-y-3 text-sm text-muted-foreground">
          <div>
            <dt className="font-medium text-foreground">Confirmed</dt>
            <dd>
              Subscription-only model. Claude Max as the underlying LLM
              capacity for the Professional and Team tiers. Three tiers — Free,
              Professional, Team.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">TBD</dt>
            <dd>
              Per-tier dollar pricing, billing cadence, included run quotas,
              and team-seat caps. We will not publish numbers we haven&apos;t
              committed to.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
