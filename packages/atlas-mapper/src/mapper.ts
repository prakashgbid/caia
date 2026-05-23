/**
 * Ticket ↔ DOM mapper — the bidirectional query layer.
 *
 * Given a `DomIdMap` (from `buildDomIdMap`) and a hierarchical
 * `TicketNode` tree (from the Principal-PO emit), this module returns
 * a `Mapper` with four query APIs:
 *
 *   - `ticketByDomId(domId)`         — which ticket scopes this element?
 *   - `domIdsByTicket(ticketId)`     — which elements does this ticket scope?
 *   - `nearestEnclosingTicket(domId)` — walk up the DOM ancestry until a
 *                                       ticket-bound element is found.
 *   - `descendantTickets(domId)`     — all tickets bound to elements
 *                                       inside the given DOM subtree, in
 *                                       depth-first order.
 *
 * All APIs are pure functions over the precomputed index tables.
 * Construction is O(D + T) where D = DOM entries and T = ticket nodes.
 * Query complexities are documented per-method below.
 *
 * # Binding model (atlas spec §2.4)
 *
 * The canonical contract is one ticket = one DOM-ID. We honour it via
 * `TicketNode.domId`. We also support `TicketNode.additionalDomIds` to
 * cover the legitimate case of a story that scopes a row of widgets
 * (e.g. `ST-home-hero-stats-row` scoping every stat-card inside it).
 *
 * Both directions are indexed:
 *
 *   domToTicket : Map<domId, ticketId>     — many DOM-IDs → one ticket
 *                                            (lookup hot path)
 *   ticketToDom : Map<ticketId, domId[]>   — one ticket → many DOM-IDs
 *
 * A ticket binding to a DOM-ID that doesn't exist in the supplied map
 * is **not** an error — atlas spec §2.3 says ticket trees can outlive
 * a single design version (orphaned tickets are surfaced, not
 * deleted). We log the unbound DOM-IDs in `unboundDomIds` instead and
 * the queries gracefully return `null` / `[]`.
 *
 * A ticket id that appears twice in the tree IS an error — a tree
 * with duplicate ids is structurally broken.
 */

import { AtlasMapperError } from './errors.js';
import type { DomIdMap, DomIdEntry } from './dom-id-map.js';
import type { Ticket, TicketNode } from './ticket-tree.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The public mapper interface returned by `buildMapper`. All methods
 * are bound functions — callers can destructure them safely.
 */
export interface Mapper<TExtra = Record<string, any>> {
  /**
   * Find the ticket that directly binds this DOM-ID. Returns `null`
   * when the DOM-ID isn't bound to any ticket.
   *
   * Complexity: O(1).
   */
  ticketByDomId: (domId: string) => Ticket<TExtra> | null;

  /**
   * Find every DOM-ID a ticket scopes (its `domId` plus any
   * `additionalDomIds`). Returns `[]` when the ticket isn't found or
   * scopes nothing.
   *
   * Result is sorted lexicographically for determinism.
   *
   * Complexity: O(k log k) where k is the result size.
   */
  domIdsByTicket: (ticketId: string) => string[];

  /**
   * Walk up the DOM ancestry starting from `domId` and return the
   * first ticket-bound DOM-ID's ticket. Returns `null` when neither
   * the element nor any ancestor is bound.
   *
   * If `domId` itself is bound, returns that ticket — i.e. this
   * method is inclusive of the starting node.
   *
   * Complexity: O(depth).
   */
  nearestEnclosingTicket: (domId: string) => Ticket<TExtra> | null;

  /**
   * Return every ticket bound to a DOM-ID inside the subtree rooted at
   * `domId`, in depth-first pre-order. The starting node itself is
   * included if it's ticket-bound.
   *
   * Complexity: O(subtree-size).
   */
  descendantTickets: (domId: string) => Ticket<TExtra>[];

  /**
   * DOM-IDs that appeared in the ticket tree but don't exist in the
   * supplied `DomIdMap`. Surfacing these is how atlas's UI builds the
   * "orphaned tickets" banner per spec §2.3.
   *
   * Sorted lexicographically.
   */
  unboundDomIds: string[];

