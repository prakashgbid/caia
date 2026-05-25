import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_POLL_OPTS,
  FileStewardClient,
  InMemoryStewardClient,
  findLedgerRowSync,
} from '../src/steward.js';
import type { StewardLedgerRow } from '../src/types.js';

function row(overrides: Partial<StewardLedgerRow> = {}): StewardLedgerRow {
  return {
    ts: '2026-05-25T12:00:00.000Z',
    id: 'r1',
    section: 'deploys',
    kind: 'deploy',
    node_id: null,
    deploy_passed: true,
    deploy_rc: 0,
    deploy_reason: 'ok',
    deploy_duration_ms: 100,
    deploy_stdout: '',
    deploy_stderr: '',
    inuse_passed: false,
    inuse_rc: 1,
    inuse_reason: 'pending',
    inuse_duration_ms: 0,
    inuse_stdout: '',
    inuse_stderr: '',
    green: false,
    ...overrides,
  };
}

describe('FileStewardClient', () => {
  let dir: string;
  let ledger: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'devops-runtime-steward-'));
    ledger = join(dir, 'runs.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends a deploy row and returns it via findLedgerRowSync', async () => {
    const client = new FileStewardClient(ledger);
    await client.recordDeploy(row({ id: 'find-me' }));
    const found = findLedgerRowSync(ledger, 'find-me');
    expect(found?.id).toBe('find-me');
  });

  it('returns undefined when the row is not present', () => {
    const found = findLedgerRowSync(ledger, 'missing');
    expect(found).toBeUndefined();
  });

  it('returns the most-recent row when an id appears multiple times', async () => {
    const client = new FileStewardClient(ledger);
    await client.recordDeploy(row({ id: 'dup', deploy_duration_ms: 1 }));
    await client.recordDeploy(row({ id: 'dup', deploy_duration_ms: 999 }));
    const found = findLedgerRowSync(ledger, 'dup');
    expect(found?.deploy_duration_ms).toBe(999);
  });

  it('pollVerification returns green when the ledger row is green', async () => {
    const client = new FileStewardClient(ledger);
    await client.recordDeploy(
      row({
        id: 'green-row',
        inuse_passed: true,
        inuse_reason: 'ok',
        green: true,
      }),
    );
    const verdict = await client.pollVerification('green-row', {
      intervalMs: 1,
      freshnessWindowMs: 50,
    });
    expect(verdict.status).toBe('green');
  });

  it('pollVerification returns red when inuse explicitly failed', async () => {
    const client = new FileStewardClient(ledger);
    await client.recordDeploy(
      row({
        id: 'red-row',
        inuse_passed: false,
        inuse_reason: 'http 503',
        green: false,
      }),
    );
    const verdict = await client.pollVerification('red-row', {
      intervalMs: 1,
      freshnessWindowMs: 50,
    });
    expect(verdict.status).toBe('red');
    expect(verdict.reason).toContain('503');
  });

  it('pollVerification times out when the row never goes green', async () => {
    const client = new FileStewardClient(ledger);
    const verdict = await client.pollVerification('never-arrives', {
      intervalMs: 1,
      freshnessWindowMs: 5,
    });
    expect(verdict.status).toBe('timeout');
    expect(verdict.reason).toContain('elapsed');
  });

  it('DEFAULT_POLL_OPTS is sensible', () => {
    expect(DEFAULT_POLL_OPTS.intervalMs).toBeGreaterThan(0);
    expect(DEFAULT_POLL_OPTS.freshnessWindowMs).toBeGreaterThan(0);
  });
});

describe('InMemoryStewardClient', () => {
  it('records deploys', async () => {
    const client = new InMemoryStewardClient();
    await client.recordDeploy(row({ id: 'r1' }));
    expect(client.recorded).toHaveLength(1);
    expect(client.recorded[0]?.id).toBe('r1');
  });

  it('preload + record returns green verdict when preloaded', async () => {
    const client = new InMemoryStewardClient();
    client.preload('r1', { inuse_passed: true, inuse_reason: 'ok', green: true });
    await client.recordDeploy(row({ id: 'r1' }));
    const verdict = await client.pollVerification('r1', {
      intervalMs: 1,
      freshnessWindowMs: 50,
    });
    expect(verdict.status).toBe('green');
  });

  it('preload red verdict surfaces immediately', async () => {
    const client = new InMemoryStewardClient();
    client.preload('r1', { inuse_passed: false, inuse_reason: 'http 500', green: false });
    await client.recordDeploy(row({ id: 'r1' }));
    const verdict = await client.pollVerification('r1', {
      intervalMs: 1,
      freshnessWindowMs: 50,
    });
    expect(verdict.status).toBe('red');
    expect(verdict.reason).toContain('500');
  });

  it('times out cleanly when never preloaded', async () => {
    const client = new InMemoryStewardClient();
    const verdict = await client.pollVerification('missing', {
      intervalMs: 1,
      freshnessWindowMs: 3,
    });
    expect(verdict.status).toBe('timeout');
  });

  it('uses provided clock for deadline math', async () => {
    const client = new InMemoryStewardClient();
    let now = 0;
    const verdict = await client.pollVerification('missing', {
      intervalMs: 1,
      freshnessWindowMs: 3,
      clock: () => (now += 2),
    });
    expect(verdict.status).toBe('timeout');
  });
});
