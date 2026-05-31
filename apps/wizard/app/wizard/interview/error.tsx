'use client';
/**
 * Next.js App Router error boundary for the Step 3 — Interview route.
 * Thin shim — recovery UX + Tempo tracing live in the shared
 * `<WizardStepErrorBoundary>` component (B1).
 */

import { WizardStepErrorBoundary } from '../../../components/wizard/WizardStepErrorBoundary';

export default function InterviewError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <WizardStepErrorBoundary step="interview" error={error} reset={reset} />;
}
