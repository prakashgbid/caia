#!/usr/bin/env node
/**
 * Tests that the FIX-012 sharded-CI workflow file is structurally
 * sound: parses as YAML, declares the right triggers, fans out the
 * matrix, runs on `[self-hosted, stolution]`, and gates on the
 * Browserless secret.
 *
 * No external deps — just node + yaml-via-spawn (we shell out to
 * python3 -c 'import yaml; ...' if available; otherwise we fall
 * through to a smoke check).
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  '..',
);
const WORKFLOW = path.join(
  REPO_ROOT,
  '.github',
  'workflows',
  'fix-it-sharded-tests.yml',
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

async function loadYaml() {
  const txt = await fs.readFile(WORKFLOW, 'utf8');
  // Try python yaml
  const py = spawnSync(
    'python3',
    ['-c', 'import sys, yaml, json; print(json.dumps(yaml.safe_load(sys.stdin)))'],
    { input: txt, encoding: 'utf8' },
  );
  if (py.status === 0 && py.stdout.trim()) {
    return JSON.parse(py.stdout);
  }
  // Fallback: rough text checks below pick up the slack.
  return null;
}

await test('workflow file exists', async () => {
  await fs.access(WORKFLOW);
});

const yaml = await loadYaml();
const txt = await fs.readFile(WORKFLOW, 'utf8');

// On the YAML side, top-level `on:` is special and parsers may load
// the key as the boolean `True` (because YAML 1.1). We accept both.
function getOn(doc) {
  if (!doc) return null;
  return doc['on'] ?? doc[true];
}

await test('parses as YAML (or text smoke when python-yaml absent)', async () => {
  if (yaml) {
    assert.ok(typeof yaml === 'object');
  } else {
    assert.match(txt, /^name:/m);
    assert.match(txt, /\njobs:/);
  }
});

await test('triggers on PR + workflow_dispatch', async () => {
  if (yaml) {
    const on = getOn(yaml);
    assert.ok(on, 'on stanza present');
    assert.ok(on.pull_request, 'pull_request trigger');
    assert.ok(on.workflow_dispatch, 'workflow_dispatch trigger');
  } else {
    assert.match(txt, /pull_request:/);
    assert.match(txt, /workflow_dispatch:/);
  }
});

await test('declares prepare, shard, merge jobs', async () => {
  if (yaml) {
    assert.ok(yaml.jobs.prepare, 'prepare job');
    assert.ok(yaml.jobs.shard, 'shard job');
    assert.ok(yaml.jobs.merge, 'merge job');
  } else {
    assert.match(txt, /^\s+prepare:/m);
    assert.match(txt, /^\s+shard:/m);
    assert.match(txt, /^\s+merge:/m);
  }
});

await test('shard job runs on the self-hosted stolution runner', async () => {
  if (yaml) {
    const runs = yaml.jobs.shard?.['runs-on'];
    assert.ok(Array.isArray(runs), 'runs-on is an array');
    assert.ok(runs.includes('self-hosted'));
    assert.ok(runs.includes('stolution'));
  } else {
    assert.match(txt, /runs-on:\s*\[\s*self-hosted,\s*stolution\s*\]/);
  }
});

await test('shard job has fail-fast: false', async () => {
  if (yaml) {
    assert.equal(yaml.jobs.shard?.strategy?.['fail-fast'], false);
  } else {
    assert.match(txt, /fail-fast:\s*false/);
  }
});

await test('shard job uses the matrix from prepare', async () => {
  if (yaml) {
    const matrix = yaml.jobs.shard?.strategy?.matrix;
    assert.ok(matrix?.shard);
    assert.match(JSON.stringify(matrix.shard), /needs\.prepare\.outputs\.shards/);
  } else {
    assert.match(txt, /matrix:\s*\n\s+shard:.*needs\.prepare\.outputs\.shards/s);
  }
});

await test('shard env wires Browserless endpoint + token from secret', async () => {
  if (yaml) {
    const env = yaml.jobs.shard?.env ?? {};
    assert.match(env.BROWSERLESS_WS_ENDPOINT ?? '', /\/playwright\/chromium/);
    assert.match(env.BROWSERLESS_TOKEN ?? '', /secrets\.BROWSERLESS_TOKEN/);
  } else {
    assert.match(txt, /BROWSERLESS_WS_ENDPOINT:.*\/playwright\/chromium/);
    assert.match(txt, /BROWSERLESS_TOKEN:.*secrets\.BROWSERLESS_TOKEN/);
  }
});

await test('shard runs --shard X/Y for Playwright', async () => {
  assert.match(txt, /--shard="\$\{SHARD_INDEX\}\/\$\{SHARD_TOTAL\}"/);
});

await test('shard uploads blob report; merge downloads + merges them', async () => {
  assert.match(txt, /upload-artifact@v4/);
  assert.match(txt, /download-artifact@v4/);
  assert.match(txt, /playwright merge-reports/);
});

await test('merge job runs `if: always()` so failures still produce a report', async () => {
  if (yaml) {
    assert.equal(yaml.jobs.merge?.if, 'always()');
  } else {
    assert.match(txt, /merge:[\s\S]*?if:\s*always\(\)/);
  }
});

await test('aggregator script is invoked and uploads shard-summary.json', async () => {
  assert.match(txt, /aggregate-shard-results\.mjs/);
  assert.match(txt, /shard-summary\.json/);
});

await test('shard count is bounded 1..30', async () => {
  // The bash check inside the prepare step.
  assert.match(txt, /-lt 1.*-gt 30/);
});

console.log();
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
