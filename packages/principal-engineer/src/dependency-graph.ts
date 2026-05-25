/**
 * Pure dependency-graph layer for the Principal Engineer (Stage 12).
 *
 * Responsibilities:
 *   1. Build a typed graph from { ticketId, dependsOn[] } records.
 *   2. Detect strongly-connected components via iterative Tarjan
 *      (stack-safe; tested on graphs of >=10k nodes).
 *   3. Compute Kahn-style topological levels (0 = roots; level N =
 *      max(predecessor levels) + 1).
 *
 * No I/O. No async. No state-machine coupling. Every function is
 * deterministic given identical inputs — important because downstream
 * bucket ids are content-addressed off of these results.
 */

import type {
  CycleReport,
  Scc,
  Ticket,
  TicketGraph,
  TopoLevel,
} from './types.js';

/** Thrown when buildDependencyGraph encounters an invalid input. */
export class DependencyGraphError extends Error {
  readonly code:
    | 'duplicate-ticket-id'
    | 'missing-dependency'
    | 'empty-ticket-id'
    | 'graph-contains-cycle';

  constructor(
    code:
      | 'duplicate-ticket-id'
      | 'missing-dependency'
      | 'empty-ticket-id'
      | 'graph-contains-cycle',
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = 'DependencyGraphError';
  }
}

/**
 * Build a TicketGraph from a flat list of tickets.
 *
 * - Tickets are kept in insertion order (the bucketer relies on this).
 * - Duplicate dependsOn entries are deduplicated.
 * - Self-loops are preserved so cycle detection can flag them.
 * - References to tickets not in the input throw DependencyGraphError.
 */
export function buildDependencyGraph(
  tickets: readonly Ticket[],
): TicketGraph {
  const nodes = new Map<string, Ticket>();
  for (const t of tickets) {
    if (!t.ticketId || t.ticketId.length === 0) {
      throw new DependencyGraphError(
        'empty-ticket-id',
        'ticketId must be a non-empty string',
      );
    }
    if (nodes.has(t.ticketId)) {
      throw new DependencyGraphError(
        'duplicate-ticket-id',
        `duplicate ticketId: ${t.ticketId}`,
      );
    }
    nodes.set(t.ticketId, t);
  }

  const predecessors = new Map<string, readonly string[]>();
  const successors = new Map<string, string[]>();
  for (const t of tickets) {
    successors.set(t.ticketId, []);
  }
  for (const t of tickets) {
    const deduped: string[] = [];
    const seen = new Set<string>();
    for (const dep of t.dependsOn) {
      if (!nodes.has(dep)) {
        throw new DependencyGraphError(
          'missing-dependency',
          `ticket ${t.ticketId} depends on unknown ticket ${dep}`,
        );
      }
      if (!seen.has(dep)) {
        seen.add(dep);
        deduped.push(dep);
      }
    }
    predecessors.set(t.ticketId, Object.freeze(deduped));
    for (const dep of deduped) {
      const succ = successors.get(dep);
      if (succ) succ.push(t.ticketId);
    }
  }

  const frozenSuccessors = new Map<string, readonly string[]>();
  for (const [k, v] of successors) {
    frozenSuccessors.set(k, Object.freeze(v.slice()));
  }

  return Object.freeze({
    nodes: nodes as ReadonlyMap<string, Ticket>,
    successors: frozenSuccessors as ReadonlyMap<string, readonly string[]>,
    predecessors: predecessors as ReadonlyMap<string, readonly string[]>,
  });
}

/**
 * Tarjan's strongly-connected components — iterative implementation so
 * deeply nested graphs don't overflow the call stack.
 *
 * Output:
 *   - All SCCs, sorted by their lowest-ticket-id member.
 *   - Inside each SCC, ticket ids are sorted lexicographically.
 *
 * An SCC is a "cycle" iff it has > 1 node OR (size == 1 AND the node has a
 * self-edge).
 */
