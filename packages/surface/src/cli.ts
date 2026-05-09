#!/usr/bin/env node
/**
 * caia-surface CLI.
 *
 * Subcommands:
 *   generate --since <expr> --output <path>
 *            [--gh-repo <owner/name>]
 *            [--corpus-root <path>]
 *            [--transcript-root <path>]
 *            [--max-bytes <n>] [--min-importance <f>] [--max-findings <n>]
 *
 * If `--output -` (or omitted), prints to stdout.
 *
 * Subscription-only: never sets ANTHROPIC_API_KEY; only shells out to `gh`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { SurfaceAgent } from './agent.js';
import type { Digest } from './types.js';

interface ParsedArgs {
  command: 'generate' | 'help';
  since: string;
  output: string | null;
  ghRepo: string | null;
  corpusRoot: string | null;
  transcriptRoot: string | null;
  maxBytes: number | null;
  minImportance: number | null;
  maxFindings: number | null;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const a: ParsedArgs = {
    command: 'help',
    since: '1 day ago',
    output: null,
    ghRepo: null,
    corpusRoot: null,
    transcriptRoot: null,
    maxBytes: null,
    minImportance: null,
    maxFindings: null
  };
  if (argv.length === 0) return a;
  const cmd = argv[0];
  if (cmd === 'generate') a.command = cmd;
  for (let i = 1; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    switch (k) {
      case '--since':
        a.since = v ?? a.since;
        i++;
        break;
      case '--output':
        a.output = v ?? null;
        i++;
        break;
      case '--gh-repo':
        a.ghRepo = v ?? null;
        i++;
        break;
      case '--corpus-root':
        a.corpusRoot = v ?? null;
        i++;
        break;
      case '--transcript-root':
        a.transcriptRoot = v ?? null;
        i++;
        break;
      case '--max-bytes':
        a.maxBytes = v === undefined ? null : Number(v);
        i++;
        break;
      case '--min-importance':
        a.minImportance = v === undefined ? null : Number(v);
        i++;
        break;
      case '--max-findings':
        a.maxFindings = v === undefined ? null : Number(v);
        i++;
        break;
      default:
        // ignore unknown flags
        break;
    }
  }
  return a;
}

function helpText(): string {
  return `caia-surface — operator-curation digest generator

USAGE:
  caia-surface generate --since "1 day ago" --output ~/Documents/projects/reports/digest-DATE.md
                        [--gh-repo owner/name]
                        [--corpus-root <path>]
                        [--transcript-root <path>]
                        [--max-bytes <n>] [--min-importance <f>] [--max-findings <n>]

  Pass "--output -" or omit to print to stdout.
`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'help') {
    console.log(helpText());
    process.exit(0);
  }

  const cfgInput: ConstructorParameters<typeof SurfaceAgent>[0] = {};
  if (args.ghRepo !== null) cfgInput.ghRepo = args.ghRepo;
  if (args.corpusRoot !== null) cfgInput.corpusRoot = args.corpusRoot;
  if (args.transcriptRoot !== null) cfgInput.transcriptRoot = args.transcriptRoot;
  if (args.maxBytes !== null && !Number.isNaN(args.maxBytes)) cfgInput.maxBytes = args.maxBytes;
  if (args.minImportance !== null && !Number.isNaN(args.minImportance)) {
    cfgInput.minImportance = args.minImportance;
  }
  if (args.maxFindings !== null && !Number.isNaN(args.maxFindings)) {
    cfgInput.maxFindings = args.maxFindings;
  }

  const agent = new SurfaceAgent(cfgInput);
  let digest: Digest;
  try {
    digest = await agent.generateDigest({ since: args.since });
  } catch (e) {
    console.error('caia-surface error:', (e as Error).message);
    process.exit(2);
  }

  if (args.output === null || args.output === '-' ) {
    process.stdout.write(digest.markdown);
    if (!digest.markdown.endsWith('\n')) process.stdout.write('\n');
  } else {
    mkdirSync(dirname(args.output), { recursive: true });
    writeFileSync(args.output, digest.markdown, 'utf-8');
    console.error(`wrote ${digest.sizeBytes} bytes (${digest.findings.length} findings) → ${args.output}`);
  }
  process.exit(0);
}

main().catch(e => {
  console.error('caia-surface fatal:', (e as Error).message);
  process.exit(2);
});
