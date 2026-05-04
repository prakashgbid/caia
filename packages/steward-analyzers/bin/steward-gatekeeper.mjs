#!/usr/bin/env node
/**
 * Steward Gatekeeper CLI — entry invoked by the `steward-gatekeeper.yml`
 * GitHub Actions workflow.
 *
 * Usage:
 *   steward-gatekeeper migration-linter [--repo-root <path>]
 *   steward-gatekeeper all  [--repo-root <path>]
 *
 * Exit codes:
 *   0 — no `block`-severity findings (warn-level findings still printed)
 *   1 — at least one `block`-severity finding
 *   2 — usage error / unexpected internal error
 *
 * Output format: human-readable to stdout + GitHub Actions annotations
 * (`::error file=...,line=...::message`) so failures land directly in the
 * PR's "Files changed" view.
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  lintMigrations,
  discoverMigrationRoots,
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
  // GitHub Actions workflow command for inline annotation.
  // See https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions
  const file = finding.path.replace(/[\r\n]/g, '');
  const line = finding.line ?? 1;
  const msg = finding.message.replace(/[\r\n]+/g, ' — ');
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positional[0];
  const repoRoot = path.resolve(args.flags['repo-root'] ?? path.resolve(__dirname, '../../..'));

  if (!command || command === '--help' || command === '-h') {
    console.error('usage: steward-gatekeeper <command> [--repo-root <path>]');
    console.error('  commands: migration-linter | all');
    process.exit(2);
  }

  let findings;
  try {
    if (command === 'migration-linter' || command === 'all') {
      findings = await runMigrationLinter(repoRoot);
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
