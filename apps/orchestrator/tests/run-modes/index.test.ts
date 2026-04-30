/**
 * RUN-MODES unit tests — guards every public function in run-modes/index.ts.
 *
 * Coverage strategy: every exported function gets at least one
 * positive + one negative test case. Cost estimates have a stability
 * test (same input → same output) and a relative-ordering test
 * (test-only > plan-only on tokens because coding is included).
 */

import {
  RUN_MODES,
  DEFAULT_RUN_MODE,
  isRunMode,
  isTestOnlyStripped,
  restrictAllowlistForMode,
  shouldSkipWorkerAssignment,
  shouldWriteCode,
  shouldAllowDeployment,
  estimateRunCost,
  TEST_ONLY_STRIPPED_CAPABILITIES,
  TEST_ONLY_STRIPPED_PREFIXES,
} from '../../src/run-modes/index';

describe('RUN_MODES enum + DEFAULT_RUN_MODE', () => {
  it('contains exactly three modes with full first', () => {
    expect(RUN_MODES).toEqual(['full', 'plan-only', 'test-only']);
  });

  it('default is full', () => {
    expect(DEFAULT_RUN_MODE).toBe('full');
  });
});

describe('isRunMode type guard', () => {
  it('accepts every canonical mode', () => {
    expect(isRunMode('full')).toBe(true);
    expect(isRunMode('plan-only')).toBe(true);
    expect(isRunMode('test-only')).toBe(true);
  });

  it('rejects non-string and unknown-string inputs', () => {
    expect(isRunMode(undefined)).toBe(false);
    expect(isRunMode(null)).toBe(false);
    expect(isRunMode(0)).toBe(false);
    expect(isRunMode('Full')).toBe(false); // case sensitive
    expect(isRunMode('PLAN-ONLY')).toBe(false);
    expect(isRunMode('plan_only')).toBe(false);
    expect(isRunMode('')).toBe(false);
    expect(isRunMode('execute')).toBe(false);
  });
});

describe('isTestOnlyStripped capability filter', () => {
  it('strips every explicitly named capability', () => {
    for (const cap of TEST_ONLY_STRIPPED_CAPABILITIES) {
      expect(isTestOnlyStripped(cap)).toBe(true);
    }
  });

  it('strips capabilities matching a stripped prefix', () => {
    expect(isTestOnlyStripped('cloudflare_pages_deploy_preview')).toBe(true);
    expect(isTestOnlyStripped('cloudflare_pages_deploy_prod')).toBe(true);
  });

  it('keeps capabilities that don\'t match the strip list', () => {
    expect(isTestOnlyStripped('git_clone')).toBe(false);
    expect(isTestOnlyStripped('npm_install')).toBe(false);
    expect(isTestOnlyStripped('git_push_feature_branch')).toBe(false);
    expect(isTestOnlyStripped('supabase_query')).toBe(false);
  });

  it('exposes a non-empty prefix list (defence against accidental empty)', () => {
    expect(TEST_ONLY_STRIPPED_PREFIXES.length).toBeGreaterThan(0);
  });
});

describe('restrictAllowlistForMode', () => {
  const FULL_ALLOWLIST = [
    'git_clone',
    'git_push_feature_branch',
    'git_push_main',
    'npm_install',
    'npm_publish',
    'cloudflare_pages_deploy_preview',
    'cloudflare_pages_deploy_prod',
    'supabase_query',
    'supabase_migration_apply',
  ];

  it('passes through full unchanged', () => {
    const out = restrictAllowlistForMode('full', FULL_ALLOWLIST);
    expect(out).toEqual(FULL_ALLOWLIST);
    // returns a fresh array, not the same reference (defends against
    // accidental shared mutable state)
    expect(out).not.toBe(FULL_ALLOWLIST);
  });

  it('passes through plan-only unchanged (no worker = no enforcement needed)', () => {
    const out = restrictAllowlistForMode('plan-only', FULL_ALLOWLIST);
    expect(out).toEqual(FULL_ALLOWLIST);
  });

  it('strips deploy / publish / push-main capabilities under test-only', () => {
    const out = restrictAllowlistForMode('test-only', FULL_ALLOWLIST);
    expect(out).toContain('git_clone');
    expect(out).toContain('git_push_feature_branch');
    expect(out).toContain('npm_install');
    expect(out).toContain('supabase_query');
    expect(out).not.toContain('git_push_main');
    expect(out).not.toContain('npm_publish');
    expect(out).not.toContain('cloudflare_pages_deploy_preview');
    expect(out).not.toContain('cloudflare_pages_deploy_prod');
    expect(out).not.toContain('supabase_migration_apply');
  });

  it('preserves order of remaining capabilities under test-only', () => {
    const out = restrictAllowlistForMode('test-only', FULL_ALLOWLIST);
    expect(out).toEqual(['git_clone', 'git_push_feature_branch', 'npm_install', 'supabase_query']);
  });

  it('handles empty allowlist gracefully', () => {
    expect(restrictAllowlistForMode('test-only', [])).toEqual([]);
    expect(restrictAllowlistForMode('full', [])).toEqual([]);
    expect(restrictAllowlistForMode('plan-only', [])).toEqual([]);
  });
});

