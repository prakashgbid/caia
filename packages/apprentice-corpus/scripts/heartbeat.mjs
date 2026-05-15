#!/usr/bin/env node
/**
 * Apprentice corpus heartbeat / no-grow watchdog.
 *
 * Reads today's and yesterday's `corpora/<YYYY-MM-DD>/manifest.json` and
 * compares `totals.final`. If today is below `threshold * yesterday`
 * (default 0.8 = catch 20%+ drops), exits 1 and prints a one-line alert
 * that the launchd plist routes to the err log.
 *
 * The audit (2026-05-13) observed a 26% drop between 05-11 and 05-12
 * that no operator noticed. The default threshold of 0.8 catches that
 * class of regression. Run this from a daily launchd at 04:00, after
 * the 02:00 aggregator has produced its manifest.
 *
 * Exit codes:
 *   0  — healthy (or insufficient history to compare)
 *   1  — drop below threshold
 *   2  — manifest missing / unreadable for today
 *
 * Env / args:
 *   --root <path>           default ~/Documents/projects/apprentice/corpora
 *   --threshold <0..1>      default 0.7
 *   --today <YYYY-MM-DD>    default today local
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Phase A2 --health-check shortcut. The post-merge gate (A1) invokes
// `<bin> --health-check` after `launchctl kickstart` and expects exit 0
// in ≤5s with single-line JSON on stdout. Runs before any manifest I/O.
if (process.argv.includes('--health-check')) {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(
    readFileSync(join(here, '..', 'package.json'), 'utf8'),
  );
  process.stdout.write(
    JSON.stringify({
      ok: true,
      label: process.env['CAIA_PLIST_LABEL'] ?? null,
      package: pkg.name,
      version: pkg.version,
      git_sha: process.env['CAIA_GIT_SHA'] ?? 'unknown',
      node: process.version,
      pid: process.pid,
      timestamp: new Date().toISOString(),
    }) + '\n',
  );
  process.exit(0);
}

function parseArgs(argv) {
  const out = {
    root: join(homedir(), 'Documents/projects/apprentice/corpora'),
    threshold: 0.8,
    today: null
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') out.root = argv[++i];
    else if (a === '--threshold') out.threshold = Number.parseFloat(argv[++i]);
    else if (a === '--today') out.today = argv[++i];
  }
  return out;
}

function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayMinus(date, n) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function readFinal(root, day) {
  const path = join(root, day, 'manifest.json');
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf8');
    const m = JSON.parse(raw);
    return typeof m?.totals?.final === 'number' ? m.totals.final : null;
  } catch {
    return null;
  }
}

const args = parseArgs(process.argv.slice(2));
const today = args.today ?? todayLocal();
const yesterday = dayMinus(today, 1);

const todayFinal = readFinal(args.root, today);
if (todayFinal === null) {
  console.error(
    `[apprentice-corpus-heartbeat] ALERT: today's manifest missing/unreadable (${args.root}/${today}/manifest.json).`
  );
  process.exit(2);
}

const ydayFinal = readFinal(args.root, yesterday);
if (ydayFinal === null || ydayFinal === 0) {
  console.log(
    `[apprentice-corpus-heartbeat] ok: today=${todayFinal}; no prior manifest at ${yesterday}, skipping ratio check.`
  );
  process.exit(0);
}

const ratio = todayFinal / ydayFinal;
const tag = `today=${todayFinal} yesterday=${ydayFinal} ratio=${ratio.toFixed(3)} threshold=${args.threshold}`;

if (ratio < args.threshold) {
  console.error(
    `[apprentice-corpus-heartbeat] ALERT: corpus dropped ${((1 - ratio) * 100).toFixed(1)}% (${tag}).`
  );
  process.exit(1);
}

console.log(`[apprentice-corpus-heartbeat] ok: ${tag}.`);
process.exit(0);
