#!/usr/bin/env node
/**
 * Apprentice corpus backfill helper.
 *
 * Re-runs the aggregator with full env from the launchd plist and prints
 * a before / after sample count. Use this to catch up after the corpus
 * was stuck on stale snapshots (audit 2026-05-13 observed 04-30 → 05-07
 * absent, then flat 05-11 → 05-13).
 *
 * The aggregator's GitHub reader already pulls PR merges from the last
 * `maxAgeDays` window (default 365), so a fresh aggregate IS the
 * historical backfill — there is no separate per-day catch-up to run.
 *
 * Usage:
 *   node packages/apprentice-corpus/scripts/backfill-gap.mjs
 *   node packages/apprentice-corpus/scripts/backfill-gap.mjs --max-distill-calls 50
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const ROOT = process.env.APPRENTICE_CORPUS_ROOT
  ?? join(homedir(), 'Documents/projects/apprentice/corpora');

function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readFinalCount(day) {
  const p = join(ROOT, day, 'manifest.json');
  if (!existsSync(p)) return null;
  try {
    const m = JSON.parse(readFileSync(p, 'utf8'));
    return typeof m?.totals?.final === 'number' ? m.totals.final : null;
  } catch {
    return null;
  }
}

const day = todayLocal();
const before = readFinalCount(day);
console.log(`[backfill] sample count BEFORE (${day}): ${before ?? 'no manifest'}`);

const args = process.argv.slice(2);
const env = { ...process.env };
// Mirror the launchd plist env so the aggregator picks up the same
// memory / reports / events / github sources.
env.CAIA_MEMORY_DIR ??= '/Users/macbook32/Library/Application Support/Claude/local-agent-mode-sessions/6c9158cd-cd01-44af-b82f-bf27b437c618/84f7697e-7ae3-4ba4-9f98-166613a82e98/agent/memory';
env.CAIA_MEMORY_DIRS ??= [
  '/Users/macbook32/Documents/projects/agent-memory',
  '/Users/macbook32/Library/Application Support/Claude/local-agent-mode-sessions/3a77f4b3-623a-45ba-b937-609ce53cf8ca/agent/memory'
].join(',');
env.CAIA_REPORTS_DIR ??= join(homedir(), 'Documents/projects/reports');
env.CAIA_EVENTS_DB ??= join(homedir(), '.caia/mentor/events.sqlite');
env.CAIA_GITHUB_REPO ??= 'prakashgbid/caia';
env.APPRENTICE_CORPUS_ROOT ??= ROOT;
env.CLAUDE_BINARY_PATH ??= '/opt/homebrew/bin/claude';

const cli = join(import.meta.dirname ?? '', '../dist/cli.js');
const node = process.env.CAIA_NODE_BIN ?? '/opt/homebrew/opt/node@22/bin/node';

console.log(`[backfill] running: ${node} ${cli} aggregate ${args.join(' ')}`);
const proc = spawn(node, [cli, 'aggregate', ...args], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env
});

let stdout = '';
proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
proc.on('exit', (code) => {
  if (code !== 0) {
    console.error(`[backfill] aggregator exited with code ${code}`);
    process.exit(code ?? 1);
  }
  const after = readFinalCount(day);
  const delta = (before !== null && after !== null) ? (after - before) : null;
  console.log(`[backfill] sample count AFTER  (${day}): ${after ?? 'no manifest'}`);
  if (delta !== null) {
    const sign = delta >= 0 ? '+' : '';
    console.log(`[backfill] delta: ${sign}${delta}`);
  }
});
