/**
 * `createRouter(deps, opts)` — the Atlas per-scope prompt router.
 *
 * Orchestration flow (spec §4.1 + §5.3):
 *   1. Validate the inbound body.
 *   2. Resolve the path-param ticket via the mapper.
 *   3. Classify the scope of change (self-only | subtree | page).
 *   4. Compute the fan-out targets from the scope.
 *   5. Build the expected-change description.
 *   6. Allocate a versionId; record an enqueue ts from the clock.
 *   7. Insert the ticket-version snapshot.
 *   8. Record the state-machine transition.
 *   9. Enqueue the dispatch.
 *  10. Return the AtlasSubmitPromptResponse.
 *
 * Every external boundary is a port — no fetch, no pg, no Anthropic SDK.
 */

import { validateBody, type ValidatedBody } from './validation.js';
import type {
  AtlasPromptRouter,
  AtlasSubmitPromptResponse,
  DispatchInput,
  DispatchResult,
  MapperTicket,
  RouterDeps,
  RouterErrorKind,
  RouterOptions,
  ScopeClassification,
  SubmitPromptInput,
  TicketState,
  TicketTransitionInput,
  TicketVersionInsert,
} from './types.js';
import { RouterError } from './types.js';

const TARGET_STATE: TicketState = 'change-requested';

export function createRouter(
  deps: RouterDeps,
  opts: RouterOptions = {} as RouterOptions,
): AtlasPromptRouter {
  const constructionDesignVersionId =
    typeof opts.designVersionId === 'string' && opts.designVersionId.length > 0
      ? opts.designVersionId
      : null;

  async function submitPrompt(input: SubmitPromptInput): Promise<AtlasSubmitPromptResponse> {
    if (!input || typeof input !== 'object') {
      throw new RouterError('invalid-body', 'submitPrompt input must be an object');
    }
    if (typeof input.ticketId !== 'string' || input.ticketId.length === 0) {
      throw new RouterError('invalid-body', `ticketId is required`, { field: 'ticketId' });
    }
    if (typeof input.operatorUserId !== 'string' || input.operatorUserId.length === 0) {
      throw new RouterError('invalid-body', `operatorUserId is required`, {
        field: 'operatorUserId',
      });
    }

    const validation = validateBody(input.body, opts);
    if (!validation.ok) {
      const e = validation.error;
      const detail: Record<string, unknown> = {};
      if ('field' in e && e.field) detail['field'] = e.field;
      if ('limit' in e && typeof e.limit === 'number') detail['limit'] = e.limit;
      if ('got' in e && (typeof e.got === 'number' || typeof e.got === 'string')) {
        detail['got'] = e.got;
      }
      throw new RouterError(e.kind, e.message, detail);
    }
    const body = validation.value;

    const designVersionId =
      typeof input.designVersionId === 'string' && input.designVersionId.length > 0
        ? input.designVersionId
        : constructionDesignVersionId;
    if (!designVersionId) {
      throw new RouterError(
        'invalid-body',
        'designVersionId is required (set via createRouter opts or SubmitPromptInput)',
        { field: 'designVersionId' },
      );
    }
    const previousState: TicketState =
      input.previousState ?? opts.previousState ?? 'approved';

    if (body.selection.length > 1) {
      return submitMulti(input, body, designVersionId, previousState);
    }

    return submitOne({
      ticketId: input.ticketId,
      operatorUserId: input.operatorUserId,
      body,
      designVersionId,
      previousState,
      isPrimary: true,
      promptGroupId: body.promptGroupId,
      siblings: null,
    });
  }

  async function submitMulti(
    input: SubmitPromptInput,
    body: ValidatedBody,
    designVersionId: string,
    previousState: TicketState,
  ): Promise<AtlasSubmitPromptResponse> {
    const promptGroupId =
      body.promptGroupId ?? `pg_${deps.idGen().replace(/^[^_]*_/, '')}`;

    const siblings: string[] = [];
    let primary: AtlasSubmitPromptResponse | null = null;

    for (const ticketId of body.selection) {
      const isPrimary = ticketId === input.ticketId;
      const res = await submitOne({
        ticketId,
        operatorUserId: input.operatorUserId,
        body,
        designVersionId,
        previousState,
        isPrimary,
        promptGroupId,
        siblings,
      });
      siblings.push(res.versionId);
      if (isPrimary) primary = res;
    }

    if (!primary) {
      return submitOne({
        ticketId: input.ticketId,
        operatorUserId: input.operatorUserId,
        body,
        designVersionId,
        previousState,
        isPrimary: true,
        promptGroupId,
        siblings,
      });
    }
    return primary;
  }

  interface SubmitOneInput {
    readonly ticketId: string;
    readonly operatorUserId: string;
    readonly body: ValidatedBody;
    readonly designVersionId: string;
    readonly previousState: TicketState;
    readonly isPrimary: boolean;
    readonly promptGroupId: string | null;
    readonly siblings: ReadonlyArray<string> | null;
  }

  async function submitOne(s: SubmitOneInput): Promise<AtlasSubmitPromptResponse> {
    const ticket = deps.mapper.ticketByDomId(s.ticketId);
    if (!ticket) {
      throw new RouterError(
        'unknown-ticket',
        `ticket '${s.ticketId}' is not bound in the mapper`,
        { field: 'ticketId', got: s.ticketId },
      );
    }

    let scope: ScopeClassification;
    try {
      scope = await Promise.resolve(
        deps.intentClassifier({
          prompt: s.body.prompt,
          ticket,
          selection: s.body.selection,
        }),
      );
    } catch (err) {
      throw wrap('classifier-failed', err);
    }
    assertScopeClassification(scope);

    const ticketIds = resolveTicketIds(scope.kind, ticket, deps.mapper);

    let expectedChangeDescription: string;
    try {
      expectedChangeDescription = await Promise.resolve(
        deps.expectedChangeWriter({
          prompt: s.body.prompt,
          ticket,
          scope: scope.kind,
        }),
      );
    } catch (err) {
      throw wrap('description-writer-failed', err);
    }
    if (typeof expectedChangeDescription !== 'string') {
      throw new RouterError(
        'description-writer-failed',
        'expected-change writer returned a non-string value',
      );
    }

    const versionId = deps.idGen();
    const operatorTs = s.body.ts;
    const transitionTs = deps.clock();

    const extra: Record<string, unknown> = {
      isPrimary: s.isPrimary,
      submittedAt: operatorTs,
    };
    if (s.siblings && s.siblings.length > 0) {
      extra['groupSiblings'] = [...s.siblings];
    }

    const insertInput: TicketVersionInsert = {
      versionId,
      ticketId: s.ticketId,
      designVersionId: s.designVersionId,
      operatorUserId: s.operatorUserId,
      prompt: s.body.prompt,
      selection: s.body.selection,
      promptGroupId: s.promptGroupId,
      operatorTs,
      enqueuedAt: transitionTs,
      previousState: s.previousState,
      newState: TARGET_STATE,
      scope: scope.kind,
      scopeReason: scope.reason,
      expectedChangeDescription,
      dispatchedTo: [],
      extra,
    };
    try {
      await Promise.resolve(deps.versionStore.insertVersion(insertInput));
    } catch (err) {
      throw wrap('persistence-failed', err);
    }

    const transition: TicketTransitionInput = {
      ticketId: s.ticketId,
      fromState: s.previousState,
      toState: TARGET_STATE,
      triggeredBy: { kind: 'operator', id: s.operatorUserId },
      ts: transitionTs,
      reason: scope.reason,
      designVersionId: s.designVersionId,
    };
    try {
      await Promise.resolve(deps.stateMachine.transitionTicket(transition));
    } catch (err) {
      throw wrap('invalid-transition', err);
    }

    const dispatchInput: DispatchInput = {
      ticketIds,
      primaryTicketId: s.ticketId,
      scope: scope.kind,
      versionId,
      prompt: s.body.prompt,
      expectedChangeDescription,
      operatorUserId: s.operatorUserId,
      designVersionId: s.designVersionId,
      enqueuedAt: transitionTs,
    };
    let dispatch: DispatchResult;
    try {
      dispatch = await Promise.resolve(deps.dispatcher.enqueue(dispatchInput));
    } catch (err) {
      throw wrap('dispatcher-failed', err);
    }
    if (
      !dispatch ||
      !Array.isArray(dispatch.dispatchedTo) ||
      typeof dispatch.enqueuedAt !== 'string'
    ) {
      throw new RouterError('dispatcher-failed', 'dispatcher returned a malformed result');
    }

    return {
      versionId,
      ticketState: TARGET_STATE,
      expectedChangeDescription,
      dispatchedTo: [...dispatch.dispatchedTo],
      enqueuedAt: dispatch.enqueuedAt,
    };
  }

  return { submitPrompt };
}

