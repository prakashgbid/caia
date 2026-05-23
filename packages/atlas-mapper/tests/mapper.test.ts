import { describe, expect, it } from 'vitest';
import { assignStableDomIds } from '../src/assign-stable-dom-ids.js';
import { buildDomIdMap } from '../src/dom-id-map.js';
import { buildMapper } from '../src/mapper.js';
import { AtlasMapperError } from '../src/errors.js';
import { HOME_DOM_IDS, smallDesign, smallTicketTree } from './fixtures.js';

function mapperForSmallDesign() {
  const stabilised = assignStableDomIds(smallDesign());
  const map = buildDomIdMap(stabilised);
  return buildMapper(map, smallTicketTree());
}

describe('Mapper.ticketByDomId', () => {
  it('finds the ticket directly bound to a DOM-ID', () => {
    const m = mapperForSmallDesign();
    expect(m.ticketByDomId(HOME_DOM_IDS.hero)?.id).toBe('WD-home-hero');
  });

  it('returns null for an unbound DOM-ID', () => {
    const m = mapperForSmallDesign();
    expect(m.ticketByDomId(HOME_DOM_IDS.h2)).toBeNull();
  });

  it('returns null for an unknown DOM-ID', () => {
    const m = mapperForSmallDesign();
    expect(m.ticketByDomId('nope')).toBeNull();
  });

  it('returns null for a non-string input', () => {
    const m = mapperForSmallDesign();
    // @ts-expect-error — testing runtime guard
    expect(m.ticketByDomId(undefined)).toBeNull();
  });

  it('finds tickets via additionalDomIds bindings', () => {
    const m = mapperForSmallDesign();
    expect(m.ticketByDomId(HOME_DOM_IDS.link0)?.id).toBe('ST-home-cert-row');
    expect(m.ticketByDomId(HOME_DOM_IDS.link2)?.id).toBe('ST-home-cert-row');
  });
});

describe('Mapper.domIdsByTicket', () => {
  it('returns all DOM-IDs scoped by a ticket (sorted)', () => {
    const m = mapperForSmallDesign();
    const ids = m.domIdsByTicket('ST-home-cert-row');
    expect(ids).toEqual([...ids].sort());
    expect(ids).toContain(HOME_DOM_IDS.link0);
    expect(ids).toContain(HOME_DOM_IDS.link2);
  });

  it('returns [] for a ticket that scopes nothing', () => {
    const m = mapperForSmallDesign();
    expect(m.domIdsByTicket('S-site')).toEqual([]);
  });

  it('returns [] for an unknown ticket id', () => {
    const m = mapperForSmallDesign();
    expect(m.domIdsByTicket('nope')).toEqual([]);
  });

  it('returns the singleton domId for a 1:1 binding', () => {
    const m = mapperForSmallDesign();
    expect(m.domIdsByTicket('WD-home-hero')).toEqual([HOME_DOM_IDS.hero]);
  });
});

describe('Mapper.nearestEnclosingTicket', () => {
  it('returns the ticket on the starting node if bound (inclusive)', () => {
    const m = mapperForSmallDesign();
    expect(m.nearestEnclosingTicket(HOME_DOM_IDS.hero)?.id).toBe('WD-home-hero');
  });

  it('walks up DOM ancestry until a bound ancestor is found', () => {
    const m = mapperForSmallDesign();
    // h2 is unbound; nearest enclosing is the section.
    expect(m.nearestEnclosingTicket(HOME_DOM_IDS.h2)?.id).toBe('SE-home-cert-strip');
  });

  it('returns null when neither node nor any ancestor is bound', () => {
    // Build a tree with no bindings inside it at all.
    const stabilised = assignStableDomIds({
      designVersionId: 'dv_x',
      routes: [{ path: '/', componentTreeId: 't' }],
      componentTrees: {
        t: {
          node: {
            tag: 'div',
            role: 'page',
            children: [{ tag: 'p', role: 'leaf' }],
          },
        },
      },
    });
    const m = buildMapper(buildDomIdMap(stabilised), [{ id: 'S-org' }]);
    expect(m.nearestEnclosingTicket('div:page:0>p:leaf:0')).toBeNull();
  });

  it('returns null for an unknown DOM-ID', () => {
    const m = mapperForSmallDesign();
    expect(m.nearestEnclosingTicket('nope')).toBeNull();
  });
});

