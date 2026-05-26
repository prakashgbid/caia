/**
 * Home page.
 *
 * Hero copy is OPERATOR-CONFIRMED ONLY. Per
 * `agent-memory/feedback_action_research_outputs.md` no fabricated metrics,
 * testimonials, or authorship may appear on the marketing surface. The
 * "What ChiefAIA does" section describes the 7-step pipeline as a feature
 * list — no anecdotal claims, no quoted users.
 */

import Link from 'next/link';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  buttonVariants,
  cn,
} from '@caia/ui';
import { siteConfig, dashboardUrl } from '../lib/site-config';

const pipelineSteps = [
  {
    n: 1,
    name: 'Brief intake',
    description:
      'Operator hands ChiefAIA a product brief. The interviewer agent fills in the gaps.',
  },
  {
    n: 2,
    name: 'Decomposition',
    description:
      'The decomposer produces a tree of buckets, stories, and tasks with explicit acceptance criteria.',
  },
  {
    n: 3,
    name: 'Architecture',
    description:
      'The architect agent reuses the canonical packages first and plans new ones only if no candidate exists.',
  },
  {
    n: 4,
    name: 'Implementation',
    description:
      'Specialist agents pick up tasks from the dispatch queue and produce code that passes the per-story tests.',
  },
  {
    n: 5,
    name: 'Verification',
    description:
      'Verifier + critic agents check the work against the acceptance criteria before the evidence gate runs.',
  },
  {
    n: 6,
    name: 'Evidence gate',
    description:
      'Typecheck, tests, lint, lighthouse, axe, visual baselines, size — all required, all deterministic.',
  },
  {
    n: 7,
    name: 'Ship',
    description:
      'PR opens, reviewers sign off, the True-Zero merge ships the change to develop.',
  },
] as const;

export default function HomePage() {
  return (
    <div className="space-y-24">
      <section aria-labelledby="hero-heading" className="space-y-8 pt-8">
        <Badge variant="outline" className="px-3 py-1">
          Subscription · Claude Max underlying
        </Badge>
        <h1
          id="hero-heading"
          className="text-balance text-4xl font-semibold leading-tight tracking-tight text-foreground sm:text-5xl md:text-6xl"
        >
          {siteConfig.tagline}.
        </h1>
        <p className="max-w-2xl text-balance text-lg text-muted-foreground">
          {siteConfig.description}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/sign-in"
            className={cn(buttonVariants({ size: 'lg' }))}
          >
            Get started
          </Link>
          <Link
            href="/docs"
            className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}
          >
            Read the docs
          </Link>
          <a
            href={dashboardUrl}
            className={cn(buttonVariants({ variant: 'ghost', size: 'lg' }))}
            rel="noopener noreferrer"
          >
            Open dashboard
          </a>
        </div>
      </section>

      <section aria-labelledby="pipeline-heading" className="space-y-8">
        <div className="space-y-3">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            The 7-step pipeline
          </p>
          <h2
            id="pipeline-heading"
            className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          >
            What ChiefAIA does
          </h2>
          <p className="max-w-3xl text-muted-foreground">
            Every brief flows through the same seven steps. Each step has a
            named owner agent, deterministic gates, and explicit acceptance
            criteria — so the pipeline is auditable end to end.
          </p>
        </div>
        <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {pipelineSteps.map((step) => (
            <li key={step.n}>
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary">{`Step ${step.n}`}</Badge>
                    <CardTitle>{step.name}</CardTitle>
                  </div>
                  <CardDescription>{step.description}</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="how-it-works" className="space-y-6">
        <h2
          id="how-it-works"
          className="text-3xl font-semibold tracking-tight text-foreground"
        >
          Built for operators who ship
        </h2>
        <div className="grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Reuse-first</CardTitle>
              <CardDescription>
                Every agent checks the workspace for a reusable package before
                writing new code. The discipline is enforced by Semgrep + a
                blocking CI gate (ADR-065).
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Evidence gate</CardTitle>
              <CardDescription>
                Typecheck, tests, lint, lighthouse, axe, visual baselines, and
                size budgets are all required status checks on every PR.
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Operator-confirmed copy</CardTitle>
              <CardDescription>
                The marketing site and the agent roster ship only what the
                operator has signed off on — no fabricated metrics,
                testimonials, or authorship.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      <section
        aria-labelledby="cta-heading"
        className="rounded-xl border border-border bg-card p-10 text-card-foreground"
      >
        <h2
          id="cta-heading"
          className="text-2xl font-semibold tracking-tight"
        >
          Ready to point ChiefAIA at a brief?
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Subscription pricing is in progress. Open the dashboard to walk through
          the operator-shared sample brief, or contact us if you want a deeper
          look.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/pricing"
            className={cn(buttonVariants({ size: 'lg' }))}
          >
            See pricing
          </Link>
          <Link
            href="/contact"
            className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}
          >
            Contact us
          </Link>
        </div>
      </section>
    </div>
  );
}

export const dynamic = 'force-static';
