#!/usr/bin/env node
/**
 * caia-verifier CLI.
 *
 * Subcommands:
 *   verify --input <path>            Run a verifier against a JSON inputs blob.
 *                                    Inputs file conforms to VerifierSpawnInputs.
 *   render-prompt --input <path>     Print the prompt the spawn would receive.
 *   validate-verdict --verdict <p>   Validate a verdict JSON against the schema.
 *
 * Subscription-only: never sets ANTHROPIC_API_KEY in the spawn env (the
 * agent strips any inherited copy before exec'ing claude).
 */

import { readFileSync, writeFileSync } from 'node:fs';

import { VerifierAgent } from './agent.js';
import { buildVerifierPrompt } from './prompt-builder.js';
import type { VerifierSpawnInputs } from './types.js';
import { parseAndValidateVerdict } from './verdict-validator.js';

interface ParsedArgs {
  command: 'verify' | 'render-prompt' | 'validate-verdict' | 'help';
  inputPath: string | null;
  verdictPath: string | null;
  outPath: string | null;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const a: ParsedArgs = {
    command: 'help',
    inputPath: null,
    verdictPath: null,
    outPath: null
  };
  if (argv.length === 0) return a;
  const cmd = argv[0];
  if (cmd === 'verify' || cmd === 'render-prompt' || cmd === 'validate-verdict') {
    a.command = cmd;
  }
  for (let i = 1; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case '--input':
        a.inputPath = v ?? null;
        i++;
        break;
      case '--verdict':
        a.verdictPath = v ?? null;
        i++;
        break;
      case '--out':
        a.outPath = v ?? null;
        i++;
        break;
    }
  }
  return a;
}

function helpText(): string {
  return [
    'caia-verifier — VERIFIER spawn (4th review-sibling).',
    '',
    'Commands:',
    '  verify --input <inputs.json> [--out <verdict.json>]',
    '      Spawns claude --print, captures + validates the verdict.',
    '  render-prompt --input <inputs.json>',
    '      Prints the verbatim spawn prompt to stdout.',
    '  validate-verdict --verdict <verdict.json>',
    '      Validates a verdict file against the schema; exits non-zero on failure.'
  ].join('\n');
}

function loadInputs(path: string): VerifierSpawnInputs {
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'help' || (args.command !== 'validate-verdict' && !args.inputPath)) {
    console.log(helpText());
    process.exit(args.command === 'help' ? 0 : 2);
  }

  if (args.command === 'render-prompt') {
    const inputs = loadInputs(args.inputPath as string);
    process.stdout.write(buildVerifierPrompt(inputs));
    return;
  }

  if (args.command === 'validate-verdict') {
    if (!args.verdictPath) {
      console.log(helpText());
      process.exit(2);
    }
    const raw = readFileSync(args.verdictPath, 'utf8').trim();
    const r = parseAndValidateVerdict(raw);
    if (r.ok) {
      console.log(`OK — verdict valid (overall=${r.verdict?.overall} verdict=${r.verdict?.verdict})`);
      process.exit(0);
    }
    console.error('FAIL — verdict invalid:');
    for (const e of r.errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  // verify
  const inputs = loadInputs(args.inputPath as string);
  const agent = new VerifierAgent({});
  const outcome = await agent.verify(inputs);
  const blob = {
    ok: outcome.ok,
    verdict: outcome.verdict,
    rawLastLine: outcome.rawLastLine,
    stdoutTail: outcome.stdoutTail,
    stderrTail: outcome.stderrTail,
    worktreePath: outcome.worktreePath,
    worktreeCleanedUp: outcome.worktreeCleanedUp,
    cleanupReason: outcome.cleanupReason,
    durationMs: outcome.durationMs,
    failureReason: outcome.failureReason
  };
  const json = JSON.stringify(blob, null, 2);
  if (args.outPath) {
    writeFileSync(args.outPath, json);
  } else {
    process.stdout.write(json + '\n');
  }
  process.exit(outcome.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(`verifier CLI failed: ${(e as Error).message}`);
  process.exit(2);
});