function resolveTicketIds(
  kind: ScopeClassification['kind'],
  ticket: MapperTicket,
  mapper: RouterDeps['mapper'],
): string[] {
  if (kind !== 'subtree') return [ticket.id];
  const domId = ticket.domId ?? ticket.id;
  const descendants = mapper.descendantTickets(domId);
  if (descendants.length === 0) return [ticket.id];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of descendants) {
    if (!seen.has(d.id)) {
      seen.add(d.id);
      out.push(d.id);
    }
  }
  if (!seen.has(ticket.id)) out.unshift(ticket.id);
  if (out[0] !== ticket.id) {
    const idx = out.indexOf(ticket.id);
    if (idx > 0) {
      out.splice(idx, 1);
      out.unshift(ticket.id);
    }
  }
  return out;
}

function assertScopeClassification(c: unknown): asserts c is ScopeClassification {
  if (!c || typeof c !== 'object') {
    throw new RouterError('classifier-failed', 'classifier returned non-object');
  }
  const kind = (c as { kind?: unknown }).kind;
  const reason = (c as { reason?: unknown }).reason;
  if (kind !== 'self-only' && kind !== 'subtree' && kind !== 'page') {
    throw new RouterError(
      'classifier-failed',
      `classifier returned invalid scope '${String(kind)}'`,
    );
  }
  if (typeof reason !== 'string') {
    throw new RouterError('classifier-failed', 'classifier returned no reason string');
  }
}

function wrap(kind: RouterErrorKind, err: unknown): RouterError {
  if (err instanceof RouterError) return err;
  const originalMessage = err instanceof Error ? err.message : String(err);
  return new RouterError(kind, `${kind}: ${originalMessage}`, { originalMessage });
}
