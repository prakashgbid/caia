/**
 * Wizard Step 1 — Onboarding.
 *
 * Server component that imports the canonical 19-category catalogue from
 * `@caia/onboarding/categories` (15 mandatory + 4 optional) and mounts a
 * `'use client'` stepper UI on top. The stepper walks each category in
 * order, captures provider choice + credentials, and POSTs the result to
 * the onboarding-submit API route (Wave 2). Once every mandatory
 * category is `passed` or `deferred`, the stepper dispatches the
 * `onboarding → idea-captured` FSM transition via the existing
 * PATCH `/api/wizard/[projectId]/state` route from PR #601.
 *
 * Reuse-first: every visible UI primitive (Card, CardHeader, CardTitle,
 * CardDescription, CardContent, Button, Badge, Input, Progress) is
 * sourced from `@caia/ui`. Domain logic comes from `@caia/onboarding`.
 *
 * The page intentionally does NOT instantiate the real `OnboardingEngine`
 * inline — the engine needs a Pg store + Infisical secrets adapter +
 * audit log, all of which are wired by the Wave 2 onboarding-submit
 * route. The V1 wizard surface focuses on the customer-facing step UI
 * and persists the chosen provider+credentials via that route.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';
import { ALL_CATEGORIES, MANDATORY_CATEGORY_IDS } from '@caia/onboarding';
import { OnboardingStepForm } from '../../../components/wizard/OnboardingStepForm';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ projectId?: string }>;
}

export default async function OnboardingPage({ searchParams }: PageProps): Promise<React.JSX.Element> {
  const sp = await Promise.resolve(searchParams);
  const projectId = sp.projectId ?? 'p-pending';

  // Server-side: snapshot the canonical category catalog. The 19 items
  // come from `@caia/onboarding`'s static catalog — no DB round-trip.
  const categories = ALL_CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    ordinal: c.ordinal,
    required: c.required,
    description: c.description,
    providers: c.providers.map((p) => ({
      id: p.id,
      label: p.label,
      archetype: p.archetype,
      noCredentials: p.noCredentials,
      credentialDescriptors: p.credentialDescriptors.map((d) => ({
        keyId: d.keyId,
        archetype: d.archetype,
        scopesRequired: d.scopesRequired,
        storeSecret: d.storeSecret,
      })),
    })),
  }));

  const mandatoryCount = MANDATORY_CATEGORY_IDS.length;
  const optionalCount = categories.length - mandatoryCount;

  return (
    <Card data-testid="wizard-step-onboarding">
      <CardHeader>
        <CardTitle>Step 1 — Onboarding</CardTitle>
        <CardDescription>
          Tell us who you are. {mandatoryCount} required and {optionalCount} optional
          categories. Each step validates the credentials you provide; nothing is
          stored until validation passes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <OnboardingStepForm projectId={projectId} categories={categories} />
      </CardContent>
    </Card>
  );
}
