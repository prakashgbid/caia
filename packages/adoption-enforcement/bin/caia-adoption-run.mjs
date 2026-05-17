#!/usr/bin/env node
/**
 * caia-adoption-run — adoption-enforcement substrate runner.
 *
 * Subcommands:
 *   scan --pr <num>         Detect new artefacts from a merged PR; emit scan.json.
 *   xref --work-dir <dir>   Read scan.json from work-dir, write xref.json beside it.
 *
 * Companion design: agent-memory/decisions/p3_adoption_enforcement_substrate_2026_05_16.md.
 */
import { dispatch } from '../dist/cli/index.js';

const result = dispatch(process.argv.slice(2));
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.exitCode);
