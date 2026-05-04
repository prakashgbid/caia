#!/usr/bin/env node
/**
 * Steward Gatekeeper CLI — entry invoked by the steward-gatekeeper.yml
 * GitHub Actions workflow + the hygiene-report.yml + dependabot-triage.yml
 * cron jobs.
 *
 * Subcommands:
 *   migration-linter       — Drizzle multi-statement breakpoint linter (failure mode #1)
 *   migration-numbering    — duplicate-prefix + gap detection (failure mode #3)
 *   graph-divergence       — develop ↔ main merge-base age check (failure mode #2)
 *   vault-checks           — Mac-local snapshot-age check (failure mode #7)
 *   preflight              — fast pre-spawn hook (modes #4 #6 + dirty-tree)
 *   hygiene-daily          — repo-state daily snapshot (modes #4 #5 #6)
 *   pr-stale               — list/auto-close stale PRs (mode #10); --auto-close to act
 *   all                    — run every pre-merge analyzer; OR exit code across all
 *
 * Flags:
 *   --repo-root <path>            repo root (default: ../../../ relative to bin)
 *   --max-age-days <N>            graph-divergence threshold (default 7)
 *   --pr-head-ref <ref>           PR head branch (default $GITHUB_HEAD_REF)
 *   --mac-snapshot-dir <path>     Mac vault snapshot dir for vault-checks (alias of --snapshot-dir, kept for back-compat)
 *   --snapshot-dir <path>         Override snapshot dir (works with --side)
 *   --side <name>                 'mac' (default) or 'stolution'; sets default snapshot dir + finding label
 *   --max-snapshot-age-hours <N>  vault-checks threshold (default 26)
 *
 * Exit codes: 0 (no block findings), 1 (block findings), 2 (usage error).
 *
 * GitHub Actions annotations are emitted via `::error file=...,line=...`
 * for block/high findings; `::warning ...` for medium/low.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  lintMigrations,
  discoverMigrationRoots,
  checkMigrationNumbering,
  checkGraphDivergence,
  exitCodeFor,
  checkSnapshotAge,
  checkStashCount,
  checkWorktreeCount,
  checkOrphanBranches,
  preflightChecks,
  checkPrStaleness,
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

// ─── Pre-merge analyzers ───────────────────────────────────────────────────

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
  let sha;
  try {
    sha = execSync('git merge-base origin/develop origin/main', {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
  } catch (err) {
    console.log(`graph-divergence: cannot compute merge-base — origin/develop or origin/main not present locally. Run \`git fetch origin develop main\` before invocation. (${err.message})`);
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

  let backMergePrPresent = false;
  try {
    const out = execSync('git for-each-ref refs/remotes/origin/chore/back-merge-main-into-develop-* --format="%(refname:short)|%(committerdate:unix)"', {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim();
    if (out) {
      const lines = out.split('\n');
      const recent = lines.find((l) => {
        const parts = l.split('|');
        const t = parseInt(parts[1] ?? '0', 10);
        return now - t < 86400;
      });
      backMergePrPresent = !!recent;
    }
  } catch {
    // ignore
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

// ─── Vault-state (failure mode #7) ─────────────────────────────────────────

function newestMtimeEpoch(dir, glob) {
  try {
    const entries = fs.readdirSync(dir).filter((name) => name.match(glob));
    if (entries.length === 0) return null;
    let newest = 0;
    for (const name of entries) {
      try {
        const st = fs.statSync(`${dir}/${name}`);
        const t = Math.floor(st.mtimeMs / 1000);
        if (t > newest) newest = t;
      } catch { /* ignore */ }
    }
    return newest > 0 ? newest : null;
  } catch {
    return null;
  }
}

