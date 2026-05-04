#!/usr/bin/env node
/**
 * Self-contained node test for the test-isolation route helpers.
 * Plain `node:assert` — the dashboard has no vitest harness.
 *
 * Usage:
 *   node apps/dashboard/app/api/test-isolation/lib.test.mjs
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as assert from 'node:assert/strict';
import {
  scanSqliteFiles,
  readShardSummary,
  buildPressureUrl,
  extractPressure,
  SQLITE_PREFIX,
} from './lib.mjs';

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
    if (process.env.DEBUG) console.error(err);
  }
}

await test('SQLITE_PREFIX is exported', () => {
  assert.equal(SQLITE_PREFIX, 'caia-test-');
});

await test('scanSqliteFiles: empty dir → empty result', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scan-empty-'));
  try {
    const r = scanSqliteFiles(dir);
    assert.equal(r.total, 0);
    assert.equal(r.bytes, 0);
    assert.deepEqual(r.recent, []);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

await test('scanSqliteFiles: missing dir → empty result, no throw', () => {
  const r = scanSqliteFiles('/nonexistent/path/xyz');
  assert.equal(r.total, 0);
});

await test('scanSqliteFiles: counts matching files, ignores prefix mismatches', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scan-mix-'));
  try {
    fs.writeFileSync(path.join(dir, 'caia-test-aaa.sqlite'), 'x'.repeat(100));
    fs.writeFileSync(path.join(dir, 'caia-test-bbb.sqlite'), 'x'.repeat(200));
    fs.writeFileSync(path.join(dir, 'unrelated.sqlite'), 'x'.repeat(50));
    const r = scanSqliteFiles(dir);
    assert.equal(r.total, 2);
    assert.equal(r.bytes, 300);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

await test('scanSqliteFiles: ignores -wal and -shm sidecars', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scan-wal-'));
  try {
    fs.writeFileSync(path.join(dir, 'caia-test-x.sqlite'), 'x');
    fs.writeFileSync(path.join(dir, 'caia-test-x.sqlite-wal'), 'w');
    fs.writeFileSync(path.join(dir, 'caia-test-x.sqlite-shm'), 's');
    const r = scanSqliteFiles(dir);
    assert.equal(r.total, 1);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

await test('scanSqliteFiles: marks files older than 1h as stale', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scan-stale-'));
  try {
    const stale = path.join(dir, 'caia-test-stale.sqlite');
    fs.writeFileSync(stale, 'x');
    const old = (Date.now() - 2 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(stale, old, old);
    fs.writeFileSync(path.join(dir, 'caia-test-fresh.sqlite'), 'y');
    const r = scanSqliteFiles(dir);
    assert.equal(r.total, 2);
    assert.equal(r.stale, 1);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

await test('scanSqliteFiles: caps recent[] at 10 entries, sorted newest-first', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scan-many-'));
  try {
    for (let i = 0; i < 15; i++) {
      const f = path.join(dir, `caia-test-${i}.sqlite`);
      fs.writeFileSync(f, 'x');
      const t = (Date.now() - i * 1000) / 1000;
      fs.utimesSync(f, t, t);
    }
    const r = scanSqliteFiles(dir);
    assert.equal(r.total, 15);
    assert.equal(r.recent.length, 10);
    for (let i = 1; i < r.recent.length; i++) {
      assert.ok(r.recent[i - 1].mtimeMs >= r.recent[i].mtimeMs);
    }
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

await test('readShardSummary: missing path → null', () => {
  assert.equal(readShardSummary(null), null);
  assert.equal(readShardSummary(''), null);
  assert.equal(readShardSummary('/nonexistent/path.json'), null);
});

await test('readShardSummary: parses valid JSON', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'shard-'));
  try {
    const p = path.join(dir, 's.json');
    const obj = { schemaVersion: 1, generatedAt: 'x', runId: '1', totals: {} };
    fs.writeFileSync(p, JSON.stringify(obj));
    const r = readShardSummary(p);
    assert.equal(r.schemaVersion, 1);
    assert.equal(r.runId, '1');
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

await test('readShardSummary: invalid JSON → null', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'shard-bad-'));
  try {
    const p = path.join(dir, 'bad.json');
    fs.writeFileSync(p, 'not json {{{');
    assert.equal(readShardSummary(p), null);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

await test('buildPressureUrl: token urlencoded; trailing slash stripped', () => {
  assert.equal(buildPressureUrl('http://h:1', 'tok'), 'http://h:1/pressure?token=tok');
  assert.equal(buildPressureUrl('http://h:1/', 'tok'), 'http://h:1/pressure?token=tok');
  assert.equal(buildPressureUrl('http://h:1', 'a/b+c'), 'http://h:1/pressure?token=a%2Fb%2Bc');
});

await test('extractPressure: returns null for missing required fields', () => {
  assert.equal(extractPressure(null), null);
  assert.equal(extractPressure({}), null);
  assert.equal(extractPressure({ pressure: {} }), null);
  assert.equal(extractPressure({ pressure: { isAvailable: true, maxConcurrent: 30 } }), null);
});

await test('extractPressure: accepts v2 wrapped shape', () => {
  const r = extractPressure({
    pressure: {
      isAvailable: true, running: 4, queued: 1, maxConcurrent: 30,
      maxQueued: 20, cpu: 12, memory: 50, reason: '',
    },
  });
  assert.equal(r.running, 4);
  assert.equal(r.queued, 1);
  assert.equal(r.cpu, 12);
});

await test('extractPressure: falls through to bare shape (forward-compat)', () => {
  const r = extractPressure({
    isAvailable: false, running: 30, maxConcurrent: 30, queued: 5,
  });
  assert.equal(r.isAvailable, false);
  assert.equal(r.running, 30);
  assert.equal(r.queued, 5);
});

await test('extractPressure: defaults missing optional fields', () => {
  const r = extractPressure({
    pressure: { isAvailable: true, running: 0, maxConcurrent: 30 },
  });
  assert.equal(r.queued, 0);
  assert.equal(r.cpu, 0);
  assert.equal(r.memory, 0);
  assert.equal(r.reason, '');
});

console.log();
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
