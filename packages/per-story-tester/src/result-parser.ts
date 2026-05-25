/**
 * Pure parsers: vitest, playwright, axe, lighthouse output → TestCaseResult[].
 */

import type {
  AxeViolation,
  LighthouseAuditSummary,
  PerformanceBudget,
  RunnerKind,
  RunnerRawOutput,
  TestCaseResult,
  TestCaseRunStatus,
} from './types.js';
import type { TestCase } from '@chiefaia/ticket-template';

// ─── Shared helpers ─────────────────────────────────────────────────────────

function statusFromVitest(raw: string | undefined): TestCaseRunStatus {
  switch (raw) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'skipped':
    case 'pending':
    case 'todo':
      return 'skipped';
    default:
      return 'errored';
  }
}

function statusFromPlaywright(raw: string | undefined, retries: number): TestCaseRunStatus {
  switch (raw) {
    case 'passed':
      return retries > 0 ? 'flaky' : 'passed';
    case 'failed':
    case 'timedOut':
    case 'interrupted':
      return 'failed';
    case 'skipped':
      return 'skipped';
    default:
      return 'errored';
  }
}

function matchCase(
  cases: readonly TestCase[],
  testName: string,
  index: number,
): TestCase | undefined {
  for (const tc of cases) {
    if (testName.includes(tc.id)) return tc;
  }
  for (const tc of cases) {
    if (testName.includes(tc.title)) return tc;
  }
  return cases[index];
}

function parseLocation(loc: unknown): { file: string; line?: number } | undefined {
  if (typeof loc === 'string') {
    const m = /(.+?):(\d+)(?::(\d+))?$/.exec(loc);
    if (m && typeof m[1] === 'string' && typeof m[2] === 'string') {
      return { file: m[1], line: Number(m[2]) };
    }
    return { file: loc };
  }
  if (loc !== null && typeof loc === 'object') {
    const l = loc as { file?: unknown; path?: unknown; line?: unknown; row?: unknown };
    const file =
      typeof l.file === 'string' ? l.file : typeof l.path === 'string' ? l.path : undefined;
    if (!file) return undefined;
    const lineRaw =
      typeof l.line === 'number' ? l.line : typeof l.row === 'number' ? l.row : undefined;
    const result: { file: string; line?: number } = { file };
    if (lineRaw !== undefined) result.line = lineRaw;
    return result;
  }
  return undefined;
}

function safeJsonReport(raw: RunnerRawOutput): unknown {
  if (raw.jsonReport !== undefined) return raw.jsonReport;
  if (raw.stdout) {
    try {
      return JSON.parse(raw.stdout);
    } catch {
      const m = raw.stdout.match(/\{[\s\S]*\}\s*$/);
      if (m) {
        try {
          return JSON.parse(m[0]);
        } catch {
          /* ignore */
        }
      }
    }
  }
  return undefined;
}


// ─── Vitest ─────────────────────────────────────────────────────────────────

export function parseVitestJson(raw: RunnerRawOutput): TestCaseResult[] {
  if (raw.runner !== 'vitest') return [];
  const json = safeJsonReport(raw);
  if (!json || typeof json !== 'object') return [];
  const root = json as { testResults?: unknown };
  if (!Array.isArray(root.testResults)) return [];

  const results: TestCaseResult[] = [];
  let positional = 0;

  for (const fileBlockUnknown of root.testResults) {
    if (!fileBlockUnknown || typeof fileBlockUnknown !== 'object') continue;
    const fileBlock = fileBlockUnknown as {
      name?: unknown;
      assertionResults?: unknown;
    };
    const filePath = typeof fileBlock.name === 'string' ? fileBlock.name : '';
    if (!Array.isArray(fileBlock.assertionResults)) continue;

    for (const ar of fileBlock.assertionResults) {
      if (!ar || typeof ar !== 'object') continue;
      const a = ar as {
        title?: unknown;
        fullName?: unknown;
        ancestorTitles?: unknown;
        status?: unknown;
        duration?: unknown;
        failureMessages?: unknown;
        location?: unknown;
      };
      const ancestors = Array.isArray(a.ancestorTitles)
        ? a.ancestorTitles.filter((x): x is string => typeof x === 'string')
        : [];
      const title = typeof a.title === 'string' ? a.title : '';
      const testName =
        typeof a.fullName === 'string' && a.fullName.length > 0
          ? a.fullName
          : [...ancestors, title].filter(Boolean).join(' > ');
      const matched = matchCase(raw.plan.cases, testName, positional);
      positional += 1;
      if (!matched) continue;

      const loc = parseLocation(a.location);
      const file = loc?.file ?? filePath;
      const failureMessages = Array.isArray(a.failureMessages)
        ? a.failureMessages.filter((x): x is string => typeof x === 'string')
        : [];
      const status = statusFromVitest(typeof a.status === 'string' ? a.status : undefined);
      const result: TestCaseResult = {
        caseId: matched.id,
        testName: testName || matched.title,
        file,
        layer: matched.layer,
        category: matched.category,
        runner: 'vitest',
        status,
        durationMs: typeof a.duration === 'number' ? a.duration : 0,
      };
      if (loc?.line !== undefined) result.line = loc.line;
      if (status === 'failed' || status === 'errored') {
        const msg = failureMessages[0];
        if (msg) {
          result.errorMessage = msg.split('\n')[0] ?? msg;
          result.errorStack = msg;
        }
      }
      results.push(result);
    }
  }

  return results;
}


