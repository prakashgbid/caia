/**
 * @caia/ea-dispatcher — composer.ts
 *
 * Sourced from research/17_architect_framework_spec_2026.md §3.5 + §5.1.
 *
 * Field-level conflicts are impossible by construction (the SectionContract
 * disjointness invariant — enforced by ArchitectRegistry at registration
 * time). Composition is therefore a deterministic disjoint-key merge:
 *
 *     architecture = ⋃ architectOutputs[i].architectureFields
 *
 * Matches the Postgres `||` (jsonb concat) the orchestrator uses to
 * actually write the result.
 *
 * We still defensively detect collisions here — registries can be bypassed
 * in tests or by misconfiguration — and surface them as a `CollisionError`
 * the dispatcher converts into a hard failure (don't silently overwrite
 * fields, ever).
 */

import type { ArchitectOutput } from '@caia/architect-kit';

export interface ComposeCollision {
  path: string;
  claimedBy: readonly string[];
}

export class CompositionError extends Error {
  constructor(
    public readonly collisions: readonly ComposeCollision[],
    message?: string,
  ) {
    const lines = collisions.map(
      (c) => `  - '${c.path}' claimed by ${c.claimedBy.join(' AND ')}`,
    );
    super(
      message ??
        `composition collision detected:\n${lines.join('\n')}\nField-level conflicts are forbidden by the SectionContract disjointness invariant (§5.1).`,
    );
    this.name = 'CompositionError';
  }
}

export interface ComposeResult {
  composed: Record<string, unknown>;
  /** Architects whose output was skipped because `status: 'failed'`. */
  skippedFailed: readonly string[];
  /**
   * Architects whose output was a `partial` — we still merge their fields
   * (the reviewer's completeness lens will flag the missing required paths).
   */
  partialContributors: readonly string[];
}

/**
 * Compose architect outputs into a single tickets.architecture blob.
 *
 *  - Failed outputs (`status === 'failed'`) are skipped entirely.
 *  - Partial outputs contribute their populated paths.
 *  - Collisions (any path claimed by ≥2 contributors) throw `CompositionError`.
 *
 * Returns a fresh object — the result is safe to mutate downstream.
 */
export function composeArchitectOutputs(
  outputs: readonly ArchitectOutput[],
): ComposeResult {
  const composed: Record<string, unknown> = {};
  /** path → architect names that have written it. */
  const owners = new Map<string, string[]>();
  const skippedFailed: string[] = [];
  const partialContributors: string[] = [];

  for (const out of outputs) {
    if (out.status === 'failed') {
      skippedFailed.push(out.architectName);
      continue;
    }
    if (out.status === 'partial') {
      partialContributors.push(out.architectName);
    }
    for (const [path, value] of Object.entries(out.architectureFields)) {
      const existingOwners = owners.get(path) ?? [];
      existingOwners.push(out.architectName);
      owners.set(path, existingOwners);
      composed[path] = value;
    }
  }

  const collisions: ComposeCollision[] = [];
  for (const [path, names] of owners) {
    if (names.length > 1) {
      collisions.push({ path, claimedBy: [...new Set(names)] });
    }
  }
  if (collisions.length > 0) throw new CompositionError(collisions);

  return { composed, skippedFailed, partialContributors };
}

/**
 * Variant of compose that DOES NOT throw on collision — instead returns the
 * collision list alongside the composed (with last-write-wins on conflict).
 * Used by tests that want to inspect collision detection without aborting.
 */
export function composeArchitectOutputsLenient(
  outputs: readonly ArchitectOutput[],
): ComposeResult & { collisions: readonly ComposeCollision[] } {
  const composed: Record<string, unknown> = {};
  const owners = new Map<string, string[]>();
  const skippedFailed: string[] = [];
  const partialContributors: string[] = [];

  for (const out of outputs) {
    if (out.status === 'failed') {
      skippedFailed.push(out.architectName);
      continue;
    }
    if (out.status === 'partial') partialContributors.push(out.architectName);
    for (const [path, value] of Object.entries(out.architectureFields)) {
      const existingOwners = owners.get(path) ?? [];
      existingOwners.push(out.architectName);
      owners.set(path, existingOwners);
      composed[path] = value;
    }
  }

  const collisions: ComposeCollision[] = [];
  for (const [path, names] of owners) {
    if (names.length > 1) {
      collisions.push({ path, claimedBy: [...new Set(names)] });
    }
  }
  return { composed, skippedFailed, partialContributors, collisions };
}
