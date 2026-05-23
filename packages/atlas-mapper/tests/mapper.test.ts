import { describe, it, expect } from 'vitest';
import {
  buildDomIdMap,
  buildMapper,
  AtlasMapperError,
  type TicketNode,
} from '../src/index.js';
import { simpleHomeDesign, simpleHomeTickets } from './fixtures.js';

describe('buildMapper — ticketByDomId', () => {
  it('returns the ticket bound to the DOM-ID', () => {
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), simpleHomeTickets());
    const t = m.ticketByDomId('WD-home-hero-cta');
    expect(t?.id).toBe('WD-home-hero-cta');
  });

  it('returns null for an unknown DOM-ID', () => {
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), simpleHomeTickets());
    expect(m.ticketByDomId('does-not-exist')).toBeNull();
  });

  it('returns null when given a non-string', () => {
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), simpleHomeTickets());
    expect(m.ticketByDomId(undefined as unknown as string)).toBeNull();
  });

  it('preserves the extra payload on the returned ticket', () => {
    const tickets: TicketNode<{ status: string }>[] = [
      {
        id: 'PG-home',
        domId: 'PG-home',
        extra: { status: 'proposed' },
      },
    ];
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), tickets);
    const t = m.ticketByDomId('PG-home');
    expect(t?.extra).toEqual({ status: 'proposed' });
  });
});

describe('buildMapper — domIdsByTicket', () => {
  it('returns the single bound DOM-ID for a 1:1 ticket', () => {
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), simpleHomeTickets());
    expect(m.domIdsByTicket('WD-home-hero-cta')).toEqual(['WD-home-hero-cta']);
  });

  it('returns all bound DOM-IDs for a ticket with additionalDomIds', () => {
    const tickets: TicketNode[] = [
      {
        id: 'PG-home',
        domId: 'PG-home',
        additionalDomIds: ['SE-home-hero', 'SE-home-footer'],
      },
    ];
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), tickets);
    expect(m.domIdsByTicket('PG-home').sort()).toEqual([
      'PG-home',
      'SE-home-footer',
      'SE-home-hero',
    ]);
  });

  it('returns [] for an unknown ticket id', () => {
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), simpleHomeTickets());
    expect(m.domIdsByTicket('NOPE')).toEqual([]);
  });

  it('returns [] for a ticket with no DOM bindings', () => {
    const tickets: TicketNode[] = [
      { id: 'PG-home', domId: 'PG-home', children: [{ id: 'EPIC-no-dom' }] },
    ];
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), tickets);
    expect(m.domIdsByTicket('EPIC-no-dom')).toEqual([]);
  });
});

describe('buildMapper — nearestEnclosingTicket', () => {
  it('returns the ticket on the starting node when it is itself bound', () => {
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), simpleHomeTickets());
    const t = m.nearestEnclosingTicket('WD-home-hero-cta');
    expect(t?.id).toBe('WD-home-hero-cta');
  });

  it('walks up until it finds the nearest bound ancestor', () => {
    // Drop the bindings on the leaf-most level so the walk has to climb.
    const tickets: TicketNode[] = [
      {
        id: 'PG-home',
        domId: 'PG-home',
        children: [
          {
            id: 'SE-home-hero',
            domId: 'SE-home-hero',
            children: [{ id: 'WD-home-hero-rotator', domId: 'WD-home-hero-rotator' }],
          },
        ],
      },
    ];
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), tickets);
    const t = m.nearestEnclosingTicket('WD-home-hero-cta');
    // CTA isn't bound; rotator is its direct parent and is bound.
    expect(t?.id).toBe('WD-home-hero-rotator');
  });

  it('returns null when no ancestor (and not the node itself) is bound', () => {
    const tickets: TicketNode[] = [{ id: 'meta-only' }];
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), tickets);
    expect(m.nearestEnclosingTicket('WD-home-hero-cta')).toBeNull();
  });

  it('returns null when the DOM-ID itself does not exist in the map', () => {
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), simpleHomeTickets());
    expect(m.nearestEnclosingTicket('ghost-id')).toBeNull();
  });

  it('walks all the way to the page-level root when needed', () => {
    const tickets: TicketNode[] = [{ id: 'PG-home', domId: 'PG-home' }];
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), tickets);
    expect(m.nearestEnclosingTicket('WD-home-hero-cta')?.id).toBe('PG-home');
  });
});

