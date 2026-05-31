'use client';
/**
 * Next.js App Router error boundary for the Step 5 — Proposal route.
 * Thin shim — recovery UX + Tempo tracing live in the shared
 * `<WizardStepErrorBoundary>` component (B1).
 */

import { WizardStepErrorBoundary } from '../../../components/wizard/WizardStepErrorBoundary';

export default function ProposalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <WizardStepErrorBoundary step="proposal" error={error} reset={reset} />;
}