function runVaultChecks(opts) {
  // Two invocation modes:
  //   • Mac (default): scans the LaunchAgent-pulled snapshot dir.
  //   • Stolution: scans the stolution-side native snapshot dir
  //     (`/home/s903/backups/vault`). Side identifier comes from --side.
  //
  // Override either via --snapshot-dir <abs path>; --mac-snapshot-dir
  // is preserved as an alias for backward compat with the Mac-only
  // invocation shipped in PR #298.
  const side = opts['side'] || 'mac';
  const defaultDir =
    side === 'stolution'
      ? '/home/s903/backups/vault'
      : `${os.homedir()}/Library/Application Support/Stolution/vault-snapshots`;
  const snapDir = opts['snapshot-dir'] || opts['mac-snapshot-dir'] || defaultDir;
  const mtime = newestMtimeEpoch(snapDir, /^vault-snapshot-.*\.snap$/);

  console.log(`vault-checks: side=${side} scanning snapshot dir ${snapDir}`);
  return checkSnapshotAge({
    snapshots: [
      { side, path: snapDir, mtimeEpoch: mtime },
    ],
    maxAgeHours: opts['max-snapshot-age-hours'] ? parseInt(opts['max-snapshot-age-hours'], 10) : 26,
  });
}

// ─── Local-state (failure modes #4 #5 #6) ──────────────────────────────────

function collectStashEntries(repoRoot) {
  try {
    const out = execSync('git stash list', { cwd: repoRoot, encoding: 'utf8' }).trim();
    return out ? out.split('\n') : [];
  } catch {
    return [];
  }
}

