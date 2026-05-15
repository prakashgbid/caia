import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import type { spawn as nodeSpawn } from 'node:child_process';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildPrompt,
  createDefaultLlmReviewer,
  noopLlmReviewer,
  parseLlmOutput
} from '../src/llm-reasoner.js';
import type { DiffHunk, LlmReviewInput } from '../src/types.js';

/**
 * Fake-child helper — produces a `node:child_process.ChildProcess`-shaped
 * mock compatible with `@chiefaia/claude-spawner`'s `spawnFn` test seam.
 * Emits stdout/stderr after listeners attach (setImmediate), then `close`.
 */
function makeFakeSpawnFn(opts: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  errorBeforeClose?: Error;
  envSpy?: (env: NodeJS.ProcessEnv) => void;
}): typeof nodeSpawn {
  return ((
    _cmd: string,
    _args: readonly string[],
    spawnOpts?: { env?: NodeJS.ProcessEnv },
  ): unknown => {
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

const sampleHunk: DiffHunk = {
  file: 'src/foo.ts',
  oldStart: 1,
  newStart: 1,
  header: '@@ -1,2 +1,2 @@',
  body: '-let x = null;\n+let x: string | null = null;',
  status: 'modified'
};

const sampleInput: LlmReviewInput = {
  hunks: [sampleHunk],
  conventionExcerpts: [],
  pr: {
    prNumber: 42,
    branch: 'feat/x',
    baseBranch: 'develop',
    title: 'Fix nullable',
    commitSubjects: []
  }
};

describe('buildPrompt', () => {
  it('embeds the system instructions', () => {
    const p = buildPrompt(sampleInput);
    expect(p).toContain('CORRECTNESS, BUGS');
    expect(p).toContain('STAY IN YOUR LANE');
  });

  it('includes the dimensions block', () => {
    const p = buildPrompt(sampleInput);
    expect(p).toContain('correctness:');
    expect(p).toContain('bug-risk:');
    expect(p).toContain('test-coverage:');
  });

  it('includes the diff hunks', () => {
    const p = buildPrompt(sampleInput);
    expect(p).toContain('src/foo.ts');
    expect(p).toContain('let x: string | null');
  });

  it('falls back to default when no conventions', () => {
    const p = buildPrompt(sampleInput);
    expect(p).toContain('(none — fall back to general TS / Node best practices)');
  });

  it('embeds convention excerpts when present', () => {
    const p = buildPrompt({
      ...sampleInput,
      conventionExcerpts: [{ source: 'A.md', heading: 'Code style', bodyExcerpt: 'use 2 spaces' }]
    });
    expect(p).toContain('Code style');
    expect(p).toContain('use 2 spaces');
  });
});

describe('parseLlmOutput', () => {
  it('parses well-formed output', () => {
    const stdout = JSON.stringify({
      result: JSON.stringify({
        findings: [
          {
            dimension: 'correctness',
            severity: 'high',
            file: 'src/foo.ts',
            line: 10,
            issueTitle: 'null-deref',
            description: 'risk of null deref',
            excerpt: 'foo.bar()'
          }
        ]
      })
    });
    const out = parseLlmOutput(stdout);
    expect(out.ok).toBe(true);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].dimension).toBe('correctness');
    expect(out.findings[0].severity).toBe('high');
  });

  it('reports a parse error on bad outer JSON', () => {
    const out = parseLlmOutput('not json');
    expect(out.ok).toBe(false);
    expect(out.diagnostic).toContain('outer JSON parse');
  });

  it('reports envelope missing result', () => {
    const out = parseLlmOutput(JSON.stringify({ no_result: true }));
    expect(out.ok).toBe(false);
    expect(out.diagnostic).toContain('result');
  });

  it('reports inner parse error', () => {
    const stdout = JSON.stringify({ result: '{not valid}' });
    const out = parseLlmOutput(stdout);
    expect(out.ok).toBe(false);
  });

  it('drops findings on Critic denylist', () => {
    const stdout = JSON.stringify({
      result: JSON.stringify({
        findings: [
          { dimension: 'security-regression', severity: 'high', file: 'a.ts', line: 1, issueTitle: 't', description: 'x' },
          { dimension: 'correctness', severity: 'high', file: 'a.ts', line: 1, issueTitle: 't', description: 'x' }
        ]
      })
    });
    const out = parseLlmOutput(stdout);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].dimension).toBe('correctness');
  });

  it('drops findings on advisory Reviewer denylist', () => {
    const stdout = JSON.stringify({
      result: JSON.stringify({
        findings: [
          { dimension: 'idiom-adherence', severity: 'medium', file: 'a.ts', line: 1, issueTitle: 't', description: 'x' }
        ]
      })
    });
    const out = parseLlmOutput(stdout);
    expect(out.findings).toHaveLength(0);
  });

  it('drops findings with unknown dimension', () => {
    const stdout = JSON.stringify({
      result: JSON.stringify({
        findings: [
          { dimension: 'totally-made-up', severity: 'high', file: 'a.ts', line: 1, issueTitle: 't', description: 'x' }
        ]
      })
    });
    const out = parseLlmOutput(stdout);
    expect(out.findings).toHaveLength(0);
  });

  it('drops findings without file or description', () => {
    const stdout = JSON.stringify({
      result: JSON.stringify({
        findings: [
          { dimension: 'correctness', severity: 'high', file: '', line: 1, issueTitle: 't', description: 'x' },
          { dimension: 'correctness', severity: 'high', file: 'a.ts', line: 1, issueTitle: 't', description: '' }
        ]
      })
    });
    const out = parseLlmOutput(stdout);
    expect(out.findings).toHaveLength(0);
  });

  it('uses default severity when invalid', () => {
    const stdout = JSON.stringify({
      result: JSON.stringify({
        findings: [
          { dimension: 'correctness', severity: 'banana', file: 'a.ts', line: 1, issueTitle: 't', description: 'x' }
        ]
      })
    });
    const out = parseLlmOutput(stdout);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].severity).toBe('high'); // default for correctness
  });

  it('caps style severity at default ceiling', () => {
    const stdout = JSON.stringify({
      result: JSON.stringify({
        findings: [
          { dimension: 'style', severity: 'critical', file: 'a.ts', line: 1, issueTitle: 't', description: 'x' }
        ]
      })
    });
    const out = parseLlmOutput(stdout);
    expect(out.findings[0].severity).toBe('low'); // capped at default for style
  });

  it('allows correctness to promote to critical', () => {
    const stdout = JSON.stringify({
      result: JSON.stringify({
        findings: [
          { dimension: 'correctness', severity: 'critical', file: 'a.ts', line: 1, issueTitle: 't', description: 'x' }
        ]
      })
    });
    const out = parseLlmOutput(stdout);
    expect(out.findings[0].severity).toBe('critical');
  });

  it('returns empty findings when array missing', () => {
    const stdout = JSON.stringify({ result: JSON.stringify({}) });
    const out = parseLlmOutput(stdout);
    expect(out.ok).toBe(true);
    expect(out.findings).toHaveLength(0);
  });

  it('extracts JSON from prose-wrapped result', () => {
    const stdout = JSON.stringify({
      result: 'Here is the analysis: {"findings":[{"dimension":"correctness","severity":"medium","file":"a.ts","line":1,"issueTitle":"t","description":"x"}]} done.'
    });
    const out = parseLlmOutput(stdout);
    expect(out.findings).toHaveLength(1);
  });
});

