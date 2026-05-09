import { describe, it, expect } from 'vitest';
import {
  resolveConfig,
  subQuestionsForDepth,
  sourcesPerQuestionForDepth,
  CAIA_DEFAULT_REPORTS_ROOT,
  CAIA_DEFAULT_MEMORY_DIR
} from '../src/config.js';

describe('resolveConfig', () => {
  it('uses CAIA defaults when nothing passed', () => {
    const c = resolveConfig(undefined);
    expect(c.reportsRoot).toBe(CAIA_DEFAULT_REPORTS_ROOT);
    expect(c.memoryDir).toBe(CAIA_DEFAULT_MEMORY_DIR);
    expect(c.claudeBinaryPath).toBe('claude');
    expect(c.synthesisModel).toBe('claude-sonnet-4-6');
    expect(c.defaultDepth).toBe('medium');
    expect(c.maxQuoteWords).toBe(14);
    expect(c.minSourceCount).toBe(10);
  });

  it('honours overrides', () => {
    const c = resolveConfig({
      reportsRoot: '/tmp/reports',
      synthesisModel: 'm',
      maxQuoteWords: 9,
      defaultDepth: 'shallow'
    });
    expect(c.reportsRoot).toBe('/tmp/reports');
    expect(c.synthesisModel).toBe('m');
    expect(c.maxQuoteWords).toBe(9);
    expect(c.defaultDepth).toBe('shallow');
  });
});

describe('subQuestionsForDepth', () => {
  it('routes by tier', () => {
    const c = resolveConfig({});
    expect(subQuestionsForDepth('shallow', c)).toBe(3);
    expect(subQuestionsForDepth('medium', c)).toBe(5);
    expect(subQuestionsForDepth('deep', c)).toBe(8);
  });
});

describe('sourcesPerQuestionForDepth', () => {
  it('routes by tier', () => {
    const c = resolveConfig({});
    expect(sourcesPerQuestionForDepth('shallow', c)).toBe(5);
    expect(sourcesPerQuestionForDepth('medium', c)).toBe(8);
    expect(sourcesPerQuestionForDepth('deep', c)).toBe(12);
  });
});
