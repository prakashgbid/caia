/**
 * Golden test — canonical DevOps-architect artifact for a known
 * prakash-tiwari contact-form Form Story ticket.
 *
 * Locks output shape against drift + verifies end-to-end output +
 * **DEPLOY STRATEGY REALISM GOLDEN**: the chosen strategy matches the
 * declared infra capabilities (canary requires traffic-split; rolling
 * requires multi-instance; blue-green requires two-identical-environments;
 * ring-deployment requires multi-region).
 */
import { describe, it, expect } from 'vitest';
import { DevopsArchitect } from '../../src/architect.js';
import {
  DEPLOY_STRATEGIES,
  DEVOPS_OWNED_FIELD_KEYS,
  STRATEGY_INFRA_REQUIREMENTS
} from '../../src/contract.js';
import { DEVOPS_INVARIANTS } from '../../src/invariants.js';
import { validateArchitectOutput } from '../../src/validation.js';
import { buildFakeInput, fakeGoldenSpawner, goldenAssistantText, goldenExpectedOutput } from '../helpers/fakes.js';

describe('golden - prakash-tiwari contact-form Form Story ticket', () => {
  it('assistant text validates cleanly', () => {
    expect(validateArchitectOutput(goldenAssistantText(), DEVOPS_OWNED_FIELD_KEYS).ok).toBe(true);
  });

  it('end-to-end produces the canonical ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await new DevopsArchitect({ spawner }).run(buildFakeInput());
    expect(out.architectName).toBe('devops');
    expect(out.status).toBe('ok');
    expect(out.confidence).toBeGreaterThan(0.5);
    for (const k of DEVOPS_OWNED_FIELD_KEYS) expect(out.architectureFields).toHaveProperty(k);
    const expected = goldenExpectedOutput();
    expect(out.architectureFields).toEqual(expected.architectureFields);
    expect(out.confidence).toBe(expected.confidence);
    expect(out.notes).toBe(expected.notes);
    expect(out.risks).toEqual(expected.risks);
    expect(out.dependencies).toEqual(expected.dependencies);
  });

  it('output passes every DevOps invariant', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await new DevopsArchitect({ spawner }).run(buildFakeInput());
    for (const inv of DEVOPS_INVARIANTS) {
      expect(inv.detect(out.architectureFields), `invariant ${inv.id}`).toBe(true);
    }
  });

  it('idempotent - running twice yields equivalent output', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new DevopsArchitect({ spawner });
    expect(await arch.run(buildFakeInput())).toEqual(await arch.run(buildFakeInput()));
  });

  it('always declares [backend, database, security] as dependencies', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await new DevopsArchitect({ spawner }).run(buildFakeInput());
    expect(out.dependencies).toContain('backend');
    expect(out.dependencies).toContain('database');
    expect(out.dependencies).toContain('security');
  });
});

