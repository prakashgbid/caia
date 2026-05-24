/**
 * Cross-architect invariants — verifies DevOps's contributions to the
 * EA Reviewer's invariant registry (per spec §6.2).
 */
import { describe, it, expect } from 'vitest';
import { DEVOPS_INVARIANTS } from '../src/invariants.js';
import { goldenExpectedOutput } from './helpers/fakes.js';

describe('DEVOPS_INVARIANTS - structural', () => {
  it('declares at least one invariant', () => {
    expect(DEVOPS_INVARIANTS.length).toBeGreaterThan(0);
  });
  it('every invariant has a stable id', () => {
    const seen = new Set<string>();
    for (const inv of DEVOPS_INVARIANTS) {
      expect(inv.id.length).toBeGreaterThan(0);
      expect(seen.has(inv.id)).toBe(false);
      seen.add(inv.id);
    }
  });
  it('every invariant is contributed by `devops`', () => {
    for (const inv of DEVOPS_INVARIANTS) {
      expect(inv.contributor).toBe('devops');
    }
  });
  it('every invariant declares a non-empty `reads` list', () => {
    for (const inv of DEVOPS_INVARIANTS) {
      expect(inv.reads.length).toBeGreaterThan(0);
    }
  });
  it('every invariant has a valid severity', () => {
    for (const inv of DEVOPS_INVARIANTS) {
      expect(['fail', 'advisory']).toContain(inv.severity);
    }
  });
  it('every invariant has a non-empty description', () => {
    for (const inv of DEVOPS_INVARIANTS) {
      expect(inv.description.length).toBeGreaterThan(20);
    }
  });
});

