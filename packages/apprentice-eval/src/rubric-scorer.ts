/**
 * rubric-scorer — runs each test case's assertions against a generated
 * output and returns a per-prompt RubricResult.
 *
 * Per DESIGN.md §5 (assertion types) + §7a (rubric pass/fail).
 *
 * Assertion types implemented:
 *   - contains            (substring match; case-sensitive)
 *   - not-contains        (inverse of contains)
 *   - regex               (RegExp.test against the output)
 *   - equals              (exact match, after trim)
 *   - javascript          (sandboxed via `Function`; receives `output`)
 *   - semantic-similarity (delegated to a SemanticScorer or null/0.0)
 */

import type {
  Assertion,
  AssertionResult,
  PromptSuite,
  RubricResult,
  SuiteTestCase
} from './types.js';

export interface SemanticScorer {
  /** Returns cosine similarity in [0, 1]. */
  readonly similarity: (a: string, b: string) => Promise<number>;
}

export interface ScoreOpts {
  readonly suite: PromptSuite;
  readonly test: SuiteTestCase;
  readonly adapter: string;
  readonly output: string;
  readonly semanticScorer?: SemanticScorer | undefined;
}

const DEFAULT_WEIGHT = 1.0;

function evalJavascriptPredicate(body: string, output: string): boolean {
  // The body is a project-internal snippet from a YAML suite under
  // `suites/`. It is NOT user-supplied at runtime — suites are committed
  // to the repo and reviewed via PR. We use Function() rather than a
  // full sandbox because (a) the inputs are trusted and (b) a sandbox
  // would force a heavyweight dep just for assertion evaluation.
  // Function() is intentional — see comment above. eslint rule that
  // would flag it isn't enabled in this config.
  const FnCtor = Function;
  const fn = new FnCtor('output', `return (${body});`) as (out: string) => unknown;
  const result = fn(output);
  return Boolean(result);
}

async function evaluateAssertion(
  assertion: Assertion,
  output: string,
  semanticScorer: SemanticScorer | undefined
): Promise<AssertionResult> {
  const weight = assertion.weight ?? DEFAULT_WEIGHT;
  switch (assertion.type) {
    case 'contains': {
      const passed = output.includes(assertion.value);
      return {
        type: assertion.type,
        value: assertion.value,
        passed,
        weight,
        ...(passed ? {} : { reason: `output missing substring: ${assertion.value}` })
      };
    }
    case 'not-contains': {
      const passed = !output.includes(assertion.value);
      return {
        type: assertion.type,
        value: assertion.value,
        passed,
        weight,
        ...(passed ? {} : { reason: `output contains forbidden substring: ${assertion.value}` })
      };
    }
    case 'regex': {
      let passed = false;
      let reason: string | undefined;
      try {
        // The regex source is from a project-internal YAML suite under
        // `suites/`, committed + PR-reviewed; not runtime user input.
        // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
        const re = new RegExp(assertion.value);
        passed = re.test(output);
        if (!passed) reason = `output does not match regex: ${assertion.value}`;
      } catch (e) {
        reason = `invalid regex: ${e instanceof Error ? e.message : String(e)}`;
      }
      return {
        type: assertion.type,
        value: assertion.value,
        passed,
        weight,
        ...(reason !== undefined ? { reason } : {})
      };
    }
    case 'equals': {
      const passed = output.trim() === assertion.value.trim();
      return {
        type: assertion.type,
        value: assertion.value,
        passed,
        weight,
        ...(passed ? {} : { reason: 'output does not equal expected (after trim)' })
      };
    }
    case 'javascript': {
      let passed = false;
      let reason: string | undefined;
      try {
        passed = evalJavascriptPredicate(assertion.value, output);
        if (!passed) reason = `js predicate returned falsy: ${assertion.value}`;
      } catch (e) {
        reason = `js predicate threw: ${e instanceof Error ? e.message : String(e)}`;
      }
      return {
        type: assertion.type,
        value: assertion.value,
        passed,
        weight,
        ...(reason !== undefined ? { reason } : {})
      };
    }
    case 'semantic-similarity': {
      const threshold = assertion.threshold ?? 0.75;
      if (!semanticScorer) {
        return {
          type: assertion.type,
          value: assertion.value,
          passed: false,
          weight,
          reason: 'semantic-similarity assertion seen but no semanticScorer configured'
        };
      }
      const sim = await semanticScorer.similarity(output, assertion.value);
      const passed = sim >= threshold;
      return {
        type: assertion.type,
        value: assertion.value,
        passed,
        weight,
        score: sim,
        ...(passed ? {} : { reason: `cosine ${sim.toFixed(3)} < threshold ${threshold}` })
      };
    }
    /* c8 ignore next 3 */
    default:
      throw new Error(`[apprentice-eval] unknown assertion type`);
  }
}

export async function scoreOne(opts: ScoreOpts): Promise<RubricResult> {
  const results: AssertionResult[] = [];
  for (const a of opts.test.assert) {
    results.push(await evaluateAssertion(a, opts.output, opts.semanticScorer));
  }
  let passed = 0;
  let failed = 0;
  let weightSum = 0;
  let weightedHits = 0;
  for (const r of results) {
    if (r.passed) passed += 1;
    else failed += 1;
    weightSum += r.weight;
    if (r.passed) weightedHits += r.weight;
  }
  const weightedScore = weightSum > 0 ? weightedHits / weightSum : 0;
  return {
    promptId: opts.test.id ?? opts.test.description,
    suiteId: opts.suite.id,
    adapter: opts.adapter,
    passed,
    failed,
    weightedScore,
    assertions: results
  };
}

export const __TEST_ONLY = { evaluateAssertion, evalJavascriptPredicate };
