/**
 * Path helpers — locate the package's `evals/` and `baselines/` dirs in
 * both built (`dist/...`) and source-tree modes.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function pkgRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // Compiled file lives at <pkg>/dist/paths.js → pkg root is one up.
  // Source-tree mode lives at <pkg>/src/paths.ts → pkg root is one up too.
  return resolve(here, '..');
}

export function evalsDir(): string {
  const root = pkgRoot();
  const candidate = resolve(root, 'evals');
  if (existsSync(candidate)) return candidate;
  // dist mode where evals is two-up:
  const distCandidate = resolve(root, '..', 'evals');
  if (existsSync(distCandidate)) return distCandidate;
  throw new Error(`[prompt-evals] could not locate evals/ dir; tried ${candidate}, ${distCandidate}`);
}

export function baselinesDir(): string {
  const root = pkgRoot();
  const candidate = resolve(root, 'baselines');
  if (existsSync(candidate)) return candidate;
  const distCandidate = resolve(root, '..', 'baselines');
  if (existsSync(distCandidate)) return distCandidate;
  // baselines may not yet exist — return the canonical path anyway so
  // callers can write to it.
  return candidate;
}
