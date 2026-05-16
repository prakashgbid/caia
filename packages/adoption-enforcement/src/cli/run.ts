// `caia-adoption-run` — top-level dispatcher.
//
// Subcommands are listed below. v1 ships only `xref`; `scan`, `pr`, and
// `verify` will land in their respective MVP chains.
//
// Companion design: agent-memory/decisions/p3_adoption_enforcement_substrate_2026_05_16.md (§2).

import { type CliResult, runXrefCli } from './xref.js';

const TOP_HELP = `caia-adoption-run — adoption-enforcement substrate runner.

Usage:
  caia-adoption-run <subcommand> [options]

Subcommands:
  xref     Read scan.json and emit xref.json (L1 cross-reference + scoring).

Run \`caia-adoption-run <subcommand> --help\` for subcommand options.
`;

export function dispatch(argv: ReadonlyArray<string>): CliResult {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    return { exitCode: argv.length === 0 ? 2 : 0, stdout: argv.length === 0 ? '' : TOP_HELP, stderr: argv.length === 0 ? TOP_HELP : '' };
  }
  const [sub, ...rest] = argv;
  switch (sub) {
    case 'xref':
      return runXrefCli(rest);
    default:
      return {
        exitCode: 2,
        stdout: '',
        stderr: `unknown subcommand: ${sub}\n\n${TOP_HELP}`,
      };
  }
}