  /**
   * The full ticket index, keyed by ticket id. Exposed for callers
   * that want to enumerate or build their own indices on top.
   */
  ticketsById: ReadonlyMap<string, Ticket<TExtra>>;
}

/* ────────────────────────────────────────────────────────────────── */
/* construction                                                        */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Flatten a TicketNode tree into a Map<ticketId, Ticket>, recording
 * parent linkages. Detects duplicate ids and cycles.
 */
function flattenTicketTree<TExtra>(
  roots: TicketNode<TExtra>[],
): { byId: Map<string, Ticket<TExtra>>; bindings: Array<{ ticketId: string; domId: string }> } {
  const byId = new Map<string, Ticket<TExtra>>();
  const bindings: Array<{ ticketId: string; domId: string }> = [];
  const visitedOnPath = new Set<string>();

  function visit(node: TicketNode<TExtra>, parentId?: string): void {
    if (!node || typeof node !== 'object') {
      throw new AtlasMapperError('invalid_ticket_tree', 'ticket node must be an object', {});
    }
    if (typeof node.id !== 'string' || node.id.length === 0) {
      throw new AtlasMapperError(
        'invalid_ticket_tree',
        'ticket node must have a non-empty string id',
        { node },
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

    const ticket: Ticket<TExtra> = {
      id: node.id,
      ...(node.domId !== undefined ? { domId: node.domId } : {}),
      ...(node.additionalDomIds !== undefined
        ? { additionalDomIds: [...node.additionalDomIds] }
        : {}),
      ...(parentId !== undefined ? { parentId } : {}),
      ...(node.extra !== undefined ? { extra: node.extra } : {}),
    };
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
        visit(child, node.id);
      }
    }
    visitedOnPath.delete(node.id);
  }

  for (const root of roots) visit(root);

  return { byId, bindings };
}

/**
 * Build a Mapper from a DOM-ID map and a hierarchical ticket tree.
 *
 * The `tickets` argument can be either a single root node or an array
 * of roots — many ticket emitters produce a forest (multiple Site-level
 * tickets) rather than a single root, so we accept both for ergonomics.
 *
 * @throws AtlasMapperError on invalid ticket tree (cycle, duplicate id)
 */
export function buildMapper<TExtra = Record<string, any>>(
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
    if (!domMap.byId.has(domId)) {
      unboundSet.add(domId);
    }
    // Multiple tickets pointing at the same DOM-ID would violate spec
    // §2.4 (unique (designVersionId, domId)). First binding wins; we
    // attach a context-carrying error to surface the collision.
    if (domToTicket.has(domId) && domToTicket.get(domId) !== ticketId) {
      throw new AtlasMapperError(
        'invalid_ticket_tree',
        `DOM-ID '${domId}' is bound by both '${domToTicket.get(domId)}' and '${ticketId}'`,
        { domId, ticketIds: [domToTicket.get(domId), ticketId] },
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

  /* ─── query implementations ─────────────────────────────────── */

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
    if (!entry) {
      // The DOM-ID doesn't exist; we can't walk an ancestry we don't
      // have. Return null rather than guessing.
      return null;
    }
    // Walk the ancestry from leaf → root. `ancestry` is inclusive of
    // `domId` itself per dom-id-map.ts, so this naturally returns the
    // ticket on the starting node if one exists.
    for (let i = entry.ancestry.length - 1; i >= 0; i--) {
      const ancestorDomId = entry.ancestry[i];
      if (ancestorDomId === undefined) continue;
      const ticketId = domToTicket.get(ancestorDomId);
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

    // Pre-order traversal: scan `entries` (which is in pre-order from
    // buildDomIdMap) and pick those whose ancestry includes `domId`.
    // This is O(n) once per call but n is bounded by the design size
    // and stays well under the perf envelope; trading clarity for the
    // ~equivalent recursion is the right call here.
    for (const e of domMap.entries) {
      // Same component-tree gate: a DOM-ID's descendants must share
      // its componentTreeId, otherwise we're mixing trees.
      if (e.componentTreeId !== startEntry.componentTreeId) continue;
      // ancestry contains domId means e is inside the subtree (or is
      // the start node itself, which we include per spec).
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
