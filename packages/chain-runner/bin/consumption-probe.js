#!/usr/bin/env node
// consumption-probe.js — Guardrail #8 daily probe.
//
// Scans every caia/packages/* and decides if each is DORMANT (no in-repo
// importer + no plist-backed CLI consumer + no recent invocation in audit
// jsonl). Emits:
//   - <repoRoot>/docs/DORMANT_PACKAGES.md   (autogen, sorted by days-silent)
//   - <repoRoot>/reports/consumption_probe_<YYYY-MM-DD>.md
//   - INBOX entries on drift (LIVE-yesterday / DORMANT-today)
//
// Standalone Node script. No deps outside the Node 18+ stdlib so the daily
// launchd job has zero install cost. Designed to be re-run idempotently:
// re-running the same day overwrites the report; the dormant-state diff is
// computed against the autogen DORMANT_PACKAGES.md committed to the tree.

import { execSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const HOME = homedir();
const REPO_ROOT = resolveRepoRoot();
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const DOCS_DIR = join(REPO_ROOT, 'docs');
const REPORTS_DIR = join(REPO_ROOT, 'reports');
const DORMANT_MD = join(DOCS_DIR, 'DORMANT_PACKAGES.md');
const INBOX = join(HOME, '.caia/chain-watchdog/INBOX.md');

const PLIST_DIRS = [join(HOME, 'Library/LaunchAgents')];
const CHAIN_WATCHDOG_DIR = join(HOME, '.caia/chain-watchdog');
const PR_MERGE_JSONL = join(HOME, '.caia/chain-runner/pr-merge-attempts.jsonl');
const PR_CREATE_JSONL = join(HOME, '.caia/chain-runner/pr-create-attempts.jsonl');

// Recent-invocation window (days). Plist-backed consumption is binary today
// (does *any* loaded plist run a bin from this pkg?); the audit window only
// suppresses false-DORMANT for pkgs invoked recently outside the plist set.
const RECENT_DAYS = 7;

function resolveRepoRoot() {
  // 1) explicit env override (used by tests + cron with non-default layout).
  if (process.env.CAIA_PROBE_REPO_ROOT) {
    return resolve(process.env.CAIA_PROBE_REPO_ROOT);
  }
  // 2) walk up from cwd. Tests run under a tmp-dir cwd; daily cron runs from
  //    the working-directory specified in the launchd plist.
  for (const start of [process.cwd(), resolve(new URL('.', import.meta.url).pathname)]) {
    let dir = resolve(start);
    for (let i = 0; i < 8; i++) {
      if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
      const parent = resolve(dir, '..');
      if (parent === dir) break;
      dir = parent;
    }
  }
  // 3) last-ditch fallback to the layout this bin lives in.
  return resolve(new URL('../../..', import.meta.url).pathname);
}

function safeReadJSON(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function safeReadText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

function listDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function loadPackages() {
  const out = [];
  for (const slug of listDirs(PACKAGES_DIR)) {
    const pkgPath = join(PACKAGES_DIR, slug);
    const pj = safeReadJSON(join(pkgPath, 'package.json'));
    if (!pj || !pj.name) continue;
    const bins = pj.bin
      ? typeof pj.bin === 'string'
        ? [{ binName: pj.name.split('/').pop(), target: pj.bin }]
        : Object.entries(pj.bin).map(([binName, target]) => ({ binName, target }))
      : [];
    out.push({
      slug,
      pkgPath,
      name: pj.name,
      version: pj.version ?? 'unknown',
      private: pj.private === true,
      description: (pj.description ?? '').replace(/\s+/g, ' ').trim(),
      bins,
      lastModified: lastModifiedAt(pkgPath),
    });
  }
  return out;
}

function lastModifiedAt(dir) {
  // Best-effort: prefer git log on the package's path; fall back to mtime walk.
  try {
    const iso = execSync(`git log -1 --format=%cI -- "${relative(REPO_ROOT, dir)}"`, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (iso) return iso;
  } catch {
    /* fall through */
  }
  let newest = 0;
  function walk(d) {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
      const p = join(d, e.name);
      try {
        const st = statSync(p);
        if (e.isDirectory()) walk(p);
        else if (st.mtimeMs > newest) newest = st.mtimeMs;
      } catch {
        /* ignore */
      }
    }
  }
  walk(dir);
  return newest ? new Date(newest).toISOString() : new Date(0).toISOString();
}

function gitGrepCount(pattern, pathspecs) {
  // git's pathspec scopes the search and skips scaffold/template dirs that
  // hold placeholder workspace deps but no real consumer code.
  try {
    const raw = execSync(
      `git grep -F -l --untracked -- "${pattern.replace(/"/g, '\\"')}" -- ${pathspecs.join(' ')} 2>/dev/null || true`,
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    return raw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// File patterns that count as a "real" consumer. Markdown, snapshots, and
// fixture files are filtered out so a doc pointer doesn't mark a pkg LIVE.
// package.json IS counted (workspace dep is a real consumption signal).
const CODE_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/;
const PACKAGE_JSON_RE = /(^|\/)package\.json$/;
const PNPM_WORKSPACE_RE = /(^|\/)pnpm-workspace\.yaml$/;

// Pathspecs scoped to first-class workspace members. Templates and scaffold
// dirs are intentionally excluded — `templates/site/` carries placeholder
// deps that aren't real consumers (per pnpm-workspace.yaml comment).
const CONSUMER_PATHSPECS = [
  'packages',
  'services',
  'apps',
  'configs',
  'pnpm-workspace.yaml',
];

function isRealConsumerFile(p) {
  if (PNPM_WORKSPACE_RE.test(p)) return true;
  if (PACKAGE_JSON_RE.test(p)) return true;
  if (CODE_FILE_RE.test(p)) return true;
  return false;
}

function findImporters(pkg) {
  // Returns set of file paths (repo-relative) inside other workspace members
  // that reference pkg.name via import, require, or workspace dep entry.
  // Self-references and template/scaffold dirs are excluded so the dormant
  // signal is honest.
  const codeTokens = [
    `from '${pkg.name}'`,
    `from "${pkg.name}"`,
    `from '${pkg.name}/`,
    `from "${pkg.name}/`,
    `require('${pkg.name}')`,
    `require("${pkg.name}")`,
    `import '${pkg.name}'`,
    `import "${pkg.name}"`,
  ];
  const depTokens = [`"${pkg.name}":`, `'${pkg.name}':`];

  const hits = new Set();
  const selfRel = relative(REPO_ROOT, pkg.pkgPath);

  for (const t of [...codeTokens, ...depTokens]) {
    for (const p of gitGrepCount(t, CONSUMER_PATHSPECS)) {
      if (p === selfRel || p.startsWith(`${selfRel}/`)) continue;
      if (!isRealConsumerFile(p)) continue;
      hits.add(p);
    }
  }
  return [...hits].sort();
}

function loadAllPlistTexts() {
  const plists = [];
  for (const dir of PLIST_DIRS) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.plist')) continue;
      const path = join(dir, name);
      plists.push({ path, name, body: safeReadText(path) });
    }
  }
  return plists;
}

function loadChainWakeScripts() {
  // Restricted to *.sh — chain-watchdog also holds INBOX.md and various
  // jsonl/cache files that the probe itself appends to. Treating those as
  // "wake scripts" creates self-referential consumer matches when a probe
  // run writes a package name into INBOX as drift, then the next run reads
  // that line back and marks the package LIVE.
  const out = [];
  if (!existsSync(CHAIN_WATCHDOG_DIR)) return out;
  for (const name of readdirSync(CHAIN_WATCHDOG_DIR)) {
    if (!name.endsWith('.sh')) continue;
    const p = join(CHAIN_WATCHDOG_DIR, name);
    try {
      if (statSync(p).isFile()) out.push({ path: p, name, body: safeReadText(p) });
    } catch {
      /* ignore */
    }
  }
  return out;
}

function findPlistBackedConsumers(pkg, plists, wakeScripts) {
  // A bin is "plist-backed" if any plist's body references the pkg-qualified
  // bin path (`packages/<slug>/<target>` or `packages/<slug>/`). Bin-name
  // alone is too generic — `content`, `config`, etc. would false-positive.
  // Wake scripts are scanned with the same package-qualified needles.
  const consumers = [];
  for (const bin of pkg.bins) {
    const needles = new Set();
    if (bin.target) {
      const tail = bin.target.replace(/^\.\//, '');
      needles.add(`packages/${pkg.slug}/${tail}`);
    }
    needles.add(`packages/${pkg.slug}/`);
    needles.add(pkg.name);
    for (const plist of plists) {
      for (const n of needles) {
        if (plist.body.includes(n)) {
          consumers.push({ kind: 'plist', bin: bin.binName, source: plist.name });
          break;
        }
      }
    }
    for (const ws of wakeScripts) {
      for (const n of needles) {
        if (ws.body.includes(n)) {
          consumers.push({ kind: 'wake-script', bin: bin.binName, source: ws.name });
          break;
        }
      }
    }
  }
  // Also flag the package as plist-backed if any plist/wake script references
  // `packages/<slug>/` directly even when the package has no `bin:` (e.g.,
  // a plist that runs `node packages/foo/dist/server.js`).
  if (pkg.bins.length === 0) {
    const needle = `packages/${pkg.slug}/`;
    for (const plist of plists) {
      if (plist.body.includes(needle)) {
        consumers.push({ kind: 'plist', bin: '(no-bin)', source: plist.name });
        break;
      }
    }
    for (const ws of wakeScripts) {
      if (ws.body.includes(needle)) {
        consumers.push({ kind: 'wake-script', bin: '(no-bin)', source: ws.name });
        break;
      }
    }
  }
  return consumers;
}

function findRecentInvocations(pkg, sinceMs) {
  // Recent invocation = audit jsonl line within sinceMs that mentions the
  // package name or bin name. Scoped to the existing chain-runner audit
  // jsonls; avoids walking ~/Library/Logs on every probe run.
  const sources = [PR_MERGE_JSONL, PR_CREATE_JSONL];
  const needles = [pkg.name, ...pkg.bins.map((b) => b.binName)];
  const hits = [];
  for (const src of sources) {
    if (!existsSync(src)) continue;
    let body;
    try {
      body = readFileSync(src, 'utf8');
    } catch {
      continue;
    }
    for (const line of body.split('\n')) {
      if (!line) continue;
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }
      const ts = Date.parse(evt.ts ?? '');
      if (!Number.isFinite(ts) || ts < sinceMs) continue;
      const blob = JSON.stringify(evt);
      for (const n of needles) {
        if (blob.includes(n)) {
          hits.push({ source: src.split('/').pop(), bin: n, ts: evt.ts });
          break;
        }
      }
    }
  }
  return hits;
}

function classify(pkg, importers, plistConsumers, recentHits) {
  if (importers.length > 0) return 'LIVE';
  if (plistConsumers.length > 0) return 'LIVE';
  if (recentHits.length > 0) return 'LIVE';
  return 'DORMANT';
}

function daysAgo(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

function generateDormantMarkdown(dormant, today) {
  const lines = [];
  lines.push('<!-- AUTOGENERATED by caia/packages/chain-runner/bin/consumption-probe.js -->');
  lines.push('<!-- Re-run via: launchctl trigger com.caia.consumption-probe-daily -->');
  lines.push('');
  lines.push('# Dormant packages');
  lines.push('');
  lines.push(`**Last probe run:** ${today}  `);
  lines.push(`**Probe definition:** zero in-repo importers AND zero plist-backed CLI bins AND zero invocations in chain-runner audit jsonl in the last ${RECENT_DAYS} days.`);
  lines.push('');
  lines.push(`**Total dormant packages:** ${dormant.length}`);
  lines.push('');
  if (dormant.length === 0) {
    lines.push('_No dormant packages — every workspace package has at least one consumer._');
    return lines.join('\n') + '\n';
  }
  lines.push('| Package | Last modified | Days silent | Last importer seen | Purpose |');
  lines.push('|---|---|---|---|---|');
  // Sorted by days-silent descending (longest-dormant first).
  const sorted = [...dormant].sort((a, b) => (b.daysSilent ?? 0) - (a.daysSilent ?? 0));
  for (const d of sorted) {
    const purpose = d.description ? d.description.slice(0, 140) : '_(no description)_';
    const lastImp = d.lastImporterSeen ?? 'never';
    const days = d.daysSilent ?? '?';
    const lm = d.lastModified ? d.lastModified.slice(0, 10) : '?';
    lines.push(`| \`${d.name}\` | ${lm} | ${days} | ${lastImp} | ${purpose} |`);
  }
  lines.push('');
  lines.push('## Disposition');
  lines.push('');
  lines.push('Each dormant package needs a decision: revive (wire to a consumer), archive (move to `packages/_archive/`), or delete. See plan §A Phase E1 for the migration script.');
  lines.push('');
  return lines.join('\n') + '\n';
}

function generateProbeReport(today, allPkgs, dormant, drift) {
  const lines = [];
  lines.push('---');
  lines.push(`title: Consumption probe report — ${today}`);
  lines.push(`date: ${today}`);
  lines.push('generated_by: caia/packages/chain-runner/bin/consumption-probe.js');
  lines.push('---');
  lines.push('');
  lines.push(`# Consumption probe — ${today}`);
  lines.push('');
  lines.push(`Scanned **${allPkgs.length}** workspace packages.`);
  lines.push('');
  lines.push(`- LIVE: ${allPkgs.length - dormant.length}`);
  lines.push(`- DORMANT: ${dormant.length}`);
  lines.push('');
  if (drift.becameDormant.length > 0) {
    lines.push('## Drift — newly dormant since last probe');
    lines.push('');
    for (const name of drift.becameDormant) lines.push(`- \`${name}\``);
    lines.push('');
  }
  if (drift.becameLive.length > 0) {
    lines.push('## Drift — revived since last probe');
    lines.push('');
    for (const name of drift.becameLive) lines.push(`- \`${name}\``);
    lines.push('');
  }
  lines.push('## Dormant packages (sorted by days-silent)');
  lines.push('');
  const sorted = [...dormant].sort((a, b) => (b.daysSilent ?? 0) - (a.daysSilent ?? 0));
  for (const d of sorted) {
    lines.push(`### ${d.name}`);
    lines.push('');
    lines.push(`- last-modified: ${d.lastModified ? d.lastModified.slice(0, 10) : '?'}`);
    lines.push(`- days-silent: ${d.daysSilent ?? '?'}`);
    lines.push(`- last-importer-seen: ${d.lastImporterSeen ?? 'never'}`);
    lines.push(`- bins: ${d.bins.length === 0 ? '_(none)_' : d.bins.map((b) => `\`${b.binName}\``).join(', ')}`);
    lines.push(`- purpose: ${d.description || '_(no description)_'}`);
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

function appendInboxAlert(today, drift) {
  if (drift.becameDormant.length === 0 && drift.becameLive.length === 0) return;
  const ts = new Date().toISOString();
  const lines = [];
  lines.push('');
  lines.push(`## [${ts}] consumption_probe_drift`);
  if (drift.becameDormant.length > 0) {
    lines.push(`- newly_dormant: ${drift.becameDormant.map((n) => `\`${n}\``).join(', ')}`);
  }
  if (drift.becameLive.length > 0) {
    lines.push(`- revived: ${drift.becameLive.map((n) => `\`${n}\``).join(', ')}`);
  }
  lines.push(`- report: reports/consumption_probe_${today}.md`);
  lines.push(`- action: review DORMANT_PACKAGES.md; if newly-dormant pkg should be LIVE, wire a consumer; if a revived pkg appeared by accident, audit the new importer.`);
  try {
    appendFileSync(INBOX, lines.join('\n') + '\n');
  } catch {
    /* INBOX is best-effort; not fatal if missing. */
  }
}

function readPriorDormantNames() {
  if (!existsSync(DORMANT_MD)) return new Set();
  const body = safeReadText(DORMANT_MD);
  const names = new Set();
  // Match `@scope/name` inside backticks in table rows.
  const re = /`(@[^`]+)`/g;
  let m;
  while ((m = re.exec(body)) !== null) names.add(m[1]);
  return names;
}

function classifyAll() {
  const sinceMs = Date.now() - RECENT_DAYS * 86400000;
  const packages = loadPackages();
  const plists = loadAllPlistTexts();
  const wakeScripts = loadChainWakeScripts();
  const results = [];
  for (const pkg of packages) {
    const importers = findImporters(pkg);
    const plistConsumers = findPlistBackedConsumers(pkg, plists, wakeScripts);
    const recentHits = findRecentInvocations(pkg, sinceMs);
    const status = classify(pkg, importers, plistConsumers, recentHits);
    const lastImporterSeen = importers.length > 0 ? importers[0] : null;
    const daysSilent = daysAgo(pkg.lastModified);
    results.push({
      name: pkg.name,
      slug: pkg.slug,
      status,
      description: pkg.description,
      bins: pkg.bins,
      importers,
      plistConsumers,
      recentHits,
      lastModified: pkg.lastModified,
      lastImporterSeen,
      daysSilent,
    });
  }
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const showJson = args.includes('--json');
  const onlyPkg = (() => {
    const i = args.indexOf('--pkg');
    return i >= 0 ? args[i + 1] : null;
  })();
  const today = new Date().toISOString().slice(0, 10);

  const results = classifyAll();

  if (onlyPkg) {
    const r = results.find((x) => x.name === onlyPkg || x.slug === onlyPkg);
    if (!r) {
      process.stderr.write(`no such package: ${onlyPkg}\n`);
      process.exit(2);
    }
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
    return;
  }

  const dormant = results.filter((r) => r.status === 'DORMANT');
  if (showJson) {
    process.stdout.write(JSON.stringify({ today, results }, null, 2) + '\n');
    return;
  }

  const priorDormant = readPriorDormantNames();
  const currentDormant = new Set(dormant.map((d) => d.name));
  const becameDormant = [...currentDormant].filter((n) => !priorDormant.has(n)).sort();
  const becameLive = [...priorDormant].filter((n) => !currentDormant.has(n)).sort();
  const drift = { becameDormant, becameLive };

  const dormantMd = generateDormantMarkdown(dormant, today);
  const probeMd = generateProbeReport(today, results, dormant, drift);

  if (dryRun) {
    process.stdout.write(`# DRY RUN — would write ${DORMANT_MD} (${dormantMd.length} bytes)\n`);
    process.stdout.write(`# DRY RUN — would write reports/consumption_probe_${today}.md (${probeMd.length} bytes)\n`);
    process.stdout.write(`dormant_count: ${dormant.length}\n`);
    process.stdout.write(`became_dormant: ${becameDormant.join(',') || '(none)'}\n`);
    process.stdout.write(`became_live: ${becameLive.join(',') || '(none)'}\n`);
    return;
  }

  if (!existsSync(DOCS_DIR)) mkdirSync(DOCS_DIR, { recursive: true });
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(DORMANT_MD, dormantMd);
  writeFileSync(join(REPORTS_DIR, `consumption_probe_${today}.md`), probeMd);
  appendInboxAlert(today, drift);

  process.stdout.write(`consumption-probe: scanned ${results.length} pkgs, ${dormant.length} dormant\n`);
  if (becameDormant.length > 0) {
    process.stdout.write(`  newly_dormant: ${becameDormant.join(', ')}\n`);
  }
  if (becameLive.length > 0) {
    process.stdout.write(`  revived: ${becameLive.join(', ')}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`consumption-probe: ${err.message}\n`);
  process.exit(1);
});

// Exported for unit tests (the `--json`-mode entry point would also work,
// but importing classifyAll/loadPackages directly avoids forking node).
export { classifyAll, loadPackages, findImporters, findPlistBackedConsumers, classify, REPO_ROOT };
