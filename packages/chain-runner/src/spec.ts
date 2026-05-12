import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import type { ChainSpec, PhaseDefinition } from './types.js';

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
  return spec;
}

export function findPhase(spec: ChainSpec, id: number): PhaseDefinition {
  const phase = spec.phases.find((p) => p.id === id);
  if (!phase) throw new Error(`unknown phase id ${id}`);
  return phase;
}
