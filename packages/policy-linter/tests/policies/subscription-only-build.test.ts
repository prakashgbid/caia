import { describe, expect, it } from 'vitest';
import {
  subscriptionOnlyBuildPolicy,
  findPaidBriefPhrasings,
  findPaidEnvKeys,
  findPaidTools
} from '../../src/policies/subscription-only-build.js';
import { makeCtx } from '../fixtures.js';

describe('subscription-only-build policy', () => {
  describe('pass cases', () => {
    it('passes a clean brief with subscription-only phrasing', async () => {
      const v = await subscriptionOnlyBuildPolicy.check(
        makeCtx({
          briefMd: 'Runs on the Claude Pro subscription. $0 marginal cost.'
        })
      );
      expect(v.ok).toBe(true);
    });

    it('passes when env keys do not include API keys', async () => {
      const v = await subscriptionOnlyBuildPolicy.check(
        makeCtx({ envKeys: ['PATH', 'HOME', 'NODE_ENV'] })
      );
      expect(v.ok).toBe(true);
    });

    it('passes when toolList contains only sanctioned tools', async () => {
      const v = await subscriptionOnlyBuildPolicy.check(
        makeCtx({ toolList: ['Read', 'Edit', 'Bash'] })
      );
      expect(v.ok).toBe(true);
    });
  });

  describe('fail cases', () => {
    it('fails when ANTHROPIC_API_KEY appears in envKeys', async () => {
      const v = await subscriptionOnlyBuildPolicy.check(
        makeCtx({ envKeys: ['ANTHROPIC_API_KEY'] })
      );
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.mode).toBe('hard-fail');
    });

    it('fails when OPENAI_API_KEY is in envKeys', async () => {
      const v = await subscriptionOnlyBuildPolicy.check(
        makeCtx({ envKeys: ['OPENAI_API_KEY'] })
      );
      expect(v.ok).toBe(false);
    });

    it('fails on MAX_TOKENS env var', async () => {
      const v = await subscriptionOnlyBuildPolicy.check(
        makeCtx({ envKeys: ['MAX_TOKENS'] })
      );
      expect(v.ok).toBe(false);
    });

    it('fails on "$3 per million" cost reference in brief', async () => {
      const v = await subscriptionOnlyBuildPolicy.check(
        makeCtx({ briefMd: 'Budget: $3 per million tokens.' })
      );
      expect(v.ok).toBe(false);
    });

    it('fails on max-tokens budget line', async () => {
      const v = await subscriptionOnlyBuildPolicy.check(
        makeCtx({ briefMd: 'Set max_tokens: 4000.' })
      );
      expect(v.ok).toBe(false);
    });

    it('fails on paid SaaS upgrade phrasing', async () => {
      const v = await subscriptionOnlyBuildPolicy.check(
        makeCtx({ briefMd: 'Upgrade to a paid plan to enable feature X.' })
      );
      expect(v.ok).toBe(false);
    });

    it('fails when estimatedCost > 0', async () => {
      const v = await subscriptionOnlyBuildPolicy.check(
        makeCtx({ estimatedCost: 0.01 })
      );
      expect(v.ok).toBe(false);
    });

    it('fails on paid tool in toolList', async () => {
      const v = await subscriptionOnlyBuildPolicy.check(
        makeCtx({ toolList: ['anthropic-api'] })
      );
      expect(v.ok).toBe(false);
    });
  });

  describe('safe-phrase allowlist', () => {
    it('does not flag "Claude Pro subscription"', () => {
      const m = findPaidBriefPhrasings('Runs on the Claude Pro subscription.');
      expect(m).toHaveLength(0);
    });

    it('does not flag "$0" / "zero-dollar"', () => {
      const m = findPaidBriefPhrasings('$0 marginal cost. Zero-dollar budget.');
      expect(m).toHaveLength(0);
    });
  });

  describe('helpers', () => {
    it('findPaidEnvKeys catches generic _API_KEY suffix', () => {
      const e = findPaidEnvKeys(['CUSTOMSERVICE_API_KEY']);
      expect(e.length).toBeGreaterThan(0);
    });
    it('findPaidTools matches "-billable" suffix tools', () => {
      const e = findPaidTools(['gpt-billable']);
      expect(e.length).toBeGreaterThan(0);
    });
  });

  describe('remediation', () => {
    it('suggestedFix mentions OperatorEscalation for billing changes', async () => {
      const v = await subscriptionOnlyBuildPolicy.check(
        makeCtx({ envKeys: ['ANTHROPIC_API_KEY'] })
      );
      if (v.ok) throw new Error('expected fail');
      expect(v.suggestedFix).toMatch(/OperatorEscalation/);
    });
  });
});
