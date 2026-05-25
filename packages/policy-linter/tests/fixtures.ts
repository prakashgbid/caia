/**
 * Test fixtures + helpers for the policy-linter test suite.
 *
 * `makeCtx(overrides)` returns a fully-populated default `DispatchContext`
 * that every policy treats as "pass" by default. Individual tests override
 * the fields needed to fire one policy at a time.
 */

import type {
  DispatchContext,
  DispatchIntent,
  DodStewardSnapshot
} from '../src/types.js';

export function makeCtx(
  overrides: Partial<DispatchContext> = {}
): DispatchContext {
  const base: DispatchContext = {
    callerAgentId: 'test-agent',
    briefMd:
      '# Default brief\n\nDoes nothing notable. No calendar times, no MUI, no paid APIs.\n\n## Next dispatch\n\n- Follow-up: none planned.\n\nNo follow-up because this is a fixture.',
    toolList: ['Read', 'Edit', 'Bash'],
    estimatedTokens: 0,
    estimatedCost: 0,
    targetRepos: ['some-third-party-repo'],
    intent: 'ops' as DispatchIntent,
    eaPlanSubmissionId: 'fixture-submission-id',
    dodStewards: freshGreenStewards(),
    metadata: {}
  };
  return { ...base, ...overrides };
}

export function freshGreenStewards(): DodStewardSnapshot {
  return {
    activationSteward: 'green',
    eaDocSteward: 'green',
    outcomeSteward: 'green',
    planDefender: 'green',
    snapshotAt: new Date().toISOString()
  };
}

export function staleGreenStewards(): DodStewardSnapshot {
  const old = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  return {
    activationSteward: 'green',
    eaDocSteward: 'green',
    outcomeSteward: 'green',
    planDefender: 'green',
    snapshotAt: old
  };
}

export function redStewardSnapshot(
  failing: keyof DodStewardSnapshot
): DodStewardSnapshot {
  const snap = freshGreenStewards();
  (snap as Record<string, unknown>)[failing] = 'red';
  return snap;
}
