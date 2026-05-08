#!/usr/bin/env node
/**
 * caia-code-reviewer CLI.
 *
 * Subcommands:
 *   review --pr <n> [--diff-file <path>] [--output text|json]
 *                    [--severity-floor <s>] [--blocking-threshold <s>]
 *                    [--no-llm] [--base-branch <b>] [--branch <b>] [--title <t>]
 *
 *   dry-run --diff-file <path> [--output text|json] [--no-llm]
 *
 * If `--diff-file` is omitted, the CLI shells out to `gh pr diff <n>` to
 * fetch the diff. SUBSCRIPTION-ONLY: never sets ANTHROPIC_API_KEY.
 *
 * Exit codes:
 *   0 — verdict 'approve'
 *   1 — verdict 'request-changes'
 *   2 — bad arguments / unrecoverable error
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { CodeReviewerAgent } from './agent.js';
import type { CodeReview, CodeReviewSeverity } from './types.js';

interface ParsedArgs {
  command: 'review' | 'dry-run' | 'help';
  pr: number;
  diffFile: string | null;
  output: 'text' | 'json';
  severityFloor: CodeReviewSeverity | null;
  blockingThreshold: CodeReviewSeverity | null;
  noLlm: boolean;
  baseBranch: string;
  branch: string;
  title: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const a: ParsedArgs = {
    command: 'help',
    pr: 0,
    diffFile: null,
    output: 'text',
    severityFloor: null,
    blockingThreshold: null,
    noLlm: false,
    baseBranch: 'develop',
    branch: 'unknown',
    title: ''
  };
  if (argv.length === 0) return a;
  const cmd = argv[0];
  if (cmd === 'review' || cmd === 'dry-run') a.command = cmd;
  for (let i = 1; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case '--pr':
        a.pr = Number(v ?? '0');
        i++;
        break;
      case '--diff-file':
        a.diffFile = v ?? null;
        i++;
        break;
      case '--output':
        if (v === 'json' || v === 'text') a.output = v;
        i++;
        break;
      case '--severity-floor':
        if (v === 'low' || v === 'medium' || v === 'high' || v === 'critical') a.severityFloor = v;
        i++;
        break;
      case '--blocking-threshold':
        if (v === 'low' || v === 'medium' || v === 'high' || v === 'critical') a.blockingThreshold = v;
        i++;
        break;
      case '--no-llm':
        a.noLlm = true;
        break;
      case '--base-branch':
        a.baseBranch = v ?? 'develop';
        i++;
        break;
      case '--branch':
        a.branch = v ?? 'unknown';
        i++;
        break;
      case '--title':
        a.title = v ?? '';
        i++;
        break;
      default:
        // ignore unknown flags
        break;
    }
  }
  return a;
}

function fetchDiffViaGh(prNumber: number): string {
  const env = { ...process.env };
  delete env['ANTHROPIC_API_KEY'];
  const result = spawnSync('gh', ['pr', 'diff', String(prNumber)], {
    encoding: 'utf-8',
    timeout: 30_000,
    env
  });
  if (result.status !== 0) {
    throw new Error(`gh pr diff ${prNumber} failed: ${(result.stderr ?? '').toString().slice(0, 300)}`);
  }
  return (result.stdout ?? '').toString();
}

function renderText(review: CodeReview): string {
  const lines: string[] = [];
  lines.push(`# Code-Reviewer review for PR #${review.prNumber}`);
  lines.push(`Reviewed: ${review.reviewedAtIso}`);
  lines.push(`Verdict: ${review.verdict.toUpperCase()}`);
  lines.push(`Total findings: ${review.totalFindings}  (blocking: ${review.blockingFindings.length})`);
  lines.push('');
  lines.push('## Summary');
  for (const sev of ['critical', 'high', 'medium', 'low'] as const) {
    const n = review.summary.countBySeverity[sev];
    if (n > 0) lines.push(`- ${sev}: ${n}`);
  }
  lines.push(`- chunks reviewed: ${review.summary.chunksReviewed}`);
  lines.push(`- duration: ${review.summary.durationMs}ms`);
  lines.push(`- LLM-reasoned findings: ${review.summary.llmReasoned} (enabled: ${review.summary.llmEnabled}, ok: ${review.summary.llmReasoningSucceeded})`);
  lines.push(`- redirects to Critic: ${review.summary.redirectsToCritic}`);
  lines.push(`- redirects to advisory Reviewer: ${review.summary.redirectsToReviewer}`);
  lines.push('');
  if (review.findings.length === 0) {
    lines.push('No findings above severity floor.');
    return lines.join('\n');
  }
  lines.push('## Findings');
  for (const f of review.findings) {
    lines.push('');
    lines.push(`### [${f.severity}] ${f.issueTitle}  (${f.dimension})`);
    lines.push(`- file: ${f.file}:${f.line}`);
    lines.push(`- source: ${f.source} (${f.detectorId})`);
    lines.push(`- description: ${f.description}`);
    if (f.reproductionSteps !== undefined && f.reproductionSteps.length > 0) {
      lines.push('- repro:');
      for (const s of f.reproductionSteps) lines.push(`  * ${s}`);
    }
    if (f.suggestedFix !== undefined) {
      lines.push(`- fix: ${f.suggestedFix}`);
    }
    if (f.excerpt !== '') {
      lines.push(`- excerpt: \`${f.excerpt.replace(/`/g, "'")}\``);
    }
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'help') {
    console.log(`caia-code-reviewer — blocking PR code-review agent

USAGE:
  caia-code-reviewer review --pr <n> [--diff-file <path>] [--output text|json]
                                     [--severity-floor low|medium|high|critical]
                                     [--blocking-threshold low|medium|high|critical]
                                     [--no-llm] [--base-branch <b>] [--branch <b>] [--title <t>]
  caia-code-reviewer dry-run --diff-file <path> [--output text|json] [--no-llm]

EXIT CODES:
  0 — verdict 'approve'
  1 — verdict 'request-changes'
  2 — bad arguments / error
`);
    process.exit(0);
  }
  let diff: string;
  if (args.diffFile !== null) {
    diff = readFileSync(args.diffFile, 'utf-8');
  } else if (args.command === 'review' && args.pr > 0) {
    diff = fetchDiffViaGh(args.pr);
  } else {
    console.error('Either --pr (with gh access) or --diff-file is required.');
    process.exit(2);
  }
  const cfgInput: ConstructorParameters<typeof CodeReviewerAgent>[0] = {};
  if (args.noLlm) cfgInput.enableLlmReasoning = false;
  if (args.severityFloor !== null) cfgInput.severityFloor = args.severityFloor;
  if (args.blockingThreshold !== null) cfgInput.blockingSeverityThreshold = args.blockingThreshold;
  const agent = new CodeReviewerAgent(cfgInput);
  const review = await agent.reviewPR({
    prNumber: args.pr,
    diff,
    context: {
      branch: args.branch,
      baseBranch: args.baseBranch,
      title: args.title
    }
  });
  if (args.output === 'json') {
    console.log(JSON.stringify(review, null, 2));
  } else {
    console.log(renderText(review));
  }
  process.exit(review.verdict === 'request-changes' ? 1 : 0);
}

main().catch(e => {
  console.error('caia-code-reviewer error:', (e as Error).message);
  process.exit(2);
});
