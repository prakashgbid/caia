import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { expandHome, resolveConfig, snapshotConfigForHash } from '../src/config.js';

describe('expandHome', () => {
  it('expands tilde slash', () => {
    expect(expandHome('~/foo')).toMatch(/\/foo$/);
    expect(expandHome('~/foo')).not.toBe('~/foo');
  });
  it('passes through absolute paths', () => {
    expect(expandHome('/abs/path')).toBe('/abs/path');
  });
  it('handles bare ~', () => {
    expect(expandHome('~')).not.toBe('~');
  });
});

describe('resolveConfig', () => {
  const snapshot: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of [
      'CAIA_MEMORY_DIR',
      'CAIA_REPORTS_DIR',
      'CAIA_EVENTS_DB',
      'CAIA_GITHUB_REPO',
      'APPRENTICE_CORPUS_ROOT',
      'CLAUDE_BINARY_PATH'
    ]) {
      snapshot[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(snapshot)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('falls back to CAIA defaults when nothing provided', () => {
    const cfg = resolveConfig({});
    expect(cfg.memoryRoot).toContain('agent/memory');
    expect(cfg.reportsRoot).toContain('Documents/projects/reports');
    expect(cfg.outputRoot).toContain('Documents/projects/apprentice/corpora');
    expect(cfg.githubRepo).toBe('chiefaia/caia');
    expect(cfg.langfuseEnabled).toBe(false);
    expect(cfg.distillEnabled).toBe(true);
  });

  it('lets explicit args override defaults', () => {
    const cfg = resolveConfig({
      memoryRoot: '/explicit/mem',
      reportsRoot: '/explicit/rep',
      maxSamples: 7,
      qualityThreshold: 0.9,
      langfuseEnabled: true
    });
    expect(cfg.memoryRoot).toBe('/explicit/mem');
    expect(cfg.reportsRoot).toBe('/explicit/rep');
    expect(cfg.maxSamples).toBe(7);
    expect(cfg.qualityThreshold).toBe(0.9);
    expect(cfg.langfuseEnabled).toBe(true);
  });

  it('lets env vars override defaults but not explicit args', () => {
    process.env['CAIA_MEMORY_DIR'] = '/from/env';
    expect(resolveConfig({}).memoryRoot).toBe('/from/env');
    expect(resolveConfig({ memoryRoot: '/from/arg' }).memoryRoot).toBe('/from/arg');
  });

  it('snapshotConfigForHash is deterministic', () => {
    const a = snapshotConfigForHash(resolveConfig({ memoryRoot: '/x' }));
    const b = snapshotConfigForHash(resolveConfig({ memoryRoot: '/x' }));
    expect(a).toBe(b);
  });
});
