import { describe, it, expect, afterEach } from 'vitest';

import { resolveConfig, expandHome } from '../src/config.js';

describe('resolveConfig', () => {
  const orig = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) {
      if (!(k in orig)) delete process.env[k];
    }
    Object.assign(process.env, orig);
  });

  it('uses CAIA defaults when nothing injected', () => {
    delete process.env['CAIA_MEMORY_ROOT'];
    delete process.env['CAIA_TAXONOMY_PATH'];
    delete process.env['CRITIC_MAX_DIFF_BYTES'];
    const r = resolveConfig({});
    expect(r.maxDiffBytes).toBe(256_000);
    expect(r.chunkBytes).toBe(64_000);
    expect(r.severityFloor).toBe('low');
    expect(r.modelTag).toContain('claude-haiku');
    expect(r.eventBusUrl).toBe('tcp://localhost:7777');
  });

  it('constructor params override env', () => {
    process.env['CRITIC_MAX_DIFF_BYTES'] = '1000';
    const r = resolveConfig({ maxDiffBytes: 999 });
    expect(r.maxDiffBytes).toBe(999);
  });

  it('env overrides default', () => {
    process.env['CRITIC_SEVERITY_FLOOR'] = 'high';
    const r = resolveConfig({});
    expect(r.severityFloor).toBe('high');
  });

  it('CRITIC_LLM_ENABLED=0 disables llm tier', () => {
    process.env['CRITIC_LLM_ENABLED'] = '0';
    const r = resolveConfig({});
    expect(r.enableLlmReasoning).toBe(false);
  });
});

describe('expandHome', () => {
  it('expands leading ~/', () => {
    const r = expandHome('~/foo');
    expect(r.endsWith('/foo')).toBe(true);
    expect(r).not.toContain('~');
  });

  it('returns ~ alone as homedir', () => {
    expect(expandHome('~')).not.toBe('~');
  });

  it('passes through absolute paths', () => {
    expect(expandHome('/abs/path')).toBe('/abs/path');
  });
});
