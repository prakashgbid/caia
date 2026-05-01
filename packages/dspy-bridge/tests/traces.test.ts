import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { recordTrace, readTraces } from '../src/traces.js';

describe('trace writer + reader', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspy-bridge-traces-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('appends one row per call into a YYYY-MM-DD-keyed file', () => {
    recordTrace(
      'po-scope-detector',
      {
        version: 'uncompiled',
        input: { promptText: 'add a logout button' },
        output: { targetScope: 'story', confidence: 0.92 },
        ok: true,
        model: 'qwen2.5-coder:7b',
        durationMs: 23,
      },
      { root, nowDateIso: () => '2026-04-30T15:00:00.000Z' },
    );
    recordTrace(
      'po-scope-detector',
      {
        version: 'uncompiled',
        input: { promptText: 'fix login button' },
        output: { targetScope: 'task', confidence: 0.7 },
        ok: true,
        model: 'qwen2.5-coder:7b',
        durationMs: 19,
      },
      { root, nowDateIso: () => '2026-04-30T15:01:00.000Z' },
    );
    recordTrace(
      'po-scope-detector',
      {
        version: 'uncompiled',
        input: { promptText: 'next-day call' },
        output: { targetScope: 'epic', confidence: 0.6 },
        ok: true,
        model: 'qwen2.5-coder:7b',
        durationMs: 34,
      },
      { root, nowDateIso: () => '2026-05-01T01:00:00.000Z' },
    );

    const apr30 = path.join(root, 'po-scope-detector', '2026-04-30.jsonl');
    const may01 = path.join(root, 'po-scope-detector', '2026-05-01.jsonl');
    expect(fs.readFileSync(apr30, 'utf8').trim().split('\n')).toHaveLength(2);
    expect(fs.readFileSync(may01, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('readTraces filters by [since, until] and skips ok=false by default', () => {
    recordTrace(
      'po-scope-detector',
      {
        version: 'uncompiled',
        input: { promptText: 'good-1' },
        output: { targetScope: 'story', confidence: 0.9 },
        ok: true,
        model: 'qwen2.5-coder:7b',
        durationMs: 11,
      },
      { root, nowDateIso: () => '2026-04-30T08:00:00.000Z' },
    );
    recordTrace(
      'po-scope-detector',
      {
        version: 'uncompiled',
        input: { promptText: 'failed-1' },
        output: {},
        ok: false,
        model: 'qwen2.5-coder:7b',
        durationMs: 12,
      },
      { root, nowDateIso: () => '2026-04-30T09:00:00.000Z' },
    );
    recordTrace(
      'po-scope-detector',
      {
        version: 'uncompiled',
        input: { promptText: 'too-late' },
        output: { targetScope: 'task', confidence: 0.7 },
        ok: true,
        model: 'qwen2.5-coder:7b',
        durationMs: 15,
      },
      { root, nowDateIso: () => '2026-05-01T08:00:00.000Z' },
    );

    const rows = readTraces(
      'po-scope-detector',
      '2026-04-30T00:00:00.000Z',
      '2026-04-30T23:59:59.999Z',
      { root },
    );
    expect(rows).toHaveLength(1);
    expect((rows[0] as { input: { promptText: string } }).input.promptText).toBe('good-1');

    const withFailed = readTraces(
      'po-scope-detector',
      '2026-04-30T00:00:00.000Z',
      '2026-04-30T23:59:59.999Z',
      { root, includeFailed: true },
    );
    expect(withFailed).toHaveLength(2);
  });

  it('returns [] when the program directory does not exist', () => {
    const rows = readTraces(
      'never-recorded',
      '2026-04-30T00:00:00.000Z',
      '2026-04-30T23:59:59.999Z',
      { root },
    );
    expect(rows).toEqual([]);
  });
});
