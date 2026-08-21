/**
 * /dashboard — mock workspace landing (STOL-5003).
 *
 * Gated by the client-side mock-auth flag; signed-out visitors bounce to
 * /sign-in. Shows the "New Project" primary CTA plus sample project cards
 * (visual placeholders — continue-project is future scope). No backend.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { buttonVariants, cn } from '@caia/ui';
import { DashboardGate } from '../../components/dashboard-gate';
import { ProjectCard } from '../../components/project-card';
import { mockProjects } from '../../lib/mock-data';

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Your ChiefAIA workspace: start a new project or continue an existing one.',
  robots: { index: false, follow: false },
};

export default function DashboardPage() {
  return (
    <DashboardGate>
      <div className="space-y-12">
        <section aria-labelledby="dashboard-heading" className="space-y-4 pt-4">
          <h1
            id="dashboard-heading"
            className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          >
            Your workspace
          </h1>
          <p className="max-w-2xl text-muted-foreground">
            Start a new project and the pipeline takes it from brief to
            shipped software — or pick up one of your existing projects below.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/dashboard/new-project"
              className={cn(buttonVariants({ size: 'lg' }))}
              data-testid="dashboard-new-project"
            >
              New Project
            </Link>
          </div>
        </section>

        <section aria-labelledby="existing-projects-heading" className="space-y-6">
          <div className="space-y-2">
            <h2
              id="existing-projects-heading"
              className="text-2xl font-semibold tracking-tight text-foreground"
            >
              Continue an existing project
            </h2>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Sample data for preview — opening a project goes live with the
              project APIs in a future story.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {mockProjects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </section>
      </div>
    </DashboardGate>
  );
}
