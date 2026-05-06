#!/usr/bin/env node
/**
 * caia-apprentice-retrainer — Phase 4 CLI.
 *
 * Usage:
 *   caia-apprentice-retrainer run [--force]
 *   caia-apprentice-retrainer state
 *   caia-apprentice-retrainer promote-canary
 *   caia-apprentice-retrainer reject-canary --reason "..."
 *   caia-apprentice-retrainer digest
 *
 * The cron driver invokes `run`. Operator runs `promote-canary` or
 * `reject-canary` to decide on a held canary.
 *
 * NOTE: this CLI does NOT auto-wire the upstream pipeline implementations
 * by default. The retrainer constructor accepts injected
 * corpusAggregator/trainer/evalHarness/serving. For real use, the cron
 * shell script should construct an instance with the production wiring;
 * this CLI is the dev-time / operator-driven entry point and runs without
 * the heavy pipeline by default (which means `run` will throw
 * CorpusFailedError unless wired). See README for the wiring pattern.
 */

import { ApprenticeRetrainer } from './retrainer.js';
import { RetrainerError } from './types.js';

interface ParsedArgs {
  command: string;
  flags: Record<string, string>;
  booleanFlags: Set<string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const booleanFlags = new Set<string>();
  let command = '';
  let i = 0;
  if (argv[0] && !argv[0].startsWith('--')) {
    command = argv[0]!;
    i = 1;
  }
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 2;
      } else {
        booleanFlags.add(key);
        i += 1;
      }
    } else {
      i += 1;
    }
  }
  return { command, flags, booleanFlags };
}

function printHelp(): void {
  process.stdout.write(
    [
      'caia-apprentice-retrainer — Apprentice Phase 4 retraining cron CLI',
      '',
      'Commands:',
      '  run [--force]              — one retraining tick (cron entrypoint)',
      '  state                      — print retrainer-state.json',
      '  promote-canary             — operator: promote current canary → production',
      '  reject-canary --reason ".."— operator: reject current canary',
      '  digest                     — print latest operator digest',
      ''
    ].join('\n')
  );
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.command || parsed.command === 'help' || parsed.booleanFlags.has('help')) {
    printHelp();
    return 0;
  }

  const retrainer = new ApprenticeRetrainer();
  try {
    switch (parsed.command) {
      case 'run': {
        const result = await retrainer.run({ force: parsed.booleanFlags.has('force') });
        process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        return result.kind === 'failed' ? 2 : 0;
      }
      case 'state': {
        const state = retrainer.readState();
        process.stdout.write(JSON.stringify(state, null, 2) + '\n');
        return 0;
      }
      case 'promote-canary': {
        const entry = await retrainer.promoteCanaryToProduction();
        process.stdout.write(JSON.stringify(entry, null, 2) + '\n');
        return 0;
      }
      case 'reject-canary': {
        const reason = parsed.flags['reason'] ?? '';
        if (reason === '') {
          process.stderr.write('--reason "..." is required\n');
          return 1;
        }
        const entry = await retrainer.rejectCanary(reason);
        process.stdout.write(JSON.stringify(entry, null, 2) + '\n');
        return 0;
      }
      case 'digest': {
        // Print the digest path; reading happens via cat by the operator.
        const cfg = (retrainer as unknown as { cfg: { digestPath: string } }).cfg;
        process.stdout.write(cfg.digestPath + '\n');
        return 0;
      }
      default:
        process.stderr.write(`unknown command: ${parsed.command}\n`);
        printHelp();
        return 1;
    }
  } catch (e) {
    if (e instanceof RetrainerError) {
      process.stderr.write(`${e.name}: ${e.message}\n`);
      if (e.details) process.stderr.write(JSON.stringify(e.details, null, 2) + '\n');
      return 2;
    }
    process.stderr.write(`unexpected error: ${(e as Error).message ?? String(e)}\n`);
    return 1;
  }
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith('cli.js');
if (isMain) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
