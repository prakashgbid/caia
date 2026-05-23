/**
 * @caia/architect-kit — dependency graph helpers.
 *
 * Sourced from research/17_architect_framework_spec_2026.md §3.3.
 *
 * The dispatcher topo-sorts the active architect set into waves via Kahn's
 * algorithm. Architects with `dependsOn: []` form wave 1; the second wave
 * contains everything whose deps are entirely in wave 1; and so on.
 *
 * The algorithm lives here (not in `@caia/ea-dispatcher`) because:
 *   - It's pure / no-IO and useful in architect-package tests too.
 *   - The shape stays close to the type definitions it operates on.
 *   - It makes the dispatcher unit testable against the contract layer
 *     without bringing in the spawner.
 */

import type { ArchitectName } from './architect-section-contract.js';
import type { SpecialistArchitect } from './specialist-architect.js';

/**
 * One layer of architects that may all run in parallel. The dispatcher
 * iterates these waves in order, awaiting each before fanning the next.
 */
export interface Wave {
  /** 1-indexed wave number. */
  index: number;
  /** Architect names — sorted alphabetically for deterministic logs. */
  members: readonly ArchitectName[];
}

export class CycleDetectedError extends Error {
  constructor(
    public readonly remaining: readonly ArchitectName[],
    message?: string,
  ) {
    super(
      message ??
        `dependency cycle detected; unresolved architects: ${remaining.join(', ')}`,
    );
    this.name = 'CycleDetectedError';
  }
}

export class UnknownDependencyError extends Error {
  constructor(
    public readonly architect: ArchitectName,
    public readonly missing: ArchitectName,
  ) {
    super(
      `architect '${architect}' depends on '${missing}' which is not in the supplied set`,
    );
    this.name = 'UnknownDependencyError';
  }
}

interface NodeMeta {
  name: ArchitectName;
  dependsOn: readonly ArchitectName[];
}

/**
 * Topo-sort an architect set into waves via Kahn's algorithm.
 *
 *  - Throws `UnknownDependencyError` if any `dependsOn` name is missing
 *    from the input set.
 *  - Throws `CycleDetectedError` if the dependency graph has a cycle.
 *  - Returns an empty array on empty input.
 */
export function computeWaves(
  architects: readonly SpecialistArchitect[],
): readonly Wave[] {
  const nodes: NodeMeta[] = architects.map((a) => ({
    name: a.name,
    dependsOn: a.sectionContract.architectMeta.dependsOn,
  }));
  return computeWavesFromMeta(nodes);
}

/**
 * The metadata-only flavour — useful for tests that don't want to build
 * full SpecialistArchitect instances. Pure data in, waves out.
 */
export function computeWavesFromMeta(
  nodes: readonly { name: ArchitectName; dependsOn: readonly ArchitectName[] }[],
): readonly Wave[] {
  if (nodes.length === 0) return [];

  const known = new Set(nodes.map((n) => n.name));
  // Validate every dependency exists.
  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (!known.has(dep)) {
        throw new UnknownDependencyError(node.name, dep);
      }
    }
  }

  // Build in-degree + reverse adjacency.
  const inDegree = new Map<ArchitectName, number>();
  const dependents = new Map<ArchitectName, ArchitectName[]>();
  for (const node of nodes) {
    inDegree.set(node.name, node.dependsOn.length);
    for (const dep of node.dependsOn) {
      const arr = dependents.get(dep) ?? [];
      arr.push(node.name);
      dependents.set(dep, arr);
    }
  }

  const waves: Wave[] = [];
  let waveIdx = 0;
  let frontier: ArchitectName[] = nodes
    .filter((n) => (inDegree.get(n.name) ?? 0) === 0)
    .map((n) => n.name);

  const resolved = new Set<ArchitectName>();

  while (frontier.length > 0) {
    waveIdx += 1;
    const members = [...frontier].sort();
    waves.push({ index: waveIdx, members });
    frontier.forEach((m) => resolved.add(m));

    const nextFrontier: ArchitectName[] = [];
    for (const member of frontier) {
      for (const dep of dependents.get(member) ?? []) {
        const newDeg = (inDegree.get(dep) ?? 0) - 1;
        inDegree.set(dep, newDeg);
        if (newDeg === 0) nextFrontier.push(dep);
      }
    }
    frontier = nextFrontier;
  }

  if (resolved.size !== nodes.length) {
    const remaining = nodes
      .map((n) => n.name)
      .filter((name) => !resolved.has(name))
      .sort();
    throw new CycleDetectedError(remaining);
  }

  return waves;
}

/**
 * Flatten a wave list to a deterministic execution order — useful in
 * tests and in logging the planned plan before fan-out.
 */
export function flattenWaves(waves: readonly Wave[]): readonly ArchitectName[] {
  return waves.flatMap((w) => w.members);
}

/**
 * Returns the wave index of a given architect within the given waves, or
 * -1 if absent.
 */
export function waveOf(
  waves: readonly Wave[],
  architectName: ArchitectName,
): number {
  for (const w of waves) {
    if (w.members.includes(architectName)) return w.index;
  }
  return -1;
}
