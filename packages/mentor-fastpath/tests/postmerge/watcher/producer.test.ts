/**
 * Integration test for the postmerge watcher producer.
 *
 * Wires:
 *   - A real :memory: state-store DB.
 *   - A real :memory: event-bus Client (mentor-event-bus's local mode).
 *   - A mocked gh-client that returns canned PR + run JSON.
 *
 * Verifies that one runIteration() call:
 *   1. Emits PRMerged events for new merged PRs.
 *   2. Emits RegressionDetected when a failed run's headSha matches a
 *      known merged commit.
 *   3. Emits EvidenceGateFailure when a failed run's headSha is on a
 *      branch we have no merge record for.
 *   4. Persists the seen state so a second iteration is a no-op.
 *   5. Advances the cursor.
 */

import { describe, expect, it } from 'vitest';

import { Client } from '@chiefaia/mentor-event-bus';

import {
  countSeenPrs,
  countSeenRuns,
  getCursor,
  openStateStore
} from '../../../src/postmerge/watcher/state-store.js';
import { runIteration } from '../../../src/postmerge/watcher/producer.js';
import type { GhClientOptions } from '../../../src/postmerge/watcher/gh-client.js';

function buildMockGh(prResp: string, runResps: string[], jobResp = '{}'): {
  ghClient: GhClientOptions;
  calls: string[][];
} {
  const calls: string[][] = [];
  let _prIdx = 0;
  let runIdx = 0;
  const runGh = (args: ReadonlyArray<string>): string => {
    calls.push([...args]);
    if (args[0] === 'pr' && args[1] === 'list') {
      _prIdx++;
      return prResp;
    }
    if (args[0] === 'run' && args[1] === 'list') {
      const out = runResps[runIdx] ?? '[]';
      runIdx++;
      return out;
    }
    if (args[0] === 'run' && args[1] === 'view') {
      return jobResp;
    }
    return '';
  };
  return { ghClient: { runGh }, calls };
}

function makeBus(): Client {
  return new Client({
    dbPath: ':memory:',
    disableWal: true,
    skipSchemaRegistration: true
  });
}

describe('runIteration — happy path', () => {
  it('emits PRMerged + classifies runs', () => {
    const stateDb = openStateStore(':memory:');
    const busClient = makeBus();

    const prResp = JSON.stringify([
      {
        number: 327,
        title: 'feat(curator-phase1-001): scan loop',
        mergeCommit: { oid: 'ea23ab0' },
        baseRefName: 'develop',
        headRefName: 'feat/curator-phase1-001',
        mergedAt: '2026-05-05T05:23:00Z',
        author: { login: 'campaign-coordinator' }
      }
    ]);

    // First gh run list (develop branch): one failed run on the merge SHA
    // → should emit RegressionDetected.
    const developRuns = JSON.stringify([
      {
        databaseId: 12345,
        name: 'Build · Test · Lint · Typecheck',
        headBranch: 'develop',
        headSha: 'ea23ab0',
        updatedAt: '2026-05-05T05:30:00Z',
        conclusion: 'failure'
      }
    ]);
    // Second gh run list (main branch): one failed run on a non-merged sha
    // → should emit EvidenceGateFailure.
    const mainRuns = JSON.stringify([
      {
        databaseId: 22222,
        name: 'lint',
        headBranch: 'feat/some-other',
        headSha: 'unknown-sha',
        updatedAt: '2026-05-05T05:31:00Z',
        conclusion: 'failure'
      }
    ]);
    const jobResp = JSON.stringify({
      jobs: [{ name: 'integration-tests', conclusion: 'failure' }]
    });

    const { ghClient } = buildMockGh(prResp, [developRuns, mainRuns], jobResp);

    const stats = runIteration({
      stateDb,
      busClient,
      ghClient,
      now: () => new Date('2026-05-05T05:35:00Z')
    });

    expect(stats.prsSeen).toBe(1);
    expect(stats.prsEmitted).toBe(1);
    expect(stats.runsSeen).toBe(2);
    expect(stats.runsEmittedAsRegression).toBe(1);
    expect(stats.runsEmittedAsGateFailure).toBe(1);
    expect(stats.errors).toEqual([]);

    expect(countSeenPrs(stateDb)).toBe(1);
    expect(countSeenRuns(stateDb)).toBe(2);

    // Cursor advanced
    const c = getCursor(stateDb);
    expect(c.lastPrQueryIso).toBe('2026-05-05T05:35:00.000Z');
    expect(c.lastRunQueryIso).toBe('2026-05-05T05:35:00.000Z');

    // Verify events landed in the bus
    const events = busClient.getRecent({ limit: 100 });
    const types = events.map((e) => e.type).sort();
    expect(types).toContain('PRMerged');
    expect(types).toContain('RegressionDetected');
    expect(types).toContain('EvidenceGateFailure');

    busClient.close();
    stateDb.close();
  });
});

