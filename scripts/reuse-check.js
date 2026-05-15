#!/usr/bin/env node
// scripts/reuse-check.js
//
// INT.1.A4 — Reuse-completeness reviewer (Guardrail #9).
//
// ADVISORY (non-blocking) CI step. Scans a PR's diff for newly-added
// identifiers that already appear in a `@chiefaia/*` package's public
// surface (its `src/index.ts`). When matches are found, prints a
// markdown comment body to stdout. The GitHub Actions workflow
// (`.github/workflows/reuse-advisory.yml`) pipes that body into
// `gh pr comment`.
//
// This script MUST NEVER exit non-zero. It is advisory — failure to
// run must not block merges. If anything goes wrong, log to stderr
// and exit 0 with an empty body so the workflow stays green.
//
// Heuristic (v1): identifier-based.
//   1. Build inventory: `<identifier> -> [@chiefaia/pkg, ...]` by
//      regex-extracting top-level exports from every
//      `packages/*/src/index.ts`.
//   2. Diff `git diff --no-color origin/develop...HEAD` (or whatever
//      base is configured via $REUSE_CHECK_BASE_REF) and pull added
//      identifier definitions from `+` lines.
//   3. For each added identifier (length >= MIN_LENGTH, alphanumeric,
//      not in its own package), look it up in the inventory and surface
//      it. MIN_LENGTH defaults to 5 per the A4 spec ("avoid `get`,
//      `set`, etc."); STOPWORDS catches the longer too-common names.
//
// Inputs (env):
//   REUSE_CHECK_BASE_REF   ref to diff against (default: origin/develop)
//   REUSE_CHECK_REPO_ROOT  repo root (default: parent of scripts/)
//   REUSE_CHECK_MIN_LENGTH min identifier length to consider (default: 5)
//
// Stdout: a markdown comment body (or empty string if no findings).
// Stderr: diagnostic lines.
// Exit code: 0 always.

'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const REPO_ROOT = process.env.REUSE_CHECK_REPO_ROOT
  ? path.resolve(process.env.REUSE_CHECK_REPO_ROOT)
  : path.resolve(__dirname, '..');
const BASE_REF = process.env.REUSE_CHECK_BASE_REF || 'origin/develop';
const MIN_LENGTH = parseInt(process.env.REUSE_CHECK_MIN_LENGTH || '5', 10);

// Identifiers everyone names something — never recommend a package
// match for these. Keep small; the min-length filter handles most.
const STOPWORDS = new Set([
  'main', 'init', 'index', 'config', 'setup', 'test', 'tests',
  'mock', 'mocks', 'util', 'utils', 'helper', 'helpers', 'lib',
  'data', 'value', 'values', 'result', 'results', 'state', 'status',
  'options', 'option', 'props', 'params', 'param', 'args', 'arg',
  'item', 'items', 'name', 'type', 'types', 'kind', 'mode',
  'context', 'request', 'response', 'error', 'err', 'success',
  'default', 'callback', 'handler', 'listener', 'event',
  'create', 'build', 'make', 'parse', 'format', 'load', 'save',
  'read', 'write', 'open', 'close', 'start', 'stop', 'run',
]);

function log(msg) {
  process.stderr.write(`[reuse-check] ${msg}\n`);
}

function safeReadFile(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (_e) {
    return null;
  }
}

