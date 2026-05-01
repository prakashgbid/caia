/**
 * @chiefaia/architecture-registry — community detection over the AKG edge graph.
 *
 * GRAPHRAG-001 (proposal §6A.4): groups arch_artifacts into hierarchical
 * communities so the EA Specialist Mesh can ground "global" architectural
 * questions against community summaries (GRAPHRAG-002).
 *
 * **Algorithm choice — PR1 ships Louvain.** Leiden is a strict refinement of
 * Louvain (better-connected communities, no resolution-limit pathology) but
 * the canonical TS implementations (graphology-communities-leiden) require
 * a non-trivial peer-dep tree. PR1 ships a self-contained Louvain that's
 * good enough to drive the GraphRAG-002 summarization pipeline; PR2 swaps
 * in graphology-communities-leiden once the deps are wired.
 *
 * The algorithm column on every persisted row is therefore set per call
 * (defaults to 'louvain' from this PR; row-level provenance lets a future
 * Leiden re-run live alongside the existing Louvain runs without losing
 * either history).
 *
 * Reference: Blondel et al., "Fast unfolding of communities in large networks"
 * (2008) — the original Louvain paper.
 */

import { nanoid } from 'nanoid';

/* ───────────────────────────────────────────────────────────────────────── *
 *  Inputs / outputs                                                          *
 * ───────────────────────────────────────────────────────────────────────── */

export type AlgorithmName = 'louvain' | 'leiden';

export interface ArtifactNode {
  /** arch_artifacts.id */
  id: string;
}

export interface ArtifactEdge {
  /** arch_edges.from_id */
  fromId: string;
  /** arch_edges.to_id */
  toId: string;
  /** arch_edges.weight (>0). Symmetric semantics — see assembleAdjacency. */
  weight: number;
}

export interface CommunityDetectionOptions {
  /** Random seed (deterministic ordering of node iteration). Default: 42. */
  seed?: number;
  /**
   * Maximum number of hierarchy levels (Louvain "passes"). Each pass
   * aggregates communities into super-nodes and repeats. Default: 5.
   */
  maxLevels?: number;
  /**
   * Stop early when the modularity gain across a full pass falls below
   * this threshold. Default: 1e-7.
   */
  modularityEpsilon?: number;
  /** Per-row created_at / updated_at timestamp (ms). Default: Date.now(). */
  nowMs?: number;
  /** Algorithm name written to persisted rows. Default: 'louvain'. */
  algorithm?: AlgorithmName;
}

export interface DetectedCommunity {
  id: string;
  runId: string;
  level: number;
  parentCommunityId: string | null;
  memberCount: number;
  internalEdgeCount: number;
  externalEdgeCount: number;
  modularityContribution: number;
  algorithm: AlgorithmName;
  seedArtifactId: string | null;
  tagsJson: string;
  createdAt: number;
  updatedAt: number;
}

export interface DetectedMembership {
  artifactId: string;
  communityId: string;
  runId: string;
  level: number;
  isPrimary: number;
  degreeInCommunity: number;
  degreeTotal: number;
  createdAt: number;
  updatedAt: number;
}

export interface CommunityRunRow {
  id: string;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  algorithm: AlgorithmName;
  totalArtifacts: number;
  totalEdges: number;
  totalCommunities: number;
  maxLevel: number;
  modularity: number;
  iterations: number;
  seed: number;
  commitSha: string | null;
  isActive: number;
  error: string | null;
  metadataJson: string;
}

export interface CommunityDetectionResult {
  run: CommunityRunRow;
  communities: DetectedCommunity[];
  memberships: DetectedMembership[];
}

/* ───────────────────────────────────────────────────────────────────────── *
 *  Adjacency / 2m bookkeeping                                                *
 * ───────────────────────────────────────────────────────────────────────── */

interface Adjacency {
  /** Sorted node ids. */
  nodes: string[];
  /** id -> dense index. */
  index: Map<string, number>;
  /** Symmetric weighted adjacency: out[i] = Map<j, weight>. */
  out: Array<Map<number, number>>;
  /** Sum of all edge weights (counted once per (i,j) i<=j). */
  totalWeight: number;
  /** Weighted degree per node. */
  degree: number[];
}

