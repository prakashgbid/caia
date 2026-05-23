/**
 * Hierarchical ticket tree — the input contract for `buildMapper`.
 *
 * The Principal-PO emits a tree of tickets that mirrors the 6-level
 * Site → Foundation → Page → Section → Widget → Story → Task
 * hierarchy (research/ticket_taxonomy_2026.md §3.2). Atlas binds each
 * ticket to one or more DOM-IDs via the ticket's `domId` field (the
 * canonical 1:1 binding per atlas spec §2) and/or via the ticket's
 * `additionalDomIds` field (for tickets that scope multiple elements,
 * e.g. a story that touches a row of stat cards).
 *
 * We deliberately model the ticket tree with a minimal shape rather
 * than coupling tightly to `@chiefaia/ticket-template`'s full
 * `TicketTemplateV1Schema`. Reasons:
 *
 * 1. atlas-mapper only needs `id + domId + children` to do its job.
 *    Tying to the full Zod schema would force every test fixture to
 *    populate 30 unrelated fields (scope, taxonomy, agentSections, …).
 * 2. Different upstream emitters (PO Agent, fixtures, test harnesses)
 *    produce tickets at different points in the pipeline. The minimal
 *    shape lets all of them participate.
 *
 * Callers who have a full ticket can pass it as-is — the shape here is
 * a `Pick<>`-compatible subset. The full ticket's extra fields are
 * preserved on the `Ticket` instances atlas-mapper returns (the type
 * is generic over the ticket payload).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Minimum-fields contract for a ticket in the tree.
 *
 * `id` is the hierarchical ticket ID (e.g. `WD-home-hero-rotator`).
 * `domId` is the primary DOM-ID this ticket scopes — 1:1 with one
 *   element on the design surface (atlas spec §2 contract).
 * `additionalDomIds` is the optional N:1 set for tickets that scope
 *   multiple elements (e.g. a story spanning a row of stat cards).
 * `children` recurse the same shape.
 *
 * Everything else is opaque pass-through — adapters can attach
 * whatever payload they want and atlas-mapper returns it unchanged.
 */
export interface TicketNode<TExtra = Record<string, any>> {
  /** Hierarchical ticket id. Must be unique within the tree. */
  id: string;

  /** Primary DOM-ID this ticket scopes. Optional — some tickets are
   *  organizational and bind no element. */
  domId?: string;

  /** Additional DOM-IDs this ticket also scopes (N:1). */
  additionalDomIds?: string[];

  /** Recursive children. */
  children?: TicketNode<TExtra>[];

  /** Arbitrary pass-through payload (title, status, story-points, …). */
  extra?: TExtra;
}

/**
 * The runtime `Ticket` shape returned by mapper queries.
 *
 * Identical to `TicketNode` but with `children` already resolved (no
 * recursive traversal needed by callers) and `parentId` populated so
 * callers can walk up the tree on their own.
 */
export interface Ticket<TExtra = Record<string, any>> {
  id: string;
  domId?: string;
  additionalDomIds?: string[];
  parentId?: string;
  extra?: TExtra;
}
