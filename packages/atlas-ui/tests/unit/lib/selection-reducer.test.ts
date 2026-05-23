/**
 * Selection reducer — pure-logic tests, no DOM.
 */

import { describe, expect, it } from 'vitest';
import { assignStableDomIds, buildDomIdMap, buildMapper, type Mapper } from '@chiefaia/atlas-mapper';

import {
  initialSelection,
  selectionReducer,
  breadcrumbForSelection,
} from '../../../src/lib/selection-reducer.js';
import {
  HERO_STATS_TICKET_ID,
  renderableDesign,
  ticketTree,
  toMapperTickets,
} from '../../../fixtures/index.js';

function makeMapper(): Mapper {
  const stabilised = assignStableDomIds(renderableDesign);
  const map = buildDomIdMap(stabilised);
  return buildMapper(map, toMapperTickets(ticketTree.tree)) as Mapper;
}

describe('selectionReducer', () => {
  const mapper = makeMapper();

  it('selectDomId binds the corresponding ticket', () => {
    const s = selectionReducer(initialSelection, {
      type: 'selectDomId',
      mapper,
      domId: HERO_STATS_TICKET_ID,
    });
    expect(s.domIds).toEqual([HERO_STATS_TICKET_ID]);
    expect(s.ticketIds).toEqual([HERO_STATS_TICKET_ID]);
    expect(s.primary).toEqual({
      domId: HERO_STATS_TICKET_ID,
      ticketId: HERO_STATS_TICKET_ID,
    });
  });

  it('selectTicket includes additional DOM-IDs when present', () => {
    const s = selectionReducer(initialSelection, {
      type: 'selectTicket',
      mapper,
      ticketId: 'SE-home-hero',
    });
    expect(s.ticketIds).toEqual(['SE-home-hero']);
    expect(s.primary?.domId).toBe('SE-home-hero');
  });

  it('add mode appends without replacing', () => {
    let s = selectionReducer(initialSelection, {
      type: 'selectDomId',
      mapper,
      domId: 'SE-home-hero',
    });
    s = selectionReducer(s, {
      type: 'selectDomId',
      mapper,
      domId: 'WD-home-hero-rotator',
      mode: 'add',
    });
    expect(s.domIds).toContain('SE-home-hero');
    expect(s.domIds).toContain('WD-home-hero-rotator');
    expect(s.primary?.ticketId).toBe('WD-home-hero-rotator');
  });

  it('toggle mode removes when already present', () => {
    let s = selectionReducer(initialSelection, {
      type: 'selectDomId',
      mapper,
      domId: 'SE-home-hero',
    });
    s = selectionReducer(s, {
      type: 'selectDomId',
      mapper,
      domId: 'SE-home-hero',
      mode: 'toggle',
    });
    expect(s.domIds).not.toContain('SE-home-hero');
  });

  it('drillUp walks to the enclosing ticket', () => {
    const start = selectionReducer(initialSelection, {
      type: 'selectDomId',
      mapper,
      domId: HERO_STATS_TICKET_ID,
    });
    const up = selectionReducer(start, { type: 'drillUp', mapper });
    // Parent of HERO_STATS_TICKET_ID is the slide-01 widget.
    expect(up.primary?.ticketId).toBe('WD-home-hero-slide-01-caia');
  });

  it('drillDown walks into the first descendant ticket', () => {
    const start = selectionReducer(initialSelection, {
      type: 'selectDomId',
      mapper,
      domId: 'SE-home-hero',
    });
    const down = selectionReducer(start, { type: 'drillDown', mapper });
    expect(down.primary?.ticketId).toBe('WD-home-hero-rotator');
  });

  it('clear returns initial', () => {
    const start = selectionReducer(initialSelection, {
      type: 'selectDomId',
      mapper,
      domId: 'PG-home',
    });
    expect(selectionReducer(start, { type: 'clear' })).toEqual(initialSelection);
  });

  it('selectDomId on unknown id leaves selection unchanged (no domId resolved)', () => {
    const s = selectionReducer(initialSelection, {
      type: 'selectDomId',
      mapper,
      domId: 'WD-does-not-exist',
    });
    expect(s.domIds).toEqual(['WD-does-not-exist']);
    expect(s.ticketIds).toEqual([]);
    expect(s.primary).toBeNull();
  });

  it('breadcrumbForSelection returns root → leaf path', () => {
    const sel = selectionReducer(initialSelection, {
      type: 'selectDomId',
      mapper,
      domId: HERO_STATS_TICKET_ID,
    });
    const bc = breadcrumbForSelection(sel, mapper);
    // The breadcrumb walks the full ticket-tree ancestry — the
    // mapper's ticketsById includes the Site root (its `parentId`
    // refers up to it). For UI presentation the host MAY drop the
    // first segment, but the underlying helper returns the full
    // root-to-leaf path.
    const ids = bc.map((b) => b.id);
    expect(ids).toContain('PG-home');
    expect(ids).toContain('SE-home-hero');
    expect(ids).toContain('WD-home-hero-rotator');
    expect(ids).toContain('WD-home-hero-slide-01-caia');
    expect(ids[ids.length - 1]).toBe(HERO_STATS_TICKET_ID);
  });
});
