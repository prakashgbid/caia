/**
 * Train / valid / test deterministic split. See DESIGN.md §7.
 *
 * Algorithm:
 *   - test  = samples whose `id ∈ manifest.holdout`. If the manifest has
 *             no `holdout` (older Phase 0 corpora), fall back to id-hash
 *             test bucket: `bucket(id) % 20 < 1` ≈ 5%.
 *   - valid = next ~10% of the non-test remainder, picked by id-hash mod
 *             1_000_000 sort.
 *   - train = the rest.
 *
 * Same `(samples, manifest, splitSeed)` → byte-identical triplet. This
 * is what enables cross-run reproducibility (Apprentice directive's
 * "rerun the same training and get the same adapter").
 */

import { createHash } from 'node:crypto';
import type {
  CorpusManifestRead,
  CorpusSample,
  ResolvedTrainingConfig,
  SplitResult
} from './types.js';
import { InsufficientCorpusError } from './types.js';

/** Hash-based bucket of a sample id into [0, mod). Stable across runs. */
function bucket(seed: number, id: string, mod: number): number {
  const h = createHash('sha256').update(`${seed}:${id}`).digest('hex').slice(0, 8);
  return parseInt(h, 16) % mod;
}

export function splitSamples(
  samples: CorpusSample[],
  manifest: CorpusManifestRead,
  cfg: ResolvedTrainingConfig
): SplitResult {
  const { splitSeed, trainSplitFraction, validSplitFraction, testSplitFraction, minSamplesToTrain } = cfg;

  if (samples.length === 0) {
    throw new InsufficientCorpusError('Corpus has no samples — cannot train.');
  }

  const holdoutIds = new Set<string>(Array.isArray(manifest.holdout) ? manifest.holdout : []);
  let holdoutFromManifest = holdoutIds.size > 0;

  // Test bucket: from manifest if present, otherwise id-hash fallback.
  let test: CorpusSample[] = [];
  let remainder: CorpusSample[] = [];

  if (holdoutFromManifest) {
    for (const s of samples) {
      if (holdoutIds.has(s.id)) test.push(s);
      else remainder.push(s);
    }
    // Guard against stale/upstream-mismatched holdout IDs. If the
    // manifest's holdout doesn't intersect the loaded samples (e.g.
    // upstream regenerated ids after holdout selection, or holdout
    // belongs to a sibling manifest), fall back to id-hash so test
    // is never empty — preserves DESIGN.md §7 honest-eval invariant.
    if (test.length === 0) {
      holdoutFromManifest = false;
      test = [];
      remainder = [];
    }
  }
  if (!holdoutFromManifest) {
    // Fallback: use id-hash test bucket sized to testSplitFraction.
    const testFracMod = Math.max(1, Math.round(1 / Math.max(testSplitFraction, 0.001)));
    for (const s of samples) {
      if (bucket(splitSeed, s.id, testFracMod) === 0) {
        test.push(s);
      } else {
        remainder.push(s);
      }
    }
    // Tiny-corpus floor: when N is small enough that floor(N * testFrac)
    // could round to zero buckets-hit, force-promote at least one sample
    // into test (the lowest-hash id in remainder). Without this a
    // ~20-sample run can produce test=0 even with non-empty fraction.
    if (test.length === 0 && samples.length > 0) {
      const sortedRem = [...remainder].sort((a, b) => {
        const ba = bucket(splitSeed, a.id, 1_000_000);
        const bb = bucket(splitSeed, b.id, 1_000_000);
        if (ba !== bb) return ba - bb;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      });
      const promoted = sortedRem.shift();
      if (promoted) {
        test = [promoted];
        remainder = sortedRem;
      }
    }
  }

  // Valid: take a deterministic slice of the remainder.
  // Target valid count is `validSplitFraction × samples.length` rounded.
  // (When holdout is provided, the test count may differ from
  // testSplitFraction; we still aim for the absolute valid target so the
  // train/valid ratio stays reasonable.)
  const validTarget = Math.min(remainder.length, Math.max(0, Math.round(samples.length * validSplitFraction)));

  // Sort remainder by stable id-hash bucket (1M-mod). The first
  // `validTarget` after sort become valid; the rest become train.
  const sortedRemainder = [...remainder].sort((a, b) => {
    const ba = bucket(splitSeed, a.id, 1_000_000);
    const bb = bucket(splitSeed, b.id, 1_000_000);
    if (ba !== bb) return ba - bb;
    // Tiebreak on id to keep sort stable across node versions.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const valid = sortedRemainder.slice(0, validTarget);
  const train = sortedRemainder.slice(validTarget);

  if (train.length < minSamplesToTrain) {
    throw new InsufficientCorpusError(
      `Train split has only ${train.length} samples; need ≥ ${minSamplesToTrain}. ` +
        `Total corpus = ${samples.length}; test = ${test.length}; valid = ${valid.length}.`,
      { totalSamples: samples.length, train: train.length, valid: valid.length, test: test.length }
    );
  }

  // Postcondition: no overlap, full coverage.
  const allIds = new Set<string>(samples.map(s => s.id));
  const splitIds = new Set<string>([...train, ...valid, ...test].map(s => s.id));
  if (allIds.size !== splitIds.size || allIds.size !== samples.length) {
    throw new InsufficientCorpusError(
      `Split coverage mismatch: corpus had ${allIds.size} unique ids, split had ${splitIds.size}.`
    );
  }

  return {
    train,
    valid,
    test,
    trace: {
      totalSamples: samples.length,
      holdoutFromManifest: holdoutFromManifest ? holdoutIds.size : 0,
      holdoutFromIdHash: holdoutFromManifest ? 0 : test.length,
      splitSeed,
      fractions: {
        train: trainSplitFraction,
        valid: validSplitFraction,
        test: testSplitFraction
      }
    }
  };
}
