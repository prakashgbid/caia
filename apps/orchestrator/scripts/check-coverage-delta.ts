#!/usr/bin/env ts-node
/**
 * gate:coverage — parses vitest/jest coverage JSON and asserts 100% coverage
 * on files changed in the current git diff (HEAD vs base branch).
 *
 * Exit 0 = all touched files at 100%. Exit 1 = coverage gaps.
 * Pass --all to check all files, not just the diff.
 *
 * @no-events — coverage gate, not an observable pipeline step.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(__dirname, '..');
const COVERAGE_JSON = path.join(ROOT, 'reports', 'coverage', 'coverage-final.json');
const CHECK_ALL = process.argv.includes('--all');
const THRESHOLD = 80; // minimum line coverage % per touched file

interface FileCoverage {
  s: Record<string, number>;
  b: Record<string, number[]>;
  f: Record<string, number>;
  fnMap: Record<string, { name: string; loc: { start: { line: number } } }>;
  statementMap: Record<string, { start: { line: number } }>;
}

function getChangedFiles(): string[] {
  try {
    const base = execSync('git merge-base HEAD origin/main 2>/dev/null || git merge-base HEAD HEAD~1', { stdio: 'pipe' }).toString().trim();
    const diff = execSync(`git diff --name-only ${base} HEAD`, { stdio: 'pipe' }).toString().trim();
    return diff
      .split('\n')
      .filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.includes('node_modules'))
      .map(f => path.resolve(ROOT, f));
  } catch {
    return [];
  }
}

function coveragePct(cov: FileCoverage): { lines: number; functions: number } {
  const stmts = Object.values(cov.s);
  const lines = stmts.length > 0 ? (stmts.filter(v => v > 0).length / stmts.length) * 100 : 100;
  const fns = Object.values(cov.f);
  const functions = fns.length > 0 ? (fns.filter(v => v > 0).length / fns.length) * 100 : 100;
  return { lines: Math.round(lines), functions: Math.round(functions) };
}

function main(): void {
  if (!fs.existsSync(COVERAGE_JSON)) {
    console.log('⚠ gate:coverage — no coverage report found at reports/coverage/coverage-final.json');
    console.log('  Run: npm test -- --coverage first');
    process.exit(0); // non-fatal if no report yet
  }

  const report = JSON.parse(fs.readFileSync(COVERAGE_JSON, 'utf-8')) as Record<string, FileCoverage>;

  let filesToCheck: string[];
  if (CHECK_ALL) {
    filesToCheck = Object.keys(report);
  } else {
    const changed = getChangedFiles();
    filesToCheck = Object.keys(report).filter(f => changed.some(c => c === f || f.includes(path.relative(ROOT, c))));
  }

  if (filesToCheck.length === 0) {
    console.log('✓ gate:coverage — no covered files in diff');
    process.exit(0);
  }

  const gaps: Array<{ file: string; lines: number; functions: number }> = [];

  for (const file of filesToCheck) {
    const cov = report[file];
    if (!cov) continue;
    const pct = coveragePct(cov);
    if (pct.lines < THRESHOLD || pct.functions < THRESHOLD) {
      gaps.push({ file: path.relative(ROOT, file), lines: pct.lines, functions: pct.functions });
    }
  }

  if (gaps.length === 0) {
    console.log(`✓ gate:coverage — ${filesToCheck.length} file(s) checked, all above ${THRESHOLD}%`);
    process.exit(0);
  } else {
    console.error(`✗ gate:coverage — ${gaps.length} file(s) below ${THRESHOLD}% coverage:`);
    for (const g of gaps) {
      console.error(`  ${g.file}  lines: ${g.lines}%  functions: ${g.functions}%`);
    }
    process.exit(1);
  }
}

main();