export function tarjanSccs(graph: TicketGraph): Scc[] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: Scc[] = [];
  let nextIndex = 0;

  type Frame = {
    node: string;
    childIdx: number;
    children: readonly string[];
  };

  for (const startNode of graph.nodes.keys()) {
    if (index.has(startNode)) continue;

    const callStack: Frame[] = [
      {
        node: startNode,
        childIdx: 0,
        children: graph.successors.get(startNode) ?? [],
      },
    ];
    index.set(startNode, nextIndex);
    lowlink.set(startNode, nextIndex);
    nextIndex += 1;
    stack.push(startNode);
    onStack.add(startNode);

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1]!;
      if (frame.childIdx < frame.children.length) {
        const child = frame.children[frame.childIdx]!;
        frame.childIdx += 1;
        if (!index.has(child)) {
          index.set(child, nextIndex);
          lowlink.set(child, nextIndex);
          nextIndex += 1;
          stack.push(child);
          onStack.add(child);
          callStack.push({
            node: child,
            childIdx: 0,
            children: graph.successors.get(child) ?? [],
          });
        } else if (onStack.has(child)) {
          const cur = lowlink.get(frame.node)!;
          const cand = index.get(child)!;
          lowlink.set(frame.node, Math.min(cur, cand));
        }
      } else {
        const node = frame.node;
        if (lowlink.get(node) === index.get(node)) {
          const members: string[] = [];
          let popped: string | undefined;
          do {
            popped = stack.pop();
            if (popped === undefined) break;
            onStack.delete(popped);
            members.push(popped);
          } while (popped !== node);
          members.sort();
          const first = members[0];
          const isCycle =
            members.length > 1 ||
            (members.length === 1 &&
              first !== undefined &&
              (graph.successors.get(first) ?? []).includes(first));
          sccs.push(Object.freeze({ nodes: Object.freeze(members), isCycle }));
        }
        callStack.pop();
        if (callStack.length > 0) {
          const parent = callStack[callStack.length - 1]!;
          const cur = lowlink.get(parent.node)!;
          const cand = lowlink.get(node)!;
          lowlink.set(parent.node, Math.min(cur, cand));
        }
      }
    }
  }

  sccs.sort((a, b) => {
    const aFirst = a.nodes[0] ?? '';
    const bFirst = b.nodes[0] ?? '';
    return aFirst.localeCompare(bFirst);
  });
  return sccs;
}

/**
 * Project the SCC list to just the cyclic ones — what callers want for
 * surfacing dependency-cycle errors to the operator.
 */
export function detectCycles(graph: TicketGraph): CycleReport {
  const sccs = tarjanSccs(graph);
  const cycles = sccs.filter((s) => s.isCycle);
  return Object.freeze({ cycles: Object.freeze(cycles) });
}

/**
 * Compute Kahn-style topological levels.
 *
 * - Level 0 = nodes with no predecessors.
 * - Level N = max(predecessor level) + 1.
 * - Throws DependencyGraphError if the graph has cycles; call detectCycles
 *   first for the structured report.
 *
 * Result preserves input ticket order.
 */
export function topoLevels(graph: TicketGraph): TopoLevel[] {
  const indegree = new Map<string, number>();
  for (const id of graph.nodes.keys()) {
    indegree.set(id, (graph.predecessors.get(id) ?? []).length);
  }

  const levels = new Map<string, number>();
  const queue: string[] = [];
  for (const id of graph.nodes.keys()) {
    if ((indegree.get(id) ?? 0) === 0) {
      queue.push(id);
      levels.set(id, 0);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const cur = queue[head]!;
    head += 1;
    const curLevel = levels.get(cur) ?? 0;
    for (const child of graph.successors.get(cur) ?? []) {
      const remaining = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, remaining);
      const childLevel = Math.max(levels.get(child) ?? 0, curLevel + 1);
      levels.set(child, childLevel);
      if (remaining === 0) queue.push(child);
    }
  }

  const unresolved: string[] = [];
  for (const [id, deg] of indegree) {
    if (deg > 0) unresolved.push(id);
  }
  if (unresolved.length > 0) {
    unresolved.sort();
    throw new DependencyGraphError(
      'graph-contains-cycle',
      `cannot topo-sort: graph contains cycles touching tickets [${unresolved.join(', ')}]; call detectCycles() for the structured report`,
    );
  }

  return Array.from(graph.nodes.keys(), (id) =>
    Object.freeze({ ticketId: id, level: levels.get(id) ?? 0 }),
  );
}

/** Convenience: tickets grouped by topo level (each level in input order). */
export function groupByLevel(levels: readonly TopoLevel[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const tl of levels) {
    const bucket = out.get(tl.level);
    if (bucket) bucket.push(tl.ticketId);
    else out.set(tl.level, [tl.ticketId]);
  }
  return out;
}
