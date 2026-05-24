/**
 * Tier-2 confirmation. In production this wraps a Claude call that
 * cross-checks the event against the principle's full statement. The
 * default heuristic implementation here confirms based on severity +
 * payload structure — useful for tests and for the no-LLM cost-budget
 * mode where tier 2 is bypassed.
 */

import type { PrincipleRecord } from '@caia/ea-architect';

import type { Tier1Hit, Tier2Adapter, Tier2Confirmation } from './types.js';

/** Default tier-2 — heuristic, no LLM. */
export class HeuristicTier2Adapter implements Tier2Adapter {
  async confirm(hit: Tier1Hit): Promise<Tier2Confirmation> {
    // High-severity rules auto-confirm + escalate.
    if (hit.severity === 'block') {
      return {
        confirmed: true,
        reasoning: `Tier-1 rule ${hit.ruleId} fired at severity 'block'. Auto-confirming and escalating.`,
        escalate: true
      };
    }
    // Warn-level rules: confirm but don't necessarily escalate.
    if (hit.severity === 'warn') {
      return {
        confirmed: true,
        reasoning: `Tier-1 rule ${hit.ruleId} fired at severity 'warn'. Confirming but not escalating; emit principle-violated event only.`,
        escalate: false
      };
    }
    return {
      confirmed: false,
      reasoning: `Tier-1 rule ${hit.ruleId} fired at severity 'info'; tier-2 heuristic dismisses.`,
      escalate: false
    };
  }
}

/** Stub tier-2 for tests — returns a configured response. */
export class StubTier2Adapter implements Tier2Adapter {
  public calls: Tier1Hit[] = [];
  constructor(private readonly response: Tier2Confirmation) {}
  async confirm(hit: Tier1Hit, _: PrincipleRecord[]): Promise<Tier2Confirmation> {
    void _;
    this.calls.push(hit);
    return this.response;
  }
}
