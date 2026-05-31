'use client';
/**
 * Next.js App Router error boundary for the Step 1 — Onboarding route.
 * Thin shim — the recovery UX + Tempo tracing live in the shared
 * `<WizardStepErrorBoundary>` component (B1).
 */

import { WizardStepErrorBoundary } from '../../../components/wizard/WizardStepErrorBoundary';

export default function OnboardingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <WizardStepErrorBoundary step="onboarding" error={error} reset={reset} />;
}