describe('createDefaultLlmReviewer (subscription-only)', () => {
  it('strips ANTHROPIC_API_KEY from spawn env', async () => {
    let capturedEnv: NodeJS.ProcessEnv = {};
    const fakeSpawn = makeFakeSpawnFn({
      stdout: JSON.stringify({ result: JSON.stringify({ findings: [] }) }),
      exitCode: 0,
      envSpy: (env) => { capturedEnv = env; }
    });
    process.env['ANTHROPIC_API_KEY'] = 'sk-ant-api03-fake';
    try {
      const llm = createDefaultLlmReviewer({
        binaryPath: 'claude',
        modelTag: 'claude-haiku-4-5-20251001',
        timeoutMs: 1000,
        spawnFn: fakeSpawn
      });
      await llm.review(sampleInput);
      expect('ANTHROPIC_API_KEY' in capturedEnv).toBe(false);
    } finally {
      delete process.env['ANTHROPIC_API_KEY'];
    }
  });

  it('returns ok:false on spawn error', async () => {
    const fakeSpawn = makeFakeSpawnFn({ errorBeforeClose: new Error('ENOENT') });
    const llm = createDefaultLlmReviewer({
      binaryPath: 'nonexistent',
      modelTag: 'm',
      timeoutMs: 100,
      spawnFn: fakeSpawn
    });
    const out = await llm.review(sampleInput);
    expect(out.ok).toBe(false);
    expect(out.diagnostic).toContain('ENOENT');
  });

  it('returns ok:false on non-zero exit', async () => {
    const fakeSpawn = makeFakeSpawnFn({ stderr: 'rate-limited', exitCode: 1 });
    const llm = createDefaultLlmReviewer({
      binaryPath: 'claude',
      modelTag: 'm',
      timeoutMs: 100,
      spawnFn: fakeSpawn
    });
    const out = await llm.review(sampleInput);
    expect(out.ok).toBe(false);
    expect(out.diagnostic).toContain('exited');
  });

  it('parses successful spawn output', async () => {
    const fakeSpawn = makeFakeSpawnFn({
      stdout: JSON.stringify({
        result: JSON.stringify({
          findings: [
            { dimension: 'bug-risk', severity: 'high', file: 'a.ts', line: 1, issueTitle: 'race', description: 'shared state' }
          ]
        })
      }),
      exitCode: 0
    });
    const llm = createDefaultLlmReviewer({
      binaryPath: 'claude',
      modelTag: 'm',
      timeoutMs: 100,
      spawnFn: fakeSpawn
    });
    const out = await llm.review(sampleInput);
    expect(out.ok).toBe(true);
    expect(out.findings).toHaveLength(1);
  });
});

