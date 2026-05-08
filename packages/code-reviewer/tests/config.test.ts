import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveConfig, expandHome } from '../src/config.js';

describe('expandHome', () => {
  it('expands leading ~/', () => {
    const out = expandHome('~/foo');
    expect(out.endsWith('/foo')).toBe(true);
    expect(out.startsWith('/')).toBe(true);
  });

  it('passes ~ alone', () => {
    const out = expandHome('~');
    expect(out.startsWith('/')).toBe(true);
    expect(out.includes('~')).toBe(false);
  });

  it('passes other paths through', () => {
    expect(expandHome('/abs/path')).toBe('/abs/path');
    expect(expandHome('relative/path')).toBe('relative/path');
  });
});

describe('resolveConfig', () => {
  const ENV_KEYS = [
    'CAIA_CONVENTIONS_PATH',
    'CAIA_REPORTS_ROOT',
    'CLAUDE_BINARY_PATH',
    'CODE_REVIEWER_MODEL_TAG',
    'CODE_REVIEWER_MAX_DIFF_BYTES',
    'CODE_REVIEWER_CHUNK_BYTES',
    'CODE_REVIEWER_SEVERITY_FLOOR',
    'CODE_REVIEWER_BLOCKING_THRESHOLD',
    'CODE_REVIEWER_VECTOR_TIMEOUT_MS',
    'CODE_REVIEWER_MAX_FINDINGS',
    'CODE_REVIEWER_LLM_ENABLED',
    'CODE_REVIEWER_DETERMINISTIC_ENABLED',
    'MENTOR_EVENT_BUS_URL'
  ];
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('uses defaults when nothing is provided', () => {
    const cfg = resolveConfig();
    expect(cfg.modelTag).toBe('claude-haiku-4-5-20251001');
    expect(cfg.severityFloor).toBe('low');
    expect(cfg.blockingSeverityThreshold).toBe('medium');
    expect(cfg.maxDiffBytes).toBe(256_000);
    expect(cfg.chunkBytes).toBe(64_000);
    expect(cfg.maxFindingsPerPr).toBe(50);
    expect(cfg.enableLlmReasoning).toBe(true);
    expect(cfg.enableDeterministic).toBe(true);
    expect(cfg.eventBusUrl).toBe('tcp://localhost:7777');
  });

  it('honors explicit input over env over defaults', () => {
    process.env['CODE_REVIEWER_MODEL_TAG'] = 'env-model';
    const cfg = resolveConfig({ modelTag: 'explicit-model' });
    expect(cfg.modelTag).toBe('explicit-model');

    const cfg2 = resolveConfig();
    expect(cfg2.modelTag).toBe('env-model');
  });

  it('honors env-driven severity floor', () => {
    process.env['CODE_REVIEWER_SEVERITY_FLOOR'] = 'high';
    const cfg = resolveConfig();
    expect(cfg.severityFloor).toBe('high');
  });

  it('honors env-driven blocking threshold', () => {
    process.env['CODE_REVIEWER_BLOCKING_THRESHOLD'] = 'high';
    const cfg = resolveConfig();
    expect(cfg.blockingSeverityThreshold).toBe('high');
  });

  it('disables LLM via env', () => {
    process.env['CODE_REVIEWER_LLM_ENABLED'] = '0';
    const cfg = resolveConfig();
    expect(cfg.enableLlmReasoning).toBe(false);
  });

  it('disables deterministic tier via env', () => {
    process.env['CODE_REVIEWER_DETERMINISTIC_ENABLED'] = '0';
    const cfg = resolveConfig();
    expect(cfg.enableDeterministic).toBe(false);
  });

  it('parses numeric envs', () => {
    process.env['CODE_REVIEWER_MAX_DIFF_BYTES'] = '999';
    process.env['CODE_REVIEWER_CHUNK_BYTES'] = '888';
    process.env['CODE_REVIEWER_VECTOR_TIMEOUT_MS'] = '1234';
    process.env['CODE_REVIEWER_MAX_FINDINGS'] = '7';
    const cfg = resolveConfig();
    expect(cfg.maxDiffBytes).toBe(999);
    expect(cfg.chunkBytes).toBe(888);
    expect(cfg.perVectorTimeoutMs).toBe(1234);
    expect(cfg.maxFindingsPerPr).toBe(7);
  });

  it('expands ~ in path inputs', () => {
    const cfg = resolveConfig({ conventionsPath: '~/somewhere/AGENTS.md' });
    expect(cfg.conventionsPath.includes('~')).toBe(false);
    expect(cfg.conventionsPath.endsWith('/somewhere/AGENTS.md')).toBe(true);
  });
});
