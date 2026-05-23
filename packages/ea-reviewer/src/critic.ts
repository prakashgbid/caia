/**
 * @caia/ea-reviewer — critic adapter (correctness lens).
 *
 * Sourced from research/17_architect_framework_spec_2026.md §6.2 (lens 3).
 *
 * The correctness lens audits acceptance-criteria alignment. In production
 * this calls a Claude subagent ("critic-style Sonnet subagent running ~1
 * call per ticket" per spec §6). In tests, we want determinism and zero
 * LLM calls — so the production path is behind a `CriticAdapter` DI seam
 * and the default in-process impl is a keyword-overlap heuristic.
 *
 * The keyword adapter:
 *   - tokenizes each acceptance criterion
 *   - searches the composed architecture for any token overlap
 *   - emits a P1 finding for any criterion with zero overlap
 *
 * This isn't *correct* in the LLM-judgment sense — it's a deterministic
 * placeholder that fails closed (flags missing coverage) and is cheap to
 * test. Production callers inject a Claude-backed adapter that does the
 * real correctness check.
 */

import type {
  ArchitectAuditRow,
  CorrectnessFinding,
  CriticAdapter,
} from './types.js';

/**
 * Tokenize a string into lowercased word stems for heuristic matching.
 */
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
  'then',
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
  'site',
  'user',
  'data',
]);

/**
 * Recursively gather every string value in the composed architecture
 * into a single search corpus.
 */
function gatherStrings(value: unknown, out: string[] = []): readonly string[] {
  if (value == null) return out;
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    out.push(String(value));
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) gatherStrings(v, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      gatherStrings(v, out);
    }
    for (const k of Object.keys(value as Record<string, unknown>)) {
      out.push(k);
    }
    return out;
  }
  return out;
}

/**
 * Heuristic critic — emits a finding for each acceptance criterion whose
 * tokens don't appear in the composed architecture. Cheap, deterministic,
 * fails closed.
 */
export class HeuristicCriticAdapter implements CriticAdapter {
  async judge(input: {
    composedArchitecture: Record<string, unknown>;
    acceptanceCriteria: readonly string[];
    auditRows: readonly ArchitectAuditRow[];
  }): Promise<readonly CorrectnessFinding[]> {
    const corpus = gatherStrings(input.composedArchitecture).join(' ').toLowerCase();
    const findings: CorrectnessFinding[] = [];
    for (const criterion of input.acceptanceCriteria) {
      const tokens = tokenize(criterion);
      if (tokens.length === 0) continue;
      const matched = tokens.filter((t) => corpus.includes(t));
      const matchRatio = matched.length / tokens.length;
      if (matchRatio < 0.25) {
        // Less than 25% of the criterion's tokens appear in the architecture.
        findings.push({
          acceptanceCriterion: criterion,
          blameArchitect: 'global',
          reason: `architecture does not appear to address the criterion (only ${matched.length}/${tokens.length} tokens matched)`,
          severity: 'P2',
        });
      }
    }
    return findings;
  }
}

/**
 * No-op critic — returns no findings. Used by tests that want to assert
 * the reviewer's other lenses in isolation.
 */
export class NullCriticAdapter implements CriticAdapter {
  async judge(_input: {
    composedArchitecture: Record<string, unknown>;
    acceptanceCriteria: readonly string[];
    auditRows: readonly ArchitectAuditRow[];
  }): Promise<readonly CorrectnessFinding[]> {
    return [];
  }
}

/**
 * Fixed-output critic — useful for tests that want to assert the reviewer
 * handles correctness findings correctly without running the heuristic.
 */
export class FixedCriticAdapter implements CriticAdapter {
  constructor(private readonly findings: readonly CorrectnessFinding[]) {}
  async judge(_input: {
    composedArchitecture: Record<string, unknown>;
    acceptanceCriteria: readonly string[];
    auditRows: readonly ArchitectAuditRow[];
  }): Promise<readonly CorrectnessFinding[]> {
    return this.findings;
  }
}
