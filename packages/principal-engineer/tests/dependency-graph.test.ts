import { describe, expect, it } from 'vitest';

import {
  buildDependencyGraph,
  DependencyGraphError,
  detectCycles,
  groupByLevel,
  tarjanSccs,
  topoLevels,
} from '../src/dependency-graph.js';
import { mk } from './test-helpers.js';

describe('buildDependencyGraph', () => {
  it('handles an empty input', () => {
    const g = buildDependencyGraph([]);
    expect(g.nodes.size).toBe(0);
  });

  it('builds a single-node graph', () => {
    const g = buildDependencyGraph([mk('A')]);
    expect(g.nodes.get('A')?.ticketId).toBe('A');
    expect(g.successors.get('A')).toEqual([]);
    expect(g.predecessors.get('A')).toEqual([]);
  });

  it('builds a two-node chain', () => {
    const g = buildDependencyGraph([mk('A'), mk('B', ['A'])]);
    expect(g.successors.get('A')).toEqual(['B']);
    expect(g.predecessors.get('B')).toEqual(['A']);
  });

  it('rejects empty ticketId', () => {
    expect(() => buildDependencyGraph([mk('')])).toThrow(DependencyGraphError);
  });

  it('rejects duplicate ticketId', () => {
    expect(() => buildDependencyGraph([mk('A'), mk('A')])).toThrow(/duplicate/);
  });

  it('rejects missing dependency', () => {
    expect(() => buildDependencyGraph([mk('A', ['X'])])).toThrow(/unknown ticket/);
  });

  it('deduplicates dependsOn entries', () => {
    const g = buildDependencyGraph([mk('A'), mk('B', ['A', 'A', 'A'])]);
    expect(g.predecessors.get('B')).toEqual(['A']);
    expect(g.successors.get('A')).toEqual(['B']);
  });

  it('preserves a self-loop', () => {
    const g = buildDependencyGraph([mk('A', ['A'])]);
    expect(g.successors.get('A')).toEqual(['A']);
    expect(g.predecessors.get('A')).toEqual(['A']);
  });
});

