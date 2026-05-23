/**
 * @caia/architect-kit — ArchitectRegistry
 *
 * The dispatcher reads from this registry. Every architect package's
 * `index.ts` calls `registerArchitect(specialistArchitect)` on import,
 * populating the registry at boot. Like `@chiefaia/agent-contract-registry`,
 * this is process-local, in-memory, and mutable at startup but immutable
 * at steady-state.
 *
 * The registry's central responsibilities:
 *   - Validate disjoint section-path ownership across all registered
 *     architects (the §5.1 invariant).
 *   - Build the dependency graph for wave-sorting (the §3.3 Kahn's input).
 *   - Resolve `appliesPredicate(ticket)` filters to the active subset for
 *     a given ticket (the §3.2 filter step).
 */

import type { SpecialistArchitect } from './specialist-architect.js';
import type {
  ArchitectName,
  ArchitectSectionContract,
} from './architect-section-contract.js';
import {
  contractPaths,
  findDuplicatePaths,
  findOverlappingPaths,
} from './architect-section-contract.js';
import type { Ticket } from './types.js';

export interface RegistryEntry {
  architect: SpecialistArchitect;
  /** Order of registration — deterministic ordering on ties. */
  registrationIndex: number;
}

/**
 * Thrown when a registration would violate the disjoint-write invariant
 * or duplicate an architect name.
 */
export class ArchitectRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchitectRegistryError';
  }
}

export class ArchitectRegistry {
  private entries: Map<ArchitectName, RegistryEntry> = new Map();
  private nextIndex = 0;
  /** path → architectName that owns it. */
  private pathOwnership: Map<string, ArchitectName> = new Map();

  /**
   * Register an architect. Throws:
   *  - If the architect name is already registered.
   *  - If the contract has duplicate paths within itself.
   *  - If any path overlaps with another already-registered architect.
   */
  register(architect: SpecialistArchitect): void {
    if (this.entries.has(architect.name)) {
      throw new ArchitectRegistryError(
        `architect '${architect.name}' is already registered`,
      );
    }
    const contract = architect.sectionContract;
    if (contract.architectName !== architect.name) {
      throw new ArchitectRegistryError(
        `architect '${architect.name}' has sectionContract.architectName='${contract.architectName}'; must match`,
      );
    }
    const intra = findDuplicatePaths(contract);
    if (intra.length > 0) {
      throw new ArchitectRegistryError(
        `architect '${architect.name}' declares duplicate paths: ${intra.join(', ')}`,
      );
    }
    for (const path of contractPaths(contract)) {
      const owner = this.pathOwnership.get(path);
      if (owner) {
        throw new ArchitectRegistryError(
          `architect '${architect.name}' claims path '${path}' already owned by '${owner}'`,
        );
      }
    }
    // All checks passed — install.
    this.entries.set(architect.name, {
      architect,
      registrationIndex: this.nextIndex++,
    });
    for (const path of contractPaths(contract)) {
      this.pathOwnership.set(path, architect.name);
    }
  }

  /** Remove an architect. Returns true if removed, false if absent. */
  unregister(name: ArchitectName): boolean {
    const entry = this.entries.get(name);
    if (!entry) return false;
    this.entries.delete(name);
    for (const path of contractPaths(entry.architect.sectionContract)) {
      if (this.pathOwnership.get(path) === name) {
        this.pathOwnership.delete(path);
      }
    }
    return true;
  }

  /** Empty the registry. Test-only. */
  clear(): void {
    this.entries.clear();
    this.pathOwnership.clear();
    this.nextIndex = 0;
  }

  /** All registered architects in registration order. */
  list(): readonly SpecialistArchitect[] {
    return [...this.entries.values()]
      .sort((a, b) => a.registrationIndex - b.registrationIndex)
      .map((e) => e.architect);
  }

  /** Look up by name. */
  get(name: ArchitectName): SpecialistArchitect | undefined {
    return this.entries.get(name)?.architect;
  }

  /** Architect count. */
  size(): number {
    return this.entries.size;
  }

  /** Owner of a section path, or `undefined` if no architect claims it. */
  ownerOf(path: string): ArchitectName | undefined {
    return this.pathOwnership.get(path);
  }

  /** All section paths claimed across every registered architect. */
  allPaths(): readonly string[] {
    return [...this.pathOwnership.keys()];
  }

  /**
   * Architects that apply to the given ticket — filters via each
   * architect's `appliesPredicate`. Output is in registration order.
   */
  applicableTo(ticket: Ticket): readonly SpecialistArchitect[] {
    return this.list().filter((a) =>
      a.sectionContract.architectMeta.appliesPredicate(ticket),
    );
  }

  /**
   * All section contracts. Convenience for the dispatcher's composer.
   */
  contracts(): readonly ArchitectSectionContract[] {
    return this.list().map((a) => a.sectionContract);
  }

  /** Validate global invariants. Returns an array of error messages (empty if OK). */
  validate(): readonly string[] {
    const errors: string[] = [];
    // Disjointness — also tracked incrementally on register, but check from scratch.
    const seen = new Map<string, ArchitectName>();
    for (const arch of this.list()) {
      for (const path of contractPaths(arch.sectionContract)) {
        const prior = seen.get(path);
        if (prior && prior !== arch.name) {
          errors.push(
            `path '${path}' claimed by both '${prior}' and '${arch.name}'`,
          );
        }
        seen.set(path, arch.name);
      }
    }
    // Dependency graph soundness — every dependsOn name resolves.
    for (const arch of this.list()) {
      for (const dep of arch.sectionContract.architectMeta.dependsOn) {
        if (!this.entries.has(dep)) {
          errors.push(
            `architect '${arch.name}' depends on '${dep}' which is not registered`,
          );
        }
      }
    }
    return errors;
  }
}

// ─── Default singleton ──────────────────────────────────────────────────────

let defaultRegistry: ArchitectRegistry | null = null;

export function getDefaultArchitectRegistry(): ArchitectRegistry {
  if (!defaultRegistry) defaultRegistry = new ArchitectRegistry();
  return defaultRegistry;
}

export function resetDefaultArchitectRegistry(): void {
  defaultRegistry = null;
}

/**
 * Convenience: register on the default singleton. Mirrors the
 * `@chiefaia/agent-contract-registry` `register()` top-level helper.
 */
export function registerArchitect(architect: SpecialistArchitect): void {
  getDefaultArchitectRegistry().register(architect);
}

/**
 * Build a quick disjointness sanity check across a snapshot of contracts —
 * useful in tests that don't want to mutate the global registry. Returns
 * the set of conflicting paths (empty if disjoint).
 */
export function disjointness(
  contracts: readonly ArchitectSectionContract[],
): readonly { path: string; claimedBy: readonly ArchitectName[] }[] {
  const owners = new Map<string, ArchitectName[]>();
  for (const c of contracts) {
    for (const path of contractPaths(c)) {
      const arr = owners.get(path) ?? [];
      arr.push(c.architectName);
      owners.set(path, arr);
    }
  }
  const conflicts: { path: string; claimedBy: ArchitectName[] }[] = [];
  for (const [path, names] of owners) {
    if (names.length > 1) conflicts.push({ path, claimedBy: names });
  }
  return conflicts;
}

/**
 * Pairwise contract-overlap check — useful in tests.
 */
export function overlapBetween(
  a: ArchitectSectionContract,
  b: ArchitectSectionContract,
): readonly string[] {
  return findOverlappingPaths(a, b);
}
