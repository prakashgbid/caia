#!/usr/bin/env node
/**
 * Build helper — copy `agents/*.md` into `dist/agents/` so the published
 * package can find the shipped definitions at runtime via
 * `paths.shippedAgentsDir()`.
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const src = resolve(pkgRoot, 'agents');
const dest = resolve(pkgRoot, 'dist', 'agents');

if (!existsSync(src)) {
  console.error(`[copy-agents] source dir missing: ${src}`);
  process.exit(2);
}

if (!existsSync(dirname(dest))) {
  mkdirSync(dirname(dest), { recursive: true });
}
cpSync(src, dest, { recursive: true });
console.log(`[copy-agents] copied ${src} -> ${dest}`);
