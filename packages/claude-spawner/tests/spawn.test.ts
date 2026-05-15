import { spawn as realSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  buildSpawnArgs,
  buildSpawnEnv,
  parseClaudeJsonEnvelope,
  SCRUBBED_AUTH_ENV_VARS,
  SpawnClaudeConstraintError,
  spawnClaude,
  type SpawnClaudeInput,
} from '../src/spawn.js';

/**
 * Minimal fake-child fixture. Exposes the API spawnClaude needs:
 *   - stdin (writable, end-able)
 *   - stdout / stderr (readable, emit `data` of Buffer)
 *   - emit `close` with exit code (or `error` with an Error)
 *   - kill() noop (we drive `close` ourselves from the test)
 */
function makeFakeChild(opts: {
  stdoutChunks?: ReadonlyArray<string>;
  stderrChunks?: ReadonlyArray<string>;
  /** Delay before emitting `close` (ms). Set high to test timeout. */
  closeDelayMs?: number;
  exitCode?: number;
  emitErrorBeforeClose?: Error;
}): { ee: EventEmitter; promise: Promise<void> } {
  const ee = new EventEmitter() as EventEmitter & {
    stdin: Writable;
    stdout: Readable;
    stderr: Readable;
    kill: (sig?: NodeJS.Signals) => boolean;
  };
  // stdin: just consume writes silently.
  ee.stdin = new Writable({
    write(_chunk, _enc, cb): void {
      cb();
    },
  });
  ee.stdout = new Readable({
    read(): void {
      /* push-driven below */
    },
  });
  ee.stderr = new Readable({
    read(): void {
      /* push-driven below */
    },
  });
  ee.kill = (): boolean => true;

  // Defer chunk emission so spawnClaude's listeners (attached AFTER
  // spawn() returns) actually receive the data. Using setImmediate
  // queues them after the current microtask flush.
  const stdoutChunks = opts.stdoutChunks ?? [];
  const stderrChunks = opts.stderrChunks ?? [];
  setImmediate(() => {
    for (const c of stdoutChunks) {
      ee.stdout.emit('data', Buffer.from(c, 'utf8'));
    }
    for (const c of stderrChunks) {
      ee.stderr.emit('data', Buffer.from(c, 'utf8'));
    }
  });

  const delay = opts.closeDelayMs ?? 5;
  const promise = new Promise<void>((resolve) => {
    setTimeout(() => {
      if (opts.emitErrorBeforeClose) {
        ee.emit('error', opts.emitErrorBeforeClose);
      } else {
        ee.emit('close', opts.exitCode ?? 0);
      }
      resolve();
    }, delay);
  });

  return { ee, promise };
}

const fakeSpawnFactory = (
  fake: ReturnType<typeof makeFakeChild>,
): typeof realSpawn =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ((..._args: any[]): any => fake.ee) as typeof realSpawn;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildSpawnArgs', () => {
  it('emits the canonical default argv', () => {
    expect(buildSpawnArgs({})).toEqual(['--print', '--output-format', 'json']);
  });

  it('appends --model when set', () => {
    expect(buildSpawnArgs({ model: 'claude-sonnet-4-6' })).toEqual([
      '--print',
      '--output-format',
      'json',
      '--model',
      'claude-sonnet-4-6',
    ]);
  });

  it('appends --permission-mode when set', () => {
    expect(buildSpawnArgs({ permissionMode: 'bypassPermissions' })).toEqual([
      '--print',
      '--output-format',
      'json',
      '--permission-mode',
      'bypassPermissions',
    ]);
  });

  it('respects overrideArgs verbatim', () => {
    expect(buildSpawnArgs({ overrideArgs: ['--version'] })).toEqual(['--version']);
  });

  it('appends extraArgs after defaults', () => {
    expect(buildSpawnArgs({ extraArgs: ['--append-system-prompt', 'foo'] })).toEqual([
      '--print',
      '--output-format',
      'json',
      '--append-system-prompt',
      'foo',
    ]);
  });

  it('honours outputFormat=text', () => {
    expect(buildSpawnArgs({ outputFormat: 'text' })).toEqual(['--print', '--output-format', 'text']);
  });
});