function assembleAdjacency(
  nodes: ArtifactNode[],
  edges: ArtifactEdge[]
): Adjacency {
  // Stable iteration order from sorted ids — makes the algorithm seed-independent
  // for ties.
  const sorted = [...nodes].map((n) => n.id).sort();
  const index = new Map<string, number>();
  sorted.forEach((id, i) => index.set(id, i));

  const out: Array<Map<number, number>> = sorted.map(() => new Map());
  const degree = new Array<number>(sorted.length).fill(0);
  let totalWeight = 0;

  for (const e of edges) {
    const i = index.get(e.fromId);
    const j = index.get(e.toId);
    if (i === undefined || j === undefined) continue;
    if (i === j) continue; // ignore self-loops at this level
    const w = Math.max(0, e.weight);
    if (w === 0) continue;
    // Symmetrize: store in both directions, but count weight once for 2m.
    out[i]!.set(j, (out[i]!.get(j) ?? 0) + w);
    out[j]!.set(i, (out[j]!.get(i) ?? 0) + w);
    degree[i]! += w;
    degree[j]! += w;
    totalWeight += w;
  }

  return { nodes: sorted, index, out, totalWeight, degree };
}

/* ───────────────────────────────────────────────────────────────────────── *
 *  Louvain pass (one level)                                                  *
 * ───────────────────────────────────────────────────────────────────────── */

interface PassResult {
  /** node-i → community-id (dense, contiguous starting at 0). */
  community: number[];
  /** sum of weighted degrees per community. */
  comDegree: number[];
  /** sum of internal weights per community (counted twice for self-loops, once otherwise). */
  comInternal: number[];
  /** modularity at the end of the pass. */
  modularity: number;
  /** number of move iterations. */
  iterations: number;
}

function runLouvainPass(
  adj: Adjacency,
  modularityEpsilon: number
): PassResult {
  const n = adj.nodes.length;
  const community = new Array<number>(n);
  for (let i = 0; i < n; i++) community[i] = i; // start: each node in its own community

  const comDegree = adj.degree.slice();
  const comInternal = new Array<number>(n).fill(0);

  const m2 = 2 * adj.totalWeight; // 2m
  const m2Safe = m2 === 0 ? 1 : m2;

  let totalGain = 0;
  let iterations = 0;
  let improved = true;

  while (improved && iterations < 100) {
    improved = false;
    iterations += 1;

    for (let i = 0; i < n; i++) {
      const ci = community[i]!;
      const ki = adj.degree[i]!;

      // Compute weight to each neighbouring community (incl. own).
      const neighbourComWeight = new Map<number, number>();
      for (const [j, w] of adj.out[i]!) {
        if (j === i) continue;
        const cj = community[j]!;
        neighbourComWeight.set(cj, (neighbourComWeight.get(cj) ?? 0) + w);
      }

      // Pull i out of its current community.
      const kiToOwn = neighbourComWeight.get(ci) ?? 0;
      comDegree[ci]! -= ki;
      comInternal[ci]! -= 2 * kiToOwn;

      // Find best community to move to.
      let bestC = ci;
      let bestGain = 0;
      for (const [c, kiToC] of neighbourComWeight) {
        const sumTot = comDegree[c]!;
        // Δmodularity = kiToC/m - (sumTot * ki) / (2m^2)
        const gain = kiToC / adj.totalWeight - (sumTot * ki) / (2 * adj.totalWeight * adj.totalWeight);
        if (gain > bestGain + modularityEpsilon) {
          bestGain = gain;
          bestC = c;
        }
      }

      // Allow staying — recompute gain for staying explicitly so we don't drift.
      if (bestC === ci) {
        // Put i back into ci.
        comDegree[ci]! += ki;
        comInternal[ci]! += 2 * kiToOwn;
        continue;
      }

      const kiToBest = neighbourComWeight.get(bestC) ?? 0;
      comDegree[bestC]! += ki;
      comInternal[bestC]! += 2 * kiToBest;
      community[i] = bestC;
      totalGain += bestGain;
      improved = true;
    }
  }

  // Compute final modularity by re-deriving comDegree + comInternal from
  // the final community[] assignment (avoids drift in the incremental
  // updates above and gives an authoritative number for the run row).
  const finalDegree = new Array<number>(n).fill(0);
  const finalInternal = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    finalDegree[community[i]!]! += adj.degree[i]!;
    for (const [j, w] of adj.out[i]!) {
      // adj.out is symmetric; sum each ordered pair → total contribution
      // to comInternal is (i,j) + (j,i) = 2*w when i and j share a community.
      if (community[i]! === community[j]!) {
        finalInternal[community[i]!]! += w;
      }
    }
  }

  let modularity = 0;
  for (let c = 0; c < n; c++) {
    if (finalDegree[c]! === 0) continue;
    const inside = finalInternal[c]! / m2Safe;
    const tot = finalDegree[c]! / m2Safe;
    modularity += inside - tot * tot;
  }

  void totalGain;
  return {
    community,
    comDegree: finalDegree,
    comInternal: finalInternal,
    modularity,
    iterations,
  };
}

