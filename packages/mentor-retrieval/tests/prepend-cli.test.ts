/**
 * Tests for the caia-mentor-prepend CLI argument parser + main wiring.
 *
 * Live Ollama-backed end-to-end is covered by Stage-6 verification at
 * leg-7 close.
 */

import { describe, expect, it, vi } from 'vitest';

import { main, parseArgs } from '../src/prepend-cli.js';

describe('parseArgs', () => {
  it('defaults to --stdin when no positional + no flag', () => {
    const p = parseArgs([], { CAIA_MEMORY_DIR: '/m' });
    expect(p.prompt).toBe('__STDIN__');
    expect(p.memoryDir).toBe('/m');
    expect(p.topN).toBe(5);
    expect(p.threshold).toBe(0.4);
    expect(p.kindFilter).toBeUndefined();
    expect(p.failOnEmpty).toBe(false);
    expect(p.metadata).toBe(false);
    expect(p.quiet).toBe(false);
  });
  it('accepts a positional prompt', () => {
    const p = parseArgs(['hello world'], { CAIA_MEMORY_DIR: '/m' });
    expect(p.prompt).toBe('hello world');
  });
  it('rejects two positional prompts', () => {
    expect(() => parseArgs(['p1', 'p2'], {})).toThrow(/only one positional/);
  });
  it('rejects positional + --stdin together', () => {
    expect(() => parseArgs(['p', '--stdin'], {})).toThrow(/cannot pass both/);
  });
  it('honors all flag overrides', () => {
    const p = parseArgs(
      [
        'q',
        '--memory',
        '/x',
        '--ollama',
        'http://o:1',
        '--model',
        'em',
        '--top-n',
        '7',
        '--threshold',
        '0.6',
        '--kind',
        'proposal',
        '--metadata',
        '--fail-on-empty',
        '--quiet'
      ],
      {}
    );
    expect(p.memoryDir).toBe('/x');
    expect(p.ollamaUrl).toBe('http://o:1');
    expect(p.model).toBe('em');
    expect(p.topN).toBe(7);
    expect(p.threshold).toBe(0.6);
    expect(p.kindFilter).toBe('proposal');
    expect(p.metadata).toBe(true);
    expect(p.failOnEmpty).toBe(true);
    expect(p.quiet).toBe(true);
  });
  it('accepts --emit-empty as a no-op', () => {
    const p = parseArgs(['q', '--emit-empty'], { CAIA_MEMORY_DIR: '/m' });
    expect(p.failOnEmpty).toBe(false);
  });
  it('rejects unknown flags', () => {
    expect(() => parseArgs(['q', '--bogus'], {})).toThrow(/unknown flag/);
  });
  it('rejects bad --top-n / --threshold / --kind values', () => {
    expect(() => parseArgs(['q', '--top-n', '0'], {})).toThrow(/positive integer/);
    expect(() => parseArgs(['q', '--threshold', 'x'], {})).toThrow(/must be a number/);
    expect(() => parseArgs(['q', '--kind', 'bogus'], {})).toThrow(/must be one of/);
  });
  it('--help returns the help sentinel', () => {
    expect(parseArgs(['--help'], {}).prompt).toBe('__HELP__');
    expect(parseArgs(['-h'], {}).prompt).toBe('__HELP__');
    expect(parseArgs(['help'], {}).prompt).toBe('__HELP__');
  });
});

describe('main: --help', () => {
  it('prints usage and exits 0', async () => {
    const out: string[] = [];
    let exitCode = -1;
    await main({
      argv: ['--help'],
      env: { CAIA_MEMORY_DIR: '/m' },
      stdout: (s) => out.push(s),
      stderr: () => undefined,
      exit: ((c: number) => {
        exitCode = c;
        return undefined as never;
      })
    });
    expect(exitCode).toBe(0);
    expect(out.join('\n')).toMatch(/caia-mentor-prepend/);
  });
});

describe('main: stdin handling', () => {
  it('rejects empty stdin', async () => {
    const errs: string[] = [];
    let exitCode = -1;
    await main({
      argv: ['--stdin', '--memory', '/tmp/no-such-dir'],
      env: {},
      stdout: () => undefined,
      stderr: (s) => errs.push(s),
      exit: ((c: number) => {
        exitCode = c;
        return undefined as never;
      }),
      readStdin: async () => '   '
    });
    expect(exitCode).toBe(1);
    expect(errs.some((e) => e.includes('stdin was empty'))).toBe(true);
  });

  it('passes stdin content through to prependLessons', async () => {
    // Use a memoryDir that has no index → lessons=[] → original prompt
    // is echoed verbatim, exit 0. Ollama isn't called because the
    // index-not-found path short-circuits before retrieve.
    // Actually retrieveLessons calls embed FIRST, then opens the DB.
    // That means without a real Ollama, this would throw on embed.
    // For the unit test we mock fetch globally.
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ embedding: [1, 0, 0, 0] }),
      text: async () => ''
    }) as unknown as Response) as unknown as typeof fetch;
    try {
      const out: string[] = [];
      let exitCode = -1;
      await main({
        argv: ['--stdin', '--memory', '/tmp/no-such-mentor-prepend-dir', '--quiet'],
        env: {},
        stdout: (s) => out.push(s),
        stderr: () => undefined,
        exit: ((c: number) => {
          exitCode = c;
          return undefined as never;
        }),
        readStdin: async () => 'piped prompt content\n'
      });
      expect(exitCode).toBe(0);
      // Default behavior emits the original prompt when no lessons match.
      expect(out.join('\n')).toContain('piped prompt content');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe('main: --metadata footer', () => {
  it('emits metadata when --metadata is set + no lessons', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ embedding: [1, 0, 0, 0] }),
      text: async () => ''
    }) as unknown as Response) as unknown as typeof fetch;
    try {
      const out: string[] = [];
      let exitCode = -1;
      await main({
        argv: [
          'positional prompt',
          '--memory',
          '/tmp/no-such-mentor-prepend-dir-2',
          '--metadata',
          '--quiet'
        ],
        env: {},
        stdout: (s) => out.push(s),
        stderr: () => undefined,
        exit: ((c: number) => {
          exitCode = c;
          return undefined as never;
        })
      });
      expect(exitCode).toBe(0);
      const joined = out.join('\n');
      expect(joined).toContain('positional prompt');
      expect(joined).toContain('--- mentor-metadata ---');
      expect(joined).toMatch(/"augmented":\s*false/);
      expect(joined).toMatch(/"lessonCount":\s*0/);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe('main: --fail-on-empty', () => {
  it('exits 1 when --fail-on-empty + no lessons', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ embedding: [1, 0, 0, 0] }),
      text: async () => ''
    }) as unknown as Response) as unknown as typeof fetch;
    try {
      const errs: string[] = [];
      let exitCode = -1;
      await main({
        argv: [
          'whatever',
          '--memory',
          '/tmp/no-such-mentor-prepend-dir-3',
          '--fail-on-empty',
          '--quiet'
        ],
        env: {},
        stdout: () => undefined,
        stderr: (s) => errs.push(s),
        exit: ((c: number) => {
          exitCode = c;
          return undefined as never;
        })
      });
      expect(exitCode).toBe(1);
      expect(errs.some((e) => e.includes('fail-on-empty'))).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
