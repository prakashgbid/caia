'use client';
/**
 * Generic step router. Maps `/wizard/<slug>` to a "Coming soon" Card stub
 * for now; per-step components arrive in follow-up PRs.
 *
 * Why a stub instead of a 404:
 * the canonical pipeline (steps 1-7) is published in the layout's Progress
 * indicator. 404'ing unrendered steps would render the indicator with
 * broken links — a confusing UX. The Coming-soon Card keeps the path
 * navigable while the per-step packages (interview/grand-idea/IA/
 * proposal/atlas) land their UI separately on sibling branches.
 *
 * Reuse-first: every visible UI primitive (Card, etc.) is from `@caia/ui`.
 */

import { notFound } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';
import { findStepBySlug, isWizardSlug } from '../../../lib/wizard/steps';

interface PageProps {
  params: Promise<{ step: string }>;
}

export default async function StepPage({ params }: PageProps) {
  const resolved = await Promise.resolve(params);
  const slug = resolved.step;
  if (!isWizardSlug(slug)) {
    notFound();
  }
  const step = findStepBySlug(slug);
  if (!step) {
    notFound();
  }
  return (
    <Card data-testid={`wizard-step-stub-${step.slug}`}>
      <CardHeader>
        <CardTitle>{step.title}</CardTitle>
        <CardDescription>{step.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p style={{ opacity: 0.7 }}>
          Step {step.index} of 7 — this view is being built. Use the wizard
          nav above to skip ahead, or come back later.
        </p>
      </CardContent>
    </Card>
  );
}

export const dynamic = 'force-dynamic';
