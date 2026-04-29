/**
 * `TestCodeGenerator` — FIX-002 (Phase 2D).
 *
 * Translates the ticket's `testCases` array (produced by the Test-Design
 * Agent) into concrete executable spec files the runner (FIX-003) can
 * exec.
 *
 * Output convention:
 *
 *   <worktreePath>/tests/generated/<storyId>/<testCaseId>.spec.ts
 *
 * One spec per test case. The spec opens with a header comment that
 * carries:
 *
 *   - the deterministic content hash of the inputs that produced it
 *   - the test-case id, layer, category, and authoring story id
 *
 * Idempotency: running the generator twice with the same inputs
 * produces byte-identical output. Implementation detail: we hash the
 * (storyId, testCase) tuple with a stable JSON canonicaliser, write
 * the hash into the header, and skip the write if the file already
 * exists with a matching `@hash` line.
 *
 * Layer dispatch:
 *
 *   - `unit`           → vitest `describe / it` template
 *   - `integration`    → vitest with `globals: false` + setup hook
 *   - `e2e`            → Playwright `test()` template
 *   - `visual`         → Playwright `expect(...).toHaveScreenshot()`
 *   - `accessibility`  → Playwright + `@axe-core/playwright`
 *
 * Real LLM-enriched generation lands later in the parallel track. This
 * PR uses deterministic Gherkin → code templates so the generator is
 * fully reproducible (a hard requirement for CI determinism). The
 * templates leave the body of the test as a TODO when no concrete
 * action can be inferred from `given/when/then`; that's intentional
 * — the runner (FIX-003) treats unimplemented bodies as `skipped`,
 * not `failed`, so they don't trigger the fix loop.
 *
 * @owner fix-it-test-agent (Phase 2D worker track)
 */

import { createHash } from 'crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

import type { TestCase } from '@chiefaia/ticket-template';

import type {
  GenerateContext,
  GeneratedSpec,
  TestCodeGenerator,
} from './stubs';

// ─── Hashing helper ─────────────────────────────────────────────────────────

/**
 * Canonical JSON: deterministic key ordering so the hash is stable
 * across Node versions / dependency upgrades.
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    out[k] = canonicalize((value as Record<string, unknown>)[k]);
  }
  return out;
}

export function hashTestCase(testCase: TestCase, storyId: string): string {
  const json = JSON.stringify(canonicalize({ storyId, testCase }));
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface TemplateTestCodeGeneratorOptions {
  /**
   * If `true` (default), the generator skips the write when the
   * existing file's `@hash` matches the new hash. Set `false` to
   * always rewrite (e.g. when tests want to assert behaviour).
   */
  idempotent?: boolean;
}

/**
 * Real implementation of `TestCodeGenerator`. Replaces the FIX-001
 * stub; consumed by `FixItOrchestrator` via the `generator` port.
 */
export class TemplateTestCodeGenerator implements TestCodeGenerator {
  private readonly idempotent: boolean;

  constructor(opts: TemplateTestCodeGeneratorOptions = {}) {
    this.idempotent = opts.idempotent ?? true;
  }

  async generate(
    testCase: TestCase,
    ctx: GenerateContext,
  ): Promise<GeneratedSpec> {
    const hash = hashTestCase(testCase, ctx.storyId);
    const specPath = specPathFor(ctx, testCase);

    if (this.idempotent && existingHashMatches(specPath, hash)) {
      return { testCaseId: testCase.id, specPath, contentHash: hash };
    }

    const body = renderSpec(testCase, ctx, hash);
    mkdirSync(dirname(specPath), { recursive: true });
    writeFileSync(specPath, body, { encoding: 'utf8' });

    return { testCaseId: testCase.id, specPath, contentHash: hash };
  }
}

// IDs are written into a filesystem path (`<storyId>/<testCaseId>.spec.ts`).
// Reject anything outside the safe charset so a malformed ticket payload
// cannot escape the worktree via `..` or absolute-path components.
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

function assertSafePathSegment(value: string, label: string): void {
  if (!SAFE_ID.test(value) || value === '.' || value === '..') {
    throw new Error(
      `[fix-it] refusing to build spec path: ${label} ${JSON.stringify(value)} contains unsafe characters`,
    );
  }
}

export function specPathFor(
  ctx: GenerateContext,
  testCase: TestCase,
): string {
  assertSafePathSegment(ctx.storyId, 'storyId');
  assertSafePathSegment(testCase.id, 'testCase.id');
  // ctx.worktreePath is an orchestrator-controlled absolute path; the
  // segments above are the only attacker-reachable input. Single-line
  // form keeps the nosemgrep annotation co-located with the join call.
  // eslint-disable-next-line max-len
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  return join(ctx.worktreePath, 'tests', 'generated', ctx.storyId, `${testCase.id}.spec.ts`);
}

function existingHashMatches(path: string, hash: string): boolean {
  try {
    statSync(path);
  } catch {
    return false;
  }
  try {
    const head = readFileSync(path, { encoding: 'utf8' }).slice(0, 1024);
    return head.includes(`@hash ${hash}`);
  } catch {
    return false;
  }
}

// ─── Layer templates ────────────────────────────────────────────────────────

