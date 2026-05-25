import { describe, expect, it } from 'vitest';

import { ScriptedLlmCaller } from '../src/llm.js';
import { reviewPrompt, recommendationFromScore } from '../src/reviewer/prompt-reviewer.js';
import type { DesignAppPromptOutput } from '../src/types/design-app.js';
import { sampleIa, samplePlan } from './fixtures/sample-plan.js';

function envelope(): DesignAppPromptOutput {
  return {
    target: 'claude_design',
    prompt_text: 'a brief',
    prompt_files: [],
    prompt_metadata: {
      palette: { paper: '#FFFFFF', ink: '#0F172A', accent: '#0E7490' },
      type_pairing: { display: 'Fraunces', body: 'Inter' },
      accent_options: [],
      layout_patterns: [],
      reference_urls: [],
      motion_preference: 'restrained',
      platform_strategy: 'pwa-only',
    },
    instructions_for_customer: 'Paste into claude.ai.',
  };
}

function reviewerJson(score: number, recommendation: 'ship' | 'retry' | 'escalate' = 'ship'): string {
  return JSON.stringify({
    composite_score: score,
    dimensions: {
      coverage: score,
      specificity: score,
      target_fit: score,
      creativity_surface: score,
      no_drift: score,
      polish: score,
    },
    findings: [],
    recommendation,
  });
}

describe('reviewPrompt', () => {
  it('parses a good-prompt reviewer output (score 88, ship)', async () => {
    const caller = new ScriptedLlmCaller([{ kind: 'ok', text: reviewerJson(88, 'ship') }]);
    const out = await reviewPrompt({
      llmCaller: caller,
      plan: samplePlan(),
      ia: sampleIa(),
      envelope: envelope(),
      target: 'claude_design',
    });
    expect(out.composite_score).toBeGreaterThanOrEqual(70);
    expect(out.recommendation).toBe('ship');
  });

  it('parses a bad-prompt reviewer output (score 45, retry)', async () => {
    const caller = new ScriptedLlmCaller([{ kind: 'ok', text: reviewerJson(45, 'retry') }]);
    const out = await reviewPrompt({
      llmCaller: caller,
      plan: samplePlan(),
      ia: sampleIa(),
      envelope: envelope(),
      target: 'claude_design',
    });
    expect(out.composite_score).toBeLessThan(70);
    expect(out.recommendation).toBe('retry');
  });

  it('recomputes composite when model disagrees by > 1 point', async () => {
    // Model claims 50 but dimensions all average 90.
    const bad = JSON.stringify({
      composite_score: 50,
      dimensions: {
        coverage: 90,
        specificity: 90,
        target_fit: 90,
        creativity_surface: 90,
        no_drift: 90,
        polish: 90,
      },
      findings: [],
      recommendation: 'retry',
    });
    const caller = new ScriptedLlmCaller([{ kind: 'ok', text: bad }]);
    const out = await reviewPrompt({
      llmCaller: caller,
      plan: samplePlan(),
      ia: sampleIa(),
      envelope: envelope(),
      target: 'claude_design',
    });
    expect(out.composite_score).toBeCloseTo(90, 1);
  });

  it('propagates reviewer_failed when LLM call fails', async () => {
    const caller = new ScriptedLlmCaller([{ kind: 'fail', diagnostic: 'simulated' }]);
    await expect(
      reviewPrompt({
        llmCaller: caller,
        plan: samplePlan(),
        ia: sampleIa(),
        envelope: envelope(),
        target: 'claude_design',
      }),
    ).rejects.toMatchObject({ code: 'reviewer_failed' });
  });
});

describe('recommendationFromScore', () => {
  it('ship at >= 70', () => expect(recommendationFromScore(85)).toBe('ship'));
  it('retry below 70', () => expect(recommendationFromScore(69)).toBe('retry'));
});
