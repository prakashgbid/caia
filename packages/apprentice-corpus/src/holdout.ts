/**
 * Deterministic holdout sampler.
 *
 * Splits the curated `InstructionPair[]` into a training set + a holdout
 * set. The holdout is excluded from `samples.jsonl` and its ids are
 * written to `manifest.holdout: string[]` so downstream eval (Phase 1's
 * `apprentice-eval`) can recover the same prompts deterministically.
 *
 * Determinism:
 *   - Seeded by `holdoutSeed` (config) so reruns of the same corpus
 *     produce identical holdouts.
 *   - Pair ordering inside the input is irrelevant — we sort by the
 *     pair's own stable id (sha256) before sampling.
 */

import type { InstructionPair } from './types.js';

export interface HoldoutSplit {
  readonly trainable: ReadonlyArray<InstructionPair>;
  readonly holdoutIds: ReadonlyArray<string>;
}

/**
 * mulberry32-style 32-bit PRNG. Deterministic across machines + Node
 * versions. Returns a function `() => [0, 1)`.
 */
export function mulberry32(seed: number): () => number {
  let t = (seed >>> 0) || 0x9e3779b9;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1) >>> 0;
    r ^= r + (Math.imul(r ^ (r >>> 7), r | 61) >>> 0);
    return ((r ^ (r >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

export interface SplitHoldoutOpts {
  readonly pairs: ReadonlyArray<InstructionPair>;
  /** Deterministic seed; default 42. */
  readonly seed?: number;
  /** 0..1 fraction of pairs to hold out; default 0.05 (5%). */
  readonly fraction?: number;
}

export function splitHoldout(opts: SplitHoldoutOpts): HoldoutSplit {
  const fraction = Math.max(0, Math.min(1, opts.fraction ?? 0.05));
  const seed = opts.seed ?? 42;
  if (opts.pairs.length === 0 || fraction === 0) {
    return { trainable: opts.pairs, holdoutIds: [] };
  }

  const sorted = [...opts.pairs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const targetCount = Math.max(1, Math.floor(sorted.length * fraction));

  // Reservoir-style deterministic shuffle: assign each pair a key from
  // the seeded PRNG, sort by key, take the first `targetCount` as holdout.
  const rng = mulberry32(seed);
  const keyed = sorted.map((p) => ({ p, key: rng() }));
  keyed.sort((a, b) => a.key - b.key);

  const holdoutSet = new Set<string>();
  for (let i = 0; i < targetCount; i++) {
    holdoutSet.add(keyed[i]!.p.id);
  }

  const trainable: InstructionPair[] = [];
  for (const p of opts.pairs) {
    if (!holdoutSet.has(p.id)) trainable.push(p);
  }
  // Sort the holdout id list for stable manifest output.
  const holdoutIds = [...holdoutSet].sort();
  return { trainable, holdoutIds };
}