// ─── Playwright ─────────────────────────────────────────────────────────────

export function parsePlaywrightJson(raw: RunnerRawOutput): TestCaseResult[] {
  if (raw.runner !== 'playwright') return [];
  const json = safeJsonReport(raw);
  if (!json || typeof json !== 'object') return [];

  const results: TestCaseResult[] = [];
  let positional = 0;

  function walkSuites(suites: unknown[]): void {
    for (const sUnknown of suites) {
      if (!sUnknown || typeof sUnknown !== 'object') continue;
      const s = sUnknown as { specs?: unknown; suites?: unknown };
      if (Array.isArray(s.specs)) {
        for (const specUnknown of s.specs) {
          if (!specUnknown || typeof specUnknown !== 'object') continue;
          const spec = specUnknown as {
            title?: unknown;
            file?: unknown;
            line?: unknown;
            tests?: unknown;
          };
          const file = typeof spec.file === 'string' ? spec.file : '';
          const line = typeof spec.line === 'number' ? spec.line : undefined;
          const title = typeof spec.title === 'string' ? spec.title : '';

          if (Array.isArray(spec.tests)) {
            for (const testUnknown of spec.tests) {
              if (!testUnknown || typeof testUnknown !== 'object') continue;
              const test = testUnknown as { results?: unknown };
              if (!Array.isArray(test.results) || test.results.length === 0) continue;
              const last = test.results[test.results.length - 1] as {
                status?: unknown;
                duration?: unknown;
                errors?: unknown;
                retry?: unknown;
              };
              const retries =
                typeof last.retry === 'number' ? last.retry : test.results.length - 1;
              const matched = matchCase(raw.plan.cases, title, positional);
              positional += 1;
              if (!matched) continue;
              const status = statusFromPlaywright(
                typeof last.status === 'string' ? last.status : undefined,
                retries,
              );
              const errors = Array.isArray(last.errors) ? last.errors : [];
              const first = errors[0] as { message?: unknown; stack?: unknown } | undefined;

              const result: TestCaseResult = {
                caseId: matched.id,
                testName: title || matched.title,
                file,
                layer: matched.layer,
                category: matched.category,
                runner: 'playwright',
                status,
                durationMs: typeof last.duration === 'number' ? last.duration : 0,
              };
              if (line !== undefined) result.line = line;
              if (retries > 0) result.flakeRetries = retries;
              if (status === 'failed' || status === 'errored') {
                if (first?.message !== undefined && typeof first.message === 'string') {
                  result.errorMessage = first.message;
                }
                if (first?.stack !== undefined && typeof first.stack === 'string') {
                  result.errorStack = first.stack;
                }
              }
              results.push(result);
            }
          }
        }
      }
      if (Array.isArray(s.suites)) walkSuites(s.suites);
    }
  }

  const root = json as { suites?: unknown };
  if (Array.isArray(root.suites)) walkSuites(root.suites);
  return results;
}


// ─── axe ────────────────────────────────────────────────────────────────────

