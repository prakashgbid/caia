/**
 * Wizard Step 4 — Information Architecture (placeholder).
 *
 * Materialising the `architecture/` route segment as its own directory
 * (rather than letting the parent `[step]/page.tsx` catch it) lets the
 * sibling `error.tsx` (B1) attach to this specific segment and gives
 * B6 (CriticFeedbackPanel + runIA wiring) a place to land its UI
 * without churning the dynamic fallback.
 *
 * For now this is a thin server component that mirrors the same
 * `<Card>` stub the [step] page renders — once B6 lands, the runIA
 * orchestration + Critic panel replace the placeholder body.
 *
 * Reuse-first: every primitive comes from `@caia/ui`; step metadata
 * comes from `lib/wizard/steps.ts`.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';
import { findStepBySlug } from '../../../lib/wizard/steps';

export const dynamic = 'force-dynamic';

export default async function ArchitecturePage(): Promise<React.JSX.Element> {
  const step = findStepBySlug('architecture');
  // The slug is canonical (compile-time-checked via the union), so
  // findStepBySlug always returns a step — narrow for the typechecker.
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
        <p style={{ opacity: 0.7 }}>
          Step {step.index} of 7 — runIA orchestration + the Critic feedback
          loop land in B6. The route is reachable now so the wizard nav
          stays unbroken and the sibling error boundary (B1) covers this
          segment.
        </p>
      </CardContent>
    </Card>
  );
}
