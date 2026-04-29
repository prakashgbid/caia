/**
 * Chain fragmenter — BUCKET-008.
 *
 * Pure function. Given a set of stories and their `blockedBy` dependency
 * graph, partition the graph into weakly-connected components (WCCs) and
 * compute level-scheduled batches inside each component.
 *
 * Why level scheduling instead of Dilworth chain cover (proposal §9.2):
 *   - Dilworth gives the true minimum number of chains needed to cover the
 *     DAG (= longest antichain), but requires max-flow / bipartite matching:
 *     O(N² × √N).
 *   - Level scheduling is O(N + E) and matches Dilworth's optimum
 *     parallelism when worker count >= longest antichain — which is true
 *     for our hardware budget. Filed `bucket-placer.optim.future-dilworth-
 *     chain-cover` for the post-MVP optimization.
 *
 * Outputs are persisted into `task_buckets.levels_json` (already a column
 * via migration 0024) so the dashboard can render Kanban level-coloring
 * without recomputing.
 */

export interface FragmentInput {
  storyIds: string[];
  /** Adjacency: story id -> ids that BLOCK it (its upstream blockers). */
  blockedBy: Map<string, string[]>;
}

export interface WCC {
  /** Story ids in this connected component. */
  storyIds: string[];
  /** levels[k] = story ids whose deepest blocker chain is at level k-1. */
  levels: string[][];
  /** Length of the longest chain in this component (== levels.length). */
  longestChain: number;
}

export interface FragmentResult {
  wccs: WCC[];
  /** Cycles detected — these story ids do NOT appear in any WCC's levels. */
  cycleStoryIds: string[];
}

// ─── WCC discovery (union-find) ─────────────────────────────────────────────

class UnionFind {
  parent = new Map<string, string>();
  rank = new Map<string, number>();
  add(id: string): void {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }
  find(id: string): string {
    const p = this.parent.get(id);
    if (p === undefined) {
      this.add(id);
      return id;
    }
    if (p === id) return id;
    const root = this.find(p);
    this.parent.set(id, root);
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra) ?? 0;
    const rankB = this.rank.get(rb) ?? 0;
    if (rankA < rankB) this.parent.set(ra, rb);
    else if (rankA > rankB) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }
}

function findWccs(input: FragmentInput): Map<string, string[]> {
  const uf = new UnionFind();
  for (const id of input.storyIds) uf.add(id);
  for (const [child, blockers] of input.blockedBy) {
    if (!input.storyIds.includes(child)) continue;
    for (const blocker of blockers) {
      if (input.storyIds.includes(blocker)) uf.union(child, blocker);
    }
  }
  const groups = new Map<string, string[]>();
  for (const id of input.storyIds) {
    const root = uf.find(id);
    const arr = groups.get(root) ?? [];
    arr.push(id);
    groups.set(root, arr);
  }
  return groups;
}

// ─── Level scheduling (Kahn's BFS) ──────────────────────────────────────────

interface LevelResult {
  levels: string[][];
  cycleMembers: string[];
}

function levelScheduleWithinGroup(
  group: string[],
  blockedBy: Map<string, string[]>,
): LevelResult {
  const groupSet = new Set(group);
  // Filter blockedBy to only include intra-group edges.
  const inDegree = new Map<string, number>();
  for (const id of group) {
    const blockers = (blockedBy.get(id) ?? []).filter((b) => groupSet.has(b));
    inDegree.set(id, blockers.length);
  }

  const visited = new Set<string>();
  const levels: string[][] = [];
  let frontier = group.filter((id) => (inDegree.get(id) ?? 0) === 0);

  while (frontier.length > 0) {
    frontier.sort();
    levels.push([...frontier]);
    for (const id of frontier) visited.add(id);

    const nextFrontier: string[] = [];
    for (const id of group) {
      if (visited.has(id)) continue;
      const remainingBlockers = (blockedBy.get(id) ?? []).filter(
        (b) => groupSet.has(b) && !visited.has(b),
      );
      if (remainingBlockers.length === 0) nextFrontier.push(id);
    }
    frontier = [...new Set(nextFrontier)];
  }

  const cycleMembers = group.filter((id) => !visited.has(id));
  return { levels, cycleMembers };
}

// ─── Main entry point ──────────────────────────────────────────────────────

/**
 * Fragment a set of stories + blockedBy edges into WCCs with level batches.
 * Cycles (which the placer should never produce — they're flagged earlier
 * as `task-scheduler.cycle-detected`) are surfaced as `cycleStoryIds`.
 */
export function fragmentChains(input: FragmentInput): FragmentResult {
  const groups = findWccs(input);
  const wccs: WCC[] = [];
  const allCycleMembers: string[] = [];

  // Sort groups by their first id (stable). Within each group, sort by id.
  const sortedGroups = Array.from(groups.values())
    .map((g) => [...g].sort())
    .sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''));

  for (const group of sortedGroups) {
    const { levels, cycleMembers } = levelScheduleWithinGroup(group, input.blockedBy);
    if (cycleMembers.length > 0) allCycleMembers.push(...cycleMembers);
    wccs.push({
      storyIds: group,
      levels,
      longestChain: levels.length,
    });
  }

  return { wccs, cycleStoryIds: allCycleMembers };
}

// ─── Convenience: parse stories rows into FragmentInput ─────────────────────

export function buildFragmentInput(
  rows: Array<{ id: string; blockedByJson?: string | null }>,
): FragmentInput {
  const storyIds = rows.map((r) => r.id);
  const blockedBy = new Map<string, string[]>();
  for (const r of rows) {
    let parsed: string[] = [];
    try {
      const json = JSON.parse(r.blockedByJson ?? '[]');
      if (Array.isArray(json)) parsed = json.filter((v) => typeof v === 'string');
    } catch {
      /* malformed JSON treated as no blockers */
    }
    blockedBy.set(r.id, parsed);
  }
  return { storyIds, blockedBy };
}
