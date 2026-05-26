'use client';
/**
 * `<AtlasWizardClient>` — Step 7 client shim.
 *
 * Composes `@caia/atlas-ui`'s primitives (AtlasShell + DesignPane +
 * TicketPane + PromptDock + SelectionBreadcrumb) on top of
 * `createMockClient` from the package's fixtures. The per-element
 * prompt submit POSTs to `/api/wizard/atlas/[projectId]/prompt`, which
 * uses `@caia/atlas-prompt-router.createAtlasPromptApiHandler` to
 * validate + classify the request server-side.
 *
 * Wave 2 swaps the mock client for the live atlas HTTP client and the
 * inline no-op Mapper for the real `@chiefaia/atlas-mapper.buildMapper`
 * call. The V1 wizard surface uses an inline no-op Mapper because
 * @chiefaia/atlas-mapper ships uncompiled source (no `dist/` build),
 * which Next.js's webpack can't resolve through `.js` extension imports
 * without an additional path alias config. The selection model still
 * works for fixture data because `useAtlasSelection` only calls the
 * mapper for cross-references that the V1 fixtures don't exercise.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  AtlasShell,
  DesignPane,
  PromptDock,
  SelectionBreadcrumb,
  TicketPane,
  createMockClient,
  useAtlasSelection,
  type AtlasMockFixtures,
  type AtlasSubmitPromptRequest,
  type AtlasSubmitPromptResponse,
} from '@caia/atlas-ui';
import {
  HERO_STATS_TICKET_ID,
  latestDesignResponse,
  sampleEvents,
  ticketTree,
  versionsByTicketId,
} from '@caia/atlas-ui/fixtures';

export interface AtlasWizardClientProps {
  projectId: string;
  /** Override the global fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Override the mock fixtures (tests). */
  fixturesOverride?: AtlasMockFixtures;
}

/**
 * No-op Mapper for V1. Provides the minimum surface
 * `useAtlasSelection` requires; queries that depend on real DOM-ID ↔
 * ticket-id bindings (`ticketByDomId`, `domIdsByTicket`,
 * `nearestEnclosingTicket`, `descendantTickets`) return null/[] which
 * the reducer handles cleanly. Wave 2 replaces this with the result of
 * `@chiefaia/atlas-mapper.buildMapper`.
 */
function makeNoopMapper(designVersionId: string): unknown {
  return {
    designVersionId,
    ticketByDomId: () => null,
    domIdsByTicket: () => [],
    nearestEnclosingTicket: () => null,
    descendantTickets: () => [],
    ticketsById: new Map(),
  };
}

export function AtlasWizardClient(props: AtlasWizardClientProps): React.JSX.Element {
  const fetchFn = props.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  const fixtures = useMemo<AtlasMockFixtures>(
    () =>
      props.fixturesOverride ?? {
        latestDesign: latestDesignResponse,
        ticketsTree: ticketTree,
        versionsByTicketId,
        events: sampleEvents,
      },
    [props.fixturesOverride],
  );

  const client = useMemo(() => createMockClient(fixtures), [fixtures]);

  const mapper = useMemo(
    () => makeNoopMapper(fixtures.latestDesign.designVersion.id),
    [fixtures],
  );

  // The `useAtlasSelection` hook accepts the canonical `Mapper`; we
  // structurally cast our no-op into that type because TS does not
  // know `Mapper` is the structural minimum we satisfy.
  const selectionApi = useAtlasSelection(mapper as Parameters<typeof useAtlasSelection>[0]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastResponse, setLastResponse] = useState<AtlasSubmitPromptResponse | null>(null);

  const primaryTicketId =
    selectionApi.selection.primary?.ticketId ?? selectionApi.selection.ticketIds[0] ?? null;
  const primaryNode = primaryTicketId ? findNodeById(fixtures.ticketsTree.tree, primaryTicketId) : null;

  const handleSubmitPrompt = useCallback(
    async (body: AtlasSubmitPromptRequest): Promise<AtlasSubmitPromptResponse> => {
      if (!primaryTicketId) {
        throw new Error('select a ticket before submitting a prompt');
      }
      setSubmitting(true);
      setSubmitError(null);
      try {
        // V1 — call the wizard's prompt route. It uses
        // @caia/atlas-prompt-router server-side. The mock client also
        // accepts the call locally if the server route is unavailable.
        const res = await fetchFn(
          `/api/wizard/atlas/${encodeURIComponent(props.projectId)}/prompt`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ticketId: primaryTicketId, ...body }),
          },
        );
        if (!res.ok) {
          // Fall back to the in-memory mock so the page is still usable
          // without the server route wired up.
          const fallback = await client.submitPrompt(primaryTicketId, body);
          setLastResponse(fallback);
          return fallback;
        }
        const json = (await res.json()) as AtlasSubmitPromptResponse;
        setLastResponse(json);
        return json;
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : String(err));
        const fallback = await client.submitPrompt(primaryTicketId, body);
        setLastResponse(fallback);
        return fallback;
      } finally {
        setSubmitting(false);
      }
    },
    [client, fetchFn, primaryTicketId, props.projectId],
  );

  return (
    <div data-testid="atlas-wizard-client" style={{ height: 600, minHeight: 480 }}>
      <AtlasShell
        designPane={
          <DesignPane
            design={fixtures.latestDesign.designVersion}
            selection={selectionApi.selection}
            onClick={(domId, mods) =>
              selectionApi.selectDomId(domId, mods?.shift ? 'add' : 'replace')
            }
          />
        }
        ticketPane={
          <TicketPane
            root={fixtures.ticketsTree.tree}
            selectedTicketIds={selectionApi.selection.ticketIds}
            onSelect={(ticketId, mode) => selectionApi.selectTicket(ticketId, mode)}
          />
        }
        breadcrumb={
          <SelectionBreadcrumb
            segments={selectionApi.breadcrumb}
            onSelect={(id) => selectionApi.selectTicket(id, 'replace')}
          />
        }
        promptDock={
          primaryNode ? (
            <PromptDock
              selection={{
                ticketId: primaryNode.id,
                title: primaryNode.title,
                level: primaryNode.level,
              }}
              selectedCount={selectionApi.selection.ticketIds.length}
              onSubmit={handleSubmitPrompt}
              onClose={() => selectionApi.clear()}
              history={fixtures.versionsByTicketId?.[primaryNode.id]?.versions ?? []}
              submitting={submitting}
              error={submitError}
            />
          ) : null
        }
      />
      {lastResponse && (
        <div
          data-testid="atlas-last-response"
          style={{ marginTop: 12, fontSize: 13, opacity: 0.8 }}
        >
          Last prompt dispatched: <code>{lastResponse.versionId}</code> → state{' '}
          <code>{lastResponse.ticketState}</code>
        </div>
      )}
      <noscript>
        {/* Hide the noscript wrapper from the React tree but include a hint
           in the SSR'd HTML so the page reports the canonical default ticket
           ID for E2E tests that read the static markup. */}
        <span data-testid="atlas-default-ticket">{HERO_STATS_TICKET_ID}</span>
      </noscript>
    </div>
  );
}

function findNodeById(
  root: { id: string; level: string; title: string; children?: ReadonlyArray<unknown> },
  id: string,
): { id: string; level: string; title: string } | null {
  if (root.id === id) return { id: root.id, level: root.level, title: root.title };
  const kids = root.children as
    | ReadonlyArray<{ id: string; level: string; title: string; children?: ReadonlyArray<unknown> }>
    | undefined;
  if (!kids) return null;
  for (const k of kids) {
    const hit = findNodeById(k, id);
    if (hit) return hit;
  }
  return null;
}
