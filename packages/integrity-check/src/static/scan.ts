import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';
import { parseFile } from './ast';
import { checkDeadOnClick } from './rules/dead-onclick';
import { checkButtonWithoutAction } from './rules/button-without-action';
import { checkMissingHref } from './rules/missing-href';
import { checkUnresolvedImports } from './rules/unresolved-import';
import { checkUnknownHandlers } from './rules/unknown-handler';
import type { Issue, StaticResult } from '../types';

const SOURCE_GLOB = 'src/**/*.{ts,tsx,js,jsx}';
const IGNORE = ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/out/**', '**/__tests__/**'];

/** Apply all static rules to a single file. */
function scanFile(filePath: string): Issue[] {
  const code = fs.readFileSync(filePath, 'utf8');
  const ast = parseFile(code, filePath);
  if (!ast) return [];

  return [
    ...checkDeadOnClick(ast, filePath),
    ...checkButtonWithoutAction(ast, filePath),
    ...checkMissingHref(ast, filePath),
    ...checkUnresolvedImports(ast, filePath),
    ...checkUnknownHandlers(ast, filePath),
  ];
}

/**
 * Auto-fix obvious issues in a file:
 * - Remove empty onClick attributes
 * - Replace href="" with href="/"
 */
function applyFixes(filePath: string, issues: Issue[]): number {
  if (issues.length === 0) return 0;
  let code = fs.readFileSync(filePath, 'utf8');
  let fixed = 0;

  // Fix: onClick={() => {}}  →  (remove attribute)
  const deadOnClickIssues = issues.filter((i) => i.rule === 'dead-onclick' && i.severity === 'error');
  if (deadOnClickIssues.length > 0) {
    const before = code;
    code = code.replace(/\s+onClick=\{[^}]*\{\s*\}[^}]*\}/g, '');
    if (code !== before) fixed += deadOnClickIssues.length;
  }

  // Fix: href=""  →  href="/"
  const emptyHrefIssues = issues.filter((i) => i.rule === 'missing-href' && i.message.includes('empty href'));
  if (emptyHrefIssues.length > 0) {
    const before = code;
    code = code.replace(/href=""/g, 'href="/"');
    if (code !== before) fixed += emptyHrefIssues.length;
  }

  if (fixed > 0) {
    fs.writeFileSync(filePath, code, 'utf8');
  }

  return fixed;
}

/** Run static analysis across all source files in the project. */
export async function runStaticScan(projectDir: string, fix = false): Promise<StaticResult> {
  const files = await fg(SOURCE_GLOB, {
    cwd: projectDir,
    ignore: IGNORE,
    absolute: true,
  });

  const allIssues: Issue[] = [];
  let totalFixed = 0;

  for (const file of files) {
    const issues = scanFile(file);
    if (fix && issues.length > 0) {
      const fixed = applyFixes(file, issues);
      totalFixed += fixed;
      // Mark fixed issues
      issues.forEach((i) => { if (fixed > 0) i.fixed = true; });
    }
    allIssues.push(...issues);
  }

  return { filesScanned: files.length, issues: allIssues };
}