describe('buildSpawnEnv', () => {
  it('scrubs all known auth-token env vars even when callers try to set them via extraEnv', () => {
    const env = buildSpawnEnv(
      { FOO: 'bar', ANTHROPIC_API_KEY: 'pre-existing' },
      { extraEnv: { ANTHROPIC_API_KEY: 'sneaky', OPENAI_API_KEY: 'sneakier', BAR: 'baz' } },
    );
    expect(env['FOO']).toBe('bar');
    expect(env['BAR']).toBe('baz');
    for (const k of SCRUBBED_AUTH_ENV_VARS) {
      expect(env[k]).toBeUndefined();
    }
  });

  it('applies homeOverride after merge', () => {
    const env = buildSpawnEnv({ HOME: '/orig', X: '1' }, { homeOverride: '/custom' });
    expect(env['HOME']).toBe('/custom');
    expect(env['X']).toBe('1');
  });

  it('drops undefined values from base env', () => {
    const env = buildSpawnEnv({ A: 'a', B: undefined } as NodeJS.ProcessEnv, {});
    expect(env['A']).toBe('a');
    expect(env['B']).toBeUndefined();
  });
});

describe('parseClaudeJsonEnvelope', () => {
  it('returns the result text for a healthy envelope', () => {
    const got = parseClaudeJsonEnvelope(
      JSON.stringify({ type: 'result', is_error: false, result: 'hello' }),
    );
    expect(got.ok).toBe(true);
    if (got.ok) {
      expect(got.text).toBe('hello');
    }
  });

  it('flags is_error envelopes as not-ok', () => {
    const got = parseClaudeJsonEnvelope(
      JSON.stringify({ type: 'result', is_error: true, api_error_status: 429 }),
    );
    expect(got.ok).toBe(false);
    if (!got.ok) {
      expect(got.diagnostic).toMatch(/api_error_status=429/);
    }
  });

  it('flags empty stdout', () => {
    const got = parseClaudeJsonEnvelope('');
    expect(got.ok).toBe(false);
  });

  it('flags malformed JSON', () => {
    const got = parseClaudeJsonEnvelope('not-json');
    expect(got.ok).toBe(false);
  });

  it('flags missing result string', () => {
    const got = parseClaudeJsonEnvelope(JSON.stringify({ type: 'result' }));
    expect(got.ok).toBe(false);
  });
});

describe('spawnClaude — happy path', () => {
  it('returns ok=true on rc=0 with stdout text', async () => {
    const fake = makeFakeChild({
      stdoutChunks: [JSON.stringify({ result: 'ok' })],
      exitCode: 0,
    });
    const input: SpawnClaudeInput = {
      prompt: 'hello',
      options: { spawnFn: fakeSpawnFactory(fake) },
    };
    const result = await spawnClaude(input);
    await fake.promise;
    expect(result.ok).toBe(true);
    expect(result.rc).toBe(0);
    expect(result.stdout).toBe(JSON.stringify({ result: 'ok' }));
    expect(result.diagnostic).toBeNull();
  });

  it('writes the prompt to stdin', async () => {
    const writeSpy = vi.fn();
    const fake = makeFakeChild({ exitCode: 0 });
    // Override stdin.write so we can capture the prompt.
    fake.ee.stdin = new Writable({
      write(chunk, _enc, cb): void {
        writeSpy(chunk.toString());
        cb();
      },
    });
    await spawnClaude({
      prompt: 'my-prompt',
      options: { spawnFn: fakeSpawnFactory(fake) },
    });
    await fake.promise;
    expect(writeSpy).toHaveBeenCalledWith('my-prompt');
  });
});

