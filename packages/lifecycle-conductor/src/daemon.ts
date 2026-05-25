/**
 * @caia/lifecycle-conductor — daemon entrypoint module.
 *
 * Continuous listener. Wires:
 *   - `InMemorySolutionStore` (default).
 *   - `SolutionLifecycleMachine` built against the store.
 *   - `LifecycleAggregator` that subscribes to the machine + optional
 *     extra event sources (e.g. the in-process event bus when stewards
 *     push directly).
 *   - `LifecycleConductorApi` over the aggregator.
 *   - `createSseFanout()` wired to the aggregator's
 *     `onCompositeStateChanged` hook.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  InMemorySolutionStore,
  SolutionLifecycleMachine,
} from '@caia/state-machine';

import { LifecycleAggregator } from './aggregator.js';
import type { AttestationEventSource } from './aggregator.js';
import { LifecycleConductorApi } from './api.js';
import {
  createSseFanout,
  type SseFanoutHandle,
} from './dashboard-projector.js';
import {
  reportDodCompletedToInbox,
  reportDodToInbox,
  reportRegressionToInbox,
  reportStuckToInbox,
} from './reporter.js';
import type { CompositeStateChangedEvent } from './types.js';

const HOME = homedir();
const DEFAULT_INBOX_PATH = join(HOME, 'Documents', 'projects', 'agent-memory', 'INBOX.md');
const DEFAULT_STATS_INTERVAL_MS = 60_000;
const DEFAULT_STUCK_SCAN_INTERVAL_MS = 5 * 60_000;

export interface DaemonConfig {
  inboxPath?: string;
  statsIntervalMs?: number;
  stuckScanIntervalMs?: number;
  stuckThresholdHours?: number;
  extraSources?: AttestationEventSource[];
  log?: (...args: unknown[]) => void;
}

export interface RunningDaemon {
  machine: SolutionLifecycleMachine;
  aggregator: LifecycleAggregator;
  api: LifecycleConductorApi;
  fanout: SseFanoutHandle;
  inboxPath: string;
  stop: () => Promise<void>;
}

export async function startDaemon(config: DaemonConfig = {}): Promise<RunningDaemon> {
  const log = config.log ?? ((...a): void => console.log('[lifecycle-conductor]', ...a));
  const inboxPath = config.inboxPath ?? DEFAULT_INBOX_PATH;
  const statsIntervalMs = config.statsIntervalMs ?? DEFAULT_STATS_INTERVAL_MS;
  const stuckScanIntervalMs =
    config.stuckScanIntervalMs ?? DEFAULT_STUCK_SCAN_INTERVAL_MS;
  const stuckThresholdHours = config.stuckThresholdHours ?? 12;

  const store = new InMemorySolutionStore();
  const machine = new SolutionLifecycleMachine(store);
  await machine.init();

  const fanout = createSseFanout();

  const aggregator = new LifecycleAggregator({
    solutionMachine: machine,
    onCompositeStateChanged: (event): void => {
      fanout.emit(event);
      void surfaceInboxOnChange(inboxPath, event, log);
    },
  });

  for (const src of config.extraSources ?? []) {
    aggregator.attachSource(src);
  }

  const api = new LifecycleConductorApi(aggregator, machine);

  log(`starting at=${new Date().toISOString()} inbox=${inboxPath}`);

  const statsTimer = setInterval(() => {
    log(
      `stats attestations=${aggregator.attestationsIngested} ` +
        `composite-changes=${aggregator.compositeStateChanges} ` +
        `fsm-advances=${aggregator.fsmAdvancesIssued} ` +
        `ignored=${aggregator.ignoredEnvelopes}`,
    );
  }, statsIntervalMs);

  const stuckTimer = setInterval(() => {
    void runStuckScan(inboxPath, api, stuckThresholdHours, log);
  }, stuckScanIntervalMs);

  const stop = async (): Promise<void> => {
    clearInterval(statsTimer);
    clearInterval(stuckTimer);
    aggregator.stop();
    log('stopped');
  };

  return { machine, aggregator, api, fanout, inboxPath, stop };
}

async function surfaceInboxOnChange(
  inboxPath: string,
  event: CompositeStateChangedEvent,
  log: (...args: unknown[]) => void,
): Promise<void> {
  try {
    if (event.toState === 'degraded') {
      await reportRegressionToInbox(inboxPath, event);
    }
    if (event.toState === 'producing-metrics') {
      await reportDodToInbox(inboxPath, event);
    }
  } catch (err) {
    log(`inbox-surface-error ${(err as Error).message}`);
  }
}

async function runStuckScan(
  inboxPath: string,
  api: LifecycleConductorApi,
  thresholdHours: number,
  log: (...args: unknown[]) => void,
): Promise<void> {
  try {
    await reportStuckToInbox(inboxPath, api, { thresholdHours });
    for (const id of (await api.listIncompleteSolutions()).map((e) => e.solutionId)) {
      const dod = api.getDodStatus(id);
      if (dod !== null && dod.done) {
        await reportDodCompletedToInbox(inboxPath, dod);
      }
    }
  } catch (err) {
    log(`stuck-scan-error ${(err as Error).message}`);
  }
}
