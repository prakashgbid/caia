/**
 * `@caia/per-story-tester/api` — public entry point.
 *
 * `runStoryTests(ticketId, config)` is the single function Stage 14
 * consumers call. It loads the ticket, runs each per-runner plan,
 * parses the output, aggregates the verdict, builds a PR review
 * comment on failure, and drives the state-machine transition
 * (code-complete -> per-story-tested | per-story-test-failed).
 */

import { executePlans, planRuns } from './runner.js';
import type {
  LayerSummary,
  LoadedTicket,
  PrReviewComment,
  RunStoryTestsConfig,
  StateTransitionOutcome,
  TestCaseResult,
  TestResults,
} from './types.js';
import {
  InvalidTransitionError,
  ProjectNotFoundError,
} from '@caia/state-machine';
import type {
  ProjectState,
  TransitionResult,
  TriggeredBy,
} from '@caia/state-machine';
import type { TestCase, TestCaseLayer } from '@chiefaia/ticket-template';

const SOURCE_STATE: ProjectState = 'code-complete';
const PASS_STATE: ProjectState = 'per-story-tested';
const FAIL_STATE: ProjectState = 'per-story-test-failed';

export async function runStoryTests(
  ticketId: string,
  config: RunStoryTestsConfig,
): Promise<TestResults> {
  const clock = config.clock ?? ((): Date => new Date());
  const startedAtIso = clock().toISOString();

  const loaded = await config.store.loadTicket(ticketId);
  const planOpts: Pick<RunStoryTestsConfig, 'resolveTestFile' | 'resolveBaseUrl'> = {};
  if (config.resolveTestFile) planOpts.resolveTestFile = config.resolveTestFile;
  if (config.resolveBaseUrl) planOpts.resolveBaseUrl = config.resolveBaseUrl;
  const plans = planRuns(loaded, planOpts);
  const perCaseRaw = await executePlans(plans, config.adapter);
  const perCase = reindexByTicketOrder(loaded.testCases, perCaseRaw);

  const summary = summarise(perCase, loaded.testCases);
  const layers = rollupLayers(perCase);
  const status: 'passed' | 'failed' = summary.requiredFailures === 0 ? 'passed' : 'failed';
  const finishedAtIso = clock().toISOString();

  const results: TestResults = {
    ticketId: loaded.ticketId,
    projectId: loaded.projectId,
    status,
    perCase,
    layers,
    summary,
    startedAtIso,
    finishedAtIso,
  };
  if (status === 'failed') {
    results.prComment = buildPrComment(perCase, loaded);
  }

  if (!config.skipStateMachine && config.stateMachine) {
    const transition = await driveTransition(loaded, status, config);
    if (transition) results.transition = transition;
  }

  return results;
}


// ─── Aggregation ────────────────────────────────────────────────────────────

function reindexByTicketOrder(
  cases: readonly TestCase[],
  results: readonly TestCaseResult[],
): TestCaseResult[] {
  const byCaseId = new Map<string, TestCaseResult[]>();
  for (const r of results) {
    const arr = byCaseId.get(r.caseId);
    if (arr) arr.push(r);
    else byCaseId.set(r.caseId, [r]);
  }

  const out: TestCaseResult[] = [];
  for (const tc of cases) {
    const hits = byCaseId.get(tc.id);
    if (hits && hits.length > 0) {
      const failed = hits.find(
        (h) => h.status === 'failed' || h.status === 'errored',
      );
      out.push(failed ?? hits[0]!);
    } else {
      out.push({
        caseId: tc.id,
        testName: tc.title,
        file: tc.selectorHints[0] ?? tc.id,
        layer: tc.layer,
        category: tc.category,
        runner: pickRunnerForTicketCase(tc),
        status: 'skipped',
        durationMs: 0,
      });
    }
  }
  return out;
}

function pickRunnerForTicketCase(tc: TestCase): TestCaseResult['runner'] {
  if (tc.layer === 'unit' || tc.layer === 'integration') return 'vitest';
  if (tc.layer === 'accessibility') return 'axe';
  if (tc.layer === 'visual' && tc.category === 'performance') return 'lighthouse';
  return 'playwright';
}

