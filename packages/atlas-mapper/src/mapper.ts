/**
 * Ticket ↔ DOM bidirectional query layer.
 *
 * Given a `DomIdMap` (from `buildDomIdMap`) and a hierarchical
 * `TicketNode` tree, exposes the four query APIs the Atlas
 * interaction model needs (spec §3):
 *
 *   - `ticketByDomId(domId)`         — direct mapping
 *   - `domIdsByTicket(ticketId)`     — reverse mapping
 *   - `nearestEnclosingTicket(domId)`— drill-up ancestry walk
 *   - `descendantTickets(domId)`     — drill-down subtree sweep
 *
 * All four are O(1) or O(depth)/O(subtree) lookups on precomputed
 * indexes. Construction is O(D + T) where D=DOM entries, T=ticket nodes.
 *
 * # Binding model (atlas spec §2.4)
 *
 * Canonical: one ticket = one DOM-ID via `TicketNode.domId`. We also
 * support `TicketNode.additionalDomIds` for stories scoping multiple
 * elements (e.g. a `stats-row` story covering each stat-card).
 *
 * # Failure modes
 *
 * - `invalid_ticket_tree`      — bad shape, missing id, duplicate id.
 * - `cycle_detected`           — cycle in the ticket tree.
 * - `duplicate_ticket_binding` — two tickets bind the same DOM-ID
 *                                (violates spec §2.4 unique
 *                                `(designVersionId, domId)`).
 *
 * Tickets binding DOM-IDs that don't exist in the map are NOT errors —
 * collected into `unboundDomIds` so the UI can show orphaned-ticket
 * banners (spec §2.3).
 */

import { AtlasMapperError } from './errors.js';
import type { DomIdMap } from './dom-id-map.js';
import type { Ticket, TicketNode } from './ticket-tree.js';

/**
 * Public mapper interface. All methods are bound functions —
 * destructure freely.
 */
export interface Mapper<TExtra = Record<string, unknown>> {
  /** O(1). Returns null when the DOM-ID is not bound. */
  ticketByDomId: (domId: string) => Ticket<TExtra> | null;

  /** O(k log k). Returns [] when the ticket scopes nothing. Result sorted. */
  domIdsByTicket: (ticketId: string) => string[];

  /**
   * O(depth). Inclusive of the starting node — if `domId` itself is
   * bound, returns that ticket. Null when neither it nor any ancestor
   * is bound, or when the DOM-ID is unknown to the map.
   */
  nearestEnclosingTicket: (domId: string) => Ticket<TExtra> | null;

  /**
   * O(subtree-size). Pre-order. Inclusive of the starting node when
   * it's ticket-bound. Empty when the DOM-ID is unknown.
   */
  descendantTickets: (domId: string) => Ticket<TExtra>[];

  /** Lex-sorted DOM-IDs from the ticket tree that aren't in the map. */
  unboundDomIds: string[];

  /** Ticket index for callers building their own structures. */
  ticketsById: ReadonlyMap<string, Ticket<TExtra>>;
}

interface TicketBinding {
  ticketId: string;
  domId: string;
}

/**
 * Flatten the ticket tree into a Map + a list of bindings. Detects
 * cycles and duplicate ticket ids inside the tree itself; the §2.4
 * binding-conflict check happens after collection.
 */
function flattenTicketTree<TExtra>(
  roots: TicketNode<TExtra>[],
): { byId: Map<string, Ticket<TExtra>>; bindings: TicketBinding[] } {
  const byId = new Map<string, Ticket<TExtra>>();
  const bindings: TicketBinding[] = [];
  const visitedOnPath = new Set<string>();

  function visit(node: TicketNode<TExtra>, parentId?: string): void {
    if (!node || typeof node !== 'object') {
      throw new AtlasMapperError('invalid_ticket_tree', 'ticket node must be an object', {});
    }
    if (typeof node.id !== 'string' || node.id.length === 0) {
      throw new AtlasMapperError(
        'invalid_ticket_tree',
        'ticket node must have a non-empty string id',
        {},
      );
    }
    if (visitedOnPath.has(node.id)) {
      throw new AtlasMapperError(
        'cycle_detected',
        `Ticket-tree cycle detected: '${node.id}' already on the visit path`,
        { ticketId: node.id, path: [...visitedOnPath] },
      );
    }
    if (byId.has(node.id)) {
      throw new AtlasMapperError(
        'invalid_ticket_tree',
        `Duplicate ticket id '${node.id}' in the ticket tree`,
        { ticketId: node.id },
      );
    }

    const ticket: Ticket<TExtra> = { id: node.id };
    if (node.domId !== undefined) ticket.domId = node.domId;
    if (node.additionalDomIds !== undefined)
      ticket.additionalDomIds = [...node.additionalDomIds];
    if (parentId !== undefined) ticket.parentId = parentId;
    if (node.extra !== undefined) ticket.extra = node.extra;
    byId.set(node.id, ticket);

    if (typeof node.domId === 'string' && node.domId.length > 0) {
      bindings.push({ ticketId: node.id, domId: node.domId });
    }
    if (Array.isArray(node.additionalDomIds)) {
      for (const d of node.additionalDomIds) {
        if (typeof d === 'string' && d.length > 0) {
          bindings.push({ ticketId: node.id, domId: d });
        }
      }
    }

    visitedOnPath.add(node.id);
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        if (child) visit(child, node.id);
      }
    }
    visitedOnPath.delete(node.id);
  }

  for (const root of roots) visit(root);
  return { byId, bindings };
}