describe('tarjanSccs', () => {
  it('returns one SCC per node in a DAG', () => {
    const g = buildDependencyGraph([mk('A'), mk('B', ['A']), mk('C', ['B'])]);
    const sccs = tarjanSccs(g);
    expect(sccs).toHaveLength(3);
    for (const s of sccs) expect(s.isCycle).toBe(false);
  });

  it('flags a self-loop as a cycle', () => {
    const g = buildDependencyGraph([mk('A', ['A'])]);
    const sccs = tarjanSccs(g);
    expect(sccs).toHaveLength(1);
    expect(sccs[0]?.isCycle).toBe(true);
    expect(sccs[0]?.nodes).toEqual(['A']);
  });

  it('flags a 2-cycle', () => {
    const g = buildDependencyGraph([mk('A', ['B']), mk('B', ['A'])]);
    const sccs = tarjanSccs(g);
    expect(sccs.filter((s) => s.isCycle)).toHaveLength(1);
    const cyc = sccs.find((s) => s.isCycle)!;
    expect(cyc.nodes).toEqual(['A', 'B']);
  });

  it('flags a 3-cycle', () => {
    const g = buildDependencyGraph([
      mk('A', ['C']),
      mk('B', ['A']),
      mk('C', ['B']),
    ]);
    const cyc = tarjanSccs(g).find((s) => s.isCycle)!;
    expect(cyc.nodes).toEqual(['A', 'B', 'C']);
  });

  it('flags a 5-node SCC', () => {
    const g = buildDependencyGraph([
      mk('A', ['E']),
      mk('B', ['A']),
      mk('C', ['B']),
      mk('D', ['C']),
      mk('E', ['D']),
    ]);
    const cyc = tarjanSccs(g).find((s) => s.isCycle)!;
    expect(cyc.nodes).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('returns multiple SCCs', () => {
    const g = buildDependencyGraph([
      mk('A', ['B']),
      mk('B', ['A']),
      mk('C', ['D']),
      mk('D', ['C']),
    ]);
    const cycles = tarjanSccs(g).filter((s) => s.isCycle);
    expect(cycles).toHaveLength(2);
    expect(cycles[0]?.nodes).toEqual(['A', 'B']);
    expect(cycles[1]?.nodes).toEqual(['C', 'D']);
  });

  it('handles a cycle nested inside a DAG', () => {
    const g = buildDependencyGraph([
      mk('root'),
      mk('A', ['root', 'B']),
      mk('B', ['A']),
      mk('leaf', ['A']),
    ]);
    const cycles = tarjanSccs(g).filter((s) => s.isCycle);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.nodes).toEqual(['A', 'B']);
  });

  it('is deterministic for the same input', () => {
    const tickets = [mk('A', ['B']), mk('B', ['A']), mk('C')];
    const g = buildDependencyGraph(tickets);
    const first = tarjanSccs(g);
    const second = tarjanSccs(g);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('handles a long linear chain (1000 nodes) without overflow', () => {
    const tickets = [];
    for (let i = 0; i < 1000; i++) {
      tickets.push(mk(`T${i}`, i === 0 ? [] : [`T${i - 1}`]));
    }
    const g = buildDependencyGraph(tickets);
    const sccs = tarjanSccs(g);
    expect(sccs).toHaveLength(1000);
    expect(sccs.every((s) => !s.isCycle)).toBe(true);
  });

  it('handles a large random DAG (500 nodes, 2000 edges) without cycles', () => {
    const N = 500;
    const tickets = [];
    for (let i = 0; i < N; i++) {
      const deps: string[] = [];
      const seen = new Set<string>();
      const target = i === 0 ? 0 : Math.min(4, i);
      while (deps.length < target) {
        const j = Math.floor(((i * 31 + deps.length * 17 + 7) % i) || 0);
        const id = `N${j}`;
        if (!seen.has(id)) {
          seen.add(id);
          deps.push(id);
        } else {
          break;
        }
      }
      tickets.push(mk(`N${i}`, deps));
    }
    const g = buildDependencyGraph(tickets);
    const cycles = tarjanSccs(g).filter((s) => s.isCycle);
    expect(cycles).toHaveLength(0);
  });
});

describe('detectCycles', () => {
  it('returns empty list on a DAG', () => {
    const g = buildDependencyGraph([mk('A'), mk('B', ['A'])]);
    expect(detectCycles(g).cycles).toEqual([]);
  });

  it('returns the cycle on a cyclic graph', () => {
    const g = buildDependencyGraph([mk('A', ['B']), mk('B', ['A'])]);
    const r = detectCycles(g);
    expect(r.cycles).toHaveLength(1);
    expect(r.cycles[0]?.nodes).toEqual(['A', 'B']);
  });
});

describe('topoLevels', () => {
  it('returns level 0 for a single node', () => {
    const g = buildDependencyGraph([mk('A')]);
    expect(topoLevels(g)).toEqual([{ ticketId: 'A', level: 0 }]);
  });

  it('returns expected levels for a chain', () => {
    const g = buildDependencyGraph([mk('A'), mk('B', ['A']), mk('C', ['B'])]);
    expect(topoLevels(g)).toEqual([
      { ticketId: 'A', level: 0 },
      { ticketId: 'B', level: 1 },
      { ticketId: 'C', level: 2 },
    ]);
  });

  it('handles a diamond (A -> {B,C} -> D)', () => {
    const g = buildDependencyGraph([
      mk('A'),
      mk('B', ['A']),
      mk('C', ['A']),
      mk('D', ['B', 'C']),
    ]);
    const lvls = new Map(topoLevels(g).map((x) => [x.ticketId, x.level]));
    expect(lvls.get('A')).toBe(0);
    expect(lvls.get('B')).toBe(1);
    expect(lvls.get('C')).toBe(1);
    expect(lvls.get('D')).toBe(2);
  });

  it('handles two disjoint diamonds', () => {
    const g = buildDependencyGraph([
      mk('A1'),
      mk('B1', ['A1']),
      mk('C1', ['A1']),
      mk('D1', ['B1', 'C1']),
      mk('A2'),
      mk('B2', ['A2']),
      mk('C2', ['A2']),
      mk('D2', ['B2', 'C2']),
    ]);
    const lvls = new Map(topoLevels(g).map((x) => [x.ticketId, x.level]));
    expect(lvls.get('D1')).toBe(2);
    expect(lvls.get('D2')).toBe(2);
  });

  it('handles disconnected components', () => {
    const g = buildDependencyGraph([mk('A'), mk('B'), mk('C', ['A'])]);
    const lvls = topoLevels(g);
    expect(lvls.find((x) => x.ticketId === 'B')?.level).toBe(0);
    expect(lvls.find((x) => x.ticketId === 'C')?.level).toBe(1);
  });

  it('throws on a cyclic graph', () => {
    const g = buildDependencyGraph([mk('A', ['B']), mk('B', ['A'])]);
    expect(() => topoLevels(g)).toThrow(/cycle/);
  });
});

describe('groupByLevel', () => {
  it('groups tickets by level preserving order', () => {
    const g = buildDependencyGraph([
      mk('A'),
      mk('B', ['A']),
      mk('C', ['A']),
      mk('D', ['B']),
    ]);
    const grouped = groupByLevel(topoLevels(g));
    expect(grouped.get(0)).toEqual(['A']);
    expect(grouped.get(1)).toEqual(['B', 'C']);
    expect(grouped.get(2)).toEqual(['D']);
  });
});
