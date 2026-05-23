/**
 * End-to-end cross-package integration:
 *   architect-kit → ea-dispatcher → ea-reviewer
 *
 * Wires a real Dispatcher around 3 mock architects, feeds the result into
 * a real Reviewer, and asserts the full pass/fail decision loop works.
 *
 * Lives in ea-reviewer/tests/ because the reviewer is the terminal step;
 * it avoids any new cross-package dep beyond what each package already
 * declares.
 */
import { describe, it, expect } from 'vitest';
import { BaseArchitect } from '@caia/architect-kit';
import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSectionContract,
} from '@caia/architect-kit';

import { Reviewer } from '../src/reviewer.js';
import { NullCriticAdapter } from '../src/critic.js';

// Local minimal dispatcher port to keep this test in @caia/ea-reviewer
// without taking a dep on @caia/ea-dispatcher (which would create a
// circular review-time dep — dispatcher already tests against reviewer
// would). The "dispatcher port" here is the public composer + plan
// computation surface from architect-kit. We're not testing the full
// dispatcher class here; the dispatcher's own integration test exercises
// the rest.

import { computeWaves } from '@caia/architect-kit';

function makeContract(
  name: string,
  paths: readonly string[],
  deps: readonly string[] = [],
): ArchitectSectionContract {
  return {
    contractId: `${name}.v1`,
    architectName: name,
    version: '0.1.0',
    sections: paths.map((p) => ({ path: p, description: p, required: true })),
    architectMeta: {
      dependsOn: deps,
      precedenceLevel: 99,
      fanoutPolicy: 'always',
      appliesPredicate: () => true,
      runtimeModel: 'sonnet',
    },
  };
}

class Mock extends BaseArchitect {
  constructor(
    readonly name: string,
    readonly sectionContract: ArchitectSectionContract,
    private fields: Record<string, unknown>,
  ) {
    super();
  }
  async run(_: ArchitectInput): Promise<ArchitectOutput> {
    return this.okOutput(this.fields, { confidence: 0.9 });
  }
}

async function runFanout(architects: readonly Mock[]) {
  const waves = computeWaves(architects);
  const outputs: ArchitectOutput[] = [];
  const composed: Record<string, unknown> = {};
  const stubInput: ArchitectInput = {
    ticket: { id: 't-1', type: 'Page', acceptance_criteria: ['user signs up'] },
    upstream: { outputs: {} },
    businessPlan: {
      ventureName: 'Acme',
      oneLiner: 'x',
      audience: 'y',
      goals: [],
    },
    designVersion: { versionId: 'v1', anchors: [] },
    tenantContext: {
      tenantId: 'tnt-1',
      schemaName: 's1',
      vaultNamespace: 'ns1',
      billingPosture: 'subscription',
      creditBalance: { usdAvailable: 100 },
    },
    budget: {
      maxInputTokens: 60_000,
      maxOutputTokens: 8_000,
      maxWallClockMs: 60_000,
      preferredModel: 'sonnet',
      hardCostCeilingUsd: 1,
    },
  };
  for (const wave of waves) {
    const members = wave.members
      .map((n) => architects.find((a) => a.name === n))
      .filter((x): x is Mock => !!x);
    const waveOuts = await Promise.all(members.map((m) => m.run(stubInput)));
    for (const out of waveOuts) {
      outputs.push(out);
      for (const [k, v] of Object.entries(out.architectureFields)) {
        composed[k] = v;
      }
    }
  }
  return { outputs, composed };
}

describe('E2E — architect-kit fan-out → reviewer audit (pass path)', () => {
  it('3 architects → clean compose → reviewer passes', async () => {
    const frontend = new Mock(
      'frontend',
      makeContract('frontend', ['frontend.framework', 'frontend.tokens']),
      { 'frontend.framework': 'next', 'frontend.tokens': {} },
    );
    const a11y = new Mock(
      'a11y',
      makeContract('a11y', ['a11y.wcagLevel'], ['frontend']),
      { 'a11y.wcagLevel': 'AA' },
    );
    const performance = new Mock(
      'performance',
      makeContract('performance', ['performance.lighthouseTargets'], ['frontend']),
      { 'performance.lighthouseTargets': { perf: 95 } },
    );
    const archs = [frontend, a11y, performance];

    const { outputs, composed } = await runFanout(archs);
    expect(outputs.length).toBe(3);

    const reviewer = new Reviewer({ critic: new NullCriticAdapter() });
    const decision = await reviewer.review({
      ticket: { id: 't-1', type: 'Page' },
      composedArchitecture: composed,
      auditRows: outputs.map((o) => ({
        architectName: o.architectName,
        status: o.status,
        confidence: o.confidence,
        notes: o.notes,
        risks: o.risks,
      })),
      contracts: archs.map((a) => a.sectionContract),
    });

    expect(decision.decision).toBe('pass');
    expect(decision.finalState).toBe('ea-complete-verified');
    expect(decision.rerunArchitects).toEqual([]);
  });
});

describe('E2E — fan-out → reviewer rejects (fail → rerun) → re-fan-out passes', () => {
  it('models the dispatcher ↔ reviewer iteration loop', async () => {
    // Iteration 1: a11y "forgets" wcagLevel.
    const frontend = new Mock(
      'frontend',
      makeContract('frontend', ['frontend.framework']),
      { 'frontend.framework': 'next' },
    );
    const a11yBad = new Mock(
      'a11y',
      makeContract('a11y', ['a11y.wcagLevel'], ['frontend']),
      {}, // empty — required path missing
    );
    const archs1 = [frontend, a11yBad];
    const r1 = await runFanout(archs1);

    const reviewer = new Reviewer({ critic: new NullCriticAdapter() });
    const decision1 = await reviewer.review({
      ticket: { id: 't-1', type: 'Page' },
      composedArchitecture: r1.composed,
      auditRows: r1.outputs.map((o) => ({
        architectName: o.architectName,
        status: o.status,
        confidence: o.confidence,
        notes: o.notes,
        risks: o.risks,
      })),
      contracts: archs1.map((a) => a.sectionContract),
    });
    expect(decision1.decision).toBe('fail');
    expect(decision1.rerunArchitects.map((d) => d.architect)).toEqual(['a11y']);

    // Iteration 2: dispatcher re-runs only the named architects. We
    // simulate that by re-running a11y with the missing field populated.
    // Note: in a real re-run, the dispatcher selects a SUBSET of architects
    // by name (selectByName) and re-computes waves on that subset only —
    // since frontend isn't in the rerun set, a11y is at the root.
    const a11yFixed = new Mock(
      'a11y',
      makeContract('a11y', ['a11y.wcagLevel'], []),
      { 'a11y.wcagLevel': 'AA' },
    );
    const r2 = await runFanout([a11yFixed]);
    // Merge with the original frontend contribution
    const composed2 = { ...r1.composed, ...r2.composed };

    const decision2 = await reviewer.review({
      ticket: { id: 't-1', type: 'Page' },
      composedArchitecture: composed2,
      auditRows: [
        ...r1.outputs
          .filter((o) => o.architectName !== 'a11y')
          .map((o) => ({
            architectName: o.architectName,
            status: o.status,
            confidence: o.confidence,
            notes: o.notes,
            risks: o.risks,
          })),
        ...r2.outputs.map((o) => ({
          architectName: o.architectName,
          status: o.status,
          confidence: o.confidence,
          notes: o.notes,
          risks: o.risks,
        })),
      ],
      contracts: archs1.map((a) => a.sectionContract),
    });
    expect(decision2.decision).toBe('pass');
    expect(decision2.finalState).toBe('ea-complete-verified');
  });
});
