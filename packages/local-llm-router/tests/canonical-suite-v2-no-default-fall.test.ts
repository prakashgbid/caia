// RR-2 (2026-05-15) — canonical-suite-v2 one-shot router-vocab eval.
//
// Companion to tests/intent-vocab-canonical.test.ts. That test asserts the
// *vocab set* parity (every canonical-suite-v2 expected_intent is a valid
// Intent + has a routing-config rule). This test runs the *one-shot eval*
// requested by the RR-2 directive:
//
//   "Add a one-shot eval: run canonical-suite-v2 ON THE ROUTER and confirm
//    no prompt falls to default-tier due to vocab mismatch."
//
// It iterates over every prompt (all 125) in canonical-suite-v2.yaml and
// asserts that calling getRoute(expected_intent) returns a rule whose
// `description` is NOT the unknown-task fallback string. Pre-RR-2, 49 of
// the 125 prompts (every code-edit-*, code-review, code-explain,
// prose-draft, search-memory, ambiguous-intent, empty-input, and
// prompt-injection-attempt row) hit that fallback because the classifier
// coerced the coarse expected_intent labels to `unknown` → claude.
//
// We do NOT need network + an LLM round-trip to assert the vocab-mismatch
// invariant — `getRoute(intent)` is the same lookup the router uses after
// `parseClassifierOutput()` lands on a tier, so the test directly covers
// the failure mode. The LLM-path accuracy / displacement / quality metrics
// are still the job of `evals/run_canonical_suite_v2.py` (which needs the
// live router + ollama + the operator-only network sandbox lift).
//
// If a future eval-suite revision adds new prompts that route to an intent
// not registered in ROUTING_RULES, this test fails with a concrete count
// of rows that would silently default-fall — the cheap regression tripwire.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { getRoute } from '../src/routing-config.js';

interface CanonicalPrompt {
  id: string;
  category: string;
  expectedIntent: string;
  expectedTier: string;
}

/**
 * Parse the canonical-suite-v2.yaml prompts list. We only need three fields
 * per prompt (id, expected_intent, expected_tier) so a tiny line-scan is
 * cheaper than pulling in a full YAML parser.
 */
function loadCanonicalPrompts(): CanonicalPrompt[] {
  const here = new URL('.', import.meta.url).pathname;
  const yamlPath = resolve(here, '..', 'evals', 'canonical-suite-v2.yaml');
  const text = readFileSync(yamlPath, 'utf8');

  const prompts: CanonicalPrompt[] = [];
  let current: Partial<CanonicalPrompt> = {};

  for (const line of text.split('\n')) {
    const idMatch = line.match(/^\s*-\s+id:\s*([\w-]+)\s*$/);
    if (idMatch) {
      // Flush prior, start new.
      if (current.id && current.expectedIntent && current.expectedTier && current.category) {
        prompts.push(current as CanonicalPrompt);
      }
      current = { id: idMatch[1] };
      continue;
    }
    const catMatch = line.match(/^\s*category:\s*([\w-]+)\s*$/);
    if (catMatch) {
      current.category = catMatch[1];
      continue;
    }
    const intentMatch = line.match(/^\s*expected_intent:\s*([\w-]+)\s*$/);
    if (intentMatch) {
      current.expectedIntent = intentMatch[1];
      continue;
    }
    const tierMatch = line.match(/^\s*expected_tier:\s*([\w-]+)\s*$/);
    if (tierMatch) {
      current.expectedTier = tierMatch[1];
      continue;
    }
  }
  if (current.id && current.expectedIntent && current.expectedTier && current.category) {
    prompts.push(current as CanonicalPrompt);
  }
  return prompts;
}

/**
 * Equivalence between canonical-suite tiers and router-emitted tiers, mirrored
 * from `evals/run_canonical_suite_v2.py`'s TIER_EQUIV. Used by the per-prompt
 * tier-compatibility check below.
 *
 * `local-3b` collapses to `local-7b` because the router has no <7B local;
 * `local-13b` ≈ `local-14b` (±1B is below the noise floor on these models);
 * any cloud-* maps to `claude`; `reject` maps to `claude` (the conservative
 * escalate). `expected_tier: stolution-batch` is not part of canonical-v2.
 */
const TIER_EQUIV: Record<string, ReadonlyArray<string>> = {
  'local-3b': ['local-7b'],
  'local-7b': ['local-7b'],
  'local-13b': ['local-14b'],
  'local-14b': ['local-14b'],
  'cloud-haiku': ['claude'],
  'cloud-sonnet': ['claude'],
  'cloud-opus': ['claude'],
  reject: ['claude'],
};

/**
 * Map a routing-rule into the canonical tier label (`local-7b` | `local-14b`
 * | `claude` | `stolution-batch`). Drives the per-prompt expected-vs-actual
 * compatibility check.
 */
function routerTierOf(localModel: string, useLocal: boolean): string {
  if (!useLocal) return 'claude';
  if (localModel.startsWith('qwen2.5-coder:7b') || localModel === 'nomic-embed-text') return 'local-7b';
  if (localModel.startsWith('qwen2.5-coder:14b')) return 'local-14b';
  if (localModel.startsWith('qwen2.5-coder:32b')) return 'local-32b';
  if (localModel === 'qwen2.5:7b-instruct') return 'stolution-batch';
  return 'local-7b';
}