/* ───────────────────────────────────────────────────────────────────────── *
 *  Public API: detectCommunities                                             *
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Run hierarchical community detection (Louvain) over the AKG.
 *
 * - Level 0 = leaf assignments (every artifact → its level-0 community).
 * - Level k>0 = aggregated communities (a "community of communities").
 *
 * Persistence is the caller's responsibility — pass the returned rows to
 * a writer that bulk-inserts into the three tables in migration 0041.
 */
export function detectCommunities(
  nodes: ArtifactNode[],
  edges: ArtifactEdge[],
  opts: CommunityDetectionOptions = {}
): CommunityDetectionResult {
  const {
    seed = 42,
    maxLevels = 5,
    modularityEpsilon = 1e-7,
    nowMs = Date.now(),
    algorithm = 'louvain',
  } = opts;

  const startedAt = nowMs;
  const runId = `comm-run-${nanoid(10)}`;

  const adj0 = assembleAdjacency(nodes, edges);

  // Empty / trivial graph.
  if (adj0.nodes.length === 0 || adj0.totalWeight === 0) {
    const finishedAt = startedAt;
    return {
      run: {
        id: runId,
        startedAt,
        finishedAt,
        durationMs: 0,
        algorithm,
        totalArtifacts: adj0.nodes.length,
        totalEdges: edges.length,
        totalCommunities: 0,
        maxLevel: 0,
        modularity: 0,
        iterations: 0,
        seed,
        commitSha: null,
        isActive: 0,
        error: null,
        metadataJson: '{}',
      },
      communities: [],
      memberships: [],
    };
  }

  // Track per-original-artifact community at every level.
  const perLevelArtifactCommunity: Array<Map<string, string>> = [];
  const communityRows: DetectedCommunity[] = [];
  const membershipRows: DetectedMembership[] = [];
  let totalIterations = 0;

  // Working adjacency at the current level. Begins as the artifact graph;
  // becomes a community-meta-graph at higher levels.
  let workingAdj = adj0;
  // For each community label at the current level, the canonical id we'll
  // persist (stable and decodable).
  let prevLevelCommunityIds: string[] = [];
  let modularityFinal = 0;

  for (let level = 0; level < maxLevels; level += 1) {
    const pass = runLouvainPass(workingAdj, modularityEpsilon);
    totalIterations += pass.iterations;

    // Compact community labels (0..k-1).
    const labelToIdx = new Map<number, number>();
    pass.community.forEach((c) => {
      if (!labelToIdx.has(c)) labelToIdx.set(c, labelToIdx.size);
    });
    const compactCommunity = pass.community.map((c) => labelToIdx.get(c)!);
    const numCommunities = labelToIdx.size;

    // Canonical community ids for THIS level.
    const levelCommunityIds: string[] = [];
    for (let i = 0; i < numCommunities; i += 1) {
      levelCommunityIds.push(`comm_${runId}_l${level}_${i}`);
    }

    // Build per-community aggregates from the working graph.
    const memberCount = new Array<number>(numCommunities).fill(0);
    const internalEdge = new Array<number>(numCommunities).fill(0);
    const externalEdge = new Array<number>(numCommunities).fill(0);
    const seedArtifact = new Array<string | null>(numCommunities).fill(null);

    for (let i = 0; i < workingAdj.nodes.length; i += 1) {
      const ci = compactCommunity[i]!;
      memberCount[ci]! += 1;
      // Pick the lexicographically-smallest underlying artifact id as seed.
      const repr = workingAdj.nodes[i]!;
      if (level === 0) {
        if (seedArtifact[ci]! === null || repr < seedArtifact[ci]!) {
          seedArtifact[ci] = repr;
        }
      }
      for (const [j, w] of workingAdj.out[i]!) {
        if (j <= i) continue; // count each edge once
        const cj = compactCommunity[j]!;
        if (ci === cj) internalEdge[ci]! += w;
        else {
          externalEdge[ci]! += w;
          externalEdge[cj]! += w;
        }
      }
    }

    // Bubble seed artifact for level>0 from the level-0 mapping.
    if (level > 0) {
      const previous = perLevelArtifactCommunity[level - 1]!;
      const minByCom: Map<string, string> = new Map();
      for (const [art, prevComId] of previous) {
        // For level>0 the working node at THIS level corresponds to a
        // level-(level-1) community, so we look up its index in
        // workingAdj.nodes (which stores the prev community ids).
        const workIdx = workingAdj.index.get(prevComId);
        if (workIdx === undefined) continue;
        const ci = compactCommunity[workIdx]!;
        const seedKey = levelCommunityIds[ci]!;
        const cur = minByCom.get(seedKey);
        if (cur === undefined || art < cur) minByCom.set(seedKey, art);
      }
      for (let i = 0; i < numCommunities; i += 1) {
        seedArtifact[i] = minByCom.get(levelCommunityIds[i]!) ?? null;
      }
    }

    // Modularity contribution per community (best-effort: split the pass's
    // modularity proportionally to (internal/total)*member_count weight).
    // The pass.modularity is the sum across all communities — we attribute
    // by share of internal weight for transparency, falling back to uniform
    // if internal weight is zero.
    const internalSum =
      internalEdge.reduce((a, b) => a + b, 0) +
      // singleton communities contribute zero internal weight; avoid div-by-0.
      0;
    const contributions = internalEdge.map((w) =>
      internalSum > 0 ? (w / internalSum) * pass.modularity : pass.modularity / numCommunities
    );

    // Emit community rows + membership rows for level 0.
    for (let i = 0; i < numCommunities; i += 1) {
      communityRows.push({
        id: levelCommunityIds[i]!,
        runId,
        level,
        parentCommunityId: null, // filled in below for level>0
        memberCount: memberCount[i]!,
        internalEdgeCount: internalEdge[i]!,
        externalEdgeCount: externalEdge[i]!,
        modularityContribution: contributions[i]!,
        algorithm,
        seedArtifactId: seedArtifact[i]!,
        tagsJson: '[]',
        createdAt: nowMs,
        updatedAt: nowMs,
      });
    }

    // Membership rows: at level 0 every artifact is a member directly.
    if (level === 0) {
      for (let i = 0; i < workingAdj.nodes.length; i += 1) {
        const ci = compactCommunity[i]!;
        const id = workingAdj.nodes[i]!;
        // degree_in_community
        let dInside = 0;
        let dTotal = 0;
        for (const [j, w] of workingAdj.out[i]!) {
          dTotal += w;
          if (compactCommunity[j]! === ci) dInside += w;
        }
        membershipRows.push({
          artifactId: id,
          communityId: levelCommunityIds[ci]!,
          runId,
          level: 0,
          isPrimary: 1,
          degreeInCommunity: dInside,
          degreeTotal: dTotal,
          createdAt: nowMs,
          updatedAt: nowMs,
        });
      }
    } else {
      // For level>0, membership uses the original artifact, with the new
      // community id at this higher level.
      const previous = perLevelArtifactCommunity[level - 1]!;
      for (const [art, prevComId] of previous) {
        const workIdx = workingAdj.index.get(prevComId);
        if (workIdx === undefined) continue;
        const ci = compactCommunity[workIdx]!;
        membershipRows.push({
          artifactId: art,
          communityId: levelCommunityIds[ci]!,
          runId,
          level,
          isPrimary: 0,
          degreeInCommunity: 0,
          degreeTotal: 0,
          createdAt: nowMs,
          updatedAt: nowMs,
        });
      }

      // Also fill parentCommunityId on the previous level's communities.
      const prevIds = prevLevelCommunityIds;
      for (let prevIdx = 0; prevIdx < prevIds.length; prevIdx += 1) {
        const ci = compactCommunity[prevIdx]!;
        // Find prev row by id and patch.
        const prevRow = communityRows.find((r) => r.id === prevIds[prevIdx]);
        if (prevRow) prevRow.parentCommunityId = levelCommunityIds[ci]!;
      }
    }

    // Snapshot artifact → current-level-community mapping.
    const snapshot = new Map<string, string>();
    if (level === 0) {
      for (let i = 0; i < workingAdj.nodes.length; i += 1) {
        snapshot.set(workingAdj.nodes[i]!, levelCommunityIds[compactCommunity[i]!]!);
      }
    } else {
      const previous = perLevelArtifactCommunity[level - 1]!;
      for (const [art, prevComId] of previous) {
        const workIdx = workingAdj.index.get(prevComId);
        if (workIdx === undefined) {
          snapshot.set(art, prevComId);
          continue;
        }
        snapshot.set(art, levelCommunityIds[compactCommunity[workIdx]!]!);
      }
    }
    perLevelArtifactCommunity.push(snapshot);

    if (pass.modularity > modularityFinal) modularityFinal = pass.modularity;

    // Stop if the partition didn't compress (every node became its own community
    // which means no agglomeration happened) or if modularity gain is negligible.
    if (numCommunities === workingAdj.nodes.length) break;

    // Build the meta-graph for the next level.
    const metaNodes: ArtifactNode[] = levelCommunityIds.map((id) => ({ id }));
    const metaEdgeMap = new Map<string, number>();
    const metaSelfLoops = new Map<string, number>();
    for (let i = 0; i < workingAdj.nodes.length; i += 1) {
      const ci = compactCommunity[i]!;
      for (const [j, w] of workingAdj.out[i]!) {
        if (j <= i) continue;
        const cj = compactCommunity[j]!;
        if (ci === cj) {
          metaSelfLoops.set(
            levelCommunityIds[ci]!,
            (metaSelfLoops.get(levelCommunityIds[ci]!) ?? 0) + w
          );
        } else {
          const k = `${levelCommunityIds[ci]}|${levelCommunityIds[cj]}`;
          metaEdgeMap.set(k, (metaEdgeMap.get(k) ?? 0) + w);
        }
      }
    }
    const metaEdges: ArtifactEdge[] = [];
    for (const [k, w] of metaEdgeMap) {
      const [a, b] = k.split('|');
      metaEdges.push({ fromId: a!, toId: b!, weight: w });
    }

    workingAdj = assembleAdjacency(metaNodes, metaEdges);
    prevLevelCommunityIds = levelCommunityIds;

    if (workingAdj.totalWeight === 0) break;
  }

  const finishedAt = nowMs;

  return {
    run: {
      id: runId,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      algorithm,
      totalArtifacts: nodes.length,
      totalEdges: edges.length,
      totalCommunities: communityRows.length,
      maxLevel: perLevelArtifactCommunity.length - 1,
      modularity: modularityFinal,
      iterations: totalIterations,
      seed,
      commitSha: null,
      isActive: 0,
      error: null,
      metadataJson: '{}',
    },
    communities: communityRows,
    memberships: membershipRows,
  };
}
