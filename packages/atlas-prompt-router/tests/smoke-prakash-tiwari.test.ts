/**
 * End-to-end integration smoke test.
 *
 * Wires the REAL @chiefaia/atlas-mapper over the prakash-tiwari hero
 * fixture from @caia/atlas-ui/fixtures and drives the router with an
 * AtlasSubmitPromptRequest that the UI's AtlasApiClient.submitPrompt
 * would emit. Validates the full atlas-ui → router → EA dispatch flow.
 */

import { describe, expect, it } from 'vitest';
import { buildDomIdMap, buildMapper } from '@chiefaia/atlas-mapper';
import {
  HERO_STATS_TICKET_ID,
  PROJECT_ID,
  DESIGN_VERSION_ID,
  renderableDesign,
  ticketTree,
  toMapperTickets,
} from '@caia/atlas-ui/fixtures/prakash-tiwari-home.js';
import { createRouter } from '../src/router.js';
import { createAtlasPromptApiHandler } from '../src/api.js';
import { frozenClockFrom } from '../src/clock.js';
import { counterIdGen } from '../src/id.js';
import {
  makeClassifier,
  makeDispatcher,
  makeStateMachine,
  makeVersionStore,
  makeWriter,
} from './test-fixtures.js';
import type {
  AtlasSubmitPromptRequest,
  AtlasSubmitPromptResponse,
  MapperPort,
  RouterDeps,
} from '../src/types.js';

function buildRealMapperFromFixture(): MapperPort {
  const domMap = buildDomIdMap(
    renderableDesign as unknown as Parameters<typeof buildDomIdMap>[0],
  );
  const tickets = toMapperTickets(ticketTree.tree);
  const mapper = buildMapper(domMap, tickets);
  return {
    ticketByDomId: (id) => mapper.ticketByDomId(id),
    descendantTickets: (id) => mapper.descendantTickets(id),
  };
}

function buildRealDeps(): {
  deps: RouterDeps;
  versionStore: ReturnType<typeof makeVersionStore>;
  stateMachine: ReturnType<typeof makeStateMachine>;
  dispatcher: ReturnType<typeof makeDispatcher>;
} {
  const mapper = buildRealMapperFromFixture();
  const versionStore = makeVersionStore();
  const stateMachine = makeStateMachine();
  const dispatcher = makeDispatcher({
    dispatchedTo: ['caia-frontend-architect'],
    enqueuedAt: '2026-05-24T12:00:00.250Z',
  });
  const classifier = makeClassifier({
    kind: 'self-only',
    reason: 'tight selector + style word (\"serif\")',
  });
  const writer = makeWriter('Change typography of:');
  const clock = frozenClockFrom('2026-05-24T12:00:00.000Z');
  const idGen = counterIdGen('tv');
  const deps: RouterDeps = {
    mapper,
    versionStore,
    stateMachine,
    dispatcher,
    intentClassifier: classifier,
    expectedChangeWriter: writer,
    clock,
    idGen,
  };
  return { deps, versionStore, stateMachine, dispatcher };
}