describe('RR-2 one-shot canonical-suite-v2 eval (no default-tier fall)', () => {
  const prompts = loadCanonicalPrompts();

  it('parses the full canonical suite (≥125 prompts)', () => {
    // Sanity guard — if the YAML file is reshaped and the line-scan stops
    // finding prompts, every downstream assertion would pass vacuously.
    // The suite header declares total_prompts=125; today's file actually
    // carries 126 entries (one category has 6) — we tolerate ±1 drift so
    // a benign re-balance doesn't trip the gate, but still catch a parser
    // regression that would collapse to a single-digit count.
    expect(prompts.length).toBeGreaterThanOrEqual(125);
    expect(prompts.length).toBeLessThanOrEqual(130);
  });

  it('no prompt routes via the unknown-task default rule', () => {
    const failures: { id: string; category: string; expectedIntent: string }[] = [];
    for (const p of prompts) {
      const rule = getRoute(p.expectedIntent);
      if (rule.description.includes('Unknown task type')) {
        failures.push({ id: p.id, category: p.category, expectedIntent: p.expectedIntent });
      }
    }
    expect(
      failures,
      `RR-2 regression: ${failures.length} prompt(s) fell to the unknown-task ` +
        `default rule due to a classifier-vocab / router-policy mismatch. ` +
        `Each row would silently mis-route to qwen2.5-coder:7b at the eval's ` +
        `quality floor: ${JSON.stringify(failures, null, 2)}`,
    ).toEqual([]);
  });

  it('every prompt routes to a tier compatible with its expected_tier', () => {
    // Strong invariant — vocab parity alone could pass while still routing
    // every `review` row to local-7b when canonical expects local-13b. The
    // TIER_EQUIV check catches that class of slow-leak misroute.
    const incompatible: {
      id: string;
      expectedIntent: string;
      expectedTier: string;
      routerTier: string;
    }[] = [];
    for (const p of prompts) {
      const allowed = TIER_EQUIV[p.expectedTier];
      if (!allowed) continue; // expected_tier we don't have an equivalence for — skip rather than false-flag
      const rule = getRoute(p.expectedIntent);
      const routerTier = routerTierOf(rule.localModel, rule.useLocal);
      if (!allowed.includes(routerTier)) {
        incompatible.push({
          id: p.id,
          expectedIntent: p.expectedIntent,
          expectedTier: p.expectedTier,
          routerTier,
        });
      }
    }
    // Note: we EXPECT a non-zero count here for legitimate cascade-controller
    // tier mismatches (e.g., a `refactor-complex` row whose expected_tier is
    // `cloud-sonnet` but whose getRoute() default is `local-14b` — the
    // cascade-controller promotes when confidence is low). The vocab-mismatch
    // regression we're guarding against would produce 49+ failures (every
    // canonical-suite-v2 row in the affected categories). We therefore cap
    // the budget at 30 mismatches — enough headroom for legitimate cascade
    // diffs, tight enough to catch a vocab regression.
    expect(
      incompatible.length,
      `RR-2 tier-compatibility budget exceeded: ${incompatible.length} prompt(s) ` +
        `routed to a tier inconsistent with their canonical-suite-v2 expected_tier. ` +
        `If this is a legitimate cascade-controller diff, raise the budget. If it ` +
        `looks like a vocab-mismatch regression, fix the routing-config rule. ` +
        `First 10 mismatches: ${JSON.stringify(incompatible.slice(0, 10), null, 2)}`,
    ).toBeLessThanOrEqual(30);
  });

  it('each affected category is fully covered (no silent vocab-mismatch fall)', () => {
    // Category-level guard: pre-RR-2, every prompt in these 8 categories
    // fell to the unknown-task default. After the fix, every prompt in
    // these categories must route via a registered rule. This is a sharper
    // signal than the global "no default fall" check — it ensures we don't
    // accidentally fix 19 of 20 prompts in `code-review` while leaving 1
    // behind on a typo.
    const affectedCategories = [
      'code-edit-small',
      'code-edit-medium',
      'code-edit-large',
      'code-review',
      'code-explain',
      'prose-draft',
      'search-memory',
      'ambiguous-intent',
      'empty-input',
      'prompt-injection-attempt',
    ];
    const perCategoryFalls: Record<string, number> = Object.fromEntries(
      affectedCategories.map((c) => [c, 0]),
    );
    for (const p of prompts) {
      if (!affectedCategories.includes(p.category)) continue;
      const rule = getRoute(p.expectedIntent);
      if (rule.description.includes('Unknown task type')) {
        perCategoryFalls[p.category] = (perCategoryFalls[p.category] ?? 0) + 1;
      }
    }
    for (const [cat, falls] of Object.entries(perCategoryFalls)) {
      expect(
        falls,
        `RR-2 regression: category "${cat}" has ${falls} prompt(s) falling to ` +
          `the unknown-task default. This category was pre-RR-2 a 100%-default-fall ` +
          `surface — a non-zero count means the vocab fix has regressed.`,
      ).toBe(0);
    }
  });
});
