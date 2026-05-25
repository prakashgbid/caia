/** Cross-cutting invariant: rendered prompts never contain credential values. */
import { describe, expect, it } from 'vitest';

import { ScriptedLlmCaller } from '../src/llm.js';
import { reviewPrompt } from '../src/reviewer/prompt-reviewer.js';
import { sampleIa, samplePlan } from './fixtures/sample-plan.js';
import type { DesignAppPromptOutput } from '../src/types/design-app.js';

const SECRETS = [
  'sk_test_DO_NOT_LEAK_123456',
  'ghp_aaaabbbbccccdddd11112222',
  'rdb-pass-XYZ-confidential',
];

function cleanEnvelope(): DesignAppPromptOutput {
  return {
    target: 'claude_design',
    prompt_text: '# Brief\nA neutral brief.',
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

describe('no-secret-leak invariant', () => {
  it('a clean envelope never contains any secret values', () => {
    const env = cleanEnvelope();
    const serialised = JSON.stringify(env);
    for (const s of SECRETS) {
      expect(serialised.includes(s)).toBe(false);
    }
  });

  it('the reviewer never echoes back secret values', async () => {
    // Even though the LLM caller is scripted to return a clean review,
    // we belt-and-brace check that the *envelope* fed in has no secret.
    const env = cleanEnvelope();
    const caller = new ScriptedLlmCaller([
      {
        kind: 'ok',
        text: JSON.stringify({
          composite_score: 85,
          dimensions: {
            coverage: 85, specificity: 85, target_fit: 85,
            creativity_surface: 85, no_drift: 85, polish: 85,
          },
          findings: [],
          recommendation: 'ship',
        }),
      },
    ]);
    const out = await reviewPrompt({
      llmCaller: caller, plan: samplePlan(), ia: sampleIa(),
      envelope: env, target: 'claude_design',
    });
    const serialised = JSON.stringify(out);
    for (const s of SECRETS) {
      expect(serialised.includes(s)).toBe(false);
    }
  });
});
