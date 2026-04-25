import chalk from 'chalk';
import * as path from 'path';
import type { ScanResult, Issue } from '../types';

const SEV_ICON = { error: chalk.red('✖'), warning: chalk.yellow('⚠') };
const RULE_COLOR: Record<string, (s: string) => string> = {
  'dead-onclick': chalk.red,
  'button-without-action': chalk.yellow,
  'missing-href': chalk.red,
  'unresolved-import': chalk.red,
  'unknown-handler': chalk.red,
  'broken-route': chalk.red,
  'broken-external': chalk.yellow,
  'http-error': chalk.red,
};

function formatIssue(issue: Issue, cwd: string): string {
  const rel = path.relative(cwd, issue.file);
  const loc = issue.line ? `${rel}:${issue.line}:${issue.col}` : rel;
  const icon = SEV_ICON[issue.severity];
  const ruleColor = RULE_COLOR[issue.rule] ?? chalk.white;
  const fixed = issue.fixed ? chalk.green(' [fixed]') : '';
  return `  ${icon} ${chalk.dim(loc)}  ${ruleColor(issue.rule)}  ${issue.message}${fixed}`;
}

function groupByFile(issues: Issue[]): Map<string, Issue[]> {
  const map = new Map<string, Issue[]>();
  for (const issue of issues) {
    const list = map.get(issue.file) ?? [];
    list.push(issue);
    map.set(issue.file, list);
  }
  return map;
}

export function printTerminalReport(result: ScanResult): void {
  const { stats, issues } = result;
  const cwd = result.projectDir;

  console.log();
  console.log(chalk.bold('Integrity Check') + chalk.dim(` — ${path.basename(result.projectDir)}`));
  console.log(chalk.dim(`  ${stats.filesScanned} files  •  ${stats.routesChecked} routes  •  ${new Date(result.timestamp).toLocaleTimeString()}`));
  console.log();

  if (issues.length === 0) {
    console.log(chalk.green('  ✔ No issues found. All links and handlers are intact.\n'));
    return;
  }

  // Group by rule
  const errors = issues.filter((i) => i.severity === 'error' && !i.fixed);
  const warnings = issues.filter((i) => i.severity === 'warning' && !i.fixed);
  const fixed = issues.filter((i) => i.fixed);

  const byFile = groupByFile(issues);

  for (const [file, fileIssues] of byFile) {
    const rel = path.relative(cwd, file);
    console.log(chalk.underline(rel));
    for (const issue of fileIssues) {
      console.log(formatIssue(issue, cwd));
      if (issue.fix && !issue.fixed) {
        console.log(chalk.dim(`      → ${issue.fix}`));
      }
    }
    console.log();
  }

  // Summary
  const parts: string[] = [];
  if (errors.length) parts.push(chalk.red(`${errors.length} error${errors.length > 1 ? 's' : ''}`));
  if (warnings.length) parts.push(chalk.yellow(`${warnings.length} warning${warnings.length > 1 ? 's' : ''}`));
  if (fixed.length) parts.push(chalk.green(`${fixed.length} auto-fixed`));

  console.log(chalk.bold('Summary:') + '  ' + parts.join('  '));

  if (errors.length > 0) {
    console.log(chalk.red.bold('\n  ✖ Build gate: FAILED (errors present)\n'));
  } else if (warnings.length > 0) {
    console.log(chalk.yellow('\n  ⚠ Build gate: PASS WITH WARNINGS\n'));
  } else {
    console.log(chalk.green.bold('\n  ✔ Build gate: PASSED\n'));
  }
}

/** Re-render a previously saved JSON report */
export function renderReport(data: ScanResult): void {
  printTerminalReport(data);
}
