import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LifecycleAggregator } from '../src/aggregator.js';
import { LifecycleConductorApi } from '../src/api.js';
import {
  HEADING_DOD,
  HEADING_REGRESSION,
  HEADING_STUCK,
  reportDodCompletedToInbox,
  reportDodToInbox,
  reportRegressionToInbox,
  reportStuckToInbox,
} from '../src/reporter.js';
import type { CompositeStateChangedEvent, StewardAttestation, StewardName } from '../src/types.js';

const T0 = new Date('2026-05-25T12:00:00Z');

function att(
  steward: StewardName,
  status: 'green' | 'amber' | 'red',
  solutionId = 'sln-A',
  observedAt: Date = T0,
): StewardAttestation {
  return { steward, status, solutionId, observedAt: observedAt.toISOString() };
}

function regressionEvent(): CompositeStateChangedEvent {
  return {
    solutionId: 'sln-A',
    fromState: 'producing-metrics',
    toState: 'degraded',
    trigger: 'drift-to-degraded:outcome.red',
    rowsSnapshot: {
      deploy: null, usage: null, activation: null, outcome: null,
    },
    at: T0.toISOString(),
  };
}

function dodCandidateEvent(): CompositeStateChangedEvent {
  return {
    solutionId: 'sln-A',
    fromState: 'called-in-test',
    toState: 'producing-metrics',
    trigger: 'forward-advance',
    rowsSnapshot: {
      deploy: null, usage: null, activation: null, outcome: null,
    },
    at: T0.toISOString(),
  };
}

describe('reportRegressionToInbox', () => {
  let inboxPath: string;
  beforeEach(async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'lifecycle-conductor-test-'));
    inboxPath = join(dir, 'INBOX.md');
  });
  afterEach(async () => {
    await fs.rm(join(inboxPath, '..'), { recursive: true, force: true });
  });

  it('skips when toState is not degraded', async () => {
    const event = { ...regressionEvent(), toState: 'deployed' as const };
    const result = await reportRegressionToInbox(inboxPath, event);
    expect(result.appended).toBe(false);
    await expect(fs.access(inboxPath)).rejects.toThrow();
  });

  it('appends a regression entry with the heading', async () => {
    const result = await reportRegressionToInbox(inboxPath, regressionEvent());
    expect(result.appended).toBe(true);
    const content = await fs.readFile(inboxPath, 'utf8');
    expect(content).toContain(HEADING_REGRESSION);
    expect(content).toContain('sln-A');
    expect(content).toContain('degraded');
    expect(content).toContain(result.reportKey);
  });

  it('is idempotent on (solutionId, at)', async () => {
    const event = regressionEvent();
    await reportRegressionToInbox(inboxPath, event);
    const second = await reportRegressionToInbox(inboxPath, event);
    expect(second.appended).toBe(false);
  });

  it('appends a fresh entry under the existing heading on a new event', async () => {
    await reportRegressionToInbox(inboxPath, regressionEvent());
    const second = await reportRegressionToInbox(inboxPath, {
      ...regressionEvent(),
      solutionId: 'sln-B',
      at: new Date(T0.getTime() + 60_000).toISOString(),
    });
    expect(second.appended).toBe(true);
    const content = await fs.readFile(inboxPath, 'utf8');
    // Heading only once.
    expect(content.match(new RegExp(HEADING_REGRESSION, 'g'))?.length).toBe(1);
    expect(content).toContain('sln-B');
  });

  it('REGRESSION envelope body never mentions drift-sentinel or future-incoming (ADR-063)', async () => {
    await reportRegressionToInbox(inboxPath, regressionEvent());
    const content = await fs.readFile(inboxPath, 'utf8');
    expect(content).not.toContain('drift-sentinel');
    expect(content).not.toContain('future-incoming');
    expect(content).not.toContain('## DRIFT ALERTS'); // pipeline-conductor's separate surface
  });
});

describe('reportDodToInbox', () => {
  let inboxPath: string;
  beforeEach(async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'lifecycle-conductor-test-'));
    inboxPath = join(dir, 'INBOX.md');
  });

  it('appends a DoD-candidate entry on producing-metrics', async () => {
    const result = await reportDodToInbox(inboxPath, dodCandidateEvent());
    expect(result.appended).toBe(true);
    const content = await fs.readFile(inboxPath, 'utf8');
    expect(content).toContain(HEADING_DOD);
    expect(content).toContain('24h holdover');
    expect(content).toContain('ea-review-approved');
  });

  it('skips when toState is not producing-metrics', async () => {
    const result = await reportDodToInbox(inboxPath, {
      ...dodCandidateEvent(),
      toState: 'deployed' as const,
    });
    expect(result.appended).toBe(false);
  });
});

describe('reportDodCompletedToInbox', () => {
  let inboxPath: string;
  beforeEach(async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'lifecycle-conductor-test-'));
    inboxPath = join(dir, 'INBOX.md');
  });

  it('appends a DoD-complete entry when done=true', async () => {
    const result = await reportDodCompletedToInbox(inboxPath, {
      solutionId: 'sln-X',
      done: true,
      compositeState: 'producing-metrics',
      holdoverHoursRemaining: 0,
      missing: {},
      driftDuringHoldover: false,
      eaReviewApproved: true,
    });
    expect(result.appended).toBe(true);
    const content = await fs.readFile(inboxPath, 'utf8');
    expect(content).toContain('sln-X');
    expect(content).toContain('met the Real DoD');
    expect(content).toContain('4 stewards');
    expect(content).toContain('ea-review-approved');
  });

  it('does not append when done=false', async () => {
    const result = await reportDodCompletedToInbox(inboxPath, {
      solutionId: 'sln-X',
      done: false,
      compositeState: 'deployed',
      holdoverHoursRemaining: null,
      missing: {},
      driftDuringHoldover: false,
      eaReviewApproved: false,
    });
    expect(result.appended).toBe(false);
  });
});

describe('reportStuckToInbox', () => {
  let inboxPath: string;
  beforeEach(async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'lifecycle-conductor-test-'));
    inboxPath = join(dir, 'INBOX.md');
  });

  it('appends STUCK entries for degraded solutions', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    await agg.ingest(att('deploy', 'red'));
    const api = new LifecycleConductorApi(agg);
    const results = await reportStuckToInbox(inboxPath, api, {
      thresholdHours: 1,
      now: T0,
    });
    expect(results.some((r) => r.appended)).toBe(true);
    const content = await fs.readFile(inboxPath, 'utf8');
    expect(content).toContain(HEADING_STUCK);
    expect(content).toContain('sln-A');
  });

  it('does not append when no solution is stuck', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    await agg.ingest(att('deploy', 'green'));
    const api = new LifecycleConductorApi(agg);
    const results = await reportStuckToInbox(inboxPath, api, {
      thresholdHours: 1,
      now: T0,
    });
    expect(results.every((r) => !r.appended)).toBe(true);
  });

  it('STUCK body surfaces ea-review-approved=false when that is the missing gate', async () => {
    const agg = new LifecycleAggregator({ now: () => T0 });
    await agg.ingest(att('deploy', 'red'));
    const api = new LifecycleConductorApi(agg);
    await reportStuckToInbox(inboxPath, api, { thresholdHours: 1, now: T0 });
    const content = await fs.readFile(inboxPath, 'utf8');
    expect(content).toContain('ea-review-approved=false');
  });
});