export function parseAxeViolations(raw: RunnerRawOutput): TestCaseResult[] {
  if (raw.runner !== 'axe') return [];
  const json = safeJsonReport(raw);
  if (!json || typeof json !== 'object') return [];
  const root = json as { violations?: unknown };
  const allowedImpacts: AxeViolation['impact'][] = [
    'minor',
    'moderate',
    'serious',
    'critical',
    'unknown',
  ];
  const violations: AxeViolation[] = Array.isArray(root.violations)
    ? root.violations
        .map((v): AxeViolation | null => {
          if (!v || typeof v !== 'object') return null;
          const vv = v as {
            id?: unknown;
            impact?: unknown;
            description?: unknown;
            helpUrl?: unknown;
            nodes?: unknown;
          };
          const id = typeof vv.id === 'string' ? vv.id : 'unknown';
          const impactRaw = typeof vv.impact === 'string' ? vv.impact : 'unknown';
          const impact: AxeViolation['impact'] = allowedImpacts.includes(
            impactRaw as AxeViolation['impact'],
          )
            ? (impactRaw as AxeViolation['impact'])
            : 'unknown';
          return {
            id,
            impact,
            description: typeof vv.description === 'string' ? vv.description : '',
            helpUrl: typeof vv.helpUrl === 'string' ? vv.helpUrl : '',
            nodes: Array.isArray(vv.nodes) ? vv.nodes.length : 0,
          };
        })
        .filter((v): v is AxeViolation => v !== null)
    : [];

  const results: TestCaseResult[] = [];
  raw.plan.cases.forEach((tc, idx) => {
    const status: TestCaseRunStatus = violations.length === 0 ? 'passed' : 'failed';
    const file = pickAxeFile(tc, raw);
    const result: TestCaseResult = {
      caseId: tc.id,
      testName: tc.title,
      file,
      layer: tc.layer,
      category: tc.category,
      runner: 'axe',
      status,
      durationMs: idx === 0 ? raw.durationMs : 0,
    };
    if (violations.length > 0) {
      result.axeViolations = violations;
      const top = violations[0];
      if (top) {
        result.errorMessage = `${violations.length} accessibility violation(s): ${top.id} (${top.impact})`;
      }
    }
    results.push(result);
  });
  return results;
}

function pickAxeFile(tc: TestCase, raw: RunnerRawOutput): string {
  const hint = tc.selectorHints[0];
  if (hint) return hint;
  if (raw.plan.url) return raw.plan.url;
  return tc.id;
}


// ─── Lighthouse ─────────────────────────────────────────────────────────────

export function parseLighthouseReport(raw: RunnerRawOutput): TestCaseResult[] {
  if (raw.runner !== 'lighthouse') return [];
  const json = safeJsonReport(raw);
  if (!json || typeof json !== 'object') return [];
  const lhr = json as { categories?: unknown; audits?: unknown };

  const cats = (lhr.categories ?? {}) as Record<string, { score?: unknown } | undefined>;
  const audits = (lhr.audits ?? {}) as Record<
    string,
    { score?: unknown; numericValue?: unknown } | undefined
  >;

  const perf = scoreOf(cats.performance);
  const a11y = scoreOf(cats.accessibility);
  const bp = scoreOf(cats['best-practices']);
  const seo = scoreOf(cats.seo);

  const lcp = numericOf(audits['largest-contentful-paint']);
  const cls = numericOf(audits['cumulative-layout-shift']);
  const tbt = numericOf(audits['total-blocking-time']);

  const failedAudits: string[] = [];
  for (const [auditId, audit] of Object.entries(audits)) {
    if (!audit) continue;
    const s = scoreOf(audit);
    if (s !== undefined && s < 0.9) failedAudits.push(auditId);
  }

  const budget = raw.plan.performanceBudget;
  const metricsForBudget: {
    performanceScore?: number;
    lcpMs?: number;
    cls?: number;
    tbtMs?: number;
  } = {};
  if (perf !== undefined) metricsForBudget.performanceScore = perf;
  if (lcp !== undefined) metricsForBudget.lcpMs = lcp;
  if (cls !== undefined) metricsForBudget.cls = cls;
  if (tbt !== undefined) metricsForBudget.tbtMs = tbt;
  const budgetFailed = lighthouseBudgetFails(metricsForBudget, budget);

  const summary: LighthouseAuditSummary = {
    performanceScore: perf ?? 0,
    accessibilityScore: a11y ?? 0,
    bestPracticesScore: bp ?? 0,
    seoScore: seo ?? 0,
    budgetFailed,
    failedAudits,
  };
  if (lcp !== undefined) summary.lcpMs = lcp;
  if (cls !== undefined) summary.cls = cls;
  if (tbt !== undefined) summary.tbtMs = tbt;

  const results: TestCaseResult[] = [];
  raw.plan.cases.forEach((tc, idx) => {
    const status: TestCaseRunStatus = budgetFailed ? 'failed' : 'passed';
    const result: TestCaseResult = {
      caseId: tc.id,
      testName: tc.title,
      file: raw.plan.url ?? tc.selectorHints[0] ?? tc.id,
      layer: tc.layer,
      category: tc.category,
      runner: 'lighthouse',
      status,
      durationMs: idx === 0 ? raw.durationMs : 0,
      lighthouseAudit: summary,
    };
    if (budgetFailed) {
      result.errorMessage = lighthouseBudgetMessage(summary, budget);
    }
    results.push(result);
  });
  return results;
}

