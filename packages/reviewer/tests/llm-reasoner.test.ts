import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import type { spawn as nodeSpawn } from 'node:child_process';

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildPrompt, parseLlmOutput, createDefaultLlmReviewer } from '../src/llm-reasoner.js';
import type { LlmReviewInput } from '../src/types.js';

/** Fake-child for `@chiefaia/claude-spawner`'s `spawnFn` test seam. */
function makeFakeSpawnFn(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  errorBeforeClose?: Error;
  envSpy?: (env: NodeJS.ProcessEnv) => void;
  onSpawn?: () => void;
}): typeof nodeSpawn {
  return ((
    _cmd: string,
    _args: readonly string[],
    spawnOpts?: { env?: NodeJS.ProcessEnv },
  ): unknown => {
    opts.onSpawn?.();
    if (spawnOpts?.env !== undefined) opts.envSpy?.(spawnOpts.env);
    const ee = new EventEmitter() as EventEmitter & {
      stdin: Writable;
      stdout: Readable;
      stderr: Readable;
      kill: () => boolean;
    };
    ee.stdin = new Writable({ write(_c, _e, cb): void { cb(); } });
    ee.stdout = new Readable({ read(): void {} });
    ee.stderr = new Readable({ read(): void {} });
    ee.kill = (): boolean => true;
    setImmediate(() => {
      if (opts.stdout !== undefined) ee.stdout.emit('data', Buffer.from(opts.stdout, 'utf8'));
      if (opts.stderr !== undefined) ee.stderr.emit('data', Buffer.from(opts.stderr, 'utf8'));
      if (opts.errorBeforeClose !== undefined) ee.emit('error', opts.errorBeforeClose);
      else ee.emit('close', opts.exitCode ?? 0);
    });
    return ee;
  }) as unknown as typeof nodeSpawn;
}

describe('buildPrompt', () => {
  it('includes dimensions, conventions, and hunks', () => {
    const input: LlmReviewInput = {
      hunks: [{
        file: 'a.ts', oldStart: 1, newStart: 1,
        header: '@@', body: '+x', status: 'added'
      }],
      conventionExcerpts: [{ source: 'AGENTS.md', heading: 'Code style', bodyExcerpt: 'no any' }],
      pr: { prNumber: 7, branch: 'b', baseBranch: 'develop', title: 't', commitSubjects: [] }
    };
    const p = buildPrompt(input);
    expect(p).toContain('naming-convention');
    expect(p).toContain('Code style');
    expect(p).toContain('a.ts');
    expect(p).toContain('prNumber: 7');
    expect(p).toContain('CRITICAL: do NOT flag');
  });

  it('falls back to message when no conventions', () => {
    const input: LlmReviewInput = {
      hunks: [],
      conventionExcerpts: [],
      pr: { prNumber: 1, branch: 'b', baseBranch: 'develop', title: 't', commitSubjects: [] }
    };
    const p = buildPrompt(input);
    expect(p).toContain('(none —');
  });
});

describe('parseLlmOutput', () => {
  const wrap = (inner: string): string => JSON.stringify({ result: inner });

  it('returns ok=false for non-JSON', () => {
    const out = parseLlmOutput('not json');
    expect(out.ok).toBe(false);
  });

  it('returns ok=false when envelope missing result', () => {
    const out = parseLlmOutput(JSON.stringify({ wrong: 'shape' }));
    expect(out.ok).toBe(false);
  });

  it('returns ok=true with empty findings when none', () => {
    const out = parseLlmOutput(wrap('{"findings":[]}'));
    expect(out.ok).toBe(true);
    expect(out.findings).toHaveLength(0);
  });

  it('parses a valid finding', () => {
    const inner = '{"findings":[{"dimension":"naming-convention","severity":"nit","file":"a.ts","line":3,"suggestionTitle":"x","description":"y","excerpt":"z"}]}';
    const out = parseLlmOutput(wrap(inner));
    expect(out.ok).toBe(true);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]?.dimension).toBe('naming-convention');
  });

  it('drops findings with Critic-denylist dimension', () => {
    const inner = '{"findings":[{"dimension":"security-regression","severity":"consider","file":"a.ts","line":1,"suggestionTitle":"x","description":"y"}]}';
    const out = parseLlmOutput(wrap(inner));
    expect(out.findings).toHaveLength(0);
  });

  it('extracts inner JSON from prose-wrapped result', () => {
    const inner = 'Here is the JSON: {"findings":[]} thanks';
    const out = parseLlmOutput(wrap(inner));
    expect(out.ok).toBe(true);
  });

  it('caps invented severities at the dimension default', () => {
    const inner = '{"findings":[{"dimension":"naming-convention","severity":"consider","file":"a.ts","line":1,"suggestionTitle":"x","description":"y"}]}';
    const out = parseLlmOutput(wrap(inner));
    // naming-convention default is 'nit'; LLM tried to bump to 'consider' — clamped.
    expect(out.findings[0]?.severity).toBe('nit');
  });
});

