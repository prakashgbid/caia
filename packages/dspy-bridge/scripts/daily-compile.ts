#!/usr/bin/env node
/**
 * Cron entry point: run the daily DSPy compile for po-scope-detector.
 *
 * Wired by `infra/cron/dspy-daily-compile.plist` (added in this PR).
 * Run manually with:
 *
 *     pnpm --filter @chiefaia/dspy-bridge exec tsx scripts/daily-compile.ts
 *
 * Hard contract:
 *   - exit 0 on promote
 *   - exit 0 on rollback (it's a successful run, just no promotion)
 *   - exit non-zero only on infrastructure failure (bridge dead,
 *     trainset empty, etc.) — those should page the operator.
 */

import { runDailyCompile, renderVerdictLine } from '../src/compile.js';
import { PO_SCOPE_DETECTOR_PROGRAM } from '../src/programs/po-scope-detector.js';

async function main(): Promise<number> {
  const program = process.env['DSPY_PROGRAM'] ?? PO_SCOPE_DETECTOR_PROGRAM;
  try {
    const verdict = await runDailyCompile({ program });
    process.stdout.write(`${renderVerdictLine(verdict)}\n`);
    if (!verdict.promoted && verdict.delta !== null && verdict.delta < 0) {
      process.stderr.write(
        `[dspy] rollback — keeping prev CURRENT (delta=${verdict.delta.toFixed(3)})\n`,
      );
    }
    return 0;
  } catch (err) {
    process.stderr.write(
      `[dspy] daily compile failed: ${(err as Error).message}\n` +
        `${(err as Error).stack ?? ''}\n`,
    );
    return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`[dspy] uncaught: ${String(err)}\n`);
    process.exit(2);
  },
);
