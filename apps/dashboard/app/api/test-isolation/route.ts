/**
 * /api/test-isolation
 *
 * Returns a snapshot of per-test resource usage for the FIX-013
 * dashboard panel:
 *
 *   - Browserless concurrency: GET ${BROWSERLESS_HTTP}/pressure
 *   - SQLite test files:       fs.readdir(${tmpdir}) filtered by prefix
 *   - Allocated test ports:    @chiefaia/test-isolation/ports state
 *
 * The dashboard is the ONLY caller. Auth is handled at the dashboard's
 * own session boundary; this route is gated by the same Next.js
 * middleware as the rest of `/api/**` (no extra ACL needed here).
 *
 * Failure semantics:
 *   - Each data source is best-effort. If Browserless is unreachable
 *     we return null in the `browserless` field rather than 5xx-ing
 *     the whole route. Same for the filesystem scan.
 *
 * Pure helpers live in ./lib.mjs so they can be unit-tested without
 * a TS compile step (the dashboard has no vitest harness).
 */

import { NextResponse } from 'next/server';
import * as os from 'node:os';
import {
  buildPressureUrl,
  extractPressure,
  readShardSummary,
  scanSqliteFiles,
} from './lib.mjs';

const BROWSERLESS_HTTP = process.env['BROWSERLESS_HTTP_ENDPOINT']
  ?? 'http://127.0.0.1:13000';
const BROWSERLESS_TOKEN = process.env['BROWSERLESS_TOKEN'] ?? '';
const SHARD_SUMMARY_PATH = process.env['SHARD_SUMMARY_PATH'] ?? '';

export async function GET() {
  const [browserless, sqlite, lastShardSummary] = await Promise.all([
    fetchBrowserlessPressure(),
    Promise.resolve(scanSqliteFiles(os.tmpdir())),
    Promise.resolve(readShardSummary(SHARD_SUMMARY_PATH || null)),
  ]);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    browserless,
    sqlite,
    ports: { inProcess: null },
    lastShardSummary,
  });
}

async function fetchBrowserlessPressure() {
  if (!BROWSERLESS_TOKEN) return null;
  try {
    const url = buildPressureUrl(BROWSERLESS_HTTP, BROWSERLESS_TOKEN);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3_000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) return null;
      const body = await res.json();
      return extractPressure(body);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
