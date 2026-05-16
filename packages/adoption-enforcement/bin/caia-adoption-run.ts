#!/usr/bin/env -S node --experimental-strip-types
/**
 * caia-adoption-run — entrypoint for the adoption enforcement substrate.
 *
 * v0 (this phase): argv parser only. Every subcommand logs what it would do and
 * exits 0. Real implementations land via the five sibling chains; see
 * agent-memory/decisions/p3_adoption_enforcement_substrate_2026_05_16.md §2.1.
 */

type Subcommand = 'scan' | 'xref' | 'pr-gen' | 'verify' | 'gate' | 'run';

const SUBCOMMANDS: readonly Subcommand[] = [
  'scan',
  'xref',
  'pr-gen',
  'verify',
  'gate',
  'run',
] as const;

function isSubcommand(value: string): value is Subcommand {
  return (SUBCOMMANDS as readonly string[]).includes(value);
}

function printUsage(): void {
  const lines = [
    'Usage: caia-adoption-run <subcommand> [options]',
    '',
    'Subcommands:',
    '  scan     Detect new exports / packages / external agents from a merged PR',
    '  xref     Cross-reference new artefacts against candidate adoption sites',
    '  pr-gen   Generate adoption PRs (per-file mode in v1)',
    '  verify   Run V1-V6 verification gauntlet on each generated PR',
    '  gate     Update DoD-v2 adoption ledger for the originating PR',
    '  run      Full pipeline: scan -> xref -> pr-gen -> verify -> gate',
    '',
    'All subcommands are stubs in v0; they log and exit 0.',
  ];
  for (const line of lines) console.log(line);
}

function parseArgs(argv: readonly string[]): { sub: Subcommand | null; rest: string[] } {
  const [first, ...rest] = argv;
  if (!first || first === '-h' || first === '--help') {
    return { sub: null, rest: [] };
  }
  if (!isSubcommand(first)) {
    console.error(`unknown subcommand: ${first}`);
    return { sub: null, rest: [] };
  }
  return { sub: first, rest };
}

function main(argv: readonly string[]): number {
  const { sub, rest } = parseArgs(argv);
  if (sub === null) {
    printUsage();
    return 0;
  }
  console.log(`[caia-adoption-run] ${sub} stub — args=${JSON.stringify(rest)}`);
  return 0;
}

const code = main(process.argv.slice(2));
process.exit(code);