describe('createDefaultLlmReviewer (with spawnFn seam)', () => {
  it('returns ok=false on non-zero exit', async () => {
    const reviewer = createDefaultLlmReviewer({
      binaryPath: 'claude', modelTag: 'm', timeoutMs: 1000,
      spawnFn: makeFakeSpawnFn({ stderr: 'oops', exitCode: 1 })
    });
    const out = await reviewer.review({
      hunks: [], conventionExcerpts: [],
      pr: { prNumber: 1, branch: 'b', baseBranch: 'develop', title: 't', commitSubjects: [] }
    });
    expect(out.ok).toBe(false);
    expect(out.diagnostic).toContain('exited');
    expect(out.diagnostic).toContain('1');
  });

  it('deletes ANTHROPIC_API_KEY from spawned env', async () => {
    let capturedEnv: NodeJS.ProcessEnv | null = null;
    const reviewer = createDefaultLlmReviewer({
      binaryPath: 'claude', modelTag: 'm', timeoutMs: 1000,
      spawnFn: makeFakeSpawnFn({
        stdout: JSON.stringify({ result: '{"findings":[]}' }),
        exitCode: 0,
        envSpy: (env) => { capturedEnv = env; }
      })
    });
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    try {
      await reviewer.review({
        hunks: [], conventionExcerpts: [],
        pr: { prNumber: 1, branch: 'b', baseBranch: 'develop', title: 't', commitSubjects: [] }
      });
    } finally {
      delete process.env['ANTHROPIC_API_KEY'];
    }
    expect(capturedEnv).not.toBeNull();
    expect((capturedEnv as NodeJS.ProcessEnv | null)?.['ANTHROPIC_API_KEY']).toBeUndefined();
  });
});

describe('A.9.13 — small-diff local-router shortcut (reviewer)', () => {
  const smallInput: LlmReviewInput = {
    hunks: [{
      file: 'a.ts', oldStart: 1, newStart: 1,
      header: '@@ -1,3 +1,4 @@',
      body: '+x\n+y\n-z',
      status: 'modified',
    }],
    conventionExcerpts: [],
    pr: { prNumber: 1, branch: 'b', baseBranch: 'develop', title: 't', commitSubjects: [] },
  };
  const largeInput: LlmReviewInput = {
    hunks: [{
      file: 'big.ts', oldStart: 1, newStart: 1,
      header: '@@ -1,500 +1,500 @@',
      body: Array.from({ length: 250 }, (_, i) => `+line ${i}`).join('\n'),
      status: 'modified',
    }],
    conventionExcerpts: [],
    pr: { prNumber: 1, branch: 'b', baseBranch: 'develop', title: 't', commitSubjects: [] },
  };

  beforeEach(() => {
    delete process.env['CAIA_REVIEW_LOCAL_FIRST'];
    delete process.env['CAIA_REVIEW_LOCAL_DIFF_LINES_MAX'];
    delete process.env['CAIA_REVIEW_LOCAL_MODEL'];
    delete process.env['CAIA_REVIEW_LOCAL_TIMEOUT_MS'];
    delete process.env['ROUTER_BASE_URL'];
    vi.unstubAllGlobals();
  });

  it('default: does NOT call the router (env flag unset)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    let spawned = false;
    const reviewer = createDefaultLlmReviewer({
      binaryPath: 'claude', modelTag: 'm', timeoutMs: 1000,
      spawnFn: makeFakeSpawnFn({
        stdout: JSON.stringify({ result: '{"findings":[]}' }),
        exitCode: 0,
        onSpawn: () => { spawned = true; }
      }),
    });
    await reviewer.review(smallInput);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(spawned).toBe(true);
  });

  it('routes small diff to the router when CAIA_REVIEW_LOCAL_FIRST=1', async () => {
    process.env['CAIA_REVIEW_LOCAL_FIRST'] = '1';
    const fetchSpy = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ findings: [] }) } }] }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    let spawned = false;
    const reviewer = createDefaultLlmReviewer({
      binaryPath: 'claude', modelTag: 'm', timeoutMs: 1000,
      spawnFn: makeFakeSpawnFn({
        stdout: '',
        exitCode: 0,
        onSpawn: () => { spawned = true; }
      }),
    });
    await reviewer.review(smallInput);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(spawned).toBe(false);
  });

  it('falls through to claude when diff > line threshold', async () => {
    process.env['CAIA_REVIEW_LOCAL_FIRST'] = '1';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    let spawned = false;
    const reviewer = createDefaultLlmReviewer({
      binaryPath: 'claude', modelTag: 'm', timeoutMs: 1000,
      spawnFn: makeFakeSpawnFn({
        stdout: JSON.stringify({ result: '{"findings":[]}' }),
        exitCode: 0,
        onSpawn: () => { spawned = true; }
      }),
    });
    await reviewer.review(largeInput);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(spawned).toBe(true);
  });
});
