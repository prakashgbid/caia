/**
 * CLI entry point for `conductor pulse`.
 * Usage: conductor pulse [--json] [--no-heal] [--no-canary]
 */

import type { RunPulseOptions } from './pulse';

// @no-events — CLI wrapper, events emitted inside pulse.ts / emit.ts
export async function runPulseCli(argv: string[]): Promise<void> {
  const jsonMode = argv.includes('--json');
  const noHeal = argv.includes('--no-heal');
  const noCanary = argv.includes('--no-canary');

  const opts: RunPulseOptions = { noHeal, noCanary };

  if (!jsonMode) {
    process.stdout.write('[pulse] Running pipeline health check…\n');
  }

  try {
    // Dynamic import to keep startup fast and avoid loading DB drivers on --help
    const { runPulse } = await import('./pulse');
    const result = await runPulse(opts);

    if (jsonMode) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      printHuman(result);
    }

    // Exit 0 for PASSING/AUTO-HEALED, 1 for DEGRADED/CRITICAL
    process.exit(result.outcome === 'CRITICAL' || result.outcome === 'DEGRADED' ? 1 : 0);
  } catch (err) {
    if (jsonMode) {
      process.stdout.write(JSON.stringify({ outcome: 'CRITICAL', error: String(err) }) + '\n');
    } else {
      process.stderr.write(`[pulse] Fatal error: ${String(err)}\n`);
    }
    process.exit(2);
  }
}

function printHuman(result: import('./types').PulseResult): void {
  const OUTCOME_LABEL: Record<string, string> = {
    'PASSING': '✅ PASSING',
    'DEGRADED': '⚠️  DEGRADED',
    'CRITICAL': '🔴 CRITICAL',
    'AUTO-HEALED': '🔧 AUTO-HEALED',
  };
  process.stdout.write(`\n${OUTCOME_LABEL[result.outcome] ?? result.outcome}  (${result.durationMs}ms, run ${result.runId})\n\n`);

  // Canary
  const canarySymbol = result.canary.passed ? '✓' : '✗';
  process.stdout.write(`  Canary  ${canarySymbol}  ${result.canary.message}\n`);

  // Checks by stage
  const stages = ['infra', 'executor', 'pipeline'] as const;
  for (const stage of stages) {
    const stageChecks = result.checks.filter(c => c.stage === stage);
    if (stageChecks.length === 0) continue;
    process.stdout.write(`\n  Stage: ${stage}\n`);
    for (const c of stageChecks) {
      const sym = c.passed ? '✓' : '✗';
      process.stdout.write(`    ${sym} ${c.name.padEnd(32)} ${c.message}\n`);
    }
  }

  // Invariants
  if (result.invariants.length > 0) {
    process.stdout.write('\n  Invariants:\n');
    for (const inv of result.invariants) {
      const sym = inv.passed ? '✓' : '✗';
      process.stdout.write(`    ${sym} ${inv.name.padEnd(36)} ${inv.message}\n`);
    }
  }

  // Heals
  if (result.heals.length > 0) {
    process.stdout.write('\n  Heals applied:\n');
    for (const h of result.heals) {
      const sym = h.success ? '✓' : '✗';
      process.stdout.write(`    ${sym} ${h.action.padEnd(30)} ${h.message}\n`);
    }
  }

  process.stdout.write('\n');
}
