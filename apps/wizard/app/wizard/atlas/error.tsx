'use client';
/**
 * Next.js App Router error boundary for the Step 7 — Atlas segment.
 * Covers the nested `[projectId]` route automatically; thin shim —
 * recovery UX + Tempo tracing live in the shared
 * `<WizardStepErrorBoundary>` component (B1).
 */

import { WizardStepErrorBoundary } from '../../../components/wizard/WizardStepErrorBoundary';

export default function AtlasError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <WizardStepErrorBoundary step="atlas" error={error} reset={reset} />;
}
