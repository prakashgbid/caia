/**
 * /projects — "Your Projects" surface on the marketing origin.
 *
 * Project data itself lives behind Cloudflare Access on the dashboard origin
 * (same auth model as /sign-in — see app/sign-in/page.tsx). This page is the
 * canonical chiefaia.com target for the header "Your Projects" link: a static
 * empty-state that routes signed-out visitors to sign-in and first-time users
 * into the new-project flow. No fabricated project data is rendered, per the
 * operator no-fabrication rule.
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
  title: 'Your Projects',
  description:
    'View and manage your ChiefAIA projects. Sign in to see the briefs and pipeline runs you own.',
  alternates: { canonical: '/projects' },
};

export const dynamic = 'force-static';

export default function ProjectsPage() {
  return (
    <div className="space-y-10">
      <section aria-labelledby="projects-heading" className="space-y-4 pt-4">
        <h1
          id="projects-heading"
          className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
        >
          Your Projects
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Every project is a brief plus the pipeline runs it produced. Projects
          live in your dashboard workspace behind sign-in — this page is where
          they surface once you are signed in.
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Nothing to show here yet</CardTitle>
          <CardDescription>
            Sign in to continue to your workspace, or start your first brief
            now — the 7-step pipeline takes it from there.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/projects/new"
              className={cn(buttonVariants({ size: 'lg' }))}
            >
              Create your first project
            </Link>
            <Link
              href="/sign-in"
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }))}
            >
              Sign in to continue
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
