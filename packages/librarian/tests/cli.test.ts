import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { main as indexMain, parseArgs as indexParseArgs } from '../src/cli.js';

interface Sink {
  out: string[];
  err: string[];
  exitCode: number | null;
}

function makeSink(): Sink & {
  exit: (c: number) => never;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
} {
  const out: string[] = [];
  const err: string[] = [];
  let exitCode: number | null = null;
  return {
    out,
    err,
    get exitCode() {
      return exitCode;
    },
    exit: ((c: number) => {
      exitCode = c;
      // Don't actually exit; just return — caller checks exitCode
      return undefined as unknown as never;
    }) as (c: number) => never,
    stdout: (s: string) => out.push(s),
    stderr: (s: string) => err.push(s)
  };
}

describe('caia-librarian-index parseArgs', () => {
  it('rejects no subcommand', () => {
    expect(() => indexParseArgs([], {})).toThrow(/missing subcommand/);
  });
  it('rejects unknown subcommand', () => {
    expect(() => indexParseArgs(['foo'], {})).toThrow(/unknown subcommand/);
  });
  it('parses build with defaults', () => {
    const a = indexParseArgs(['build'], {});
    expect(a.subcommand).toBe('build');
    expect(a.memoryDir).toMatch(/agent.memory$/);
    expect(a.reportsDir).toMatch(/Documents.projects.reports$/);
    expect(a.ollamaUrl).toBe('http://127.0.0.1:11434');
    expect(a.model).toBe('nomic-embed-text');
    expect(a.quiet).toBe(false);
  });
  it('honors --memory + --reports', () => {
    const a = indexParseArgs(['build', '--memory', '/m', '--reports', '/r'], {});
    expect(a.memoryDir).toBe('/m');
    expect(a.reportsDir).toBe('/r');
  });
  it('honors --no-reports', () => {
    const a = indexParseArgs(['build', '--no-reports'], {});
    expect(a.reportsDir).toBeNull();
  });
  it('honors env vars', () => {
    const a = indexParseArgs(['status'], {
      CAIA_MEMORY_DIR: '/env/m',
      CAIA_REPORTS_DIR: '/env/r',
      OLLAMA_URL: 'http://o:1',
      LIBRARIAN_EMBED_MODEL: 'env-model'
    });
    expect(a.memoryDir).toBe('/env/m');
    expect(a.reportsDir).toBe('/env/r');
    expect(a.ollamaUrl).toBe('http://o:1');
    expect(a.model).toBe('env-model');
  });
  it('rejects unknown flags', () => {
    expect(() => indexParseArgs(['build', '--bogus'], {})).toThrow(/unknown flag/);
  });
  it('rejects flag without value', () => {
    expect(() => indexParseArgs(['build', '--memory'], {})).toThrow(/--memory requires a value/);
  });
});

describe('caia-librarian-index main', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'librarian-cli-test-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('help subcommand prints usage and exits 0', async () => {
    const sink = makeSink();
    await indexMain({
      argv: ['help'],
      env: {},
      stdout: sink.stdout,
      stderr: sink.stderr,
      exit: sink.exit
    });
    expect(sink.exitCode).toBe(0);
    expect(sink.out.join('\n')).toMatch(/caia-librarian-index/);
  });

  it('status returns empty placeholder when DB is missing', async () => {
    const sink = makeSink();
    await indexMain({
      argv: ['status', '--memory', tmpRoot],
      env: {},
      stdout: sink.stdout,
      stderr: sink.stderr,
      exit: sink.exit
    });
    expect(sink.exitCode).toBe(0);
    const parsed = JSON.parse(sink.out.join(''));
    expect(parsed.totalRows).toBe(0);
    expect(parsed.note).toMatch(/index not built yet/);
  });

  it('exits 1 on bad subcommand', async () => {
    const sink = makeSink();
    await indexMain({
      argv: ['foo'],
      env: {},
      stdout: sink.stdout,
      stderr: sink.stderr,
      exit: sink.exit
    });
    expect(sink.exitCode).toBe(1);
    expect(sink.err.join('\n')).toMatch(/unknown subcommand/);
  });

  it('build exits 2 if Ollama is unreachable (real network)', async () => {
    const memoryDir = join(tmpRoot, 'memory');
    mkdirSync(memoryDir);
    writeFileSync(join(memoryDir, 'feedback_x.md'), 'something to embed');
    const sink = makeSink();
    await indexMain({
      argv: [
        'build',
        '--memory', memoryDir,
        '--no-reports',
        '--ollama', 'http://127.0.0.1:1', // unreachable port
        '--quiet'
      ],
      env: {},
      stdout: sink.stdout,
      stderr: sink.stderr,
      exit: sink.exit
    });
    // The build itself doesn't fail (per-file embed errors are caught);
    // the build returns stats with failedEmbed > 0 and exits 0.
    expect(sink.exitCode).toBe(0);
    const parsed = JSON.parse(sink.out.join(''));
    expect(parsed.scanned).toBe(1);
    expect(parsed.failedEmbed).toBe(1);
    expect(parsed.embeddedNew).toBe(0);
  });
});
