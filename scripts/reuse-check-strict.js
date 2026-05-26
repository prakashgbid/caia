#!/usr/bin/env node
/**
 * scripts/reuse-check-strict.js — BLOCKING reuse-advisory CI gate.
 *
 * Companion to the legacy `scripts/reuse-check.js` (non-blocking, comment-only).
 * This script EXITS NON-ZERO on new violations, which fails the
 * `reuse-advisory-blocking` required status check on develop/main.
 *
 * Rules (per ADR-065 / AGENTS.md > Reuse-first):
 *
 *   | Pattern                                          | Allowed in              |
 *   |--------------------------------------------------|-------------------------|
 *   | `from "@radix-ui/*"`                             | packages/ui/**          |
 *   | `from "@/components/ui/*"` (raw shadcn)          | packages/ui/**          |
 *   | `import axios from "axios"`                      | packages/http-client/** |
 *   | `import ... from "node-fetch"`                   | packages/http-client/** |
 *   | `import ... from "better-sqlite3"`               | packages/persistence-* /** |
 *
 * Baseline-aware: pre-existing violations recorded in
 * `.reuse-advisory-baseline.json` at repo root are NOT failed. New violations
 * relative to baseline fail the build. Baseline shrinks over time.
 *
 * Escape hatches:
 *   - Inline:    `// reuse-advisory:allow <reason>` on the same or previous line
 *   - PR-level:  label the PR `reuse-advisory-escape` (handled in the workflow,
 *                NOT here — this script always runs strict)
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO_ROOT = process.cwd();
const BASELINE_PATH = join(REPO_ROOT, ".reuse-advisory-baseline.json");

const RULES = [
  {
    id: "raw-shadcn-import",
    description: "Raw shadcn primitive import outside packages/ui/**",
    regex: /from\s+["'](?:@\/components\/ui\/[a-z-]+|\.{1,2}\/components\/ui\/[a-z-]+)["']/,
    allow: (p) => p.startsWith("packages/ui/"),
  },
  {
    id: "raw-radix-import",
    description: "Raw @radix-ui/* import outside packages/ui/**",
    regex: /from\s+["']@radix-ui\//,
    allow: (p) => p.startsWith("packages/ui/"),
  },
  {
    id: "raw-axios-import",
    description: "Raw axios import outside packages/http-client/**",
    regex: /(?:import[^"']+["']axios["']|require\(\s*["']axios["']\s*\))/,
    allow: (p) => p.startsWith("packages/http-client/"),
  },
  {
    id: "raw-node-fetch-import",
    description: "Raw node-fetch import outside packages/http-client/**",
    regex: /(?:import[^"']+["']node-fetch["']|require\(\s*["']node-fetch["']\s*\))/,
    allow: (p) => p.startsWith("packages/http-client/"),
  },
  {
    id: "raw-better-sqlite3-import",
    description: "Raw better-sqlite3 import outside packages/persistence-* /**",
    regex: /(?:import[^"']+["']better-sqlite3["']|require\(\s*["']better-sqlite3["']\s*\))/,
    allow: (p) => /^packages\/persistence-[a-z0-9-]+\//.test(p),
  },
];

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIR_NAMES = new Set(["node_modules", "dist", "build", ".next", ".turbo", "coverage", "__visual_baselines__", "__fixtures__"]);
const TEST_FILE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return new Set();
  try {
    const raw = JSON.parse(readFileSync(BASELINE_PATH, "utf-8"));
    const arr = Array.isArray(raw?.violations) ? raw.violations : [];
    return new Set(arr.map((v) => `${v.rule}::${v.path}::${v.line}`));
  } catch {
    return new Set();
  }
}

function changedFiles() {
  // GitHub-Actions injects BASE_REF; locally we diff against develop.
  const baseRef = process.env.BASE_REF || "develop";
  try {
    const out = execSync(`git diff --name-only --diff-filter=AM "origin/${baseRef}"...HEAD`, { encoding: "utf-8" });
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    // No git history (e.g. shallow clone) → scan everything.
    return null;
  }
}

function walkAll(dir, out = []) {
  let entries;
  try {
    entries = require("node:fs").readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIR_NAMES.has(e.name)) continue;
    if (e.name.startsWith(".") && e.name !== ".github") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walkAll(full, out);
    else if (e.isFile() && SCAN_EXTENSIONS.has(extname(e.name))) out.push(full);
  }
  return out;
}

function extname(name) {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i);
}

function isInlineAllowed(lines, i) {
  const prev = lines[i - 1] || "";
  const curr = lines[i] || "";
  return /\/\/\s*reuse-advisory:allow\b/.test(prev) || /\/\/\s*reuse-advisory:allow\b/.test(curr);
}

function checkFile(absPath, repoRelPath) {
  if (TEST_FILE.test(repoRelPath)) return [];
  const lines = readFileSync(absPath, "utf-8").split("\n");
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    for (const rule of RULES) {
      if (rule.allow(repoRelPath)) continue;
      if (rule.regex.test(lines[i])) {
        if (isInlineAllowed(lines, i)) continue;
        findings.push({
          rule: rule.id,
          description: rule.description,
          path: repoRelPath,
          line: i + 1,
          snippet: lines[i].trim().slice(0, 160),
        });
      }
    }
  }
  return findings;
}

function main() {
  const baseline = loadBaseline();
  const changed = changedFiles();
  let scope;
  if (changed === null) {
    console.error("reuse-check-strict: no git diff base — scanning entire repo");
    const files = [
      ...walkAll(join(REPO_ROOT, "apps")),
      ...walkAll(join(REPO_ROOT, "packages")),
    ];
    scope = files.map((f) => ({ abs: f, rel: relative(REPO_ROOT, f) }));
  } else {
    scope = changed
      .filter((p) => p.startsWith("apps/") || p.startsWith("packages/"))
      .filter((p) => SCAN_EXTENSIONS.has(extname(p)))
      .map((p) => ({ abs: resolve(REPO_ROOT, p), rel: p }))
      .filter(({ abs }) => {
        try { return statSync(abs).isFile(); } catch { return false; }
      });
  }

  const findings = [];
  for (const { abs, rel } of scope) {
    findings.push(...checkFile(abs, rel));
  }

  const newFindings = findings.filter((f) => !baseline.has(`${f.rule}::${f.path}::${f.line}`));

  console.log(`reuse-check-strict: scanned ${scope.length} file(s); ${findings.length} total finding(s); ${newFindings.length} NEW vs baseline`);

  if (newFindings.length === 0) {
    process.exit(0);
  }

  console.log("");
  console.log("=== NEW REUSE-ADVISORY VIOLATIONS (block-on-merge) ===");
  for (const f of newFindings) {
    console.log(`  ${f.path}:${f.line}  [${f.rule}]  ${f.description}`);
    console.log(`    ${f.snippet}`);
  }
  console.log("");
  console.log("To unblock:");
  console.log("  1. Refactor the import to consume the canonical wrapper (@caia/ui, @chiefaia/http-client, @chiefaia/persistence-*).");
  console.log("  2. If genuinely one-off: add `// reuse-advisory:allow <reason>` on the line above the violation.");
  console.log("  3. PR-level escape: have an EA-reviewer apply the `reuse-advisory-escape` label.");
  console.log("");
  console.log("See AGENTS.md > Reuse-first and caia-ea/decisions/ADR-065.");

  process.exit(1);
}

main();
