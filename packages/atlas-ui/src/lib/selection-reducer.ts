/**
 * Selection reducer — the pure-logic state machine that drives the
 * Atlas selection model (spec §3).
 *
 * Kept reducer-shaped (and pure) for three reasons:
 *
 *   1. The same state must be derivable from a click in the iframe,
 *      a click in the panel, a keyboard event, or an SSE event. A
 *      reducer is the only honest way to keep these in sync.
 *   2. Tests assert the state-machine independent of React.
 *   3. Selection logic must run identically in unit tests, Storybook,
 *      and prod — no DOM, no effects, no `useState` leakage.
 *
 * Every action is named for the operator intent it represents
 * (`selectDomId` from an iframe click; `selectTicket` from a panel
 * click; `drillUp` from `Esc` or `↑`). The reducer never reaches into
 * the mapper directly — the caller passes the `Mapper` instance in
 * each dispatch (it's cheap; the mapper is a stable reference).
 */

import type { Mapper } from '@chiefaia/atlas-mapper';
import type { AtlasSelection } from '../types/index.js';

/** Initial state — nothing selected. */
export const initialSelection: AtlasSelection = {
  domIds: [],
  ticketIds: [],
  primary: null,
};

/** Action kinds — discriminated union. */
export type SelectionAction =
  | {
      type: 'selectDomId';
      domId: string;
      mapper: Mapper;
      mode?: 'replace' | 'add' | 'toggle';
    }
  | {
      type: 'selectTicket';
      ticketId: string;
      mapper: Mapper;
      mode?: 'replace' | 'add' | 'toggle';
    }
  | { type: 'drillUp'; mapper: Mapper }
  | { type: 'drillDown'; mapper: Mapper }
  | { type: 'clear' };

interface NormalisedSelection {
  domIds: string[];
  ticketIds: string[];
  primary: AtlasSelection['primary'];
}

/**
 * Pure reducer. Returns a NEW selection object on every action — even
 * when the new selection is logically equal, we return a new reference
 * if anything material changed. React equality checks rely on this.
 */