function scoreOf(input: unknown): number | undefined {
  if (input === null || typeof input !== 'object') return undefined;
  const s = (input as { score?: unknown }).score;
  return typeof s === 'number' ? s : undefined;
}

function numericOf(input: unknown): number | undefined {
  if (input === null || typeof input !== 'object') return undefined;
  const n = (input as { numericValue?: unknown }).numericValue;
  return typeof n === 'number' ? n : undefined;
}

function lighthouseBudgetFails(
  metrics: {
    performanceScore?: number;
    lcpMs?: number;
    cls?: number;
    tbtMs?: number;
  },
  budget: PerformanceBudget | undefined,
): boolean {
  if (!budget) return false;
  if (
    budget.performanceScoreFloor !== undefined &&
    metrics.performanceScore !== undefined &&
    metrics.performanceScore < budget.performanceScoreFloor
  ) {
    return true;
  }
  if (budget.lcpMs !== undefined && metrics.lcpMs !== undefined && metrics.lcpMs > budget.lcpMs) {
    return true;
  }
  if (budget.cls !== undefined && metrics.cls !== undefined && metrics.cls > budget.cls) {
    return true;
  }
  if (budget.tbtMs !== undefined && metrics.tbtMs !== undefined && metrics.tbtMs > budget.tbtMs) {
    return true;
  }
  return false;
}

function lighthouseBudgetMessage(
  summary: LighthouseAuditSummary,
  budget: PerformanceBudget | undefined,
): string {
  const parts: string[] = [];
  if (
    budget?.performanceScoreFloor !== undefined &&
    summary.performanceScore < budget.performanceScoreFloor
  ) {
    parts.push(
      `performance ${summary.performanceScore.toFixed(2)} < floor ${budget.performanceScoreFloor}`,
    );
  }
  if (budget?.lcpMs !== undefined && summary.lcpMs !== undefined && summary.lcpMs > budget.lcpMs) {
    parts.push(`LCP ${Math.round(summary.lcpMs)}ms > budget ${budget.lcpMs}ms`);
  }
  if (budget?.cls !== undefined && summary.cls !== undefined && summary.cls > budget.cls) {
    parts.push(`CLS ${summary.cls.toFixed(3)} > budget ${budget.cls}`);
  }
  if (budget?.tbtMs !== undefined && summary.tbtMs !== undefined && summary.tbtMs > budget.tbtMs) {
    parts.push(`TBT ${Math.round(summary.tbtMs)}ms > budget ${budget.tbtMs}ms`);
  }
  if (parts.length === 0) return 'Lighthouse budget failed';
  return `Lighthouse budget failed: ${parts.join('; ')}`;
}


// ─── Dispatcher ─────────────────────────────────────────────────────────────

export function parseRunnerOutput(raw: RunnerRawOutput): TestCaseResult[] {
  switch (raw.runner) {
    case 'vitest':
      return parseVitestJson(raw);
    case 'playwright':
      return parsePlaywrightJson(raw);
    case 'axe':
      return parseAxeViolations(raw);
    case 'lighthouse':
      return parseLighthouseReport(raw);
    default: {
      const exhaustive: never = raw.runner;
      void exhaustive;
      return [];
    }
  }
}

export function synthesiseRunnerError(
  raw: RunnerRawOutput,
  reason: string,
): TestCaseResult[] {
  return raw.plan.cases.map(
    (tc): TestCaseResult => ({
      caseId: tc.id,
      testName: tc.title,
      file: tc.selectorHints[0] ?? tc.id,
      layer: tc.layer,
      category: tc.category,
      runner: raw.runner as RunnerKind,
      status: 'errored',
      durationMs: raw.durationMs,
      errorMessage: reason,
      errorStack: raw.stderr.slice(0, 4_000),
    }),
  );
}
