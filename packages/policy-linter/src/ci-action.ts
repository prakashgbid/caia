/**
 * @caia/policy-linter — GitHub Actions step renderer.
 *
 * Consumers embed a CI step that runs the linter against a PR. The step:
 *   1. Resolves the brief path (defaults to `.github/policy-brief.md`).
 *   2. Captures the PR diff via `gh pr diff` and the body via `gh pr view`.
 *   3. Invokes `caia-policy-lint` with the right flags.
 *   4. Annotates the PR via `::error` / `::warning` workflow commands.
 */

import type { PolicyReport } from './types.js';

export interface RenderGithubActionsStepOptions {
  stepName?: string;
  briefPath?: string;
  callerAgentId?: string;
  intent?: string;
  targetRepos?: ReadonlyArray<string>;
  workingDirectory?: string;
  format?: 'json' | 'markdown' | 'line';
  buildBeforeRun?: boolean;
}

export function renderGithubActionsStep(
  opts: RenderGithubActionsStepOptions = {}
): string {
  const stepName = opts.stepName ?? 'CAIA policy linter (Layer 1)';
  const briefPath = opts.briefPath ?? '.github/policy-brief.md';
  const callerAgentId = opts.callerAgentId ?? '${{ github.actor }}';
  const intent = opts.intent ?? 'build';
  const targetRepos = opts.targetRepos ?? ['${{ github.repository }}'];
  const format = opts.format ?? 'markdown';
  const workingDirectory = opts.workingDirectory ?? 'packages/policy-linter';
  const buildLine = opts.buildBeforeRun
    ? '    pnpm --filter @caia/policy-linter build\n'
    : '';
  const targetReposFlag = targetRepos
    .map((r) => `--target-repo "${r}"`)
    .join(' ');

  return [
    `- name: ${stepName}`,
    `  if: github.event_name == 'pull_request'`,
    `  working-directory: ${workingDirectory}`,
    `  env:`,
    `    GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}`,
    `    PR_NUMBER: \${{ github.event.pull_request.number }}`,
    `  run: |`,
    `    set -euo pipefail`,
    `${buildLine}    PR_BODY=$(mktemp)`,
    `    PR_DIFF=$(mktemp)`,
    `    gh pr view "$PR_NUMBER" --json body --jq .body > "$PR_BODY" || true`,
    `    gh pr diff "$PR_NUMBER" > "$PR_DIFF" || true`,
    `    OPEN=$(gh pr list --state open --json number --jq 'length')`,
    `    npx --no caia-policy-lint "${briefPath}" \\`,
    `      --format ${format} \\`,
    `      --caller-agent-id "${callerAgentId}" \\`,
    `      --intent "${intent}" \\`,
    `      ${targetReposFlag} \\`,
    `      --pr-body-file "$PR_BODY" \\`,
    `      --pr-diff-file "$PR_DIFF" \\`,
    `      --open-pr-count "$OPEN"`
  ].join('\n');
}

export function formatAnnotation(report: PolicyReport): string {
  const out: string[] = [];
  for (const r of report.results) {
    if (r.verdict.ok) continue;
    const command = r.effectiveMode === 'hard-fail' ? 'error' : 'warning';
    const reason = r.verdict.reason.replace(/\r?\n+/g, ' — ');
    out.push(`::${command} title=${r.policyId}::${reason}`);
  }
  return out.join('\n');
}
