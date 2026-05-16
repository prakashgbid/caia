import { describe, expect, it } from 'vitest';
import { renderVerificationComment } from '../../src/pr/comment.js';
import { COMMENT_MARKER } from '../../src/pr/types.js';

describe('renderVerificationComment', () => {
  const baseArgs = {
    pr: { number: 542, headRefOid: 'abcdef1234567890' },
    targetPackages: ['@chiefaia/guardrails-validator'],
    consumerPackages: ['@chiefaia/orchestrator'],
    worktreeDir: '/tmp/adopt-verify-abcdef12',
    startedAt: '2026-05-16T20:00:00Z',
    finishedAt: '2026-05-16T20:05:00Z',
  };

  it('embeds the upsert marker on PASS', () => {
    const body = renderVerificationComment({
      ...baseArgs,
      result: {
        pass: true,
        durationMs: 300_000,
        checks: [
          { id: 'V1', label: 'typecheck', command: 'pnpm typecheck', status: 'pass', exitCode: 0, durationMs: 1000, stdoutTail: '', stderrTail: '' },
          { id: 'V2', label: 'tests',     command: 'pnpm test',      status: 'pass', exitCode: 0, durationMs: 2000, stdoutTail: '', stderrTail: '' },
          { id: 'V3', label: 'build',     command: 'pnpm build',     status: 'pass', exitCode: 0, durationMs: 3000, stdoutTail: '', stderrTail: '' },
        ],
      },
    });
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain('Adoption verification — PASS');
    expect(body).toContain('| V1 | typecheck |');
    expect(body).toContain('@chiefaia/orchestrator');
  });

  it('includes failure details on FAIL', () => {
    const body = renderVerificationComment({
      ...baseArgs,
      result: {
        pass: false,
        durationMs: 60_000,
        checks: [
          { id: 'V1', label: 'typecheck', command: 'pnpm typecheck', status: 'fail', exitCode: 1, durationMs: 1000, stdoutTail: 'last stdout', stderrTail: 'TS2304: Cannot find name "doTheThing"' },
          { id: 'V2', label: 'tests',     command: '(skipped)',      status: 'skipped', exitCode: null, durationMs: 0, stdoutTail: '', stderrTail: '' },
          { id: 'V3', label: 'build',     command: '(skipped)',      status: 'skipped', exitCode: null, durationMs: 0, stdoutTail: '', stderrTail: '' },
        ],
      },
    });
    expect(body).toContain('Adoption verification — FAIL');
    expect(body).toContain('TS2304');
    expect(body).toContain('### V1 typecheck — fail');
    expect(body).toContain('<details><summary>stderr (tail)');
  });

  it('renders setup errors when supplied', () => {
    const body = renderVerificationComment({
      ...baseArgs,
      setupErrors: ['pnpm install exit 1: cold-store EPERM'],
      result: { pass: false, durationMs: 0, checks: [] },
    });
    expect(body).toContain('### Setup errors');
    expect(body).toContain('pnpm install exit 1');
  });
});
