/**
 * Wizard Step 2 — Grand Idea.
 *
 * Wraps the canonical `GrandIdeaForm` from `@caia/grand-idea/ui-component`
 * in a `@caia/ui` Card container. The form itself uses inline styles by
 * design (see its header comment) — we do NOT add nested shadcn around
 * it because that would override the form's visual contract.
 *
 * On successful capture (`onCaptured`), the wrapping `'use client'`
 * adapter dispatches the FSM transition `onboarding → idea-captured` via
 * the existing PATCH `/api/wizard/[projectId]/state` route from PR #601.
 * The mapping mirrors `advanceToIdeaCaptured` from
 * `@caia/grand-idea/state-machine`: idempotent on already-captured
 * projects (the API route's canTransition check returns 409 in that
 * case which we surface as a soft "already captured" message).
 *
 * Reuse-first compliance:
 *   - Card / CardHeader / CardTitle / CardDescription / CardContent come
 *     from `@caia/ui`.
 *   - GrandIdeaForm comes from `@caia/grand-idea/ui-component`.
 *   - FSM lookup uses `@caia/state-machine` (the PATCH route handler).
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';
import { GrandIdeaStepBridge } from '../../../components/wizard/GrandIdeaStepBridge';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ projectId?: string; tenantSlug?: string }>;
}

export default async function GrandIdeaPage({ searchParams }: PageProps): Promise<React.JSX.Element> {
  const sp = await Promise.resolve(searchParams);
  const projectId = sp.projectId ?? 'p-pending';
  const tenantSlug = sp.tenantSlug ?? 'tenant-pending';

  return (
    <Card data-testid="wizard-step-grand-idea">
      <CardHeader>
        <CardTitle>Step 2 — Grand Idea</CardTitle>
        <CardDescription>
          Capture the one-paragraph north star. The Interviewer will follow up
          with the structured questions — you don&apos;t need to anticipate them
          here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <GrandIdeaStepBridge projectId={projectId} tenantSlug={tenantSlug} />
      </CardContent>
    </Card>
  );
}
