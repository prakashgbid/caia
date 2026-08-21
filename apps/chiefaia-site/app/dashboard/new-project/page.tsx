/**
 * /dashboard/new-project — two-panel factory explorer (STOL-5003, mock).
 *
 * Left panel lists all SF-## microfactories + CP-## control-plane
 * components grouped by macro stage per the STOL-1034 blueprint; right
 * panel shows mock scope / features / work items for the selection.
 */

import type { Metadata } from 'next';
import { DashboardGate } from '../../../components/dashboard-gate';
import { NewProjectWorkbench } from '../../../components/new-project-workbench';

export const metadata: Metadata = {
  title: 'New Project',
  description: 'Explore the CAIA factory stages your new project will flow through.',
  robots: { index: false, follow: false },
};

export default function DashboardNewProjectPage() {
  return (
    <DashboardGate>
      <div className="space-y-8">
        <section aria-labelledby="new-project-heading" className="space-y-3 pt-4">
          <h1
            id="new-project-heading"
            className="text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
          >
            New Project
          </h1>
          <p className="max-w-3xl text-muted-foreground">
            Every project flows through the CAIA factory: microfactories
            (SF-##) grouped into macro stages, wired on the kernel control
            plane (CP-##). Browse what each one does — intake opens here when
            project APIs ship.
          </p>
        </section>
        <NewProjectWorkbench />
      </div>
    </DashboardGate>
  );
}
