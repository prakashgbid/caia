/**
 * This architect's contributions to the EA Reviewer's cross-architect
 * invariants registry (per spec §6.2).
 *
 * Each invariant is a pure predicate over either:
 *   - the per-architect `architectureFields` dict (where keys are FLAT
 *     dotted strings like `'devops.deployStrategy'`), or
 *   - the composed `tickets.architecture` JSONB blob (where the
 *     Dispatcher will nest the same fields under the `devops.*` path).
 *
 * Both views are accepted — we look up via `readField()` which checks
 * the flat key first, then falls back to the nested path.
 *
 * True ⇒ pass; false ⇒ a Reviewer advisory or fail (driven by `severity`).
 *
 * The most consequential invariant in this set is
 * `devops.deployStrategy-requires-realistic-infra` — it cross-validates
 * the chosen deploy strategy against the infra capabilities the
 * architect declared. This is the realism gate the golden test asserts.
 */

import { DEPLOY_STRATEGIES, STRATEGY_INFRA_REQUIREMENTS } from './contract.js';

export type InvariantSeverity = 'fail' | 'advisory';

export interface ArchitectInvariant {
  id: string;
  contributor: string;
  reads: readonly string[];
  severity: InvariantSeverity;
  description: string;
  detect(architecture: Readonly<Record<string, unknown>>): boolean;
}