export function selectionReducer(
  state: AtlasSelection,
  action: SelectionAction,
): AtlasSelection {
  switch (action.type) {
    case 'selectDomId': {
      const ticket = action.mapper.ticketByDomId(action.domId);
      // Permit selecting elements without a bound ticket — operator
      // can still see the box; the panel just won't highlight.
      const ticketId = ticket?.id ?? null;
      return applyMode(state, {
        domId: action.domId,
        ticketId,
        mode: action.mode ?? 'replace',
      });
    }
    case 'selectTicket': {
      const domIds = action.mapper.domIdsByTicket(action.ticketId);
      // Pick the first bound DOM-ID as primary. domIdsByTicket sorts
      // lex; for the panel-click case any deterministic pick is fine.
      const primaryDomId = domIds[0] ?? null;
      return applyMode(state, {
        domId: primaryDomId,
        ticketId: action.ticketId,
        mode: action.mode ?? 'replace',
        // When mode=replace, also expand the selection to include all
        // bound DOM-IDs so the overlay can draw multiple boxes for a
        // story that scopes several elements.
        extraDomIds: action.mode === 'replace' || !action.mode ? domIds.slice(1) : [],
      });
    }
    case 'drillUp': {
      if (!state.primary) return state;
      const parent = action.mapper.nearestEnclosingTicket(state.primary.domId);
      if (!parent) return state;
      if (parent.id === state.primary.ticketId) {
        // The starting node IS the nearest enclosing ticket — walk to
        // the ticket's parent in the tree.
        if (!parent.parentId) return state;
        const grandparent = action.mapper.ticketsById.get(parent.parentId);
        if (!grandparent || !grandparent.domId) return state;
        return applyMode(state, {
          domId: grandparent.domId,
          ticketId: grandparent.id,
          mode: 'replace',
        });
      }
      if (!parent.domId) return state;
      return applyMode(state, {
        domId: parent.domId,
        ticketId: parent.id,
        mode: 'replace',
      });
    }
    case 'drillDown': {
      if (!state.primary) return state;
      const descendants = action.mapper.descendantTickets(state.primary.domId);
      // Skip the current ticket itself; pick the next ticket in
      // pre-order (which is the natural "first child" choice).
      const next = descendants.find(
        (t) => t.id !== state.primary?.ticketId && t.domId,
      );
      if (!next || !next.domId) return state;
      return applyMode(state, {
        domId: next.domId,
        ticketId: next.id,
        mode: 'replace',
      });
    }
    case 'clear':
      return initialSelection;
    /* istanbul ignore next */
    default: {
      // Exhaustiveness check — compile error if we forget a case.
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

interface ApplyModeInput {
  domId: string | null;
  ticketId: string | null;
  mode: 'replace' | 'add' | 'toggle';
  extraDomIds?: string[];
}

function applyMode(prev: AtlasSelection, input: ApplyModeInput): AtlasSelection {
  const { domId, ticketId, mode } = input;
  if (!domId) return prev;

  const prevDomIds = new Set(prev.domIds);
  const prevTicketIds = new Set(prev.ticketIds);
  const extras = input.extraDomIds ?? [];

  let nextDomIds: string[];
  let nextTicketIds: string[];

  switch (mode) {
    case 'replace': {
      nextDomIds = unique([domId, ...extras]);
      nextTicketIds = ticketId ? [ticketId] : [];
      break;
    }
    case 'add': {
      nextDomIds = unique([...prev.domIds, domId, ...extras]);
      nextTicketIds = ticketId ? unique([...prev.ticketIds, ticketId]) : prev.ticketIds;
      break;
    }
    case 'toggle': {
      if (prevDomIds.has(domId)) {
        nextDomIds = prev.domIds.filter((d) => d !== domId);
        nextTicketIds =
          ticketId && prevTicketIds.has(ticketId)
            ? prev.ticketIds.filter((t) => t !== ticketId)
            : prev.ticketIds;
      } else {
        nextDomIds = unique([...prev.domIds, domId, ...extras]);
        nextTicketIds = ticketId ? unique([...prev.ticketIds, ticketId]) : prev.ticketIds;
      }
      break;
    }
    /* istanbul ignore next */
    default: {
      const _exhaustive: never = mode;
      void _exhaustive;
      return prev;
    }
  }

  // Primary is always the most-recently-acted-upon (domId,ticketId).
  // If the toggle removed it, fall back to the new last entry.
  const inserted = nextDomIds.includes(domId);
  const primaryDomId = inserted ? domId : nextDomIds[nextDomIds.length - 1] ?? null;
  const primaryTicketId =
    inserted && ticketId
      ? ticketId
      : nextTicketIds[nextTicketIds.length - 1] ?? null;

  const next: NormalisedSelection = {
    domIds: nextDomIds,
    ticketIds: nextTicketIds,
    primary:
      primaryDomId && primaryTicketId
        ? { domId: primaryDomId, ticketId: primaryTicketId }
        : null,
  };

  return next;
}

function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/**
 * Compute the breadcrumb path for the current primary selection.
 * Returns the ancestry tickets in root-first order — `[Site, Page,
 * Section, Widget, Story]`. Empty when nothing is selected.
 */
export function breadcrumbForSelection(
  selection: AtlasSelection,
  mapper: Mapper,
): { id: string; level: string; title: string }[] {
  if (!selection.primary) return [];
  const out: { id: string; level: string; title: string }[] = [];
  let cursor = mapper.ticketsById.get(selection.primary.ticketId);
  while (cursor) {
    const extra = (cursor.extra ?? {}) as { level?: string; title?: string };
    out.unshift({
      id: cursor.id,
      level: extra.level ?? 'unknown',
      title: extra.title ?? cursor.id,
    });
    if (!cursor.parentId) break;
    cursor = mapper.ticketsById.get(cursor.parentId);
  }
  return out;
}
