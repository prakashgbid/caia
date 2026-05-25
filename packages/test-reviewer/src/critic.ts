/**
 * @caia/test-reviewer — critic adapter (correctness lens).
 *
 * Mirrors `@caia/ea-reviewer`'s `critic.ts` exactly in shape. In production
 * this would spawn a Claude subagent (subscription-only per P14, no
 * API-key billing); in tests we want determinism and zero LLM calls — so
 * the production path is behind a `CriticAdapter` DI seam and the default
 * in-process impl is a keyword-overlap heuristic.
 *
 * The heuristic adapter:
 *   - tokenizes each acceptance criterion
 *   - for each criterion, searches the corresponding linked-test's
 *     `given/when/then` for token overlap
 *   - emits a P2 finding when overlap is < 25% (cheap signal that the
 *     test doesn't actually exercise the criterion)
 *
 * This isn't *correct* in the LLM-judgment sense — it's a deterministic
 * placeholder that fails closed (flags weak coverage) and is cheap to
 * test. Production callers inject a Claude-backed adapter.
 */

import type { TestCase } from '@chiefaia/ticket-template';
import type { CorrectnessFinding, CriticAdapter } from './types.js';

function tokenize(s: string): readonly string[] {
  return s
    .toLowerCase()
    .split(/[\s,.;:!?()/\\"'`<>{}[\]|&^%$#@~+=*-]+/)
    .filter((t) => t.length >= 4)
    .filter((t) => !STOPWORDS.has(t));
}

const STOPWORDS = new Set([
  'this',
  'that',
  'with',
  'from',
  'when',
  'then',
  'where',
  'which',
  'they',
  'their',
  'them',
  'have',
  'been',
  'must',
  'will',
  'shall',
  'should',
  'would',
  'into',
  'than',
  'also',
  'such',
  'each',
  'some',
  'more',
  'less',
  'over',
  'under',
  'page',
  'load',
  'user',
  'data',
  'given',
  'test',
]);

/**
 * Heuristic critic — for each AC, examine the linked test case(s) and
 * flag any whose given+when+then text doesn't share at least 25% of the
 * AC's content tokens.
 *
 * Fails closed: returns a finding when in doubt.
 */
export class HeuristicCriticAdapter implements CriticAdapter {
  async judge(input: {
    testCases: readonly TestCase[];
    acceptanceCriteria: readonly string[];
    composedArchitecture: Record<string, unknown>;
  }): Promise<readonly CorrectnessFinding[]> {
    const findings: CorrectnessFinding[] = [];
    for (let i = 0; i < input.acceptanceCriteria.length; i++) {
      const ac = input.acceptanceCriteria[i] ?? '';
      const acTokens = tokenize(ac);
      if (acTokens.length === 0) continue;

      const linked = input.testCases.filter(
        (tc) => tc.linkedAcceptanceCriterionIndex === i,
      );
      if (linked.length === 0) {
        // AC-coverage lens handles "no linked test"; we don't double-fire.
        continue;
      }
      for (const tc of linked) {
        const corpus = `${tc.given} ${tc.when} ${tc.then}`.toLowerCase();
        const matched = acTokens.filter((t) => corpus.includes(t));
        const ratio = matched.length / acTokens.length;
        if (ratio < 0.25) {
          findings.push({
            testCaseId: tc.id,
            reason: `test '${tc.id}' linked to AC #${i} but only ${matched.length}/${acTokens.length} criterion tokens appear in given/when/then`,
            severity: 'P2',
          });
        }
      }
    }
    return findings;
  }
}

/**
 * No-op critic — returns no findings. Default. Lets the deterministic
 * lenses do all the work.
 */
export class NullCriticAdapter implements CriticAdapter {
  async judge(_input: {
    testCases: readonly TestCase[];
    acceptanceCriteria: readonly string[];
    composedArchitecture: Record<string, unknown>;
  }): Promise<readonly CorrectnessFinding[]> {
    return [];
  }
}

/**
 * Fixed-output critic — for tests that need to assert the reviewer
 * handles correctness findings correctly without invoking the heuristic.
 */
export class FixedCriticAdapter implements CriticAdapter {
  constructor(private readonly findings: readonly CorrectnessFinding[]) {}
  async judge(_input: {
    testCases: readonly TestCase[];
    acceptanceCriteria: readonly string[];
    composedArchitecture: Record<string, unknown>;
  }): Promise<readonly CorrectnessFinding[]> {
    return this.findings;
  }
}
