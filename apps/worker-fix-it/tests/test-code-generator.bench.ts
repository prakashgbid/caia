/**
 * Microbenchmark — FIX-002.
 *
 * The directive's effective per-test-case time budget is ~10s for
 * browser cases. Generator overhead lives inside that budget, so we
 * pin it well below 5 ms per generation. With idempotency on (the
 * default), the second pass should be ~free since we early-return on
 * a hash match.
 *
 * Run: `pnpm --filter @caia-app/worker-fix-it bench`
 */

import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { TemplateTestCodeGenerator } from '../src/test-code-generator';
import type { TestCase } from '@chiefaia/ticket-template';

const ITER = 50;
const FIRST_PASS_BUDGET_MS = 5;
const IDEMPOTENT_PASS_BUDGET_MS = 1;

function makeCase(i: number): TestCase {
  return {
    id: `tc${i}`,
    title: `case ${i}`,
    category: 'happy',
    layer: i % 5 === 0 ? 'e2e' : 'unit',
    given: 'g',
    when: 'w',
    then: 't',
    selectorHints: [],
    mocks: [],
    required: true,
    status: 'pending',
    designedBy: 'testing-agent',
    designedAt: 0,
  };
}

describe('TemplateTestCodeGenerator overhead', () => {
  it(`first pass under ${FIRST_PASS_BUDGET_MS}ms / case`, async () => {
    const ctx = {
      storyId: 'sBench',
      worktreePath: mkdtempSync(join(tmpdir(), 'caia-fix-002-bench-')),
    };
    const gen = new TemplateTestCodeGenerator();
    const start = Date.now();
    for (let i = 0; i < ITER; i++) {
      // eslint-disable-next-line no-await-in-loop
      await gen.generate(makeCase(i), ctx);
    }
    const totalMs = Date.now() - start;
    const perMs = totalMs / ITER;
    // eslint-disable-next-line no-console
    console.log(`[bench] FIX-002 first pass: ${perMs.toFixed(3)}ms/case over ${ITER} cases`);
    expect(perMs).toBeLessThan(FIRST_PASS_BUDGET_MS);
  });

  it(`idempotent second pass under ${IDEMPOTENT_PASS_BUDGET_MS}ms / case`, async () => {
    const ctx = {
      storyId: 'sBench',
      worktreePath: mkdtempSync(join(tmpdir(), 'caia-fix-002-bench-id-')),
    };
    const gen = new TemplateTestCodeGenerator();
    // warm
    for (let i = 0; i < ITER; i++) {
      // eslint-disable-next-line no-await-in-loop
      await gen.generate(makeCase(i), ctx);
    }
    const start = Date.now();
    for (let i = 0; i < ITER; i++) {
      // eslint-disable-next-line no-await-in-loop
      await gen.generate(makeCase(i), ctx);
    }
    const totalMs = Date.now() - start;
    const perMs = totalMs / ITER;
    // eslint-disable-next-line no-console
    console.log(`[bench] FIX-002 idempotent pass: ${perMs.toFixed(3)}ms/case over ${ITER} cases`);
    expect(perMs).toBeLessThan(IDEMPOTENT_PASS_BUDGET_MS);
  });
});
