/**
 * Tests for the caia-mentor-index CLI argument parser + status path.
 *
 * The build path requires a live Ollama daemon, so we test the bits we
 * can without one: parseArgs, status output (empty + populated DB),
 * help text, and error paths.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { main, parseArgs } from '../src/cli.js';
import { vectorToBlob } from '../src/embed.js';
import { openIndexStore } from '../src/index-store.js';

describe('parseArgs', () => {
  it('rejects missing subcommand', () => {
    expect(() => parseArgs([], {})).toThrow(/missing subcommand/);
  });
  it('rejects unknown subcommand', () => {
    expect(() => parseArgs(['weird'], {})).toThrow(/unknown subcommand/);
  });
  it('accepts build with defaults', () => {
    const p = parseArgs(['build'], { CAIA_MEMORY_DIR: '/m' });
    expect(p.subcommand).toBe('build');
    expect(p.memoryDir).toBe('/m');
    expect(p.ollamaUrl).toBe('http://127.0.0.1:11434');
    expect(p.model).toBe('nomic-embed-text');
    expect(p.quiet).toBe(false);
  });
  it('honors all flag overrides', () => {
    const p = parseArgs(
      [
        'build',
        '--memory',
        '/x/y',
        '--ollama',
        'http://o:1',
        '--model',
        'em',
        '--quiet'
      ],
      {}
    );
    expect(p.memoryDir).toBe('/x/y');
    expect(p.ollamaUrl).toBe('http://o:1');
    expect(p.model).toBe('em');
    expect(p.quiet).toBe(true);
  });
  it('honors env overrides', () => {
    const p = parseArgs(['status'], {
      CAIA_MEMORY_DIR: '/from-env',
      OLLAMA_URL: 'http://env:9',
      MENTOR_EMBED_MODEL: 'env-model'
    });
    expect(p.memoryDir).toBe('/from-env');
    expect(p.ollamaUrl).toBe('http://env:9');
    expect(p.model).toBe('env-model');
  });
  it('rejects flag without value', () => {
    expect(() => parseArgs(['build', '--memory'], {})).toThrow(/--memory requires a value/);
  });
  it('rejects unknown flag', () => {
    expect(() => parseArgs(['build', '--bogus'], {})).toThrow(/unknown flag/);
  });
});

describe('main: help', () => {
  it('prints usage and exits 0', async () => {
    const out: string[] = [];
    let exitCode = -1;
    await main({
      argv: ['help'],
      env: {},
      stdout: (s) => out.push(s),
      stderr: () => undefined,
      exit: ((c: number) => {
        exitCode = c;
        return undefined as never;
      })
    });
    expect(exitCode).toBe(0);
    expect(out.join('\n')).toContain('caia-mentor-index');
    expect(out.join('\n')).toContain('build');
    expect(out.join('\n')).toContain('status');
  });
});

describe('main: status', () => {
  let memoryDir: string;
  beforeEach(() => {
    memoryDir = mkdtempSync(join(tmpdir(), 'mentor-retrieval-cli-'));
  });
  afterEach(() => {
    // tmpdir auto-cleanup
  });

  it('prints "not built yet" graceful output when DB is missing', async () => {
    const out: string[] = [];
    let exitCode = -1;
    await main({
      argv: ['status', '--memory', memoryDir],
      env: {},
      stdout: (s) => out.push(s),
      stderr: () => undefined,
      exit: ((c: number) => {
        exitCode = c;
        return undefined as never;
      })
    });
    expect(exitCode).toBe(0);
    const json = JSON.parse(out.join(''));
    expect(json.totalRows).toBe(0);
    expect(json.note).toMatch(/not built yet/);
  });

  it('summarizes a populated DB', async () => {
    // Populate a tiny DB by hand.
    const store = openIndexStore({ memoryDir });
    try {
      store.upsertLesson({
        sourcePath: '/m/a.md',
        kind: 'feedback',
        slug: 'a',
        mtimeMs: 1,
        contentSha256: 'h',
        contentSnippet: 's',
        embeddingDim: 1,
        embedding: vectorToBlob(new Float32Array([1])),
        indexedAtMs: 1
      });
      store.upsertLesson({
        sourcePath: '/m/p1.md',
        kind: 'proposal',
        slug: 'p1',
        mtimeMs: 2,
        contentSha256: 'h2',
        contentSnippet: 's',
        embeddingDim: 1,
        embedding: vectorToBlob(new Float32Array([1])),
        indexedAtMs: 2
      });
      store.setMeta('embedding_model', 'm');
      store.setMeta('embedding_dim', '1');
      store.setMeta('last_build_at_ms', '1700000000000');
      store.setMeta('last_build_scanned', '2');
    } finally {
      store.close();
    }

    const out: string[] = [];
    let exitCode = -1;
    await main({
      argv: ['status', '--memory', memoryDir],
      env: {},
      stdout: (s) => out.push(s),
      stderr: () => undefined,
      exit: ((c: number) => {
        exitCode = c;
        return undefined as never;
      })
    });
    expect(exitCode).toBe(0);
    const json = JSON.parse(out.join(''));
    expect(json.totalRows).toBe(2);
    expect(json.byKind.feedback).toBe(1);
    expect(json.byKind.proposal).toBe(1);
    expect(json.embeddingModel).toBe('m');
    expect(json.embeddingDim).toBe(1);
    expect(json.lastBuildAtMs).toBe(1700000000000);
    expect(json.lastBuildAtIso).toBe(new Date(1700000000000).toISOString());
  });

  it('exits 1 on usage error', async () => {
    let exitCode = -1;
    const errs: string[] = [];
    await main({
      argv: ['weird'],
      env: {},
      stdout: () => undefined,
      stderr: (s) => errs.push(s),
      exit: ((c: number) => {
        exitCode = c;
        return undefined as never;
      })
    });
    expect(exitCode).toBe(1);
    expect(errs.some((e) => e.includes('unknown subcommand'))).toBe(true);
  });

  it('writes feedback files into a real memoryDir and recognizes them as 0 (no DB)', async () => {
    // Create some feedback files but never build an index.
    writeFileSync(join(memoryDir, 'feedback_x.md'), 'a');
    mkdirSync(join(memoryDir, 'proposals'));
    writeFileSync(join(memoryDir, 'proposals', 'p.md'), 'b');

    const out: string[] = [];
    let exitCode = -1;
    await main({
      argv: ['status', '--memory', memoryDir],
      env: {},
      stdout: (s) => out.push(s),
      stderr: () => undefined,
      exit: ((c: number) => {
        exitCode = c;
        return undefined as never;
      })
    });
    expect(exitCode).toBe(0);
    const json = JSON.parse(out.join(''));
    expect(json.totalRows).toBe(0);
  });
});
