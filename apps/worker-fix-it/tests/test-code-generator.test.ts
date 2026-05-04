/**
 * `TemplateTestCodeGenerator` — FIX-002 contract tests.
 *
 * Three properties we must hold:
 *
 *   1. one spec per test case
 *   2. byte-identical output across two consecutive `generate()` calls
 *      with the same inputs (idempotency contract)
 *   3. layer dispatch — every layer of @chiefaia/ticket-template's
 *      TestCaseLayer enum produces a runnable spec with the right
 *      imports + scaffolding
 */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  TemplateTestCodeGenerator,
  hashTestCase,
  renderSpec,
  specPathFor,
} from '../src/test-code-generator';
import type { TestCase, TestCaseLayer } from '@chiefaia/ticket-template';

function makeCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: 'tc1',
    title: 'Login redirects to dashboard',
    category: 'happy',
    layer: 'unit',
    given: 'a user is on /login',
    when: 'they submit valid credentials',
    then: 'they land on /dashboard',
    selectorHints: [],
    mocks: [],
    required: true,
    status: 'pending',
    designedBy: 'testing-agent',
    designedAt: 0,
    ...overrides,
  };
}

function makeCtx(): { storyId: string; worktreePath: string } {
  return {
    storyId: 'story_1',
    worktreePath: mkdtempSync(join(tmpdir(), 'caia-fix-002-')),
  };
}

describe('TemplateTestCodeGenerator', () => {
  it('writes one spec file per test case at the canonical path', async () => {
    const ctx = makeCtx();
    const tc = makeCase({ id: 'tc-alpha' });
    const gen = new TemplateTestCodeGenerator();

    const result = await gen.generate(tc, ctx);

    expect(result.testCaseId).toBe('tc-alpha');
    expect(result.specPath).toBe(specPathFor(ctx, tc));
    expect(existsSync(result.specPath)).toBe(true);
    const body = readFileSync(result.specPath, 'utf8');
    expect(body).toContain('@testCase tc-alpha');
    expect(body).toContain('@hash');
  });

  it('is idempotent — same inputs produce byte-identical output', async () => {
    const ctx = makeCtx();
    const tc = makeCase({ id: 'tc-id' });
    const gen = new TemplateTestCodeGenerator();

    await gen.generate(tc, ctx);
    const firstBody = readFileSync(specPathFor(ctx, tc), 'utf8');
    const firstStat = require('fs').statSync(specPathFor(ctx, tc));

    // wait a hair so mtime would differ if file were rewritten
    await new Promise((r) => setTimeout(r, 25));

    const result2 = await gen.generate(tc, ctx);
    const secondBody = readFileSync(specPathFor(ctx, tc), 'utf8');
    const secondStat = require('fs').statSync(specPathFor(ctx, tc));

    expect(secondBody).toBe(firstBody);
    expect(result2.contentHash).toBe(hashTestCase(tc, ctx.storyId));
    // mtime should be unchanged because the file was not rewritten
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
  });

  it('rewrites when an existing file has a stale hash', async () => {
    const ctx = makeCtx();
    const tc = makeCase();
    const gen = new TemplateTestCodeGenerator();

    // Pre-populate the target with content that has an OLD hash
    const path = specPathFor(ctx, tc);
    require('fs').mkdirSync(require('path').dirname(path), { recursive: true });
    writeFileSync(path, '/** @hash old-hash-value */\nold content\n', 'utf8');

    await gen.generate(tc, ctx);
    const body = readFileSync(path, 'utf8');
    expect(body).not.toContain('old content');
    expect(body).toContain('@hash');
    expect(body).toContain('@testCase tc1');
  });

  it('rewrites every call when idempotent=false', async () => {
    const ctx = makeCtx();
    const tc = makeCase();
    const gen = new TemplateTestCodeGenerator({ idempotent: false });

    await gen.generate(tc, ctx);
    const firstStat = require('fs').statSync(specPathFor(ctx, tc));
    await new Promise((r) => setTimeout(r, 25));
    await gen.generate(tc, ctx);
    const secondStat = require('fs').statSync(specPathFor(ctx, tc));
    expect(secondStat.mtimeMs).toBeGreaterThan(firstStat.mtimeMs);
  });

  it('changes the hash when test case content changes', () => {
    const a = makeCase({ then: 'they land on /dashboard' });
    const b = makeCase({ then: 'they land on /home' });
    expect(hashTestCase(a, 'story_1')).not.toBe(hashTestCase(b, 'story_1'));
  });

  it('changes the hash when storyId changes', () => {
    const tc = makeCase();
    expect(hashTestCase(tc, 'story_1')).not.toBe(hashTestCase(tc, 'story_2'));
  });
});

describe('renderSpec — layer dispatch', () => {
  const ctx = { storyId: 's', worktreePath: '/tmp/x' };

  const layerExpectations: Array<[TestCaseLayer, string[], string[]]> = [
    [
      'unit',
      ["from 'vitest'", 'describe(', 'it('],
      ['playwright', 'AxeBuilder'],
    ],
    [
      'integration',
      ["from 'vitest'", 'beforeAll', 'afterAll'],
      ['playwright', 'page.goto'],
    ],
    [
      'e2e',
      ["from '@playwright/test'", 'test(', 'page.goto'],
      ['vitest', 'AxeBuilder'],
    ],
    [
      'visual',
      ["from '@playwright/test'", 'toHaveScreenshot'],
      ['vitest', 'AxeBuilder'],
    ],
    [
      'accessibility',
      ["from '@axe-core/playwright'", 'AxeBuilder', 'violations'],
      ['vitest'],
    ],
  ];

  for (const [layer, mustInclude, mustNotInclude] of layerExpectations) {
    it(`emits a ${layer} spec with the right scaffolding`, () => {
      const tc = makeCase({ id: `tc-${layer}`, layer });
      const body = renderSpec(tc, ctx, hashTestCase(tc, ctx.storyId));
      for (const fragment of mustInclude) {
        expect(body).toContain(fragment);
      }
      for (const fragment of mustNotInclude) {
        expect(body).not.toContain(fragment);
      }
      expect(body).toContain(`@testCase tc-${layer}`);
    });
  }

  it('emits selectorHints as comments when present', () => {
    const tc = makeCase({
      layer: 'e2e',
      selectorHints: ['button#login', '[data-testid="submit"]'],
    });
    const body = renderSpec(tc, { storyId: 's', worktreePath: '/tmp/x' }, 'h');
    expect(body).toContain('selectorHints from BA UI section');
    expect(body).toContain('button#login');
    expect(body).toContain('[data-testid="submit"]');
  });

  it('escapes */ inside Gherkin to prevent comment-block break', () => {
    const tc = makeCase({
      given: 'an end-of-comment marker */ embedded in given',
    });
    const body = renderSpec(tc, ctx, 'h');
    expect(body).not.toContain('an end-of-comment marker */ embedded');
    expect(body).toContain('* /');
  });

  it('escapes newlines inside Gherkin to keep one-line comments', () => {
    const tc = makeCase({ when: 'line one\nline two' });
    const body = renderSpec(tc, ctx, 'h');
    // The newline should be replaced with a space so the comment stays on one line.
    expect(body).not.toContain('line one\nline two');
    expect(body).toContain('line one line two');
  });
});