describe('shouldSkipWorkerAssignment / shouldWriteCode / shouldAllowDeployment', () => {
  it('plan-only: skip = true, writeCode = false, deploy = false', () => {
    expect(shouldSkipWorkerAssignment('plan-only')).toBe(true);
    expect(shouldWriteCode('plan-only')).toBe(false);
    expect(shouldAllowDeployment('plan-only')).toBe(false);
  });

  it('test-only: skip = false, writeCode = true, deploy = false', () => {
    expect(shouldSkipWorkerAssignment('test-only')).toBe(false);
    expect(shouldWriteCode('test-only')).toBe(true);
    expect(shouldAllowDeployment('test-only')).toBe(false);
  });

  it('full: skip = false, writeCode = true, deploy = true', () => {
    expect(shouldSkipWorkerAssignment('full')).toBe(false);
    expect(shouldWriteCode('full')).toBe(true);
    expect(shouldAllowDeployment('full')).toBe(true);
  });
});

describe('estimateRunCost', () => {
  const STORY_IDS = ['story_001', 'story_002', 'story_003'];

  it('returns a stable shape with all fields', () => {
    const out = estimateRunCost('full', STORY_IDS);
    expect(out.mode).toBe('full');
    expect(out.totalStories).toBe(3);
    expect(out.totalInputTokens).toBeGreaterThan(0);
    expect(out.totalOutputTokens).toBeGreaterThan(0);
    expect(out.estimatedUsd).toBeGreaterThan(0);
    expect(out.perStory).toHaveLength(3);
    expect(out.perStory[0]?.storyId).toBe('story_001');
  });

  it('plan-only excludes coding-agent tokens (so estimate is lower than full)', () => {
    const fullEst = estimateRunCost('full', STORY_IDS);
    const planEst = estimateRunCost('plan-only', STORY_IDS);
    expect(planEst.totalInputTokens).toBeLessThan(fullEst.totalInputTokens);
    expect(planEst.totalOutputTokens).toBeLessThan(fullEst.totalOutputTokens);
    expect(planEst.estimatedUsd).toBeLessThan(fullEst.estimatedUsd);
  });

  it('test-only matches full on token count (coding still runs)', () => {
    const fullEst = estimateRunCost('full', STORY_IDS);
    const testEst = estimateRunCost('test-only', STORY_IDS);
    expect(testEst.totalInputTokens).toBe(fullEst.totalInputTokens);
    expect(testEst.totalOutputTokens).toBe(fullEst.totalOutputTokens);
    expect(testEst.estimatedUsd).toBe(fullEst.estimatedUsd);
  });

  it('totals scale linearly with story count', () => {
    const oneStory = estimateRunCost('full', ['s1']);
    const tenStories = estimateRunCost('full', Array.from({ length: 10 }, (_, i) => `s${i}`));
    expect(tenStories.totalInputTokens).toBe(oneStory.totalInputTokens * 10);
    expect(tenStories.totalOutputTokens).toBe(oneStory.totalOutputTokens * 10);
    // USD is rounded to 4 decimals so allow tiny drift
    expect(Math.abs(tenStories.estimatedUsd - oneStory.estimatedUsd * 10)).toBeLessThan(0.001);
  });

  it('handles zero stories', () => {
    const out = estimateRunCost('full', []);
    expect(out.totalStories).toBe(0);
    expect(out.totalInputTokens).toBe(0);
    expect(out.totalOutputTokens).toBe(0);
    expect(out.estimatedUsd).toBe(0);
    expect(out.perStory).toEqual([]);
  });

  it('per-story estimate is uniform for a uniform-mode run', () => {
    const out = estimateRunCost('full', STORY_IDS);
    const first = out.perStory[0]!;
    for (const ps of out.perStory) {
      expect(ps.totalInputTokens).toBe(first.totalInputTokens);
      expect(ps.totalOutputTokens).toBe(first.totalOutputTokens);
      expect(ps.estimatedUsd).toBe(first.estimatedUsd);
    }
  });

  it('is deterministic on repeated calls', () => {
    const a = estimateRunCost('full', STORY_IDS);
    const b = estimateRunCost('full', STORY_IDS);
    expect(a).toEqual(b);
  });

  it('records the mode it was called with', () => {
    expect(estimateRunCost('full', STORY_IDS).mode).toBe('full');
    expect(estimateRunCost('plan-only', STORY_IDS).mode).toBe('plan-only');
    expect(estimateRunCost('test-only', STORY_IDS).mode).toBe('test-only');
  });
});