function listPackages(root) {
  const packagesDir = path.join(root, 'packages');
  if (!fs.existsSync(packagesDir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = path.join(packagesDir, entry.name, 'package.json');
    const raw = safeReadFile(pkgJsonPath);
    if (!raw) continue;
    let pkg;
    try { pkg = JSON.parse(raw); } catch (_e) { continue; }
    if (!pkg.name || !pkg.name.startsWith('@chiefaia/')) continue;
    // `private: true` packages are kept — they are not published to npm
    // but are still importable inside the monorepo via the workspace
    // protocol, so reuse advice still applies.
    out.push({
      name: pkg.name,
      dir: path.join(packagesDir, entry.name),
      relDir: path.posix.join('packages', entry.name),
    });
  }
  return out;
}

// Regex set used both for inventory extraction and for diff scanning.
// Captures identifier names from common TS/JS declaration forms.
const DECL_PATTERNS = [
  // export (default)? (async)? function Foo(
  /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  // export (default)? class Foo
  /^\s*export\s+(?:default\s+|abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  // export (const|let|var) foo
  /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
  // export interface Foo
  /^\s*export\s+interface\s+([A-Za-z_$][\w$]*)/,
  // export type Foo =
  /^\s*export\s+type\s+([A-Za-z_$][\w$]*)\s*=/,
  // export enum Foo
  /^\s*export\s+enum\s+([A-Za-z_$][\w$]*)/,
];

// Same patterns minus the `export` prefix — used to scan diff bodies
// for *internal* declarations that re-implement something exported by
// a package (e.g. `function debounce` defined locally when
// `@chiefaia/foo` already exports `debounce`).
const LOCAL_DECL_PATTERNS = [
  /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+(?:default\s+|abstract\s+)?)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/,
  /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/,
  /^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/,
];

// `export { foo, bar as baz, type Quux }` — capture identifier names
// (the aliased form `as baz` is what the package exposes externally;
// the un-aliased form is the original symbol). Multiline form is the
// common case for re-exports from sibling files, so the regex spans
// newlines via `[\s\S]` and `multiline` flag is not required.
const RE_EXPORT_LIST = /export\s*\{\s*([\s\S]*?)\s*\}\s*(?:from\s+['"][^'"]+['"]\s*)?;?/g;

function harvestExportListBody(body, ids) {
  for (const raw of body.split(',')) {
    // Strip `type` modifier and `default as` artefacts; honour `as alias`.
    const cleaned = raw.trim().replace(/^type\s+/, '');
    if (!cleaned) continue;
    const asMatch = /^(\S+)\s+as\s+(\S+)$/.exec(cleaned);
    if (asMatch) {
      ids.add(asMatch[2]); // exposed name
    } else {
      ids.add(cleaned);
    }
  }
}

function extractExports(src) {
  const ids = new Set();
  const lines = src.split(/\r?\n/);
  for (const line of lines) {
    for (const re of DECL_PATTERNS) {
      const m = re.exec(line);
      if (m) ids.add(m[1]);
    }
  }
  // Export-list bodies may span multiple lines, so scan the whole source.
  let m;
  RE_EXPORT_LIST.lastIndex = 0;
  while ((m = RE_EXPORT_LIST.exec(src)) !== null) {
    harvestExportListBody(m[1], ids);
  }
  return ids;
}

function buildInventory(packages) {
  const inv = new Map(); // identifier -> Set(packageName)
  for (const pkg of packages) {
    // Try a few entry-point candidates, in order.
    const candidates = [
      path.join(pkg.dir, 'src', 'index.ts'),
      path.join(pkg.dir, 'src', 'index.tsx'),
      path.join(pkg.dir, 'src', 'index.js'),
      path.join(pkg.dir, 'index.ts'),
      path.join(pkg.dir, 'index.js'),
    ];
    let src = null;
    for (const c of candidates) {
      src = safeReadFile(c);
      if (src) break;
    }
    if (!src) continue;
    for (const id of extractExports(src)) {
      if (id.length < MIN_LENGTH) continue;
      if (STOPWORDS.has(id.toLowerCase())) continue;
      if (!inv.has(id)) inv.set(id, new Set());
      inv.get(id).add(pkg.name);
    }
  }
  return inv;
}

function getDiff(baseRef) {
  // --unified=0 keeps the noise down; we only care about `+` lines.
  // `--diff-filter=AM` skips deletions; `-w` ignores whitespace-only.
  // We constrain the scan to source-y files; the GHA already handles
  // checkout depth.
  try {
    const out = cp.execSync(
      `git diff --no-color --unified=0 --diff-filter=AM ${baseRef}...HEAD -- '*.ts' '*.tsx' '*.js' '*.jsx'`,
      { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    return out;
  } catch (e) {
    log(`git diff failed: ${e.message}`);
    return '';
  }
}

// Parse a unified diff into { path -> [addedLine, addedLine, ...] }.
// Ignores deletions and hunk headers.
function parseDiff(diffText) {
  const byFile = new Map();
  const lines = diffText.split(/\r?\n/);
  let currentPath = null;
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      // `diff --git a/path b/path`
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      currentPath = m ? m[2] : null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      // confirm path; tolerate /dev/null on new-file deletes (skipped by filter anyway).
      const m = /^\+\+\+ b\/(.+)$/.exec(line);
      if (m) currentPath = m[1];
      continue;
    }
    if (line.startsWith('---') || line.startsWith('@@') || line.startsWith('index ')) continue;
    if (line.startsWith('+') && currentPath) {
      const body = line.slice(1);
      if (!byFile.has(currentPath)) byFile.set(currentPath, []);
      byFile.get(currentPath).push(body);
    }
  }
  return byFile;
}

// Return the @chiefaia package name that the file lives in, or null.
function owningPackage(filePath, packages) {
  for (const pkg of packages) {
    if (filePath === pkg.relDir || filePath.startsWith(pkg.relDir + '/')) return pkg.name;
  }
  return null;
}

function scanAddedIdentifiers(addedLines) {
  const ids = new Set();
  for (const line of addedLines) {
    for (const re of LOCAL_DECL_PATTERNS) {
      const m = re.exec(line);
      if (m) ids.add(m[1]);
    }
  }
  return ids;
}

function shouldSkipFile(p) {
  // Skip tests, fixtures, generated files, vendored deps.
  if (/(^|\/)(node_modules|dist|build|coverage|\.next|\.turbo)\//.test(p)) return true;
  if (/(^|\/)(__tests__|__fixtures__|__mocks__)\//.test(p)) return true;
  if (/\.(test|spec)\.[jt]sx?$/.test(p)) return true;
  // Skip the reviewer itself (don't false-positive on its own additions).
  if (p === 'scripts/reuse-check.js') return true;
  return false;
}

function formatFindings(findings) {
  if (findings.length === 0) return '';
  const lines = [];
  lines.push('<!-- reuse-check:advisory -->');
  lines.push('### Reuse-completeness review (advisory)');
  lines.push('');
  lines.push("These added identifiers share a name with existing `@chiefaia/*` package exports. " +
    "Consider importing instead of re-implementing — this comment is **advisory only** and never blocks the merge.");
  lines.push('');
  lines.push('| File | Identifier | Already exported by |');
  lines.push('| ---- | ---------- | ------------------- |');
  for (const f of findings) {
    const pkgs = [...f.packages].sort().map((p) => `\`${p}\``).join(', ');
    lines.push(`| \`${f.file}\` | \`${f.id}\` | ${pkgs} |`);
  }
  lines.push('');
  lines.push('_Generated by `scripts/reuse-check.js` (INT.1.A4 — Guardrail #9). False positives are common with v1\'s identifier-based heuristic. To silence, rename the local symbol or import from the named package._');
  return lines.join('\n');
}

function main() {
  log(`repo=${REPO_ROOT} base=${BASE_REF}`);
  const packages = listPackages(REPO_ROOT);
  log(`packages: ${packages.length}`);
  if (packages.length === 0) {
    log('no @chiefaia/* packages found — nothing to compare against');
    process.stdout.write('');
    return;
  }
  const inv = buildInventory(packages);
  log(`inventory identifiers: ${inv.size}`);

  const diffText = getDiff(BASE_REF);
  if (!diffText.trim()) {
    log('empty diff');
    process.stdout.write('');
    return;
  }
  const byFile = parseDiff(diffText);
  log(`changed source files: ${byFile.size}`);

  const findings = [];
  for (const [file, addedLines] of byFile) {
    if (shouldSkipFile(file)) continue;
    const owner = owningPackage(file, packages);
    const ids = scanAddedIdentifiers(addedLines);
    for (const id of ids) {
      if (id.length < MIN_LENGTH) continue;
      if (STOPWORDS.has(id.toLowerCase())) continue;
      const matches = inv.get(id);
      if (!matches || matches.size === 0) continue;
      // Don't flag re-exports within the same package — those are the
      // packages's *own* identifiers being moved around.
      const filtered = [...matches].filter((pkg) => pkg !== owner);
      if (filtered.length === 0) continue;
      findings.push({ file, id, packages: new Set(filtered) });
    }
  }

  // Stable order: by file, then by id.
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.id.localeCompare(b.id));
  log(`findings: ${findings.length}`);

  process.stdout.write(formatFindings(findings));
}

try {
  main();
} catch (e) {
  log(`fatal: ${e && e.stack ? e.stack : e}`);
  // Advisory — never fail the build.
}
process.exit(0);
