#!/usr/bin/env node
/**
 * `caia-policy-lint <task-brief.md>` — run the 7 default policies against a
 * task brief file and emit a structured report.
 *
 * Exit codes (matches `exitCodeFor`):
 *
 *   0 — all policies passed or only advisories.
 *   1 — soft-fail (CI may still proceed; INBOX entry written separately).
 *   2 — hard-fail (CI fails; dispatch blocked).
 *
 * Flags:
 *
 *   --format json|markdown|line   (default: line)
 *   --caller-agent-id <id>        (default: "cli")
 *   --intent <intent>             (default: "build")
 *   --target-repo <repo>          (repeatable; default: "caia")
 *   --pr-body-file <path>         (optional)
 *   --pr-diff-file <path>         (optional)
 *   --open-pr-count <n>           (optional)
 *   --metadata <key=value>        (repeatable; appended to metadata)
 *   --policy <id>                 (repeatable; defaults to all 7)
 *   --quiet                       (suppress non-essential stderr)
 *   --version                     (print version + exit 0)
 *   --help                        (print usage + exit 0)
 */

import { readFile } from 'node:fs/promises';
import { argv, exit, stderr, stdout } from 'node:process';

import { defaultPolicies } from './index.js';
import {
  PolicyEngine
} from './policy-engine.js';
import {
  exitCodeFor,
  toJson,
  toLine,
  toMarkdown
} from './report.js';
import type {
  DispatchContext,
  DispatchIntent,
  Policy
} from './types.js';

const VERSION = '0.1.0';

interface ParsedArgs {
  briefPath: string;
  format: 'json' | 'markdown' | 'line';
  callerAgentId: string;
  intent: DispatchIntent;
  targetRepos: string[];
  prBodyFile: string | undefined;
  prDiffFile: string | undefined;
  openPrCount: number | undefined;
  metadata: Record<string, string>;
  policyFilter: string[];
  quiet: boolean;
}

function printHelp(): void {
  stdout.write(
    [
      'caia-policy-lint — Layer 1 of AI-First Continuous-Discipline',
      '',
      'Usage:  caia-policy-lint <task-brief.md> [flags]',
      '',
      'Flags:',
      '  --format json|markdown|line   default: line',
      '  --caller-agent-id <id>        default: "cli"',
      '  --intent <intent>             one of: research|spec|build|review|ops|meta',
      '  --target-repo <repo>          repeatable; default: "caia"',
      '  --pr-body-file <path>',
      '  --pr-diff-file <path>',
      '  --open-pr-count <n>',
      '  --metadata <key=value>        repeatable',
      '  --policy <id>                 repeatable; default: all 7',
      '  --quiet                       suppress non-essential stderr',
      '  --version, --help',
      '',
      'Exit codes: 0 pass/advisory · 1 soft-fail · 2 hard-fail'
    ].join('\n') + '\n'
  );
}

