/**
 * Wizard Step 4 — Information Architecture.
 *
 * Phase B B6 (2026-05-31): now renders the live architecture step
 * stub PLUS the `<CriticFeedbackPanel>` underneath when the prior
 * runIA returned `approved-with-modifications`. The runIA verdict is
 * passed in via searchParams (`criticKind=approved-with-modifications`)
 * so this server component can stay statically-render-friendly. A
 * follow-up minor PR will swap the searchParam wiring for a live
 * Pg-backed read of the most recent runIA verdict for the project.
 *
 * Reuse-first: every primitive comes from `@caia/ui`; step metadata
 * comes from `lib/wizard/steps.ts`; the modification surface is the
 * shared `<CriticFeedbackPanel>` (also used by the interview step).
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';
import { findStepBySlug } from '../../../lib/wizard/steps';
import { ArchitectureCriticBridge } from '../../../components/wizard/ArchitectureCriticBridge';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    projectId?: string;
    criticKind?: 'approved-with-modifications' | 'coverage-insufficient';
  }>;
}

export default async function ArchitecturePage({
  searchParams,
}: PageProps): Promise<React.JSX.Element> {
  const sp = await Promise.resolve(searchParams);
  const projectId = sp.projectId ?? 'p-pending';
  const criticKind = sp.criticKind;

  const step = findStepBySlug('architecture');
  if (!step) {
    throw new Error('architecture-step-missing-from-catalog');
  }
  return (
    <Card data-testid="wizard-step-stub-architecture">
      <CardHeader>
        <CardTitle>{step.title}</CardTitle>
        <CardDescription>{step.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p style={{ opacity: 0.7, marginBottom: 16 }}>
          Step {step.index} of 7 — runIA orchestration lands in a Wave 2
          minor PR. When that ships, this page reads the IA verdict +
          modifications from the run endpoint and the panel below
          renders inline. For now, append
          {' '}<code>?criticKind=approved-with-modifications</code> to the URL
          to preview the panel against a stub feedback envelope.
        </p>
        <ArchitectureCriticBridge
          projectId={projectId}
          criticKind={criticKind ?? null}
        />
      </CardContent>
    </Card>
  );
}
