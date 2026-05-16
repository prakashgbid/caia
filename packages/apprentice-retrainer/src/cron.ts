#!/usr/bin/env node
/**
 * caia-apprentice-retrainer-cron — LaunchAgent entry point.
 *
 * Constructs an `ApprenticeRetrainer` with full production wiring
 * (corpus + training + eval + serving), runs ONE retraining tick, and
 * exits with a status code the launchd log can be triaged by.
 *
 * Exit codes:
 *   0 — tick completed (`skipped-*`, `trained-and-canary-promoted`,
 *       `trained-and-rejected`, `gated-pending-quality`,
 *       `canary-held-prompting-operator`)
 *   2 — tick failed (any `RetrainerError` subclass — already recorded
 *       in `retrainer-state.json` via the `lastError` slot)
 *   1 — argument / wiring / unexpected error
 *
 * Flags:
 *   --force         — force a retrain even when the delta gate would skip
 *   --no-eval       — skip the eval harness (operator tool — debug runs)
 *   --health-check  — Phase A2: emit single-line JSON and exit 0
 *
 * Distinction from `caia-apprentice-retrainer run`: that subcommand is
 * the dev / operator entry — `new ApprenticeRetrainer()` with NO
 * pipelines wired, which throws CorpusFailedError unless the caller
 * supplies pipelines themselves. The plist points at THIS binary; that
 * one stays for operators who want to inspect state or run subcommands
 * like `promote-canary` without paying the wiring import cost.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProductionRetrainer } from './production-wiring.js';
import { RetrainerError } from './types.js';

// Phase A2 --health-check shortcut (mirrors cli.ts so the post-merge gate
// can `kickstart` either binary and still get the JSON contract).
if (process.argv.includes('--health-check')) {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(
    readFileSync(join(here, '..', 'package.json'), 'utf8')
  ) as { name: string; version: string };
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
      entry: 'cron'
    }) + '\n'
  );
  process.exit(0);
}

export async function main(argv: string[]): Promise<number> {
  const force = argv.includes('--force');
  const disableEval = argv.includes('--no-eval');

  const retrainer = createProductionRetrainer({ disableEval });

  try {
    const result = await retrainer.run({ force });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.kind === 'failed' ? 2 : 0;
  } catch (e) {
    if (e instanceof RetrainerError) {
      process.stderr.write(`${e.name}: ${e.message}\n`);
      if (e.details) process.stderr.write(JSON.stringify(e.details, null, 2) + '\n');
      return 2;
    }
    process.stderr.write(`unexpected error: ${(e as Error).message ?? String(e)}\n`);
    return 1;
  }
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith('cron.js');
if (isMain) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
