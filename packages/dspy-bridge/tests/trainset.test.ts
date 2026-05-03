import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { recordTrace } from '../src/traces.js';
import { buildTrainset, writeTrainsetJsonl } from '../src/trainset.js';
import {
  PHASE2E_002_FIXTURES,
  fixturesToEvalsetRows,
} from '../src/evalsets/po-scope-detector-phase2e002.js';

describe('buildTrainset', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'dspy-bridge-trainset-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function tap(promptText: string, scope: string, ts: string, opts: { ok?: boolean; label?: Record<string, unknown> } = {}) {
    const row: Parameters<typeof recordTrace>[1] = {
      version: 'uncompiled',
      input: { promptText },
      output: { targetScope: scope, confidence: 0.85, rationale: 'stub' },
      ok: opts.ok ?? true,
      model: 'qwen2.5-coder:7b',
      durationMs: 17,
    };
    if (opts.label) row.label = opts.label;
    recordTrace('po-scope-detector', row, { root, nowDateIso: () => ts });
  }

  it('dedupes by input and prefers labelled rows', () => {
    tap('add a logout button', 'story', '2026-04-30T08:00:00.000Z');
    tap('add a logout button', 'story', '2026-04-30T09:00:00.000Z'); // dup
    tap('refactor the auth module', 'task', '2026-04-30T10:00:00.000Z');
    tap('refactor the auth module', 'task', '2026-04-30T11:00:00.000Z', {
      label: { target_scope: 'task', tolerance: ['task'] },
    });

    const rows = buildTrainset({
      program: 'po-scope-detector',
      sinceIso: '2026-04-30T00:00:00.000Z',
      untilIso: '2026-04-30T23:59:59.999Z',
      traceRoot: root,
    });
    expect(rows).toHaveLength(2);
    // Labelled row should land first.
    expect(rows[0]?.label).toMatchObject({ target_scope: 'task' });
  });

  it('uses model output as a pseudo-label when no real label exists', () => {
    tap('rename _x to _internal in foo.ts', 'subtask', '2026-04-30T08:00:00.000Z');

    const rows = buildTrainset({
      program: 'po-scope-detector',
      sinceIso: '2026-04-30T00:00:00.000Z',
      untilIso: '2026-04-30T23:59:59.999Z',
      traceRoot: root,
    });
    expect(rows[0]?.label).toMatchObject({ targetScope: 'subtask' });
  });

  it('caps to maxRows', () => {
    for (let i = 0; i < 50; i++) {
      tap(`prompt ${String(i)}`, 'task', `2026-04-30T08:${String(i % 60).padStart(2, '0')}:00.000Z`);
    }
    const rows = buildTrainset({
      program: 'po-scope-detector',
      sinceIso: '2026-04-30T00:00:00.000Z',
      untilIso: '2026-04-30T23:59:59.999Z',
      traceRoot: root,
      maxRows: 10,
    });
    expect(rows).toHaveLength(10);
  });

  it('writeTrainsetJsonl emits one JSON object per line', () => {
    const out = path.join(root, 'out.jsonl');
    writeTrainsetJsonl(
      [
        { input: { promptText: 'a' }, label: { target_scope: 'task' } },
        { input: { promptText: 'b' }, label: { target_scope: 'story' } },
      ],
      out,
    );
    const lines = fs.readFileSync(out, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] as string)).toEqual({
      input: { promptText: 'a' },
      label: { target_scope: 'task' },
    });
  });
});

describe('PHASE2E-002 evalset', () => {
  it('has exactly 10 fixtures and unique tags', () => {
    expect(PHASE2E_002_FIXTURES).toHaveLength(10);
    const tags = new Set(PHASE2E_002_FIXTURES.map((f) => f.tag));
    expect(tags.size).toBe(10);
  });

  it('every fixture lists expectedScope inside its tolerance set', () => {
    for (const f of PHASE2E_002_FIXTURES) {
      expect(f.tolerance).toContain(f.expectedScope);
    }
  });

  it('fixturesToEvalsetRows emits matching JSONL-ready rows', () => {
    const rows = fixturesToEvalsetRows();
    expect(rows).toHaveLength(10);
    expect(rows[0]?.input).toHaveProperty('promptText');
    expect(rows[0]?.label).toHaveProperty('target_scope');
    expect(rows[0]?.label).toHaveProperty('tolerance');
  });
});
