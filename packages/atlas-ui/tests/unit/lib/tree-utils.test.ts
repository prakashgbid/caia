/**
 * Tree-utils tests — flatten + search + filter logic.
 */

import { describe, expect, it } from 'vitest';
import {
  ancestorIds,
  findNode,
  flattenTree,
  walkTree,
} from '../../../src/lib/tree-utils.js';
import { ticketTree, HERO_STATS_TICKET_ID } from '../../../fixtures/index.js';

describe('flattenTree', () => {
  it('returns only the root when nothing is expanded', () => {
    const rows = flattenTree(ticketTree.tree, { expandedIds: new Set() });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ticket.id).toBe(ticketTree.tree.id);
  });

  it('returns ancestor + child rows when root is expanded', () => {
    const rows = flattenTree(ticketTree.tree, {
      expandedIds: new Set([ticketTree.tree.id]),
    });
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0]?.ticket.id).toBe(ticketTree.tree.id);
  });

  it('search auto-expands ancestors of matches', () => {
    const rows = flattenTree(ticketTree.tree, {
      expandedIds: new Set(),
      search: 'stats',
    });
    const ids = rows.map((r) => r.ticket.id);
    expect(ids).toContain(HERO_STATS_TICKET_ID);
    expect(ids).toContain('SE-home-hero');
    expect(ids).toContain('PG-home');
  });

  it('stateFilter narrows the visible rows', () => {
    const rows = flattenTree(ticketTree.tree, {
      expandedIds: new Set([
        ticketTree.tree.id,
        'PG-home',
        'SE-home-hero',
        'WD-home-hero-rotator',
        'WD-home-hero-slide-01-caia',
      ]),
      stateFilter: new Set(['change-requested']),
    });
    expect(rows.every((r) => r.ticket.state === 'change-requested')).toBe(true);
  });
});

describe('walkTree + findNode + ancestorIds', () => {
  it('walks every node once', () => {
    let count = 0;
    walkTree(ticketTree.tree, () => {
      count++;
    });
    expect(count).toBeGreaterThan(10);
  });

  it('finds an existing node', () => {
    const n = findNode(ticketTree.tree, HERO_STATS_TICKET_ID);
    expect(n?.id).toBe(HERO_STATS_TICKET_ID);
  });

  it('returns null for unknown id', () => {
    expect(findNode(ticketTree.tree, 'WD-not-real')).toBeNull();
  });

  it('ancestorIds returns root → parent (excluding target)', () => {
    const a = ancestorIds(ticketTree.tree, HERO_STATS_TICKET_ID);
    expect(a).toEqual([
      'S-prakash-tiwari',
      'PG-home',
      'SE-home-hero',
      'WD-home-hero-rotator',
      'WD-home-hero-slide-01-caia',
    ]);
  });

  it('ancestorIds returns [] for the root itself', () => {
    expect(ancestorIds(ticketTree.tree, ticketTree.tree.id)).toEqual([]);
  });
});