export function parseArgs(args: ReadonlyArray<string>): ParsedArgs {
  const out: ParsedArgs = {
    briefPath: '',
    format: 'line',
    callerAgentId: 'cli',
    intent: 'build',
    targetRepos: [],
    prBodyFile: undefined,
    prDiffFile: undefined,
    openPrCount: undefined,
    metadata: {},
    policyFilter: [],
    quiet: false
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (a === '--format') {
      const v = args[++i];
      if (v !== 'json' && v !== 'markdown' && v !== 'line') {
        throw new Error(`--format must be json|markdown|line, got "${v ?? ''}"`);
      }
      out.format = v;
    } else if (a === '--caller-agent-id') {
      out.callerAgentId = expect(args[++i], '--caller-agent-id');
    } else if (a === '--intent') {
      const v = expect(args[++i], '--intent');
      if (!['research', 'spec', 'build', 'review', 'ops', 'meta'].includes(v)) {
        throw new Error(`--intent invalid: ${v}`);
      }
      out.intent = v as DispatchIntent;
    } else if (a === '--target-repo') {
      out.targetRepos.push(expect(args[++i], '--target-repo'));
    } else if (a === '--pr-body-file') {
      out.prBodyFile = expect(args[++i], '--pr-body-file');
    } else if (a === '--pr-diff-file') {
      out.prDiffFile = expect(args[++i], '--pr-diff-file');
    } else if (a === '--open-pr-count') {
      const n = Number(expect(args[++i], '--open-pr-count'));
      if (!Number.isFinite(n) || n < 0) {
        throw new Error('--open-pr-count must be a non-negative number');
      }
      out.openPrCount = n;
    } else if (a === '--metadata') {
      const kv = expect(args[++i], '--metadata');
      const eq = kv.indexOf('=');
      if (eq < 1) throw new Error('--metadata must be key=value');
      out.metadata[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (a === '--policy') {
      out.policyFilter.push(expect(args[++i], '--policy'));
    } else if (a === '--quiet') {
      out.quiet = true;
    } else if (a === '--version') {
      stdout.write(`${VERSION}\n`);
      exit(0);
    } else if (a === '--help' || a === '-h') {
      printHelp();
      exit(0);
    } else if (a.startsWith('-')) {
      throw new Error(`Unknown flag: ${a}`);
    } else if (!out.briefPath) {
      out.briefPath = a;
    } else {
      throw new Error(`Unexpected positional argument: ${a}`);
    }
  }
  if (!out.briefPath) {
    throw new Error('Missing required <task-brief.md> argument');
  }
  if (out.targetRepos.length === 0) out.targetRepos.push('caia');
  return out;
}

function expect(v: string | undefined, flag: string): string {
  if (!v || v.startsWith('-')) {
    throw new Error(`${flag} requires a value`);
  }
  return v;
}

export async function buildContextFromArgs(
  parsed: ParsedArgs
): Promise<DispatchContext> {
  const briefMd = await readFile(parsed.briefPath, 'utf8');
  const prBody = parsed.prBodyFile
    ? await readFile(parsed.prBodyFile, 'utf8')
    : undefined;
  const prDiff = parsed.prDiffFile
    ? await readFile(parsed.prDiffFile, 'utf8')
    : undefined;
  const ctx: DispatchContext = {
    callerAgentId: parsed.callerAgentId,
    briefMd,
    toolList: [],
    estimatedTokens: 0,
    estimatedCost: 0,
    targetRepos: parsed.targetRepos,
    intent: parsed.intent,
    metadata: { ...parsed.metadata }
  };
  if (prBody !== undefined) (ctx as { prBody?: string }).prBody = prBody;
  if (prDiff !== undefined) (ctx as { prDiff?: string }).prDiff = prDiff;
  if (parsed.openPrCount !== undefined) {
    (ctx as { openPrCount?: number }).openPrCount = parsed.openPrCount;
  }
  return ctx;
}

export function selectPolicies(
  filter: ReadonlyArray<string>,
  all: ReadonlyArray<Policy> = defaultPolicies
): ReadonlyArray<Policy> {
  if (filter.length === 0) return all;
  const selected = all.filter((p) => filter.includes(p.id));
  if (selected.length === 0) {
    throw new Error(
      `No policies matched filter [${filter.join(', ')}]. Available: ${all.map((p) => p.id).join(', ')}.`
    );
  }
  return selected;
}

export async function main(args: ReadonlyArray<string>): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    stderr.write(`[caia-policy-lint] ${(err as Error).message}\n`);
    return 2;
  }
  const policies = selectPolicies(parsed.policyFilter);
  const ctx = await buildContextFromArgs(parsed);
  const engine = new PolicyEngine(policies);
  const report = await engine.run(ctx);
  if (parsed.format === 'json') {
    stdout.write(`${toJson(report)}\n`);
  } else if (parsed.format === 'markdown') {
    stdout.write(`${toMarkdown(report)}\n`);
  } else {
    stdout.write(`${toLine(report)}\n`);
  }
  if (!parsed.quiet && report.violationCount > 0) {
    stderr.write(
      `[caia-policy-lint] ${report.violationCount} violation(s); worst=${report.worstOutcome}\n`
    );
  }
  return exitCodeFor(report);
}

// Only run when invoked as a CLI (not when imported by tests).
const isDirectInvocation = (() => {
  try {
    const entry = argv[1] ?? '';
    return entry.endsWith('/cli.js') || entry.endsWith('/cli.ts');
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  main(argv.slice(2))
    .then((code) => exit(code))
    .catch((err) => {
      stderr.write(`[caia-policy-lint] fatal: ${(err as Error).stack ?? err}\n`);
      exit(2);
    });
}
