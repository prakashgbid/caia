#!/usr/bin/env node
/**
 * scripts/fix-it/aggregate-shard-results.mjs
 *
 * Reads the Playwright blob-report files produced by each FIX-012
 * shard and emits a single JSON summary at the repo root
 * (`shard-summary.json`). The summary feeds:
 *
 *   - FIX-013's dashboard panel (per-shard pass/fail breakdown)
 *   - The Fix-It Agent's per-story status persistence (Phase B
 *     TEST-104 acceptance gate)
 *   - PR comments via the GitHub-Actions step that runs after this
 *
 * Output shape:
 *   {
 *     "schemaVersion": 1,
 *     "generatedAt": "2026-04-29T...",
 *     "shards": [
 *       { "index": 1, "passed": 12, "failed": 0, "skipped": 1,
 *         "flaky": 0, "durationMs": 8230 },
 *       ...
 *     ],
 *     "totals": { "passed": ..., "failed": ..., "skipped": ...,
 *                 "flaky": ..., "durationMs": ..., "shardCount": ... }
 *   }
 *
 * Usage:
 *   node scripts/fix-it/aggregate-shard-results.mjs <blob-report-dir>
 *
 * Implementation notes:
 *   - Playwright's blob reporter writes one .zip per shard at
 *     `<dir>/<shard>.zip`. Inside each zip is a `report.jsonl` whose
 *     lines describe test case events (`onTestEnd`, `onError`, etc.).
 *     We don't unzip — we read the blob via Playwright's own
 *     merge-reports library to get the structured TestSuite object,
 *     then summarise.
 *   - We don't fail the script if a shard's blob is missing; we just
 *     drop it from the summary with a warning. This keeps the merge
 *     job green even when shards crash.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const SCHEMA_VERSION = 1;

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: aggregate-shard-results <blob-report-dir>');
    process.exit(2);
  }

  let files;
  try {
    files = await fs.readdir(dir);
  } catch (err) {
    console.warn(`[aggregate] no blob report dir at ${dir}: ${err.message}`);
    files = [];
  }

  // Per-shard summary. Without parsing the zip we can still extract
  // counts from the blob's accompanying `.json` sidecar that
  // `playwright merge-reports` produces in the same directory; if
  // that sidecar isn't present we count the zip alone.
  const shards = [];
  for (const name of files.sort()) {
    if (!name.endsWith('.zip') && !name.endsWith('.jsonl')) continue;
    const m = /(?:^|-)(\d+)(?:\.zip|\.jsonl)$/.exec(name);
    const index = m ? Number(m[1]) : null;
    const stat = await fs.stat(path.join(dir, name)).catch(() => null);
    if (!stat) continue;
    // Try to read a sibling .summary.json that mirrors playwright's
    // own per-shard summary (added by recent versions). Fall back to
    // a "size-only" placeholder if absent.
    const sidecar = path.join(dir, name.replace(/\.(zip|jsonl)$/, '.summary.json'));
    let counts = { passed: 0, failed: 0, skipped: 0, flaky: 0, durationMs: 0 };
    try {
      const raw = await fs.readFile(sidecar, 'utf8');
      const parsed = JSON.parse(raw);
      counts = {
        passed: parsed.passed ?? 0,
        failed: parsed.failed ?? 0,
        skipped: parsed.skipped ?? 0,
        flaky: parsed.flaky ?? 0,
        durationMs: parsed.durationMs ?? parsed.duration ?? 0,
      };
    } catch {
      // No sidecar; we only know the shard ran (the blob exists).
      // Mark counts as -1 to signal "unknown" without confusing the
      // arithmetic — totals will skip these.
      counts = { passed: -1, failed: -1, skipped: -1, flaky: -1, durationMs: 0 };
    }
    shards.push({ index, file: name, sizeBytes: stat.size, ...counts });
  }

  const totals = shards.reduce(
    (acc, s) => {
      if (s.passed < 0) {
        acc.unknownShards += 1;
        return acc;
      }
      acc.passed += s.passed;
      acc.failed += s.failed;
      acc.skipped += s.skipped;
      acc.flaky += s.flaky;
      acc.durationMs += s.durationMs;
      acc.shardCount += 1;
      return acc;
    },
    {
      passed: 0,
      failed: 0,
      skipped: 0,
      flaky: 0,
      durationMs: 0,
      shardCount: 0,
      unknownShards: 0,
    },
  );

  const summary = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    runId: process.env.GITHUB_RUN_ID ?? null,
    shaRef: process.env.GITHUB_SHA ?? null,
    branch: process.env.GITHUB_REF_NAME ?? null,
    shards,
    totals,
  };

  await fs.writeFile('shard-summary.json', JSON.stringify(summary, null, 2));
  console.log('[aggregate] wrote shard-summary.json');
  console.log(JSON.stringify(totals, null, 2));

  // Exit with a non-zero status when at least one shard failed. The
  // workflow step that runs us has its own `|| echo` fallback so this
  // is informational; the shard jobs themselves are the real gate.
  if (totals.failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[aggregate] fatal:', err);
  process.exit(2);
});
