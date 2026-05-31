'use client';
/**
 * Next.js App Router error boundary for the Step 6 — Design route.
 * Thin shim — recovery UX + Tempo tracing live in the shared
 * `<WizardStepErrorBoundary>` component (B1).
 */

import { WizardStepErrorBoundary } from '../../../components/wizard/WizardStepErrorBoundary';

export default function DesignError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <WizardStepErrorBoundary step="design" error={error} reset={reset} />;
}