describe('Mapper.descendantTickets', () => {
  it('returns all tickets inside the subtree (pre-order, deduped)', () => {
    const m = mapperForSmallDesign();
    const tickets = m.descendantTickets(HOME_DOM_IDS.page).map((t) => t.id);
    expect(tickets[0]).toBe('PG-home');
    expect(tickets).toContain('WD-home-nav');
    expect(tickets).toContain('WD-home-hero');
    expect(tickets).toContain('WD-home-hero-slide-01');
    expect(tickets).toContain('SE-home-cert-strip');
    expect(tickets).toContain('ST-home-cert-row');
  });

  it('includes the start node if it is bound', () => {
    const m = mapperForSmallDesign();
    const tickets = m.descendantTickets(HOME_DOM_IDS.hero);
    expect(tickets[0]?.id).toBe('WD-home-hero');
  });

  it('does not include tickets from other component trees', () => {
    const m = mapperForSmallDesign();
    const tickets = m.descendantTickets(HOME_DOM_IDS.page).map((t) => t.id);
    expect(tickets).not.toContain('PG-about');
    expect(tickets).not.toContain('WD-about-nav');
  });

  it('returns [] for an unknown DOM-ID', () => {
    const m = mapperForSmallDesign();
    expect(m.descendantTickets('nope')).toEqual([]);
  });
});

describe('buildMapper validation', () => {
  it('throws on invalid map argument', () => {
    expect(() => buildMapper({} as never, [{ id: 'x' }])).toThrowError(AtlasMapperError);
  });

  it('throws on missing ticket id', () => {
    const stabilised = assignStableDomIds(smallDesign());
    const map = buildDomIdMap(stabilised);
    try {
      buildMapper(map, [{ id: '' } as never]);
      expect.fail('expected throw');
    } catch (e) {
      expect((e as AtlasMapperError).code).toBe('invalid_ticket_tree');
    }
  });

  it('throws on duplicate ticket id (sibling duplicate)', () => {
    const stabilised = assignStableDomIds(smallDesign());
    const map = buildDomIdMap(stabilised);
    try {
      buildMapper(map, [
        {
          id: 'ROOT',
          children: [
            { id: 'DUP' },
            { id: 'DUP' },
          ],
        },
      ]);
      expect.fail('expected throw');
    } catch (e) {
      expect((e as AtlasMapperError).code).toBe('invalid_ticket_tree');
    }
  });

  it('throws on cycle in the ticket tree', () => {
    const stabilised = assignStableDomIds(smallDesign());
    const map = buildDomIdMap(stabilised);
    const a: { id: string; children: { id: string; children?: unknown[] }[] } = {
      id: 'A',
      children: [{ id: 'B' }],
    };
    // Manually craft a cycle.
    (a.children[0] as { id: string; children?: unknown[] }).children = [a as unknown];
    try {
      buildMapper(map, [a as never]);
      expect.fail('expected throw');
    } catch (e) {
      expect((e as AtlasMapperError).code).toBe('cycle_detected');
    }
  });

  it('throws duplicate_ticket_binding when two tickets bind the same DOM-ID', () => {
    const stabilised = assignStableDomIds(smallDesign());
    const map = buildDomIdMap(stabilised);
    try {
      buildMapper(map, [
        {
          id: 'S-root',
          children: [
            { id: 'T1', domId: HOME_DOM_IDS.hero },
            { id: 'T2', domId: HOME_DOM_IDS.hero },
          ],
        },
      ]);
      expect.fail('expected throw');
    } catch (e) {
      expect((e as AtlasMapperError).code).toBe('duplicate_ticket_binding');
    }
  });

  it('surfaces unbound DOM-IDs without throwing', () => {
    const stabilised = assignStableDomIds(smallDesign());
    const map = buildDomIdMap(stabilised);
    const m = buildMapper(map, [
      { id: 'PG-ghost', domId: 'unknown:page:0' },
    ]);
    expect(m.unboundDomIds).toEqual(['unknown:page:0']);
  });

  it('preserves the parent chain via Ticket.parentId', () => {
    const m = mapperForSmallDesign();
    const slide = m.ticketByDomId(HOME_DOM_IDS.heroSlide1)!;
    expect(slide.parentId).toBe('WD-home-hero');
  });

  it('exposes ticketsById as the full index', () => {
    const m = mapperForSmallDesign();
    expect(m.ticketsById.size).toBeGreaterThan(5);
    expect(m.ticketsById.has('S-site')).toBe(true);
  });
});
