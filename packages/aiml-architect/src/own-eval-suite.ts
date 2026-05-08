/**
 * Implementation of `ownEvalSuite()`.
 */

import { ROUTING_RULES } from '@chiefaia/local-llm-router';

import type { ResolvedAIMLArchitectConfig } from './config.js';
import {
  loadCanonicalSuite,
  SuiteLoadError,
  type CanonicalSuiteAssertion,
  type CanonicalSuiteTest
} from './eval-suite-loader.js';
import type { EvalIssue, EvalSuite, FsReader } from './types.js';

export interface OwnEvalSuiteDeps {
  readonly cfg: ResolvedAIMLArchitectConfig;
  readonly fs: FsReader;
  readonly clock: () => Date;
  readonly routingTaskCategories?: ReadonlyArray<string>;
  readonly minCoverage?: number;
  readonly staleBaselineDays?: number;
}

export function ownEvalSuite(deps: OwnEvalSuiteDeps): EvalSuite {
  const path = deps.cfg.canonicalSuitePath;
  const minCoverage = deps.minCoverage ?? 3;
  const staleDays = deps.staleBaselineDays ?? 90;
  const taskCategories =
    deps.routingTaskCategories ?? ROUTING_RULES.map((r) => r.taskType);

  let suite;
  try {
    suite = loadCanonicalSuite(path, deps.fs);
  } catch (e) {
    if (e instanceof SuiteLoadError) {
      return {
        path,
        promptCount: 0,
        lastUpdatedIso: deps.clock().toISOString(),
        perTaskCategoryCoverage: {},
        perAssertionTypeUsage: {},
        integrityIssues: [
          {
            kind: 'suite-not-found',
            detail: e.message
          }
        ]
      };
    }
    throw e;
  }

  const tests = suite.tests;
  const integrityIssues: EvalIssue[] = [];

  const perCategory: Record<string, number> = {};
  for (const cat of taskCategories) {
    perCategory[cat] = 0;
  }
  for (const t of tests) {
    const cat = inferTaskCategoryFromTest(t);
    if (cat !== null && Object.prototype.hasOwnProperty.call(perCategory, cat)) {
      perCategory[cat] = (perCategory[cat] ?? 0) + 1;
    }
  }
  for (const [cat, count] of Object.entries(perCategory)) {
    if (count < minCoverage) {
      integrityIssues.push({
        kind: 'missing-task-coverage',
        detail: `Task category "${cat}" has ${count} prompt(s); threshold is ${minCoverage}.`
      });
    }
  }

  const promptHashes = new Map<string, string>();
  for (const t of tests) {
    const key = normalisedPromptText(t);
    if (promptHashes.has(key)) {
      integrityIssues.push({
        kind: 'duplicate-prompt',
        detail: `Two tests share the same normalised prompt content.`,
        promptId: t.description
      });
    } else {
      promptHashes.set(key, t.description);
    }
  }

  const assertionUsage: Record<string, number> = {};
  for (const t of tests) {
    const asserts = t.assert ?? [];
    for (const a of asserts) {
      assertionUsage[a.type] = (assertionUsage[a.type] ?? 0) + 1;
      const issue = checkAssertionAnchor(a);
      if (issue !== null) {
        integrityIssues.push({
          kind: 'unanchored-assertion',
          detail: issue,
          promptId: t.description
        });
      }
    }
  }

  const stat = deps.fs.stat(path);
  const ageMs = deps.clock().getTime() - stat.mtimeMs;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays > staleDays) {
    integrityIssues.push({
      kind: 'stale-baseline',
      detail:
        `Canonical suite at ${path} is ${ageDays.toFixed(0)} days old, ` +
        `threshold is ${staleDays} days. Consider a baseline refresh.`
    });
  }

  return {
    path,
    promptCount: tests.length,
    lastUpdatedIso: new Date(stat.mtimeMs).toISOString(),
    perTaskCategoryCoverage: perCategory,
    perAssertionTypeUsage: assertionUsage,
    integrityIssues
  };
}

function inferTaskCategoryFromTest(t: CanonicalSuiteTest): string | null {
  if (t.metadata && typeof t.metadata === 'object') {
    const cat = (t.metadata as Record<string, unknown>)['taskCategory'];
    if (typeof cat === 'string') return cat;
  }
  if (t.vars && typeof t.vars === 'object') {
    const cat = (t.vars as Record<string, unknown>)['taskCategory'];
    if (typeof cat === 'string') return cat;
  }
  const m = t.description.match(/^([a-z0-9-_]+)(?:\s*[:-])/i);
  if (m && m[1]) return m[1].toLowerCase();
  return null;
}

function normalisedPromptText(t: CanonicalSuiteTest): string {
  const promptVar =
    t.vars && typeof t.vars === 'object'
      ? (t.vars as Record<string, unknown>)['prompt']
      : undefined;
  if (typeof promptVar !== 'string') return t.description;
  return promptVar.replace(/\s+/g, ' ').trim().toLowerCase();
}

function checkAssertionAnchor(
  a: CanonicalSuiteAssertion
): string | null {
  if (a.type === 'contains' || a.type === 'not-contains' || a.type === 'equals') {
    if (typeof a.value !== 'string' || a.value.length === 0) {
      return `assertion "${a.type}" missing or empty value`;
    }
  }
  if (a.type === 'regex') {
    if (typeof a.value !== 'string' || a.value.length === 0) {
      return `assertion "regex" missing pattern`;
    }
    try {
      // Validates that the developer-authored regex pattern from canonical
      // suite config is well-formed. The constructed RegExp is discarded
      // immediately; no execution occurs on user input here.
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
      new RegExp(a.value);
    } catch (e) {
      return `assertion "regex" pattern invalid: ${String(e)}`;
    }
  }
  if (a.type === 'javascript') {
    if (typeof a.value !== 'string' || a.value.length === 0) {
      return `assertion "javascript" missing predicate`;
    }
  }
  return null;
}