describe('integration: atlas-ui → atlas-prompt-router → ea dispatch', () => {
  it('runs the prakash-tiwari hero stats prompt end-to-end', async () => {
    const { deps, versionStore, stateMachine, dispatcher } = buildRealDeps();
    const router = createRouter(deps, {
      designVersionId: DESIGN_VERSION_ID,
      previousState: 'change-requested',
    });

    const wireBody: AtlasSubmitPromptRequest = {
      prompt: 'make the stats serif and 1.5x bigger',
      selection: [HERO_STATS_TICKET_ID],
      ts: '2026-05-24T12:00:00.000Z',
    };

    const res = await router.submitPrompt({
      ticketId: HERO_STATS_TICKET_ID,
      operatorUserId: 'u_demo',
      body: wireBody,
    });

    expect(res.versionId).toBe('tv_000001');
    expect(res.ticketState).toBe('change-requested');
    expect(res.dispatchedTo).toEqual(['caia-frontend-architect']);
    expect(res.expectedChangeDescription).toContain('Change typography of:');
    expect(res.enqueuedAt).toBe('2026-05-24T12:00:00.250Z');

    expect(versionStore.rows).toHaveLength(1);
    const row = versionStore.rows[0]!;
    expect(row.ticketId).toBe(HERO_STATS_TICKET_ID);
    expect(row.designVersionId).toBe(DESIGN_VERSION_ID);
    expect(row.previousState).toBe('change-requested');
    expect(row.newState).toBe('change-requested');
    expect(row.scope).toBe('self-only');
    expect(row.operatorUserId).toBe('u_demo');
    expect(row.selection).toEqual([HERO_STATS_TICKET_ID]);

    expect(stateMachine.transitions).toHaveLength(1);
    const tr = stateMachine.transitions[0]!;
    expect(tr.ticketId).toBe(HERO_STATS_TICKET_ID);
    expect(tr.toState).toBe('change-requested');
    expect(tr.triggeredBy).toEqual({ kind: 'operator', id: 'u_demo' });
    expect(tr.ts).toBe('2026-05-24T12:00:00.000Z');

    expect(dispatcher.calls).toHaveLength(1);
    const d = dispatcher.calls[0]!;
    expect(d.ticketIds).toEqual([HERO_STATS_TICKET_ID]);
    expect(d.prompt).toBe(wireBody.prompt);
    expect(d.scope).toBe('self-only');
    expect(d.versionId).toBe('tv_000001');

    const _typecheck: AtlasSubmitPromptResponse = res;
    expect(_typecheck).toBeDefined();
  });

  it('routes a section-level prompt to a subtree fan-out', async () => {
    const { deps, dispatcher } = buildRealDeps();
    const classifier = deps.intentClassifier;
    (classifier as unknown as { next: unknown }).next = {
      kind: 'subtree',
      reason: 'restructure the hero — touches all slides',
    };
    const router = createRouter(deps, { designVersionId: DESIGN_VERSION_ID });

    const HERO_SECTION = 'SE-home-hero';
    const wireBody: AtlasSubmitPromptRequest = {
      prompt: 'rebuild the hero — full redesign',
      selection: [HERO_SECTION],
      ts: '2026-05-24T12:00:00.000Z',
    };

    const res = await router.submitPrompt({
      ticketId: HERO_SECTION,
      operatorUserId: 'u_demo',
      body: wireBody,
    });

    expect(res.versionId).toBe('tv_000001');
    expect(res.ticketState).toBe('change-requested');

    const call = dispatcher.calls[0]!;
    expect(call.ticketIds[0]).toBe(HERO_SECTION);
    expect(call.ticketIds).toContain('WD-home-hero-rotator');
    expect(call.ticketIds).toContain('WD-home-hero-slide-01-caia');
    expect(call.ticketIds).toContain(HERO_STATS_TICKET_ID);
    expect(call.scope).toBe('subtree');
  });

  it('drives the same flow through the HTTP API handler', async () => {
    const { deps, versionStore } = buildRealDeps();
    const handler = createAtlasPromptApiHandler(createRouter(deps));
    const res = await handler({
      body: {
        prompt: 'make the stats serif',
        selection: [HERO_STATS_TICKET_ID],
        ts: '2026-05-24T12:00:00.000Z',
      },
      params: { ticketId: HERO_STATS_TICKET_ID },
      operatorUserId: 'u_demo',
      designVersionId: DESIGN_VERSION_ID,
    });
    expect(res.status).toBe(200);
    expect(versionStore.rows[0]?.designVersionId).toBe(DESIGN_VERSION_ID);
  });

  it('uses the project id consistently across fixture lookups', () => {
    expect(PROJECT_ID).toBe('p_prakash_tiwari');
    expect(DESIGN_VERSION_ID).toBe('dv_prakash_tiwari_v1');
    expect(HERO_STATS_TICKET_ID).toBe('WD-home-hero-slide-01-stats');
  });
});