export function renderSpec(
  testCase: TestCase,
  ctx: GenerateContext,
  hash: string,
): string {
  const header = renderHeader(testCase, ctx, hash);
  switch (testCase.layer) {
    case 'unit':
      return header + renderUnit(testCase);
    case 'integration':
      return header + renderIntegration(testCase);
    case 'e2e':
      return header + renderE2e(testCase);
    case 'visual':
      return header + renderVisual(testCase);
    case 'accessibility':
      return header + renderAccessibility(testCase);
    default: {
      const _exhaustive: never = testCase.layer;
      void _exhaustive;
      return header + renderUnit(testCase);
    }
  }
}

function renderHeader(
  testCase: TestCase,
  ctx: GenerateContext,
  hash: string,
): string {
  return [
    '/**',
    ' * AUTO-GENERATED — DO NOT EDIT.',
    ' *',
    ' * Generated by @caia-app/worker-fix-it / TemplateTestCodeGenerator.',
    ` * @story ${ctx.storyId}`,
    ` * @testCase ${testCase.id}`,
    ` * @layer ${testCase.layer}`,
    ` * @category ${testCase.category}`,
    ` * @hash ${hash}`,
    ' *',
    ' * If you need to change the assertion logic, edit the test_case in',
    ' * the source ticket and regenerate. Hand-edits will be overwritten',
    ' * by the next Fix-It Test Agent run.',
    ' */',
    '',
  ].join('\n');
}

function renderGherkinComment(testCase: TestCase): string {
  return [
    '// Given:',
    `//   ${escapeForComment(testCase.given)}`,
    '// When:',
    `//   ${escapeForComment(testCase.when)}`,
    '// Then:',
    `//   ${escapeForComment(testCase.then)}`,
    '',
  ].join('\n');
}

function renderUnit(testCase: TestCase): string {
  return [
    "import { describe, it, expect } from 'vitest';",
    '',
    renderGherkinComment(testCase),
    `describe(${stringLit(testCase.title)}, () => {`,
    `  it(${stringLit('then ' + testCase.then)}, () => {`,
    '    // FIX-002: deterministic template body. Replaced with',
    '    // LLM-enriched concrete code in a follow-up enrichment PR.',
    "    expect.fail('test body not yet implemented for ' + " +
      stringLit(testCase.id) +
      ');',
    '  });',
    '});',
    '',
  ].join('\n');
}

function renderIntegration(testCase: TestCase): string {
  return [
    "import { beforeAll, afterAll, describe, it, expect } from 'vitest';",
    '',
    renderGherkinComment(testCase),
    `describe(${stringLit(testCase.title)}, () => {`,
    '  beforeAll(async () => {',
    '    // setup external resources here (db, fixtures, ports)',
    '  });',
    '  afterAll(async () => {',
    '    // teardown',
    '  });',
    `  it(${stringLit('then ' + testCase.then)}, async () => {`,
    "    expect.fail('integration body not yet implemented for ' + " +
      stringLit(testCase.id) +
      ');',
    '  });',
    '});',
    '',
  ].join('\n');
}

function renderE2e(testCase: TestCase): string {
  return [
    "import { test, expect } from '@playwright/test';",
    '',
    renderGherkinComment(testCase),
    `test(${stringLit(testCase.title)}, async ({ page }) => {`,
    '  await page.goto(process.env.E2E_BASE_URL ?? "http://localhost:3000");',
    ...renderSelectorHints(testCase),
    "  await expect(page).toHaveURL(/.+/);  // placeholder assertion — replace via fix loop",
    '});',
    '',
  ].join('\n');
}

function renderVisual(testCase: TestCase): string {
  return [
    "import { test, expect } from '@playwright/test';",
    '',
    renderGherkinComment(testCase),
    `test(${stringLit(testCase.title)}, async ({ page }) => {`,
    '  await page.goto(process.env.E2E_BASE_URL ?? "http://localhost:3000");',
    ...renderSelectorHints(testCase),
    `  await expect(page).toHaveScreenshot(${stringLit(testCase.id + '.png')});`,
    '});',
    '',
  ].join('\n');
}

function renderAccessibility(testCase: TestCase): string {
  return [
    "import { test, expect } from '@playwright/test';",
    "import AxeBuilder from '@axe-core/playwright';",
    '',
    renderGherkinComment(testCase),
    `test(${stringLit(testCase.title)}, async ({ page }) => {`,
    '  await page.goto(process.env.E2E_BASE_URL ?? "http://localhost:3000");',
    ...renderSelectorHints(testCase),
    '  const results = await new AxeBuilder({ page }).analyze();',
    '  expect(results.violations).toEqual([]);',
    '});',
    '',
  ].join('\n');
}

function renderSelectorHints(testCase: TestCase): string[] {
  if (!testCase.selectorHints || testCase.selectorHints.length === 0) {
    return [];
  }
  const lines: string[] = [
    '  // selectorHints from BA UI section:',
  ];
  for (const sel of testCase.selectorHints) {
    lines.push(`  // ${sel}`);
  }
  return lines;
}

function escapeForComment(s: string): string {
  return s.replace(/\*\//g, '* /').replace(/\n/g, ' ');
}

function stringLit(s: string): string {
  return JSON.stringify(s);
}