function collectWorktrees(repoRoot) {
  try {
    const out = execSync('git worktree list --porcelain', {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const blocks = out.split(/\n\n+/).filter(Boolean);
    return blocks.map((block) => {
      const lines = block.split('\n');
      let pathStr = null;
      let branch = null;
      for (const line of lines) {
        if (line.startsWith('worktree ')) pathStr = line.slice('worktree '.length).trim();
        else if (line.startsWith('branch refs/heads/')) branch = line.slice('branch refs/heads/'.length).trim();
        else if (line === 'detached') branch = null;
      }
      return { path: pathStr ?? '', branch };
    });
  } catch {
    return [];
  }
}

function collectDirtyTreeCount(repoRoot) {
  try {
    const out = execSync('git status --porcelain', { cwd: repoRoot, encoding: 'utf8' }).trim();
    return out ? out.split('\n').length : 0;
  } catch {
    return 0;
  }
}

function collectBranchInfo(repoRoot) {
  let openPrHeads = new Set();
  try {
    const prsJson = execSync('gh pr list --state open --limit 200 --json headRefName', {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const prs = JSON.parse(prsJson);
    openPrHeads = new Set(prs.map((p) => p.headRefName));
  } catch {
    // gh unavailable / unauthenticated; proceed with empty set.
  }
  let branches = [];
  try {
    const out = execSync(
      `git for-each-ref refs/remotes/origin --format='%(refname:short)|%(committerdate:unix)'`,
      { cwd: repoRoot, encoding: 'utf8' },
    ).trim();
    branches = out.split('\n').map((line) => {
      const [refnameRaw, tsRaw] = line.split('|');
      const branch = (refnameRaw ?? '').replace(/^origin\//, '');
      return {
        branch,
        committerTimeUnix: parseInt(tsRaw ?? '0', 10),
        hasOpenPr: openPrHeads.has(branch),
      };
    }).filter((b) => b.branch && b.branch !== 'HEAD');
  } catch {
    // ignore
  }
  return branches;
}

function runPreflight(repoRoot) {
  const stashEntries = collectStashEntries(repoRoot);
  const worktrees = collectWorktrees(repoRoot);
  const dirtyTreeEntries = collectDirtyTreeCount(repoRoot);
  console.log(
    `preflight: stash=${stashEntries.length} worktrees=${Math.max(0, worktrees.length - 1)} dirty=${dirtyTreeEntries}`,
  );
  return preflightChecks({ stashEntries, worktrees, dirtyTreeEntries });
}

function runHygieneDaily(repoRoot) {
  const stashEntries = collectStashEntries(repoRoot);
  const worktrees = collectWorktrees(repoRoot);
  const branches = collectBranchInfo(repoRoot);
  console.log(
    `hygiene-daily: stash=${stashEntries.length} worktrees=${Math.max(0, worktrees.length - 1)} branches=${branches.length}`,
  );
  return [
    ...checkStashCount({ stashEntries }),
    ...checkWorktreeCount({ worktrees }),
    ...checkOrphanBranches({ branches }),
  ];
}

// ─── PR-stale (failure mode #10) ───────────────────────────────────────────

/**
 * Fetch open PRs via `gh pr list` and run the staleness analyzer.
 * If `--auto-close` is provided, eligible (>=30d, not keep-open, not
 * dependabot) PRs are closed via `gh pr close` with the standard comment.
 *
 * The "stale; reopen if needed" comment matches the analyzer's
 * `pr-stale-auto-close` ruleId remediation. Reference:
 * `agent/memory/steward_gatekeeper_directive.md` (mode 10),
 * `agent/memory/feedback_git_flow_enforced.md`.
 */
function runPrStale(repoRoot, opts) {
  const autoClose = !!opts['auto-close'];
  let raw;
  try {
    raw = execSync(
      'gh pr list --state open --limit 200 --json number,title,headRefName,updatedAt,labels,isDraft,author',
      { cwd: repoRoot, encoding: 'utf8' },
    );
  } catch (err) {
    console.log(`pr-stale: cannot list PRs via gh — ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
  let prs;
  try {
    const parsed = JSON.parse(raw);
    prs = parsed.map((p) => ({
      number: p.number,
      title: p.title,
      branch: p.headRefName,
      updatedAt: p.updatedAt,
      labels: (p.labels || []).map((l) => (typeof l === 'string' ? l : l.name)),
      isDraft: !!p.isDraft,
      author: p.author?.login || p.author?.name || '',
    }));
  } catch (err) {
    console.log(`pr-stale: cannot parse gh output — ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
  console.log(`pr-stale: scanning ${prs.length} open PR(s) (auto-close=${autoClose})`);
  const findings = checkPrStaleness({ prs });
  if (autoClose) {
    const eligible = findings.filter((f) => f.ruleId === 'pr-stale-auto-close');
    if (eligible.length === 0) {
      console.log('pr-stale: 0 PR(s) eligible for auto-close.');
    } else {
      console.log(`pr-stale: closing ${eligible.length} eligible PR(s)...`);
    }
    for (const f of eligible) {
      const num = f.context?.prNumber;
      if (typeof num !== 'number') continue;
      try {
        execSync(
          `gh pr close ${num} --comment ${JSON.stringify('stale; reopen if needed')}`,
          { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' },
        );
        console.log(`pr-stale: closed #${num} (${f.context?.ageDays}d idle)`);
      } catch (err) {
        console.log(`pr-stale: failed to close #${num}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return findings;
}

// ─── Main entry ────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positional[0];
  const repoRoot = path.resolve(args.flags['repo-root'] ?? path.resolve(__dirname, '../../..'));

  if (!command || command === '--help' || command === '-h') {
    console.error('usage: steward-gatekeeper <command> [--repo-root <path>] [--max-age-days <N>] [--pr-head-ref <ref>] [--mac-snapshot-dir <path>]');
    console.error('  pre-merge   : migration-linter | migration-numbering | graph-divergence | all');
    console.error('  pre-spawn   : preflight');
    console.error('  scheduled   : hygiene-daily | vault-checks | pr-stale');
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
    } else if (command === 'vault-checks') {
      findings = runVaultChecks(args.flags);
    } else if (command === 'preflight') {
      findings = runPreflight(repoRoot);
    } else if (command === 'hygiene-daily') {
      findings = runHygieneDaily(repoRoot);
    } else if (command === 'pr-stale') {
      findings = runPrStale(repoRoot, args.flags);
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