describe('noopLlmReviewer', () => {
  it('returns empty findings', async () => {
    const out = await noopLlmReviewer.review(sampleInput);
    expect(out.ok).toBe(true);
    expect(out.findings).toHaveLength(0);
  });
});

describe('A.9.13 — small-diff local-router shortcut (code-reviewer)', () => {
  const LARGE_HUNK: DiffHunk = {
    file: 'src/big.ts',
    oldStart: 1,
    newStart: 1,
    header: '@@ -1,500 +1,500 @@',
    body: Array.from({ length: 250 }, (_, i) => `+ line ${i}`).join('\n'),
    status: 'modified',
  };
  const largeInput: LlmReviewInput = { ...sampleInput, hunks: [LARGE_HUNK] };

  function spawnSpy(): { fn: typeof nodeSpawn; called: () => boolean } {
    let called = false;
    const fn = ((
      cmd: string,
      args: readonly string[],
      opts?: { env?: NodeJS.ProcessEnv },
    ): unknown => {
      called = true;
      const real = makeFakeSpawnFn({
        stdout: JSON.stringify({ result: JSON.stringify({ findings: [] }) }),
        exitCode: 0,
      });
      return (real as unknown as (a: string, b: readonly string[], c: typeof opts) => unknown)(cmd, args, opts);
    }) as unknown as typeof nodeSpawn;
    return { fn, called: () => called };
  }

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
    const spy = spawnSpy();
    const llm = createDefaultLlmReviewer({
      binaryPath: 'claude', modelTag: 'm', timeoutMs: 1000,
      spawnFn: spy.fn,
    });
    await llm.review(sampleInput);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(spy.called()).toBe(true);
  });

  it('routes small diff to the router when CAIA_REVIEW_LOCAL_FIRST=1', async () => {
    process.env['CAIA_REVIEW_LOCAL_FIRST'] = '1';
    const fetchSpy = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ findings: [] }) } }] }),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const spy = spawnSpy();
    const llm = createDefaultLlmReviewer({
      binaryPath: 'claude', modelTag: 'm', timeoutMs: 1000,
      spawnFn: spy.fn,
    });
    await llm.review(sampleInput);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(spy.called()).toBe(false);
  });

  it('falls through to claude when diff > 200 lines', async () => {
    process.env['CAIA_REVIEW_LOCAL_FIRST'] = '1';
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const spy = spawnSpy();
    const llm = createDefaultLlmReviewer({
      binaryPath: 'claude', modelTag: 'm', timeoutMs: 1000,
      spawnFn: spy.fn,
    });
    await llm.review(largeInput);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(spy.called()).toBe(true);
  });

  it('falls through to claude when router 5xx', async () => {
    process.env['CAIA_REVIEW_LOCAL_FIRST'] = '1';
    const fetchSpy = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }));
    vi.stubGlobal('fetch', fetchSpy);
    const spy = spawnSpy();
    const llm = createDefaultLlmReviewer({
      binaryPath: 'claude', modelTag: 'm', timeoutMs: 1000,
      spawnFn: spy.fn,
    });
    await llm.review(sampleInput);
    expect(fetchSpy).toHaveBeenCalled();
    expect(spy.called()).toBe(true);
  });
});
