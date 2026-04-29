#!/usr/bin/env node
/**
 * Tests for scripts/fix-it/aggregate-shard-results.mjs.
 *
 * Plain node-based test (no vitest dep) so the script and its tests
 * are self-contained — runs in CI without a workspace install.
 *
 * Usage:
 *   node scripts/fix-it/aggregate-shard-results.test.mjs
 */

import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as assert from 'node:assert/strict';

const SCRIPT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  'aggregate-shard-results.mjs',
);

let passed = 0;
let failed = 0;
async function test(name, fn) {
  process.stdout.write(`- ${name} ... `);
  try {
    await fn();
    passed += 1;
    process.stdout.write('ok\n');
  } catch (err) {
    failed += 1;
    process.stdout.write(`FAIL: ${err.message}\n`);
  }
}

async function withFixture(setup) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shard-aggregate-'));
  try {
    await setup(dir);
    const result = spawnSync(
      process.execPath,
      [SCRIPT, dir],
      { cwd: dir, stdio: 'pipe', env: { ...process.env, GITHUB_RUN_ID: '999' } },
    );
    const summaryPath = path.join(dir, 'shard-summary.json');
    let summary = null;
    try {
      summary = JSON.parse(await fs.readFile(summaryPath, 'utf8'));
    } catch {
      // not all tests expect a summary file
    }
    return { result, summary, dir };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

await test('emits a summary even when blob dir is missing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'no-blobs-'));
  try {
    const result = spawnSync(process.execPath, [SCRIPT, path.join(dir, 'missing')], {
      cwd: dir,
      stdio: 'pipe',
      env: { ...process.env },
    });
    assert.equal(result.status, 0);
    const summary = JSON.parse(await fs.readFile(path.join(dir, 'shard-summary.json'), 'utf8'));
    assert.equal(summary.schemaVersion, 1);
    assert.deepEqual(summary.shards, []);
    assert.equal(summary.totals.passed, 0);
    assert.equal(summary.totals.failed, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

await test('aggregates counts from .summary.json sidecars', async () => {
  const { result, summary } = await withFixture(async (dir) => {
    await fs.writeFile(path.join(dir, 'shard-1.zip'), 'fake-blob-1');
    await fs.writeFile(
      path.join(dir, 'shard-1.summary.json'),
      JSON.stringify({ passed: 10, failed: 1, skipped: 0, flaky: 0, durationMs: 5000 }),
    );
    await fs.writeFile(path.join(dir, 'shard-2.zip'), 'fake-blob-2');
    await fs.writeFile(
      path.join(dir, 'shard-2.summary.json'),
      JSON.stringify({ passed: 8, failed: 0, skipped: 2, flaky: 1, durationMs: 4500 }),
    );
  });
  assert.equal(result.status, 1, 'should exit 1 when any shard failed');
  assert.ok(summary, 'summary written');
  assert.equal(summary.shards.length, 2);
  assert.equal(summary.totals.passed, 18);
  assert.equal(summary.totals.failed, 1);
  assert.equal(summary.totals.skipped, 2);
  assert.equal(summary.totals.flaky, 1);
  assert.equal(summary.totals.durationMs, 9500);
  assert.equal(summary.totals.shardCount, 2);
  assert.equal(summary.totals.unknownShards, 0);
});

await test('exits 0 when all shards pass', async () => {
  const { result } = await withFixture(async (dir) => {
    await fs.writeFile(path.join(dir, 'shard-1.zip'), 'b');
    await fs.writeFile(
      path.join(dir, 'shard-1.summary.json'),
      JSON.stringify({ passed: 5, failed: 0, skipped: 0, flaky: 0, durationMs: 1000 }),
    );
  });
  assert.equal(result.status, 0);
});

await test('captures unknown-shard count when sidecar is missing', async () => {
  const { result, summary } = await withFixture(async (dir) => {
    // No sidecar — only the zip exists.
    await fs.writeFile(path.join(dir, 'shard-3.zip'), 'opaque');
  });
  assert.equal(result.status, 0);
  assert.equal(summary.shards.length, 1);
  assert.equal(summary.shards[0].passed, -1, 'unknown counts marked as -1');
  assert.equal(summary.totals.unknownShards, 1);
});

await test('extracts shard index from filename', async () => {
  const { summary } = await withFixture(async (dir) => {
    await fs.writeFile(path.join(dir, 'shard-7.zip'), 'b');
    await fs.writeFile(
      path.join(dir, 'shard-7.summary.json'),
      JSON.stringify({ passed: 1, failed: 0, skipped: 0, flaky: 0, durationMs: 100 }),
    );
  });
  assert.equal(summary.shards[0].index, 7);
});

await test('records GITHUB_RUN_ID when present', async () => {
  const { summary } = await withFixture(async () => {
    /* empty */
  });
  assert.equal(summary.runId, '999');
});

await test('produces a valid ISO-8601 generatedAt', async () => {
  const { summary } = await withFixture(async () => {
    /* empty */
  });
  assert.match(summary.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

console.log();
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