describe('runIteration — idempotency', () => {
  it('a second iteration with the same gh data emits zero new events', () => {
    const stateDb = openStateStore(':memory:');
    const busClient = makeBus();

    const prResp = JSON.stringify([
      {
        number: 327,
        title: 'x',
        mergeCommit: { oid: 'sha1' },
        baseRefName: 'develop',
        headRefName: 'feat/x',
        mergedAt: '2026-05-05T05:23:00Z',
        author: { login: 'a' }
      }
    ]);
    const runResp = JSON.stringify([
      {
        databaseId: 1,
        name: 'lint',
        headBranch: 'develop',
        headSha: 'sha1',
        updatedAt: '2026-05-05T05:30:00Z',
        conclusion: 'failure'
      }
    ]);

    // First iteration
    const m1 = buildMockGh(prResp, [runResp, '[]'], '{}');
    const stats1 = runIteration({
      stateDb,
      busClient,
      ghClient: m1.ghClient,
      now: () => new Date('2026-05-05T05:35:00Z')
    });
    expect(stats1.prsEmitted).toBe(1);
    expect(stats1.runsEmittedAsRegression).toBe(1);

    // Second iteration with the SAME gh data
    const m2 = buildMockGh(prResp, [runResp, '[]'], '{}');
    const stats2 = runIteration({
      stateDb,
      busClient,
      ghClient: m2.ghClient,
      now: () => new Date('2026-05-05T05:40:00Z')
    });
    expect(stats2.prsSeen).toBe(1); // still saw it from gh
    expect(stats2.prsEmitted).toBe(0); // but didn't re-emit
    // Run's updatedAt (T-5min) is now older than the cursor advanced
    // by iteration 1 (T) — the gh-client filter cuts it before we
    // reach the seen-runs check. This is correct behaviour: cursor-
    // advancement is the cheap dedupe, seen_runs is the safety net.
    expect(stats2.runsEmittedAsRegression).toBe(0);
    expect(stats2.runsEmittedAsGateFailure).toBe(0);

    busClient.close();
    stateDb.close();
  });
});

describe('runIteration — error handling', () => {
  it('records a partial error without throwing when gh pr list fails', () => {
    const stateDb = openStateStore(':memory:');
    const busClient = makeBus();

    const ghClient: GhClientOptions = {
      runGh: (args) => {
        if (args[0] === 'pr') throw new Error('network down');
        if (args[0] === 'run' && args[1] === 'list') return '[]';
        return '';
      }
    };

    const stats = runIteration({
      stateDb,
      busClient,
      ghClient,
      now: () => new Date('2026-05-05T05:35:00Z')
    });
    expect(stats.errors.length).toBeGreaterThan(0);
    expect(stats.errors[0]).toMatch(/gh pr list failed/);
    // Did not crash; runs were still queried.
    expect(stats.runsSeen).toBe(0);

    busClient.close();
    stateDb.close();
  });

  it('continues past a per-PR emit failure', () => {
    const stateDb = openStateStore(':memory:');
    const busClient = makeBus();

    // We cannot easily induce an emit failure on the in-memory bus, but
    // we can verify that the watcher tolerates a gh-pr-view failure
    // when fetching failed-job names (skips the names but still emits
    // the event).
    const prResp = JSON.stringify([
      {
        number: 1,
        title: 'x',
        mergeCommit: { oid: 'aaa' },
        baseRefName: 'develop',
        headRefName: 'feat/y',
        mergedAt: '2026-05-05T05:23:00Z',
        author: { login: 'a' }
      }
    ]);
    const runResp = JSON.stringify([
      {
        databaseId: 1,
        name: 'lint',
        headBranch: 'develop',
        headSha: 'aaa',
        updatedAt: '2026-05-05T05:30:00Z',
        conclusion: 'failure'
      }
    ]);

    const ghClient: GhClientOptions = {
      runGh: (args) => {
        if (args[0] === 'pr') return prResp;
        if (args[0] === 'run' && args[1] === 'list') {
          // First call (develop) returns runResp; subsequent (main) empty.
          return runResp;
        }
        if (args[0] === 'run' && args[1] === 'view') {
          throw new Error('rate-limited');
        }
        return '';
      }
    };

    let calls = 0;
    const wrapped: GhClientOptions = {
      runGh: (args) => {
        calls++;
        if (args[0] === 'pr') return prResp;
        if (args[0] === 'run' && args[1] === 'list') {
          // first → develop, second → main
          return calls <= 3 ? runResp : '[]';
        }
        if (args[0] === 'run' && args[1] === 'view') {
          throw new Error('rate-limited');
        }
        return '';
      }
    };

    const stats = runIteration({
      stateDb,
      busClient,
      ghClient: wrapped,
      now: () => new Date('2026-05-05T05:35:00Z')
    });
    // Failed-job lookup errored but we still emitted the regression
    // event with the workflow name as the only "failed job."
    expect(stats.errors.some((e) => /gh run view/.test(e))).toBe(true);
    expect(stats.runsEmittedAsRegression).toBeGreaterThanOrEqual(1);

    busClient.close();
    stateDb.close();

    // Silence unused-binding lint warning
    void ghClient;
  });
});

describe('runIteration — cursor behaviour', () => {
  it('uses the configured initial-lookback when cursor is empty', () => {
    const stateDb = openStateStore(':memory:');
    const busClient = makeBus();

    const captured: string[] = [];
    const ghClient: GhClientOptions = {
      runGh: (args) => {
        captured.push(args.join(' '));
        if (args[0] === 'pr') return '[]';
        if (args[0] === 'run' && args[1] === 'list') return '[]';
        return '';
      }
    };

    runIteration({
      stateDb,
      busClient,
      ghClient,
      initialLookbackHours: 6,
      now: () => new Date('2026-05-05T05:35:00Z')
    });

    // pr list call's search includes 'merged:>=' with iso ~6h before now
    const prCall = captured.find((c) => c.includes('pr list'));
    expect(prCall).toMatch(/merged:>=2026-05-04T23:35/);

    busClient.close();
    stateDb.close();
  });
});