describe('spawnClaude — failure modes', () => {
  it('returns ok=false on non-zero exit', async () => {
    const fake = makeFakeChild({
      exitCode: 1,
      stderrChunks: ['something failed'],
    });
    const result = await spawnClaude({
      prompt: 'p',
      options: { spawnFn: fakeSpawnFactory(fake) },
    });
    await fake.promise;
    expect(result.ok).toBe(false);
    expect(result.rc).toBe(1);
    expect(result.diagnostic).toMatch(/exited with code 1/);
  });

  it('returns ok=false on child error event', async () => {
    const fake = makeFakeChild({
      emitErrorBeforeClose: new Error('ENOENT'),
    });
    const result = await spawnClaude({
      prompt: 'p',
      options: { spawnFn: fakeSpawnFactory(fake) },
    });
    await fake.promise;
    expect(result.ok).toBe(false);
    expect(result.diagnostic).toMatch(/child process error.*ENOENT/);
  });

  it('returns timedOut=true when the child overruns the deadline', async () => {
    const fake = makeFakeChild({ exitCode: 0, closeDelayMs: 100 });
    const result = await spawnClaude({
      prompt: 'p',
      options: { spawnFn: fakeSpawnFactory(fake), timeoutMs: 5 },
    });
    await fake.promise;
    expect(result.timedOut).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.diagnostic).toMatch(/timed out after 5ms/);
  });

  it('returns ok=false when spawn() throws synchronously', async () => {
    const badSpawn = ((): never => {
      throw new Error('spawn-threw');
    }) as unknown as typeof realSpawn;
    const result = await spawnClaude({
      prompt: 'p',
      options: { spawnFn: badSpawn },
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostic).toMatch(/failed to spawn .*spawn-threw/);
  });
});

describe('spawnClaude — constraints', () => {
  it('throws SpawnClaudeConstraintError when rejectIfApiKeyPresent and key is set', async () => {
    const prev = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    try {
      const fake = makeFakeChild({ exitCode: 0 });
      await expect(
        spawnClaude({
          prompt: 'p',
          options: { spawnFn: fakeSpawnFactory(fake) },
          constraints: { rejectIfApiKeyPresent: true },
        }),
      ).rejects.toBeInstanceOf(SpawnClaudeConstraintError);
    } finally {
      if (prev === undefined) delete process.env['ANTHROPIC_API_KEY'];
      else process.env['ANTHROPIC_API_KEY'] = prev;
    }
  });

  it('throws SpawnClaudeConstraintError when cwd is not under cwdAllowList', async () => {
    const fake = makeFakeChild({ exitCode: 0 });
    await expect(
      spawnClaude({
        prompt: 'p',
        options: { spawnFn: fakeSpawnFactory(fake), cwd: '/etc' },
        constraints: { cwdAllowList: ['/home/user/repo'] },
      }),
    ).rejects.toBeInstanceOf(SpawnClaudeConstraintError);
  });

  it('accepts cwd that exactly matches an allow-list entry', async () => {
    const fake = makeFakeChild({ exitCode: 0, stdoutChunks: ['{"result":"ok"}'] });
    const result = await spawnClaude({
      prompt: 'p',
      options: { spawnFn: fakeSpawnFactory(fake), cwd: '/tmp' },
      constraints: { cwdAllowList: ['/tmp'] },
    });
    await fake.promise;
    expect(result.ok).toBe(true);
  });

  it('accepts cwd that is a subdirectory of an allow-list entry', async () => {
    const fake = makeFakeChild({ exitCode: 0, stdoutChunks: ['{"result":"ok"}'] });
    const result = await spawnClaude({
      prompt: 'p',
      options: { spawnFn: fakeSpawnFactory(fake), cwd: '/tmp/sub/dir' },
      constraints: { cwdAllowList: ['/tmp'] },
    });
    await fake.promise;
    expect(result.ok).toBe(true);
  });
});

describe('spawnClaude — env scrub end-to-end', () => {
  it('hands the spawn impl an env with auth-token vars removed', async () => {
    const sawEnv = vi.fn();
    const fake = makeFakeChild({ exitCode: 0 });
    const spawnFn = ((
      _bin: string,
      _args: ReadonlyArray<string>,
      opts: { env?: NodeJS.ProcessEnv } | undefined,
    ): unknown => {
      sawEnv(opts?.env);
      return fake.ee;
    }) as unknown as typeof realSpawn;

    const prev = process.env['ANTHROPIC_API_KEY'];
    process.env['ANTHROPIC_API_KEY'] = 'sk-leak';
    try {
      await spawnClaude({ prompt: 'p', options: { spawnFn } });
      await fake.promise;
      const env = sawEnv.mock.calls[0]?.[0] as Record<string, string> | undefined;
      expect(env).toBeDefined();
      for (const k of SCRUBBED_AUTH_ENV_VARS) {
        expect(env?.[k]).toBeUndefined();
      }
    } finally {
      if (prev === undefined) delete process.env['ANTHROPIC_API_KEY'];
      else process.env['ANTHROPIC_API_KEY'] = prev;
    }
  });
});