describe('DEVOPS_INVARIANTS - predicate behaviour against the golden fixture', () => {
  const goldenArch = goldenExpectedOutput().architectureFields;

  it('every invariant passes against the canonical good output', () => {
    for (const inv of DEVOPS_INVARIANTS) {
      const ok = inv.detect(goldenArch);
      expect(ok, `invariant ${inv.id} should pass on the golden fixture`).toBe(true);
    }
  });

  it('deployStrategy-kind-allowed fails on an unknown strategy', () => {
    const inv = DEVOPS_INVARIANTS.find(i => i.id === 'devops.deployStrategy-kind-allowed');
    expect(inv).toBeDefined();
    const corrupted = { ...goldenArch, 'devops.deployStrategy': { kind: 'yolo-deploy' } };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('deployStrategy-requires-realistic-infra fails when canary lacks traffic-split', () => {
    const inv = DEVOPS_INVARIANTS.find(i => i.id === 'devops.deployStrategy-requires-realistic-infra');
    expect(inv).toBeDefined();
    const iac = goldenArch['devops.infrastructureAsCode'] as Record<string, unknown>;
    const corrupted = {
      ...goldenArch,
      'devops.infrastructureAsCode': { ...iac, capabilities: ['multi-instance'] }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('deployStrategy-requires-realistic-infra fails when blue-green lacks two-identical-environments', () => {
    const inv = DEVOPS_INVARIANTS.find(i => i.id === 'devops.deployStrategy-requires-realistic-infra');
    const iac = goldenArch['devops.infrastructureAsCode'] as Record<string, unknown>;
    const corrupted = {
      ...goldenArch,
      'devops.deployStrategy': {
        ...(goldenArch['devops.deployStrategy'] as Record<string, unknown>),
        kind: 'blue-green'
      },
      'devops.infrastructureAsCode': { ...iac, capabilities: ['traffic-split', 'multi-instance'] }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('deployStrategy-requires-realistic-infra fails when ring-deployment lacks multi-region', () => {
    const inv = DEVOPS_INVARIANTS.find(i => i.id === 'devops.deployStrategy-requires-realistic-infra');
    const iac = goldenArch['devops.infrastructureAsCode'] as Record<string, unknown>;
    const corrupted = {
      ...goldenArch,
      'devops.deployStrategy': {
        ...(goldenArch['devops.deployStrategy'] as Record<string, unknown>),
        kind: 'ring-deployment'
      },
      'devops.infrastructureAsCode': { ...iac, capabilities: ['traffic-split'] }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('deployStrategy-requires-realistic-infra fails when rolling lacks multi-instance', () => {
    const inv = DEVOPS_INVARIANTS.find(i => i.id === 'devops.deployStrategy-requires-realistic-infra');
    const iac = goldenArch['devops.infrastructureAsCode'] as Record<string, unknown>;
    const corrupted = {
      ...goldenArch,
      'devops.deployStrategy': {
        ...(goldenArch['devops.deployStrategy'] as Record<string, unknown>),
        kind: 'rolling'
      },
      'devops.infrastructureAsCode': { ...iac, capabilities: ['traffic-split'] }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('deployStrategy-requires-realistic-infra passes when recreate has no required capabilities', () => {
    const inv = DEVOPS_INVARIANTS.find(i => i.id === 'devops.deployStrategy-requires-realistic-infra');
    const iac = goldenArch['devops.infrastructureAsCode'] as Record<string, unknown>;
    const variant = {
      ...goldenArch,
      'devops.deployStrategy': {
        ...(goldenArch['devops.deployStrategy'] as Record<string, unknown>),
        kind: 'recreate'
      },
      'devops.infrastructureAsCode': { ...iac, capabilities: [] }
    };
    expect(inv!.detect(variant)).toBe(true);
  });

  it('healthcheck-gate-declared fails when path is missing', () => {
    const inv = DEVOPS_INVARIANTS.find(i => i.id === 'devops.healthcheck-gate-declared');
    const ds = goldenArch['devops.deployStrategy'] as Record<string, unknown>;
    const corrupted = {
      ...goldenArch,
      'devops.deployStrategy': { ...ds, healthcheckGate: { timeoutSec: 30, expectStatus: 200 } }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('rollback-auto-revert-window fails when window exceeds 5 min', () => {
    const inv = DEVOPS_INVARIANTS.find(i => i.id === 'devops.rollback-auto-revert-window');
    const corrupted = {
      ...goldenArch,
      'devops.rollbackContract': {
        ...(goldenArch['devops.rollbackContract'] as Record<string, unknown>),
        trigger: { kind: 'healthcheck-failure', windowMin: 15 }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('rollback-method-allowed fails on `pray-and-wait`', () => {
    const inv = DEVOPS_INVARIANTS.find(i => i.id === 'devops.rollback-method-allowed');
    const corrupted = {
      ...goldenArch,
      'devops.rollbackContract': {
        ...(goldenArch['devops.rollbackContract'] as Record<string, unknown>),
        method: 'pray-and-wait'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('env-promotion-manual-staging-to-prod fails when prod auto-promotes', () => {
    const inv = DEVOPS_INVARIANTS.find(i => i.id === 'devops.env-promotion-manual-staging-to-prod');
    const ep = goldenArch['devops.environmentPromotion'] as Record<string, unknown>;
    const envs = (ep.environments as Array<Record<string, unknown>>).map(e =>
      e.name === 'prod' ? { ...e, autoPromote: true, gateKind: 'none' } : e
    );
    const corrupted = { ...goldenArch, 'devops.environmentPromotion': { ...ep, environments: envs } };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('observability-required-events fails when an event is missing', () => {
    const inv = DEVOPS_INVARIANTS.find(i => i.id === 'devops.observability-required-events');
    const obs = goldenArch['devops.deploymentObservability'] as Record<string, unknown>;
    const events = (obs.events as Array<Record<string, unknown>>).filter(e => e.name !== 'deploy.rollback.triggered');
    const corrupted = { ...goldenArch, 'devops.deploymentObservability': { ...obs, events } };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('observability-sink-via-security fails when sinkRef is custom', () => {
    const inv = DEVOPS_INVARIANTS.find(i => i.id === 'devops.observability-sink-via-security');
    const obs = goldenArch['devops.deploymentObservability'] as Record<string, unknown>;
    const corrupted = { ...goldenArch, 'devops.deploymentObservability': { ...obs, sinkRef: 'my-own-sink' } };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('secrets-forward-reference-security fails on a DIY secrets store', () => {
    const inv = DEVOPS_INVARIANTS.find(i => i.id === 'devops.secrets-forward-reference-security');
    const sec = goldenArch['devops.secretsManagementInPipeline'] as Record<string, unknown>;
    const corrupted = { ...goldenArch, 'devops.secretsManagementInPipeline': { ...sec, provider: 'env-files' } };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('secrets-never-in-artifact fails when password is missing from the list', () => {
    const inv = DEVOPS_INVARIANTS.find(i => i.id === 'devops.secrets-never-in-artifact');
    const sec = goldenArch['devops.secretsManagementInPipeline'] as Record<string, unknown>;
    const corrupted = { ...goldenArch, 'devops.secretsManagementInPipeline': { ...sec, neverInArtifact: ['token', 'secret', 'authorization'] } };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('cicd-pipeline-canonical-stages fails when a stage is missing', () => {
    const inv = DEVOPS_INVARIANTS.find(i => i.id === 'devops.cicd-pipeline-canonical-stages');
    const ci = goldenArch['devops.cicdPipeline'] as Record<string, unknown>;
    const stages = (ci.stages as Array<Record<string, unknown>>).filter(s => s.name !== 'typecheck');
    const corrupted = { ...goldenArch, 'devops.cicdPipeline': { ...ci, stages } };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('deploy-strategy-traffic-shift-monotonic fails when pcts decrease', () => {
    const inv = DEVOPS_INVARIANTS.find(i => i.id === 'devops.deploy-strategy-traffic-shift-monotonic');
    const ds = goldenArch['devops.deployStrategy'] as Record<string, unknown>;
    const corrupted = {
      ...goldenArch,
      'devops.deployStrategy': {
        ...ds,
        trafficShift: [
          { phase: 'p50', pct: 50, dwellMin: 10 },
          { phase: 'p10', pct: 10, dwellMin: 10 }
        ]
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });
});
