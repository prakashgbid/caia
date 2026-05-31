'use client';
/**
 * Next.js App Router error boundary for the Step 2 — Grand Idea route.
 * Thin shim — recovery UX + Tempo tracing live in the shared
 * `<WizardStepErrorBoundary>` component (B1).
 */

import { WizardStepErrorBoundary } from '../../../components/wizard/WizardStepErrorBoundary';

export default function GrandIdeaError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <WizardStepErrorBoundary step="grand-idea" error={error} reset={reset} />;
}
