import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ChainPaths } from './types.js';

const ROOT_ENV = 'CAIA_CHAIN_HOME';

export function chainRoot(): string {
  return process.env[ROOT_ENV] ?? join(homedir(), '.caia', 'chain');
}

export function chainPaths(chainId: string): ChainPaths {
  if (!/^[A-Za-z0-9._-]+$/.test(chainId)) {
    throw new Error(
      `invalid chain-id ${JSON.stringify(chainId)}: must match [A-Za-z0-9._-]+`,
    );
  }
  const baseDir = join(chainRoot(), chainId);
  return {
    baseDir,
    stateFile: join(baseDir, 'state.json'),
    lockFile: join(baseDir, 'lock.json'),
    auditFile: join(baseDir, 'audit.jsonl'),
  };
}

export function ensureChainDir(chainId: string): ChainPaths {
  const paths = chainPaths(chainId);
  mkdirSync(paths.baseDir, { recursive: true });
  return paths;
}
