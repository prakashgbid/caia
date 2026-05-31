'use client';
/**
 * Next.js App Router error boundary for the Step 4 — Architecture route.
 * Thin shim — recovery UX + Tempo tracing live in the shared
 * `<WizardStepErrorBoundary>` component (B1).
 */

import { WizardStepErrorBoundary } from '../../../components/wizard/WizardStepErrorBoundary';

export default function ArchitectureError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <WizardStepErrorBoundary step="architecture" error={error} reset={reset} />;
}
