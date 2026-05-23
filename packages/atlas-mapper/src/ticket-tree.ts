/**
 * Hierarchical ticket tree — the input contract for `buildMapper`.
 *
 * The Principal-PO emits a tree of tickets that mirrors the 6-level
 * Site → Foundation → Page → Section → Widget → Story → Task
 * hierarchy (`research/ticket_taxonomy_2026.md` §3.2). Atlas binds
 * each ticket to one or more DOM-IDs via `domId` (the canonical 1:1
 * binding per atlas spec §2) and/or via `additionalDomIds` (for the
 * legitimate case of a story scoping multiple elements — e.g. a
 * stats-row story covering each stat-card inside the row).
 *
 * We model the ticket tree with a deliberately minimal shape rather
 * than coupling tightly to `@chiefaia/ticket-template`'s full
 * `TicketTemplateV1Schema`. Reasons:
 *
 * 1. atlas-mapper only needs `id + domId + children` to do its job.
 *    Tying to the full Zod schema would force every test fixture to
 *    populate 30 unrelated fields.
 * 2. Different upstream emitters (PO Agent, fixtures, test harnesses)
 *    produce tickets at different points in the pipeline. A minimal
 *    shape lets all of them participate.
 *
 * Callers with full tickets can pass them as-is — the shape here is
 * a `Pick<>`-compatible subset, and the full ticket's extra fields
 * are preserved on the returned `Ticket` via the `extra` slot. The
 * type is generic over the extra payload so consumers get type-safe
 * access to their own ticket fields.
 */

/**
 * Minimum-fields contract for a ticket in the tree.
 *
 *   `id`               — the hierarchical ticket id (e.g. `WD-home-hero-rotator`).
 *   `domId`            — the primary DOM-ID this ticket scopes (1:1).
 *   `additionalDomIds` — optional N:1 set for tickets that scope
 *                        multiple elements.
 *   `children`         — recurse the same shape.
 *
 * Everything else is opaque pass-through via `extra`.
 */
export interface TicketNode<TExtra = Record<string, unknown>> {
  /** Hierarchical ticket id. Must be unique within the tree. */
  id: string;

  /**
   * Primary DOM-ID this ticket scopes. Optional — some tickets are
   * organisational (a Site or Foundation row) and bind no element.
   */
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
 * callers can walk up the tree on their own without an additional
 * index.
 */
export interface Ticket<TExtra = Record<string, unknown>> {
  id: string;
  domId?: string;
  additionalDomIds?: string[];
  parentId?: string;
  extra?: TExtra;
}
