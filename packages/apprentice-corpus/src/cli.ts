#!/usr/bin/env node
/**
 * caia-apprentice-corpus CLI.
 *
 * Subcommands:
 *   aggregate              Run the full pipeline against CAIA defaults.
 *   aggregate --dry-run    Plan only, no writes.
 *   --memory-root X        Override single config field (also supported via env).
 *
 * All flags map directly to `ApprenticeCorpusConfig` keys via kebab-case.
 */

import { ApprenticeCorpusAggregator } from './aggregator.js';
import type { ApprenticeCorpusConfig } from './config.js';

interface ParsedArgs {
  command: string | undefined;
  dryRun: boolean;
  config: ApprenticeCorpusConfig;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { command: undefined, dryRun: false, config: {} };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') {
      out.command = 'help';
      i += 1;
      continue;
    }
    if (out.command === undefined && !a.startsWith('-')) {
      out.command = a;
      i += 1;
      continue;
    }
    if (a === '--dry-run') {
      out.dryRun = true;
      i += 1;
      continue;
    }
    if (a === '--memory-root' && i + 1 < argv.length) {
      out.config.memoryRoot = argv[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (a === '--reports-root' && i + 1 < argv.length) {
      out.config.reportsRoot = argv[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (a === '--events-db' && i + 1 < argv.length) {
      out.config.eventsDbPath = argv[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (a === '--output-root' && i + 1 < argv.length) {
      out.config.outputRoot = argv[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (a === '--no-distill') {
      out.config.distillEnabled = false;
      i += 1;
      continue;
    }
    if (a === '--max-samples' && i + 1 < argv.length) {
      out.config.maxSamples = Number.parseInt(argv[i + 1]!, 10);
      i += 2;
      continue;
    }
    if (a === '--max-age-days' && i + 1 < argv.length) {
      out.config.maxAgeDays = Number.parseInt(argv[i + 1]!, 10);
      i += 2;
      continue;
    }
    if (a === '--quality-threshold' && i + 1 < argv.length) {
      out.config.qualityThreshold = Number.parseFloat(argv[i + 1]!);
      i += 2;
      continue;
    }
    // Unknown — ignore but advance to avoid infinite loop
    i += 1;
  }
  return out;
}

const HELP = `caia-apprentice-corpus — Apprentice Phase 0 corpus aggregator

Usage:
  caia-apprentice-corpus aggregate [options]

Options:
  --memory-root <path>        Override CAIA memory directory
  --reports-root <path>       Override reports directory
  --events-db <path>          Override mentor events.sqlite path
  --output-root <path>        Override corpus output root
  --no-distill                Disable claude-binary distillation
  --max-samples <n>           Cap final corpus size (default 50000)
  --max-age-days <n>          Bound source artifacts by age (default 365)
  --quality-threshold <f>     Minimum quality score [0..1] (default 0.4)
  --dry-run                   Plan only; no writes
  -h, --help                  Show this help
`;

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === 'help' || parsed.command === undefined) {
    console.log(HELP);
    return;
  }
  if (parsed.command !== 'aggregate') {
    console.error(`Unknown command: ${parsed.command}`);
    console.error(HELP);
    process.exit(2);
  }
  const agg = new ApprenticeCorpusAggregator(parsed.config);
  const manifest = await agg.aggregate({ dryRun: parsed.dryRun });
  console.log(JSON.stringify(manifest, null, 2));
}

if (process.argv[1]?.endsWith('cli.js') === true || process.argv[1]?.endsWith('cli.ts') === true) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
