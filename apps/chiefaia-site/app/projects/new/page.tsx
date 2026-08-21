/**
 * /projects/new — "New Project" entry point on the marketing origin.
 *
 * The real brief-intake flow (pipeline step 1) runs in the dashboard behind
 * Cloudflare Access, so this page is a static placeholder that explains what
 * starting a project means and hands the visitor to sign-in. It deliberately
 * ships no client-side form: there is no unauthenticated intake API, and a
 * fake form would violate the no-temporary-work rule.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  buttonVariants,
  cn,
} from '@caia/ui';

export const metadata: Metadata = {
  title: 'New Project',
  description:
    'Start a new ChiefAIA project: hand the pipeline a product brief and the interviewer agent fills in the gaps.',
  alternates: { canonical: '/projects/new' },
};

export const dynamic = 'force-static';

export default function NewProjectPage() {
  return (
    <div className="space-y-10">
      <section aria-labelledby="new-project-heading" className="space-y-4 pt-4">
        <h1
          id="new-project-heading"
          className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
        >
          New Project
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          A project starts with a product brief — a plain description of what
          you want built. Brief intake is step 1 of the pipeline: the
          interviewer agent reads your brief and fills in the gaps before
          decomposition begins.
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Start with a brief</CardTitle>
          <CardDescription>
            Brief intake runs in your dashboard workspace. Sign in to continue
            and hand ChiefAIA your first brief, or read the docs to see what a
            good brief looks like.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/sign-in"
              className={cn(buttonVariants({ size: 'lg' }))}
            >
              Sign in to continue
            </Link>
            <Link
              href="/docs/getting-started"
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}
            >
              Read the docs
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
