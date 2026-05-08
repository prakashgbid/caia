#!/usr/bin/env node
/**
 * caia-reviewer CLI.
 *
 * Subcommands:
 *   review --pr <n> [--diff-file <path>] [--output text|json] [--severity-floor <s>]
 *   dry-run --diff-file <path>
 *
 * If `--diff-file` is omitted, the CLI shells out to `gh pr diff <n>` to
 * fetch the diff. Subscription-only: never sets ANTHROPIC_API_KEY.
 *
 * Reviewer never produces blocking findings; CLI exit code is 0 unless
 * argument parsing fails (exit 2) — there is no exit-1 "review failed"
 * because no Reviewer finding is ever a hard fail.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { ReviewerAgent } from './agent.js';
import type { CraftsmanshipReview, CraftsmanshipSeverity } from './types.js';

interface ParsedArgs {
  command: 'review' | 'dry-run' | 'help';
  pr: number;
  diffFile: string | null;
  output: 'text' | 'json';
  severityFloor: CraftsmanshipSeverity | null;
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
        if (v === 'praise' || v === 'nit' || v === 'suggestion' || v === 'consider') a.severityFloor = v;
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

function renderText(review: CraftsmanshipReview): string {
  const lines: string[] = [];
  lines.push(`# Reviewer (craftsmanship) for PR #${review.prNumber}`);
  lines.push(`Reviewed: ${review.reviewedAtIso}`);
  lines.push(`Total findings: ${review.totalFindings}  (advisory — never blocking)`);
  lines.push('');
  lines.push('## Summary');
  for (const sev of ['praise', 'consider', 'suggestion', 'nit'] as const) {
    const n = review.summary.countBySeverity[sev];
    if (n > 0) lines.push(`- ${sev}: ${n}`);
  }
  lines.push(`- chunks reviewed: ${review.summary.chunksReviewed}`);
  lines.push(`- duration: ${review.summary.durationMs}ms`);
  lines.push(`- deterministic findings: ${review.summary.deterministic}`);
  lines.push(`- LLM-reasoned findings: ${review.summary.llmReasoned} (enabled: ${review.summary.llmEnabled}, ok: ${review.summary.llmReasoningSucceeded})`);
  if (review.summary.redirectsToCritic > 0) {
    lines.push(`- LLM findings redirected to Critic (denylisted): ${review.summary.redirectsToCritic}`);
  }
  lines.push('');
  if (review.findings.length === 0) {
    lines.push('No findings above severity floor.');
    return lines.join('\n');
  }
  lines.push('## Findings');
  for (const f of review.findings) {
    lines.push('');
    lines.push(`### [${f.severity}] ${f.suggestionTitle}  (${f.dimension})`);
    lines.push(`- file: ${f.file}:${f.line}`);
    lines.push(`- source: ${f.source} (${f.detectorId})`);
    lines.push(`- description: ${f.description}`);
    if (f.suggestedChange !== undefined) {
      lines.push(`- suggested change: ${f.suggestedChange}`);
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
    console.log(`caia-reviewer — craftsmanship PR review agent (advisory)

USAGE:
  caia-reviewer review --pr <n> [--diff-file <path>] [--output text|json]
                                [--severity-floor praise|nit|suggestion|consider]
                                [--no-llm] [--base-branch <b>] [--branch <b>] [--title <t>]
  caia-reviewer dry-run --diff-file <path> [--output text|json] [--no-llm]
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
  const cfgInput: ConstructorParameters<typeof ReviewerAgent>[0] = {};
  if (args.noLlm) cfgInput.enableLlmReasoning = false;
  if (args.severityFloor !== null) cfgInput.severityFloor = args.severityFloor;
  const agent = new ReviewerAgent(cfgInput);
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
  process.exit(0);
}

main().catch(e => {
  console.error('caia-reviewer error:', (e as Error).message);
  process.exit(2);
});