function summarise(
  perCase: readonly TestCaseResult[],
  ticketCases: readonly TestCase[],
): TestResults['summary'] {
  const out = {
    totalCases: perCase.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    errored: 0,
    flaky: 0,
    durationMs: 0,
    requiredFailures: 0,
  };
  const requiredById = new Map<string, boolean>();
  for (const tc of ticketCases) requiredById.set(tc.id, tc.required);

  for (const r of perCase) {
    out.durationMs += r.durationMs;
    switch (r.status) {
      case 'passed':
        out.passed += 1;
        break;
      case 'failed':
        out.failed += 1;
        break;
      case 'skipped':
        out.skipped += 1;
        break;
      case 'errored':
        out.errored += 1;
        break;
      case 'flaky':
        out.flaky += 1;
        break;
    }
    if (
      (r.status === 'failed' || r.status === 'errored') &&
      requiredById.get(r.caseId) === true
    ) {
      out.requiredFailures += 1;
    }
  }
  return out;
}


function rollupLayers(perCase: readonly TestCaseResult[]): LayerSummary[] {
  const byLayer = new Map<LayerSummary['layer'], LayerSummary>();
  const ensure = (layer: LayerSummary['layer']): LayerSummary => {
    const existing = byLayer.get(layer);
    if (existing) return existing;
    const fresh: LayerSummary = {
      layer,
      totalCases: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      errored: 0,
      flaky: 0,
      durationMs: 0,
    };
    byLayer.set(layer, fresh);
    return fresh;
  };
  for (const r of perCase) {
    const layerKey: LayerSummary['layer'] =
      r.runner === 'lighthouse' ? 'lighthouse' : (r.layer satisfies TestCaseLayer);
    const bucket = ensure(layerKey);
    bucket.totalCases += 1;
    bucket.durationMs += r.durationMs;
    switch (r.status) {
      case 'passed':
        bucket.passed += 1;
        break;
      case 'failed':
        bucket.failed += 1;
        break;
      case 'skipped':
        bucket.skipped += 1;
        break;
      case 'errored':
        bucket.errored += 1;
        break;
      case 'flaky':
        bucket.flaky += 1;
        break;
    }
  }
  const order: LayerSummary['layer'][] = [
    'unit',
    'integration',
    'e2e',
    'accessibility',
    'visual',
    'lighthouse',
  ];
  return order
    .map((k) => byLayer.get(k))
    .filter((s): s is LayerSummary => s !== undefined);
}


// ─── PR review comment ──────────────────────────────────────────────────────

/**
 * Build a transport-agnostic PR review comment payload. The orchestrator
 * is responsible for posting this to GitHub/Gitea/etc. — we only return
 * structured threads (file + optional line + message) plus a Markdown
 * body summarising the failures.
 */
export function buildPrComment(
  perCase: readonly TestCaseResult[],
  loaded: LoadedTicket,
): PrReviewComment {
  const failures = perCase.filter(
    (r) => r.status === 'failed' || r.status === 'errored',
  );
  const header = `Per-story tests failed for ${loaded.ticketId} — ${failures.length} required failure(s)`;
  const lines: string[] = [];
  lines.push(`### Per-story test results — ${loaded.ticketId}`);
  lines.push('');
  lines.push(`Project: \`${loaded.projectId}\``);
  lines.push(`Required failures: **${failures.length}**`);
  lines.push('');
  if (failures.length === 0) {
    lines.push('All required test cases passed.');
  } else {
    lines.push('| Runner | Layer | Case | File:Line | Message |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const r of failures) {
      const loc = r.line !== undefined ? `${r.file}:${r.line}` : r.file;
      const msg = (r.errorMessage ?? '').replace(/\|/g, '\\|').slice(0, 200);
      lines.push(
        `| ${r.runner} | ${r.layer} | \`${r.caseId}\` ${escapeMd(r.testName)} | \`${loc}\` | ${msg || '_(no message)_'} |`,
      );
    }
  }

  return {
    header,
    body: lines.join('\n'),
    requestChanges: failures.length > 0,
    threads: failures.map((r) => {
      const message = composeThreadMessage(r);
      const thread: PrReviewComment['threads'][number] = {
        file: r.file,
        caseId: r.caseId,
        testName: r.testName,
        message,
      };
      if (r.line !== undefined) thread.line = r.line;
      return thread;
    }),
  };
}

