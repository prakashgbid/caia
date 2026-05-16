#!/usr/bin/env node
/**
 * caia-adoption-verify — discover open adopt/* PRs, run V1+V2+V3 in a
 * /tmp/adopt-verify-<sha> worktree, upsert a verification.md PR comment, and
 * apply adoption-verified / adoption-failed labels idempotently.
 *
 * Usage:
 *   caia-adoption-verify [--pr <num>] [--repo <dir>] [--dry-run]
 *                        [--wall-clock-ms <n>]
 */
import { runAll } from '../dist/pr/orchestrator.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--pr':
        out.prNumber = Number(next);
        i += 1;
        break;
      case '--repo':
        out.repoCwd = next;
        i += 1;
        break;
      case '--dry-run':
        out.dryRun = true;
        break;
      case '--wall-clock-ms':
        out.perPrWallClockMs = Number(next);
        i += 1;
        break;
      case '--help':
      case '-h':
        process.stdout.write(
          'Usage: caia-adoption-verify [--pr <num>] [--repo <dir>] [--dry-run] [--wall-clock-ms <n>]\n',
        );
        process.exit(0);
        break;
      default:
        process.stderr.write(`unknown arg: ${arg}\n`);
        process.exit(2);
    }
  }
  if (!out.repoCwd) out.repoCwd = process.cwd();
  return out;
}

const opts = parseArgs(process.argv.slice(2));
const outcomes = await runAll(opts);

let failed = 0;
for (const o of outcomes) {
  const tag = o.verdict.toUpperCase();
  process.stdout.write(
    `[${tag}] #${o.pr.number} ${o.pr.headRefName} — comment:${o.commentAction ?? 'n/a'} label:${o.labelAction ?? 'n/a'} (${o.durationMs}ms)\n`,
  );
  if (o.setupErrors.length > 0) {
    for (const err of o.setupErrors) process.stdout.write(`    setup-error: ${err}\n`);
  }
  if (o.verdict !== 'pass') failed += 1;
}

process.stdout.write(
  `\nSummary: ${outcomes.length} PR(s) verified, ${failed} non-pass.\n`,
);

process.exit(failed === 0 ? 0 : 1);
