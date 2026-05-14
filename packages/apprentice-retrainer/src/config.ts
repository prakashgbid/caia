import { homedir } from 'node:os';
import * as path from 'node:path';
import type {
  ApprenticeRetrainerConfig,
  ResolvedRetrainerConfig
} from './types.js';
import { DefaultFsAccess } from './fs-access.js';

const DEFAULT_RUN_STATE = '~/Documents/projects/apprentice/retrainer-state.json';
const DEFAULT_DIGEST = '~/Documents/projects/reports/apprentice-retrainer-digest.md';
const DEFAULT_LOCKFILE = '~/Documents/projects/apprentice/retrainer.lock';
const DEFAULT_AUDIT = '~/.chiefaia/apprentice-retrainer/audit.jsonl';

export function expandHome(p: string): string {
  if (p.startsWith('~/')) return path.join(homedir(), p.slice(2));
  if (p === '~') return homedir();
  return p;
}

export function resolveConfig(cfg: ApprenticeRetrainerConfig = {}): ResolvedRetrainerConfig {
  const fs = cfg.fs ?? new DefaultFsAccess();
  const clock = cfg.clock ?? (() => new Date());
  const resolved: ResolvedRetrainerConfig = {
    runStatePath: expandHome(cfg.runStatePath ?? DEFAULT_RUN_STATE),
    digestPath: expandHome(cfg.digestPath ?? DEFAULT_DIGEST),
    lockfilePath: expandHome(cfg.lockfilePath ?? DEFAULT_LOCKFILE),
    auditPath: expandHome(cfg.auditPath ?? DEFAULT_AUDIT),
    retrainThreshold: cfg.retrainThreshold ?? 500,
    retrainMaxAgeMs: cfg.retrainMaxAgeMs ?? 7 * 24 * 60 * 60 * 1000,
    evalWinRateGate: cfg.evalWinRateGate ?? 0.6,
    defaultCanaryPercent: cfg.defaultCanaryPercent ?? 10,
    canaryHoldDays: cfg.canaryHoldDays ?? 3,
    qualityFloorAvg: cfg.qualityFloorAvg ?? 0.55,
    qualityFloorCount: cfg.qualityFloorCount ?? 300,
    fs,
    clock
  };
  if (cfg.corpusAggregator !== undefined) resolved.corpusAggregator = cfg.corpusAggregator;
  if (cfg.trainer !== undefined) resolved.trainer = cfg.trainer;
  if (cfg.evalHarness !== undefined) resolved.evalHarness = cfg.evalHarness;
  if (cfg.serving !== undefined) resolved.serving = cfg.serving;
  return resolved;
}
