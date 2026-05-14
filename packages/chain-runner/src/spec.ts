import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { validateRetryPolicyEntry } from './retry-policy.js';
import type { ChainSpec, FailureClass, PhaseDefinition } from './types.js';

const KNOWN_FAILURE_CLASSES: ReadonlySet<FailureClass> = new Set<FailureClass>([
  'worker_no_start_rate_limit',
  'worker_no_start_auth_failure',
  'worker_no_start_binary_missing',
  'worker_no_start_spawn_error',
  'worker_no_start_bad_args',
  'worker_hung_post_success',
  'worker_hung_mid_work',
  'worker_crashed',
  'mark_done_failed',
  'artifact_missing',
  'artifact_malformed',
  'pr_unmerged_at_done',
  'acceptance_failed',
  'runtime_exceeded',
  'unknown',
]);

export function loadChainSpec(specPath: string): ChainSpec {
  const raw = readFileSync(specPath, 'utf8');
  const parsed = yaml.load(raw);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as ChainSpec).phases)) {
    throw new Error(`invalid chain spec at ${specPath}: expected { phases: [...] }`);
  }
  const spec = parsed as ChainSpec;
  for (const p of spec.phases) {
    if (typeof p.id !== 'number' || typeof p.name !== 'string') {
      throw new Error(`phase missing id/name in ${specPath}: ${JSON.stringify(p)}`);
    }
  }
  // H-9: validate defaults.retry_policy if present. Unknown FailureClass keys
  // are a typo, not a forward-compat feature — fail loud at load time so the
  // operator catches it before the chain runs unsupervised.
  const rp = spec.defaults?.retry_policy;
  if (rp) {
    for (const [cls, entry] of Object.entries(rp)) {
      if (!KNOWN_FAILURE_CLASSES.has(cls as FailureClass)) {
        throw new Error(
          `retry_policy.${cls}: unknown FailureClass (expected one of ${Array.from(KNOWN_FAILURE_CLASSES).join(', ')})`,
        );
      }
      spec.defaults!.retry_policy![cls as FailureClass] = validateRetryPolicyEntry(cls, entry);
    }
  }
  return spec;
}

export function findPhase(spec: ChainSpec, id: number): PhaseDefinition {
  const phase = spec.phases.find((p) => p.id === id);
  if (!phase) throw new Error(`unknown phase id ${id}`);
  return phase;
}