/**
 * Build a Mapper. `tickets` can be a single root or a forest.
 *
 * @throws AtlasMapperError on bad map, bad ticket tree, cycle,
 *         duplicate ticket id, or two tickets binding the same DOM-ID.
 */
export function buildMapper<TExtra = Record<string, unknown>>(
  domMap: DomIdMap,
  tickets: TicketNode<TExtra> | TicketNode<TExtra>[],
): Mapper<TExtra> {
  if (!domMap || !Array.isArray(domMap.entries) || !(domMap.byId instanceof Map)) {
    throw new AtlasMapperError(
      'invalid_renderable_design',
      'mapper requires a DomIdMap produced by buildDomIdMap',
      {},
    );
  }
  const roots: TicketNode<TExtra>[] = Array.isArray(tickets) ? tickets : [tickets];

  const { byId: ticketsById, bindings } = flattenTicketTree<TExtra>(roots);

  const domToTicket = new Map<string, string>();
  const ticketToDom = new Map<string, Set<string>>();
  const unboundSet = new Set<string>();

  for (const { ticketId, domId } of bindings) {
    if (!domMap.byId.has(domId)) unboundSet.add(domId);
    const existing = domToTicket.get(domId);
    if (existing && existing !== ticketId) {
      throw new AtlasMapperError(
        'duplicate_ticket_binding',
        `DOM-ID '${domId}' is bound by both '${existing}' and '${ticketId}'`,
        { domId, ticketIds: [existing, ticketId] },
      );
    }
    domToTicket.set(domId, ticketId);
    let set = ticketToDom.get(ticketId);
    if (!set) {
      set = new Set<string>();
      ticketToDom.set(ticketId, set);
    }
    set.add(domId);
  }

  const ticketByDomId = (domId: string): Ticket<TExtra> | null => {
    if (typeof domId !== 'string') return null;
    const ticketId = domToTicket.get(domId);
    if (!ticketId) return null;
    return ticketsById.get(ticketId) ?? null;
  };

  const domIdsByTicket = (ticketId: string): string[] => {
    if (typeof ticketId !== 'string') return [];
    const set = ticketToDom.get(ticketId);
    if (!set || set.size === 0) return [];
    return [...set].sort();
  };

  const nearestEnclosingTicket = (domId: string): Ticket<TExtra> | null => {
    if (typeof domId !== 'string') return null;
    const entry = domMap.byId.get(domId);
    if (!entry) return null;
    // `ancestry` is inclusive of `domId` itself — so this returns the
    // ticket on the starting node when present (drill-up Esc on a
    // selected leaf should re-select that leaf's ticket, not its
    // parent's).
    for (let i = entry.ancestry.length - 1; i >= 0; i--) {
      const ancestor = entry.ancestry[i];
      if (ancestor === undefined) continue;
      const ticketId = domToTicket.get(ancestor);
      if (ticketId) {
        const ticket = ticketsById.get(ticketId);
        if (ticket) return ticket;
      }
    }
    return null;
  };

  const descendantTickets = (domId: string): Ticket<TExtra>[] => {
    if (typeof domId !== 'string') return [];
    const startEntry = domMap.byId.get(domId);
    if (!startEntry) return [];

    const out: Ticket<TExtra>[] = [];
    const seenTickets = new Set<string>();
    // O(n) sweep — n bounded by design size, well under the perf budget.
    // Pre-order property of `entries` makes the result deterministic.
    for (const e of domMap.entries) {
      if (e.componentTreeId !== startEntry.componentTreeId) continue;
      if (!e.ancestry.includes(domId)) continue;
      const ticketId = domToTicket.get(e.domId);
      if (!ticketId) continue;
      if (seenTickets.has(ticketId)) continue;
      const ticket = ticketsById.get(ticketId);
      if (!ticket) continue;
      seenTickets.add(ticketId);
      out.push(ticket);
    }
    return out;
  };

  return {
    ticketByDomId,
    domIdsByTicket,
    nearestEnclosingTicket,
    descendantTickets,
    unboundDomIds: [...unboundSet].sort(),
    ticketsById,
  };
}
