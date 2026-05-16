// RR-2 (2026-05-15) — canonical-suite-v2 intent-vocab parity guard.
//
// The canonical eval suite (evals/canonical-suite-v2.yaml) uses 20 coarse
// `expected_intent` labels as ground-truth: ambiguous, classify, doc-update,
// doc-write, edit, empty, error-recovery, explain, extract, format-convert,
// prompt-injection, prose-draft, prose-rewrite, refactor-complex, rename,
// review, schema-design, search, summarize, test-gen.
//
// Before RR-2, the labels `edit`, `explain`, `review`, `prose-draft`,
// `search`, `ambiguous`, `empty`, `prompt-injection` were NOT in the
// classifier's INTENT_VALUES — `parseClassifierOutput()` coerced them to
// `unknown`, which routed to `claude` (the default tier). Result: every
// canonical-suite-v2 row in the code-edit-*, code-review, code-explain,
// prose-draft, search-memory, ambiguous-intent, empty-input, and
// prompt-injection-attempt categories silently fell to claude, suppressing
// the displacement metric the suite was designed to measure.
//
// This test is the cheap regression tripwire — it loads the canonical YAML
// directly and asserts every `expected_intent` value is:
//   (a) a member of INTENT_VALUES (classifier can emit it), AND
//   (b) backed by a routing-config rule with `taskType === intent` (router
//       returns the right model instead of falling through to the unknown-
//       task default).
//
// If a future eval-suite revision adds a new `expected_intent` value, this
// test fails until both the classifier vocab and the router policy are
// updated to handle it. Tests/routing-config.test.ts handles the inverse
// direction (every classifier-emitted intent has a router rule).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  CANONICAL_SUITE_V2_INTENTS,
  INTENT_VALUES,
} from '../src/classifier.js';
import { ROUTING_RULES, getRoute } from '../src/routing-config.js';

/**
 * Extract every unique `expected_intent` value from canonical-suite-v2.yaml.
 * Tiny line-scan (no YAML library) — we only need a flat list of strings.
 */
function loadCanonicalExpectedIntents(): string[] {
  const here = new URL('.', import.meta.url).pathname;
  const yamlPath = resolve(here, '..', 'evals', 'canonical-suite-v2.yaml');
  const text = readFileSync(yamlPath, 'utf8');
  const seen = new Set<string>();
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*expected_intent:\s*([\w-]+)\s*$/);
    if (m && m[1]) seen.add(m[1]);
  }
  return [...seen].sort();
}

describe('RR-2 intent-vocab canonical parity', () => {
  it('canonical-suite-v2.yaml expected_intent values match CANONICAL_SUITE_V2_INTENTS', () => {
    // Drift guard: the in-code constant must stay in lockstep with the YAML.
    const fromYaml = loadCanonicalExpectedIntents();
    const fromCode = [...CANONICAL_SUITE_V2_INTENTS].sort();
    expect(
      fromCode,
      `CANONICAL_SUITE_V2_INTENTS drifted from canonical-suite-v2.yaml. ` +
        `Add/remove entries in src/classifier.ts to match — never edit the ` +
        `YAML to track the code.`,
    ).toEqual(fromYaml);
  });

  it('every canonical-suite-v2 expected_intent is in INTENT_VALUES (classifier can emit it)', () => {
    const yamlIntents = loadCanonicalExpectedIntents();
    // Sanity: the YAML actually parsed.
    expect(yamlIntents.length).toBeGreaterThan(10);
    const intentSet = new Set<string>(INTENT_VALUES as readonly string[]);
    const missing = yamlIntents.filter((i) => !intentSet.has(i));
    expect(
      missing,
      `canonical-suite-v2 expected_intent values missing from INTENT_VALUES — ` +
        `the classifier will coerce these to "unknown" → claude (silent ` +
        `default-tier fall on every eval row using them): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('every canonical-suite-v2 expected_intent has a routing-config rule (router can dispatch it)', () => {
    const yamlIntents = loadCanonicalExpectedIntents();
    const taskTypes = new Set(ROUTING_RULES.map((r) => r.taskType));
    const missing = yamlIntents.filter((i) => !taskTypes.has(i));
    expect(
      missing,
      `canonical-suite-v2 expected_intent values missing from ROUTING_RULES — ` +
        `getRoute() will fall through to the unknown-task default ` +
        `(qwen2.5-coder:7b, useLocal:true) instead of the intent's true ` +
        `default tier: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('coarse-intent aliases route to the documented default tier', () => {
    // Per the RR-2 mapping table:
    //   edit, explain, prose-draft, search → local-7b (qwen2.5-coder:7b)
    //   review                              → local-14b (qwen2.5-coder:14b)
    //   ambiguous, empty, prompt-injection → claude (useLocal:false)
    expect(getRoute('edit').localModel).toBe('qwen2.5-coder:7b');
    expect(getRoute('edit').useLocal).toBe(true);
    expect(getRoute('explain').localModel).toBe('qwen2.5-coder:7b');
    expect(getRoute('explain').useLocal).toBe(true);
    expect(getRoute('prose-draft').localModel).toBe('qwen2.5-coder:7b');
    expect(getRoute('prose-draft').useLocal).toBe(true);
    expect(getRoute('search').localModel).toBe('qwen2.5-coder:7b');
    expect(getRoute('search').useLocal).toBe(true);

    expect(getRoute('review').localModel).toBe('qwen2.5-coder:14b');
    expect(getRoute('review').useLocal).toBe(true);

    expect(getRoute('ambiguous').useLocal).toBe(false);
    expect(getRoute('empty').useLocal).toBe(false);
    expect(getRoute('prompt-injection').useLocal).toBe(false);
  });

  it('no canonical-suite-v2 intent falls through to the unknown-task default', () => {
    // The unknown-task default is the silent-default-tier-fall failure mode.
    // Assert getRoute() for every canonical intent returns a rule whose
    // description is NOT the unknown-task fallback string.
    const yamlIntents = loadCanonicalExpectedIntents();
    const unknownDefault = getRoute('this-task-type-definitely-does-not-exist');
    expect(unknownDefault.description).toContain('Unknown task type');
    for (const intent of yamlIntents) {
      const rule = getRoute(intent);
      expect(
        rule.description,
        `canonical intent "${intent}" routed via the unknown-task default — ` +
          `getRoute() didn't find a matching ROUTING_RULES entry`,
      ).not.toContain('Unknown task type');
    }
  });
});