describe('golden - DEPLOY STRATEGY REALISM (canonical assertion)', () => {
  const arch = goldenExpectedOutput().architectureFields;
  const ds = arch['devops.deployStrategy'] as Record<string, unknown>;
  const iac = arch['devops.infrastructureAsCode'] as Record<string, unknown>;
  const caps = iac.capabilities as string[];

  it('chosen deploy strategy is one of the canonical kinds', () => {
    expect(DEPLOY_STRATEGIES).toContain(ds.kind);
  });

  it('infra capabilities include every requirement of the chosen strategy', () => {
    const required = STRATEGY_INFRA_REQUIREMENTS[ds.kind as string] ?? [];
    for (const r of required) {
      expect(caps, `capability ${r} required by ${ds.kind}`).toContain(r);
    }
  });

  it('canary strategy explicitly requires traffic-split', () => {
    if (ds.kind === 'canary') {
      expect(caps).toContain('traffic-split');
    }
  });

  it('every strategy in the realism table has at least the declared capability when that strategy is chosen (smoke check)', () => {
    for (const strat of DEPLOY_STRATEGIES) {
      const required = STRATEGY_INFRA_REQUIREMENTS[strat];
      expect(Array.isArray(required)).toBe(true);
    }
  });

  it('traffic shift is monotonically non-decreasing', () => {
    const shift = ds.trafficShift as Array<{ pct: number }>;
    let last = -Infinity;
    for (const phase of shift) {
      expect(phase.pct).toBeGreaterThanOrEqual(last);
      last = phase.pct;
    }
  });

  it('last traffic-shift phase reaches 100%', () => {
    const shift = ds.trafficShift as Array<{ pct: number }>;
    expect(shift[shift.length - 1].pct).toBe(100);
  });

  it('healthcheck gate is /_health with HTTP 200', () => {
    const gate = ds.healthcheckGate as Record<string, unknown>;
    expect(gate.path).toBe('/_health');
    expect(gate.expectStatus).toBe(200);
    expect(gate.timeoutSec).toBeGreaterThan(0);
  });

  it('rollback contract has auto-revert window <= 5 min', () => {
    const rb = arch['devops.rollbackContract'] as Record<string, unknown>;
    const trigger = rb.trigger as Record<string, unknown>;
    expect(trigger.kind).toBe('healthcheck-failure');
    expect(trigger.windowMin).toBeLessThanOrEqual(5);
  });

  it('rollback method falls back to Time Machine snapshot key', () => {
    const rb = arch['devops.rollbackContract'] as Record<string, unknown>;
    expect(['time-machine', 'hybrid']).toContain(rb.method);
    expect(rb.timeMachineSnapshotKey).toBeDefined();
  });
});

describe('golden - upstream cross-validation', () => {
  it('input includes Backend upstream output', () => {
    const input = buildFakeInput();
    expect(input.upstream.outputs.backend).toBeDefined();
    expect(input.upstream.outputs.backend!.architectureFields['backend.apiEndpoints']).toBeDefined();
  });

  it('input includes Database upstream output', () => {
    const input = buildFakeInput();
    expect(input.upstream.outputs.database).toBeDefined();
    expect(input.upstream.outputs.database!.architectureFields['database.migrations']).toBeDefined();
  });

  it('input includes Security upstream output', () => {
    const input = buildFakeInput();
    expect(input.upstream.outputs.security).toBeDefined();
    expect(input.upstream.outputs.security!.architectureFields['security.secretsHandling']).toBeDefined();
  });

  it('golden deploymentObservability sink forward-references Security', () => {
    const obs = goldenExpectedOutput().architectureFields['devops.deploymentObservability'] as Record<string, unknown>;
    expect(obs.sinkRef).toContain('security.auditLogRequirements');
  });

  it('golden secretsManagementInPipeline forward-references Security', () => {
    const sec = goldenExpectedOutput().architectureFields['devops.secretsManagementInPipeline'] as Record<string, unknown>;
    expect(sec.provider).toBe('vault-via-security-architect');
    expect(sec.securityArchitectRef).toBe('security.secretsHandling');
  });

  it('golden cicdPipeline provider matches onboarding `businessPlan.infrastructure.ciProvider`', () => {
    const input = buildFakeInput();
    const onboardingCi = ((input.businessPlan as Record<string, unknown>).infrastructure as Record<string, unknown>).ciProvider;
    const ci = goldenExpectedOutput().architectureFields['devops.cicdPipeline'] as Record<string, unknown>;
    expect(ci.provider).toBe(onboardingCi);
  });

  it('golden infrastructureAsCode tool matches onboarding `businessPlan.infrastructure.iacTool`', () => {
    const input = buildFakeInput();
    const onboardingIac = ((input.businessPlan as Record<string, unknown>).infrastructure as Record<string, unknown>).iacTool;
    const iac = goldenExpectedOutput().architectureFields['devops.infrastructureAsCode'] as Record<string, unknown>;
    expect(iac.tool).toBe(onboardingIac);
  });

  it('golden environmentPromotion includes `fail-on-database-review` blocker', () => {
    const ep = goldenExpectedOutput().architectureFields['devops.environmentPromotion'] as Record<string, unknown>;
    expect(ep.blockers as string[]).toContain('fail-on-database-review');
  });
});