describe('buildMapper — descendantTickets', () => {
  it('returns every ticket under a subtree in depth-first pre-order', () => {
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), simpleHomeTickets());
    const tickets = m.descendantTickets('SE-home-hero').map((t) => t.id);
    expect(tickets).toEqual([
      'SE-home-hero',
      'WD-home-hero-rotator',
      'WD-home-hero-cta',
      'WD-home-hero-headline',
      'WD-home-hero-image',
    ]);
  });

  it('includes the starting node when it is ticket-bound', () => {
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), simpleHomeTickets());
    const ids = m.descendantTickets('PG-home').map((t) => t.id);
    expect(ids[0]).toBe('PG-home');
  });

  it('returns [] for an unknown DOM-ID', () => {
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), simpleHomeTickets());
    expect(m.descendantTickets('ghost')).toEqual([]);
  });

  it('returns [] for a subtree whose nodes are not ticket-bound', () => {
    const tickets: TicketNode[] = [{ id: 'PG-home', domId: 'PG-home' }];
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), tickets);
    expect(m.descendantTickets('SE-home-hero')).toEqual([]);
  });

  it('returns a leaf ticket alone when called on a leaf DOM-ID', () => {
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), simpleHomeTickets());
    const ids = m.descendantTickets('WD-home-hero-cta').map((t) => t.id);
    expect(ids).toEqual(['WD-home-hero-cta']);
  });

  it('does not bleed across component trees', () => {
    const design = simpleHomeDesign();
    design.routes.push({ path: '/about', componentTreeId: 'tree:about' });
    design.componentTrees['tree:about'] = {
      node: {
        tag: 'main',
        role: 'page',
        domId: 'PG-about',
        children: [{ tag: 'h1', role: 'leaf', domId: 'WD-about-headline' }],
      },
    };
    const tickets: TicketNode[] = [
      { id: 'PG-home', domId: 'PG-home' },
      { id: 'PG-about', domId: 'PG-about', children: [{ id: 'WD-about-headline', domId: 'WD-about-headline' }] },
    ];
    const m = buildMapper(buildDomIdMap(design), tickets);
    const homeDesc = m.descendantTickets('PG-home').map((t) => t.id);
    // PG-about must NOT appear in PG-home's descendants even though
    // it sits at the same logical 'page' depth.
    expect(homeDesc).not.toContain('PG-about');
  });
});

describe('buildMapper — bookkeeping', () => {
  it('surfaces unboundDomIds for tickets pointing at missing DOM-IDs', () => {
    const tickets: TicketNode[] = [
      {
        id: 'PG-home',
        domId: 'PG-home',
        children: [{ id: 'WD-orphan', domId: 'WD-not-in-design' }],
      },
    ];
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), tickets);
    expect(m.unboundDomIds).toEqual(['WD-not-in-design']);
    // The ticket still answers domIdsByTicket cleanly.
    expect(m.domIdsByTicket('WD-orphan')).toEqual(['WD-not-in-design']);
    // ticketByDomId on the orphan still finds the ticket.
    expect(m.ticketByDomId('WD-not-in-design')?.id).toBe('WD-orphan');
    // nearestEnclosingTicket on the missing id is null (we don't have
    // ancestry for an id that doesn't exist in the DOM map).
    expect(m.nearestEnclosingTicket('WD-not-in-design')).toBeNull();
  });

  it('exposes ticketsById for direct enumeration', () => {
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), simpleHomeTickets());
    expect(m.ticketsById.size).toBe(8);
    expect(m.ticketsById.get('SE-home-hero')?.id).toBe('SE-home-hero');
  });

  it('accepts a single root in place of an array', () => {
    const m = buildMapper(buildDomIdMap(simpleHomeDesign()), simpleHomeTickets()[0]!);
    expect(m.ticketByDomId('PG-home')?.id).toBe('PG-home');
  });
});

describe('buildMapper — error handling', () => {
  it('throws on duplicate ticket ids in the tree', () => {
    const dup: TicketNode[] = [
      {
        id: 'PG-home',
        domId: 'PG-home',
        children: [
          { id: 'X', domId: 'WD-home-hero-cta' },
          { id: 'X', domId: 'WD-home-hero-headline' },
        ],
      },
    ];
    expect(() => buildMapper(buildDomIdMap(simpleHomeDesign()), dup)).toThrow(
      /Duplicate ticket id/,
    );
  });

  it('throws on a ticket-tree cycle', () => {
    // Hand-craft a cyclic node graph (TS won't let us do this naturally
    // because TicketNode.children is non-circular by inference).
    const a: TicketNode = { id: 'A' };
    const b: TicketNode = { id: 'B' };
    a.children = [b];
    b.children = [a];
    expect(() => buildMapper(buildDomIdMap(simpleHomeDesign()), [a])).toThrow(
      AtlasMapperError,
    );
  });

  it('throws on a non-string ticket id', () => {
    expect(() =>
      buildMapper(buildDomIdMap(simpleHomeDesign()), [
        { id: 123 } as unknown as TicketNode,
      ]),
    ).toThrow(/non-empty string id/);
  });

  it('throws when two tickets bind the same DOM-ID', () => {
    const collision: TicketNode[] = [
      { id: 'A', domId: 'WD-home-hero-cta' },
      { id: 'B', domId: 'WD-home-hero-cta' },
    ];
    expect(() => buildMapper(buildDomIdMap(simpleHomeDesign()), collision)).toThrow(
      /is bound by both/,
    );
  });
});
