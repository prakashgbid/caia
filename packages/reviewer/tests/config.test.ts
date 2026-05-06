import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { resolveConfig, expandHome } from '../src/config.js';

describe('expandHome', () => {
  it('expands ~/ to homedir', () => {
    const out = expandHome('~/foo');
    expect(out).toMatch(/\/foo$/);
    expect(out.startsWith('~')).toBe(false);
  });

  it('passes through absolute paths', () => {
    expect(expandHome('/abs/path')).toBe('/abs/path');
  });

  it('expands lone ~', () => {
    expect(expandHome('~')).not.toBe('~');
  });
});

describe('resolveConfig', () => {
  const ENV_KEYS = [
    'CAIA_CONVENTIONS_PATH', 'CAIA_MEMORY_ROOT', 'CAIA_REPORTS_ROOT',
    'MENTOR_EVENT_BUS_URL', 'CLAUDE_BINARY_PATH', 'REVIEWER_MODEL_TAG',
    'REVIEWER_MAX_DIFF_BYTES', 'REVIEWER_CHUNK_BYTES',
    'REVIEWER_SEVERITY_FLOOR', 'REVIEWER_VECTOR_TIMEOUT_MS',
    'REVIEWER_MAX_FINDINGS', 'REVIEWER_MAX_FUNCTION_LINES',
    'REVIEWER_MAX_FILE_LINES', 'REVIEWER_MAX_NESTING_DEPTH',
    'REVIEWER_LLM_ENABLED', 'REVIEWER_DETERMINISTIC_ENABLED'
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
      const prior = saved[k];
      if (prior === undefined) delete process.env[k];
      else process.env[k] = prior;
    }
  });

  it('uses CAIA defaults when no input/env', () => {
    const cfg = resolveConfig();
    expect(cfg.modelTag).toBe('claude-haiku-4-5-20251001');
    expect(cfg.severityFloor).toBe('nit');
    expect(cfg.maxFunctionLines).toBe(60);
    expect(cfg.maxFileLines).toBe(500);
    expect(cfg.maxNestingDepth).toBe(4);
    expect(cfg.maxFindingsPerPr).toBe(30);
    expect(cfg.enableLlmReasoning).toBe(true);
    expect(cfg.enableDeterministic).toBe(true);
  });

  it('honours constructor input over defaults', () => {
    const cfg = resolveConfig({
      severityFloor: 'consider',
      maxFunctionLines: 100,
      enableLlmReasoning: false
    });
    expect(cfg.severityFloor).toBe('consider');
    expect(cfg.maxFunctionLines).toBe(100);
    expect(cfg.enableLlmReasoning).toBe(false);
  });

  it('falls through to env when no input', () => {
    process.env['REVIEWER_MAX_FUNCTION_LINES'] = '42';
    process.env['REVIEWER_LLM_ENABLED'] = '0';
    const cfg = resolveConfig();
    expect(cfg.maxFunctionLines).toBe(42);
    expect(cfg.enableLlmReasoning).toBe(false);
  });
});
