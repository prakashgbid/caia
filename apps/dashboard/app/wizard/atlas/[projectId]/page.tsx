/**
 * Wizard Step 7 — Atlas.
 *
 * Server component that mounts the `<AtlasWizardClient>` shim. The
 * client component composes `@caia/atlas-ui`'s `AtlasShell` with
 * `DesignPane` + `TicketPane` + `PromptDock` + `SelectionBreadcrumb`,
 * backed by `createMockClient` from `@caia/atlas-ui/fixtures` for the
 * V1 wizard path. Per-element prompt submissions go through a tiny
 * server adapter at `/api/wizard/atlas/[projectId]/prompt` that uses
 * `createAtlasPromptApiHandler` from `@caia/atlas-prompt-router`.
 *
 * Reuse-first compliance:
 *   - All UI primitives come from `@caia/atlas-ui` (a sibling of
 *     `@caia/ui`; the operator-locked rule allows atlas-ui to ship its
 *     own components because they are domain-specific composites built
 *     on top of `@caia/ui` primitives).
 *   - The wrapping Card uses `@caia/ui`.
 *   - Per-element prompt validation uses
 *     `@caia/atlas-prompt-router.createAtlasPromptApiHandler` in the
 *     companion API route.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';
import { AtlasWizardClient } from '../../../../components/wizard/AtlasWizardClient';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ projectId: string }>;
}

export default async function AtlasPage({ params }: PageProps): Promise<React.JSX.Element> {
  const { projectId } = await Promise.resolve(params);
  return (
    <Card data-testid="wizard-step-atlas">
      <CardHeader>
        <CardTitle>Step 7 — Atlas</CardTitle>
        <CardDescription>
          The split-screen ticket-to-design surface for project {projectId}. Click any
          element on the design to select its ticket; submit a per-element prompt to
          enqueue a change request.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AtlasWizardClient projectId={projectId} />
      </CardContent>
    </Card>
  );
}