function readField(arch: Readonly<Record<string, unknown>>, path: string): unknown {
  if (path in arch) return arch[path];
  const parts = path.split('.');
  let cursor: unknown = arch;
  for (const part of parts) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function asObject(v: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  return v as Readonly<Record<string, unknown>>;
}

function asArray(v: unknown): readonly unknown[] | null {
  return Array.isArray(v) ? v : null;
}

const REQUIRED_DEPLOY_EVENTS: readonly string[] = [
  'deploy.started',
  'deploy.succeeded',
  'deploy.failed',
  'deploy.rollback.triggered',
  'deploy.healthcheck.failed'
];

const REQUIRED_NEVER_IN_ARTIFACT: readonly string[] = [
  'password',
  'token',
  'secret',
  'authorization'
];

const REQUIRED_PIPELINE_STAGES: readonly string[] = [
  'lint',
  'typecheck',
  'test',
  'build',
  'deploy'
];

export const DEVOPS_INVARIANTS: readonly ArchitectInvariant[] = [
  {
    id: 'devops.deployStrategy-kind-allowed',
    contributor: 'devops',
    reads: ['devops.deployStrategy'],
    severity: 'fail',
    description:
      'deployStrategy.kind MUST be one of the locked strategies (blue-green | canary | ring-deployment | rolling | recreate).',
    detect(arch): boolean {
      const ds = asObject(readField(arch, 'devops.deployStrategy'));
      if (!ds) return false;
      const kind = ds.kind;
      return typeof kind === 'string' && DEPLOY_STRATEGIES.includes(kind);
    }
  },
  {
    id: 'devops.deployStrategy-requires-realistic-infra',
    contributor: 'devops',
    reads: ['devops.deployStrategy', 'devops.infrastructureAsCode'],
    severity: 'fail',
    description:
      'The chosen deploy strategy MUST match the infrastructure capabilities. blue-green requires two-identical-environments; canary requires traffic-split; ring-deployment requires multi-region; rolling requires multi-instance.',
    detect(arch): boolean {
      const ds = asObject(readField(arch, 'devops.deployStrategy'));
      const iac = asObject(readField(arch, 'devops.infrastructureAsCode'));
      if (!ds || !iac) return false;
      const kind = ds.kind;
      if (typeof kind !== 'string') return false;
      const required = STRATEGY_INFRA_REQUIREMENTS[kind] ?? [];
      if (required.length === 0) return true;
      const caps = asArray(iac.capabilities);
      if (!caps) return false;
      const set = new Set(caps.filter((c): c is string => typeof c === 'string'));
      return required.every(r => set.has(r));
    }
  },
  {
    id: 'devops.healthcheck-gate-declared',
    contributor: 'devops',
    reads: ['devops.deployStrategy'],
    severity: 'fail',
    description:
      'deployStrategy MUST declare a healthcheckGate with path + timeoutSec + expectStatus.',
    detect(arch): boolean {
      const ds = asObject(readField(arch, 'devops.deployStrategy'));
      if (!ds) return false;
      const gate = asObject(ds.healthcheckGate);
      if (!gate) return false;
      if (typeof gate.path !== 'string' || (gate.path as string).length === 0) return false;
      if (typeof gate.timeoutSec !== 'number' || (gate.timeoutSec as number) <= 0) return false;
      if (typeof gate.expectStatus !== 'number') return false;
      return true;
    }
  },
  {
    id: 'devops.rollback-auto-revert-window',
    contributor: 'devops',
    reads: ['devops.rollbackContract'],
    severity: 'fail',
    description:
      'rollbackContract.trigger MUST be healthcheck-failure with windowMin ≤ 5.',
    detect(arch): boolean {
      const rb = asObject(readField(arch, 'devops.rollbackContract'));
      if (!rb) return false;
      const trigger = asObject(rb.trigger);
      if (!trigger) return false;
      if (trigger.kind !== 'healthcheck-failure') return false;
      if (typeof trigger.windowMin !== 'number' || (trigger.windowMin as number) > 5 || (trigger.windowMin as number) <= 0) return false;
      return true;
    }
  },
  {
    id: 'devops.rollback-method-allowed',
    contributor: 'devops',
    reads: ['devops.rollbackContract'],
    severity: 'fail',
    description:
      'rollbackContract.method MUST be one of time-machine | git-revert | hybrid.',
    detect(arch): boolean {
      const rb = asObject(readField(arch, 'devops.rollbackContract'));
      if (!rb) return false;
      const method = rb.method;
      if (typeof method !== 'string') return false;
      return ['time-machine', 'git-revert', 'hybrid'].includes(method);
    }
  },
  {
    id: 'devops.env-promotion-manual-staging-to-prod',
    contributor: 'devops',
    reads: ['devops.environmentPromotion'],
    severity: 'fail',
    description:
      'environmentPromotion MUST declare a manual (or approval-2of3) gate at staging→prod. Auto-promotion to prod is forbidden.',
    detect(arch): boolean {
      const ep = asObject(readField(arch, 'devops.environmentPromotion'));
      if (!ep) return false;
      const envs = asArray(ep.environments);
      if (!envs) return false;
      let foundProdManualGate = false;
      for (const e of envs) {
        const env = asObject(e);
        if (!env) continue;
        if (env.name !== 'prod') continue;
        const gateKind = env.gateKind;
        if (gateKind === 'manual' || gateKind === 'approval-2of3') {
          foundProdManualGate = true;
        }
      }
      if (!foundProdManualGate) return false;
      // Cross-check promotionFlow includes staging→prod with a condition mentioning manual or approval.
      const flow = asArray(ep.promotionFlow);
      if (!flow) return true;
      for (const f of flow) {
        const step = asObject(f);
        if (!step) continue;
        if (step.from === 'staging' && step.to === 'prod') {
          if (typeof step.condition !== 'string') return false;
        }
      }
      return true;
    }
  },
  {
    id: 'devops.observability-required-events',
    contributor: 'devops',
    reads: ['devops.deploymentObservability'],
    severity: 'fail',
    description:
      'deploymentObservability.events MUST cover all 5 required deploy event types: started, succeeded, failed, rollback.triggered, healthcheck.failed.',
    detect(arch): boolean {
      const obs = asObject(readField(arch, 'devops.deploymentObservability'));
      if (!obs) return false;
      const events = asArray(obs.events);
      if (!events) return false;
      const names = new Set<string>();
      for (const e of events) {
        const ev = asObject(e);
        if (!ev) continue;
        if (typeof ev.name === 'string') names.add(ev.name);
      }
      return REQUIRED_DEPLOY_EVENTS.every(n => names.has(n));
    }
  },
  {
    id: 'devops.observability-sink-via-security',
    contributor: 'devops',
    reads: ['devops.deploymentObservability'],
    severity: 'fail',
    description:
      'deploymentObservability MUST reference the Security Architect\'s `security.auditLogRequirements.sink` (no DIY sink).',
    detect(arch): boolean {
      const obs = asObject(readField(arch, 'devops.deploymentObservability'));
      if (!obs) return false;
      const ref = obs.sinkRef;
      return typeof ref === 'string' && ref.includes('security.auditLogRequirements');
    }
  },
  {
    id: 'devops.secrets-forward-reference-security',
    contributor: 'devops',
    reads: ['devops.secretsManagementInPipeline'],
    severity: 'fail',
    description:
      'secretsManagementInPipeline.provider MUST be `vault-via-security-architect` and securityArchitectRef MUST reference `security.secretsHandling`. No DIY secret stores.',
    detect(arch): boolean {
      const sec = asObject(readField(arch, 'devops.secretsManagementInPipeline'));
      if (!sec) return false;
      if (sec.provider !== 'vault-via-security-architect') return false;
      const ref = sec.securityArchitectRef;
      return typeof ref === 'string' && ref.includes('security.secretsHandling');
    }
  },
  {
    id: 'devops.secrets-never-in-artifact',
    contributor: 'devops',
    reads: ['devops.secretsManagementInPipeline'],
    severity: 'fail',
    description:
      'secretsManagementInPipeline.neverInArtifact MUST include `password`, `token`, `secret`, and `authorization`.',
    detect(arch): boolean {
      const sec = asObject(readField(arch, 'devops.secretsManagementInPipeline'));
      if (!sec) return false;
      const never = asArray(sec.neverInArtifact);
      if (!never) return false;
      const set = new Set(never.filter((v): v is string => typeof v === 'string'));
      return REQUIRED_NEVER_IN_ARTIFACT.every(k => set.has(k));
    }
  },
  {
    id: 'devops.cicd-pipeline-canonical-stages',
    contributor: 'devops',
    reads: ['devops.cicdPipeline'],
    severity: 'fail',
    description:
      'cicdPipeline.stages MUST include the five canonical stages (lint, typecheck, test, build, deploy).',
    detect(arch): boolean {
      const ci = asObject(readField(arch, 'devops.cicdPipeline'));
      if (!ci) return false;
      const stages = asArray(ci.stages);
      if (!stages) return false;
      const names = new Set<string>();
      for (const s of stages) {
        const st = asObject(s);
        if (!st) continue;
        if (typeof st.name === 'string') names.add(st.name);
      }
      return REQUIRED_PIPELINE_STAGES.every(n => names.has(n));
    }
  },
  {
    id: 'devops.deploy-strategy-traffic-shift-monotonic',
    contributor: 'devops',
    reads: ['devops.deployStrategy'],
    severity: 'advisory',
    description:
      'When deployStrategy declares a trafficShift schedule, the pct values should be monotonically non-decreasing across phases.',
    detect(arch): boolean {
      const ds = asObject(readField(arch, 'devops.deployStrategy'));
      if (!ds) return false;
      const shift = asArray(ds.trafficShift);
      if (!shift) return true;
      let last = -Infinity;
      for (const phase of shift) {
        const p = asObject(phase);
        if (!p) return false;
        if (typeof p.pct !== 'number') return false;
        if ((p.pct as number) < last) return false;
        last = p.pct as number;
      }
      return true;
    }
  }
];