function composeThreadMessage(r: TestCaseResult): string {
  const parts: string[] = [];
  parts.push(`**${r.runner} — ${r.layer}/${r.category}** — case \`${r.caseId}\``);
  parts.push(`Status: \`${r.status}\`${r.flakeRetries ? ` (retries: ${r.flakeRetries})` : ''}`);
  if (r.errorMessage) {
    parts.push('');
    parts.push(`> ${r.errorMessage.split('\n')[0]}`);
  }
  if (r.axeViolations && r.axeViolations.length > 0) {
    const top = r.axeViolations.slice(0, 3);
    parts.push('');
    parts.push('Axe violations (top 3):');
    for (const v of top) {
      parts.push(`- \`${v.id}\` (${v.impact}) — ${v.description} [docs](${v.helpUrl})`);
    }
  }
  if (r.lighthouseAudit?.budgetFailed) {
    parts.push('');
    parts.push(`Lighthouse budget failed; perf score ${r.lighthouseAudit.performanceScore.toFixed(2)}.`);
  }
  return parts.join('\n');
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/`/g, '\\`');
}


// ─── State-machine driver ───────────────────────────────────────────────────

async function driveTransition(
  loaded: LoadedTicket,
  status: 'passed' | 'failed',
  config: RunStoryTestsConfig,
): Promise<StateTransitionOutcome | undefined> {
  const sm = config.stateMachine;
  if (!sm) return undefined;

  const targetState: ProjectState = status === 'passed' ? PASS_STATE : FAIL_STATE;

  let project;
  try {
    project = await sm.getProject(loaded.projectId);
  } catch (err) {
    return {
      attempted: true,
      toState: targetState,
      fromState: SOURCE_STATE,
      applied: false,
      reason: `getProject failed: ${err instanceof Error ? err.message : String(err)}`,
      transitionResult: {
        applied: false,
        projectId: loaded.projectId,
        fromState: SOURCE_STATE,
        toState: targetState,
        newVersion: 0,
        historyId: null,
        payloadHash: '',
        retries: 0,
      },
    };
  }

  if (!project) {
    return {
      attempted: true,
      toState: targetState,
      fromState: SOURCE_STATE,
      applied: false,
      reason: `project ${loaded.projectId} not found`,
      transitionResult: {
        applied: false,
        projectId: loaded.projectId,
        fromState: SOURCE_STATE,
        toState: targetState,
        newVersion: 0,
        historyId: null,
        payloadHash: '',
        retries: 0,
      },
    };
  }

  const fromState = project.status;
  const triggeredBy: TriggeredBy = config.triggeredBy ?? {
    kind: 'agent',
    id: '@caia/per-story-tester',
  };

  try {
    const transitionResult: TransitionResult = await sm.transition(
      loaded.projectId,
      targetState,
      {
        reason:
          status === 'passed'
            ? `per-story tests passed for ${loaded.ticketId}`
            : `per-story tests failed for ${loaded.ticketId}`,
        triggeredBy,
        payload: {
          ticketId: loaded.ticketId,
          verdict: status,
        },
      },
    );
    return {
      attempted: true,
      toState: targetState,
      fromState,
      applied: transitionResult.applied,
      reason: transitionResult.applied ? 'transition-applied' : 'idempotent-no-op',
      transitionResult,
    };
  } catch (err) {
    const reason =
      err instanceof InvalidTransitionError
        ? `invalid-transition: ${err.message}`
        : err instanceof ProjectNotFoundError
          ? `project-not-found: ${err.message}`
          : `transition-error: ${err instanceof Error ? err.message : String(err)}`;
    return {
      attempted: true,
      toState: targetState,
      fromState,
      applied: false,
      reason,
      transitionResult: {
        applied: false,
        projectId: loaded.projectId,
        fromState,
        toState: targetState,
        newVersion: project.version,
        historyId: null,
        payloadHash: '',
        retries: 0,
      },
    };
  }
}
