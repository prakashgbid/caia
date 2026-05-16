import { COMMENT_MARKER } from './types.js';
import type { VerificationResult } from '../verify/types.js';

export interface RenderOptions {
  readonly pr: { readonly number: number; readonly headRefOid: string };
  readonly targetPackages: readonly string[];
  readonly consumerPackages: readonly string[];
  readonly result: VerificationResult;
  readonly worktreeDir: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly setupErrors?: readonly string[];
}

const STATUS_EMOJI: Record<string, string> = {
  pass: '✅',
  fail: '❌',
  timeout: '⏱',
  skipped: '⏭',
};

export function renderVerificationComment(opts: RenderOptions): string {
  const header = opts.result.pass
    ? '## Adoption verification — PASS'
    : '## Adoption verification — FAIL';

  const summary = [
    `**PR**: #${opts.pr.number} @ \`${opts.pr.headRefOid.slice(0, 12)}\``,
    `**Worktree**: \`${opts.worktreeDir}\``,
    `**Target**: ${formatPkgs(opts.targetPackages)}`,
    `**Consumers**: ${formatPkgs(opts.consumerPackages)}`,
    `**Started**: ${opts.startedAt}`,
    `**Finished**: ${opts.finishedAt}`,
    `**Wall-clock**: ${formatMs(opts.result.durationMs)}`,
  ].join('  \n');

  const table = renderTable(opts.result);
  const details = renderFailureDetails(opts.result);
  const setup = (opts.setupErrors && opts.setupErrors.length > 0)
    ? `\n\n### Setup errors\n${opts.setupErrors.map((e) => `- ${e}`).join('\n')}\n`
    : '';

  return [
    COMMENT_MARKER,
    header,
    '',
    summary,
    setup,
    '',
    table,
    '',
    details,
  ].filter((s) => s.length > 0).join('\n');
}

function formatPkgs(pkgs: readonly string[]): string {
  if (pkgs.length === 0) return '_none inferred_';
  return pkgs.map((p) => `\`${p}\``).join(', ');
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 100) / 10;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  const s = (seconds - m * 60).toFixed(1);
  return `${m}m ${s}s`;
}

function renderTable(result: VerificationResult): string {
  const rows = result.checks.map((c) => {
    const status = `${STATUS_EMOJI[c.status] ?? ''} ${c.status}`;
    const exit = c.exitCode === null ? '—' : String(c.exitCode);
    return `| ${c.id} | ${c.label} | ${status} | ${exit} | ${formatMs(c.durationMs)} |`;
  });
  return [
    '| Check | Label | Status | Exit | Duration |',
    '|-------|-------|--------|------|----------|',
    ...rows,
  ].join('\n');
}

function renderFailureDetails(result: VerificationResult): string {
  const failures = result.checks.filter(
    (c) => c.status === 'fail' || c.status === 'timeout',
  );
  if (failures.length === 0) return '';
  return failures
    .map((c) => {
      const stderr = c.stderrTail.trim();
      const stdout = c.stdoutTail.trim();
      return [
        `### ${c.id} ${c.label} — ${c.status}`,
        '',
        `Command: \`${c.command}\``,
        '',
        '<details><summary>stderr (tail)</summary>',
        '',
        '```',
        stderr || '(empty)',
        '```',
        '',
        '</details>',
        '',
        '<details><summary>stdout (tail)</summary>',
        '',
        '```',
        stdout || '(empty)',
        '```',
        '',
        '</details>',
      ].join('\n');
    })
    .join('\n\n');
}
