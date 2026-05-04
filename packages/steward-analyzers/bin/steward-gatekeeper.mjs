#!/usr/bin/env node
/**
 * Steward Gatekeeper CLI — entry invoked by the steward-gatekeeper.yml
 * GitHub Actions workflow.
 *
 * Subcommands:
 *   migration-linter       — Drizzle multi-statement breakpoint linter (failure mode #1)
 *   migration-numbering    — duplicate-prefix + gap detection (failure mode #3)
 *   graph-divergence       — develop ↔ main merge-base age check (failure mode #2)
 *   all                    — run every analyzer; OR exit code across all
 *
 * Flags:
 *   --repo-root <path>       repo root (default: ../../../ relative to bin)
 *   --max-age-days <N>       graph-divergence threshold (default 7)
 *   --pr-head-ref <ref>      PR head branch (default $GITHUB_HEAD_REF)
 *
 * Exit codes: 0 (no block findings), 1 (block findings), 2 (usage error).
 *
 * GitHub Actions annotations are emitted via `::error file=...,line=...`
 * for block/high findings; `::warning ...` for medium/low.
 */

import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  lintMigrations,
  discoverMigrationRoots,
  checkMigrationNumbering,
  checkGraphDivergence,
  exitCodeFor,
} from '../dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const args = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args.flags[key] = next;
        i++;
      } else {
        args.flags[key] = true;
      }
    } else {
      args.positional.push(a);
    }
  }
  return args;
}

function gha(level, finding) {
  const file = (finding.path || '').replace(/[\r\n]/g, '');
  const line = finding.line ?? 1;
  const msg = (finding.message || '').replace(/[\r\n]+/g, ' — ');
  return `::${level} file=${file},line=${line}::[${finding.analyzer}/${finding.ruleId}] ${msg}`;
}

function printFindings(findings) {
  if (findings.length === 0) {
    console.log('✓ no findings.');
    return;
  }
  for (const f of findings) {
    const ghaLevel = f.severity === 'block' || f.severity === 'high' ? 'error' : 'warning';
    console.log(gha(ghaLevel, f));
    console.log(`  ${f.severity.padEnd(6)} ${f.path}${f.line ? `:${f.line}` : ''}`);
    console.log(`    ${f.message}`);
    if (f.remediation) console.log(`    fix: ${f.remediation}`);
    if (f.context && Object.keys(f.context).length > 0) {
      console.log(`    context: ${JSON.stringify(f.context)}`);
    }
    console.log();
  }
}

async function runMigrationLinter(repoRoot) {
  const roots = await discoverMigrationRoots(repoRoot);
  if (roots.length === 0) {
    console.log(`migration-linter: no Drizzle migration roots found under ${repoRoot}.`);
    return [];
  }
  const all = [];
  for (const dir of roots) {
    console.log(`migration-linter: scanning ${path.relative(repoRoot, dir)}/`);
    const findings = await lintMigrations({ migrationsDir: dir });
    all.push(...findings);
  }
  return all;
}

async function runMigrationNumbering(repoRoot) {
  const roots = await discoverMigrationRoots(repoRoot);
  if (roots.length === 0) {
    console.log(`migration-numbering: no Drizzle migration roots found under ${repoRoot}.`);
    return [];
  }
  const all = [];
  for (const dir of roots) {
    console.log(`migration-numbering: scanning ${path.relative(repoRoot, dir)}/`);
    const findings = await checkMigrationNumbering({ migrationsDir: dir });
    all.push(...findings);
  }
  return all;
}

function runGraphDivergence(repoRoot, opts) {
  // Resolve develop ↔ main merge-base + its commit timestamp via git.
  // Requires actions/checkout@v4 with fetch-depth: 0 + a `git fetch origin develop main`.
  let sha;
  try {
    sha = execSync('git merge-base origin/develop origin/main', {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
  } catch (err) {
    console.log(`graph-divergence: cannot compute merge-base — origin/develop or origin/main not present locally. Run \`git fetch origin develop main\` before invocation. (${err.message})`);
    // Don't fail CI — graph-divergence is observational, not a hard
    // requirement for fork-style PRs that may not have both refs.
    return [];
  }
  const ts = parseInt(
    execSync(`git log -1 --format=%ct ${sha}`, {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim(),
    10,
  );
  const now = Math.floor(Date.now() / 1000);
  const headRef = opts['pr-head-ref'] || process.env.GITHUB_HEAD_REF || '';

  // Cheap check: is a back-merge PR open? Avoid `gh` invocation in CLI
  // (no auth in some contexts); look for a local ref instead. The
  // cron run path will pass this in via opts when needed.
  let backMergePrPresent = false;
  try {
    const out = execSync('git for-each-ref refs/remotes/origin/chore/back-merge-main-into-develop-* --format="%(refname:short)|%(committerdate:unix)"', {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    if (out) {
      // Treat "back-merge ref pushed within last 24h" as evidence one is in flight.
      const lines = out.split('\n');
      const recent = lines.find((l) => {
        const parts = l.split('|');
        const t = parseInt(parts[1] ?? '0', 10);
        return now - t < 86400;
      });
      backMergePrPresent = !!recent;
    }
  } catch {
    // ignore — refs may not exist
  }

  const findings = checkGraphDivergence({
    mergeBaseTimestamp: ts,
    nowTimestamp: now,
    maxAgeDays: opts['max-age-days'] ? parseInt(opts['max-age-days'], 10) : 7,
    prHeadRef: headRef,
    backMergePrPresent,
  });
  console.log(`graph-divergence: merge-base ${sha.substring(0, 8)} ts=${ts} ageDays=${((now - ts) / 86400).toFixed(1)} headRef=${headRef || '(none)'} backMergePrPresent=${backMergePrPresent}`);
  return findings;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positional[0];
  const repoRoot = path.resolve(args.flags['repo-root'] ?? path.resolve(__dirname, '../../..'));

  if (!command || command === '--help' || command === '-h') {
    console.error('usage: steward-gatekeeper <command> [--repo-root <path>] [--max-age-days <N>] [--pr-head-ref <ref>]');
    console.error('  commands: migration-linter | migration-numbering | graph-divergence | all');
    process.exit(2);
  }

  let findings = [];
  try {
    if (command === 'migration-linter') {
      findings = await runMigrationLinter(repoRoot);
    } else if (command === 'migration-numbering') {
      findings = await runMigrationNumbering(repoRoot);
    } else if (command === 'graph-divergence') {
      findings = runGraphDivergence(repoRoot, args.flags);
    } else if (command === 'all') {
      const a = await runMigrationLinter(repoRoot);
      const b = await runMigrationNumbering(repoRoot);
      const c = runGraphDivergence(repoRoot, args.flags);
      findings = [...a, ...b, ...c];
    } else {
      console.error(`unknown command: ${command}`);
      process.exit(2);
    }
  } catch (err) {
    console.error(`steward-gatekeeper: internal error: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exit(2);
  }

  printFindings(findings);

  const code = exitCodeFor(findings);
  if (code !== 0) {
    console.log(`\n${findings.filter((f) => f.severity === 'block').length} blocking finding(s); CI will fail.`);
  } else if (findings.length > 0) {
    console.log(`\n${findings.length} non-blocking finding(s); CI will pass.`);
  }
  process.exit(code);
}

main();
