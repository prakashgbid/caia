#!/usr/bin/env node
/**
 * CLI entrypoint for the postmerge watcher.
 *
 * Subcommands:
 *
 *   watch [--db <path>] [--state <path>] [--base-refs develop,main]
 *         [--interval-ms 300000] [--initial-lookback-hours 24]
 *         [--skip-failed-job-lookup]
 *     Run the long-running poll loop. The --db is the mentor-event-bus
 *     events.sqlite (we WRITE to it via the bus Client). --state is the
 *     watcher's own state DB.
 *
 *   scan-once [...same flags]
 *     Run exactly one iteration and exit. Useful for cron / cron-like
 *     setups + smoke tests + Stage-6 verify.
 *
 *   status [--state <path>]
 *     Print a one-line JSON with seen-counts + cursor.
 *
 * Defaults:
 *   --db    $CAIA_EVENT_BUS_DB_PATH or
 *           ~/Library/Application Support/caia/events/events.sqlite
 *   --state ${CAIA_POSTMERGE_STATE_PATH} or <db>.postmerge-watcher-state.sqlite
 *
 * Env:
 *   CAIA_EVENT_BUS_DB_PATH        events.sqlite to write events into
 *   CAIA_POSTMERGE_STATE_PATH     watcher state DB
 *   CAIA_POSTMERGE_BASE_REFS      comma-separated branches (default develop,main)
 *   CAIA_POSTMERGE_INTERVAL_MS    poll interval (default 300000)
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@chiefaia/mentor-event-bus';

import {
  countSeenPrs,
  countSeenRuns,
  getCursor,
  openStateStore
} from './state-store.js';
import {
  DEFAULT_BASE_REFS,
  DEFAULT_INITIAL_LOOKBACK_HOURS,
  DEFAULT_POLL_INTERVAL_MS,
  runIteration,
  runProducer
} from './producer.js';

interface Argv {
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): Argv {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = '1';
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

function defaultBusDbPath(): string {
  return (
    process.env['CAIA_EVENT_BUS_DB_PATH'] ??
    join(
      homedir(),
      'Library',
      'Application Support',
      'caia',
      'events',
      'events.sqlite'
    )
  );
}

function defaultStateDbPath(busDbPath: string): string {
  return (
    process.env['CAIA_POSTMERGE_STATE_PATH'] ??
    `${busDbPath}.postmerge-watcher-state.sqlite`
  );
}

function resolveBaseRefs(args: Argv): readonly string[] {
  const flag = args.flags['base-refs'] ?? process.env['CAIA_POSTMERGE_BASE_REFS'];
  if (!flag) return DEFAULT_BASE_REFS;
  return flag
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function buildCommonOpts(args: Argv): {
  busDb: string;
  stateDb: string;
  baseRefs: readonly string[];
  intervalMs: number;
  lookbackHours: number;
  skipFailedJobLookup: boolean;
} {
  const busDb = args.flags['db'] ?? defaultBusDbPath();
  const stateDb = args.flags['state'] ?? defaultStateDbPath(busDb);
  const baseRefs = resolveBaseRefs(args);
  const intervalMs = Number(
    args.flags['interval-ms'] ??
      process.env['CAIA_POSTMERGE_INTERVAL_MS'] ??
      DEFAULT_POLL_INTERVAL_MS
  );
  const lookbackHours = Number(
    args.flags['initial-lookback-hours'] ?? DEFAULT_INITIAL_LOOKBACK_HOURS
  );
  const skipFailedJobLookup = args.flags['skip-failed-job-lookup'] === '1';
  return {
    busDb,
    stateDb,
    baseRefs,
    intervalMs,
    lookbackHours,
    skipFailedJobLookup
  };
}

async function watchCmd(args: Argv): Promise<void> {
  const opts = buildCommonOpts(args);
  const stateDb = openStateStore(opts.stateDb);
  const busClient = new Client({
    dbPath: opts.busDb,
    processName: 'caia-postmerge-watcher'
  });
  const ac = new AbortController();
  const stop = (): void => {
    ac.abort();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  await runProducer({
    stateDb,
    busClient,
    baseRefs: opts.baseRefs,
    pollIntervalMs: opts.intervalMs,
    initialLookbackHours: opts.lookbackHours,
    skipFailedJobLookup: opts.skipFailedJobLookup,
    abortSignal: ac.signal
  });

  busClient.close();
  stateDb.close();
}

async function scanOnceCmd(args: Argv): Promise<void> {
  const opts = buildCommonOpts(args);
  const stateDb = openStateStore(opts.stateDb);
  const busClient = new Client({
    dbPath: opts.busDb,
    processName: 'caia-postmerge-watcher'
  });
  try {
    const stats = runIteration({
      stateDb,
      busClient,
      baseRefs: opts.baseRefs,
      initialLookbackHours: opts.lookbackHours,
      skipFailedJobLookup: opts.skipFailedJobLookup
    });
    console.log(JSON.stringify({ ok: true, stats }));
  } finally {
    busClient.close();
    stateDb.close();
  }
}

function statusCmd(args: Argv): void {
  const opts = buildCommonOpts(args);
  const stateDb = openStateStore(opts.stateDb);
  try {
    const c = getCursor(stateDb);
    const out = {
      stateDbPath: opts.stateDb,
      seenPrCount: countSeenPrs(stateDb),
      seenRunCount: countSeenRuns(stateDb),
      lastPrQueryIso: c.lastPrQueryIso,
      lastRunQueryIso: c.lastRunQueryIso
    };
    console.log(JSON.stringify(out));
  } finally {
    stateDb.close();
  }
}

function usage(): never {
  console.error(
    [
      'Usage: caia-postmerge-watcher <subcommand> [flags]',
      '',
      'Subcommands:',
      '  watch        Long-running poll loop (LaunchAgent-friendly).',
      '  scan-once    One iteration, then exit.',
      '  status       Print seen-counts + cursor as one-line JSON.',
      '',
      'Flags:',
      '  --db <path>                          events.sqlite (default: $CAIA_EVENT_BUS_DB_PATH)',
      '  --state <path>                       watcher state DB',
      '  --base-refs develop,main             comma-separated branches to watch',
      '  --interval-ms 300000                 poll interval (watch only)',
      '  --initial-lookback-hours 24          first-poll look-back window',
      '  --skip-failed-job-lookup             do not call gh run view (faster, less detail)'
    ].join('\n')
  );
  process.exit(2);
}

export async function main(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  const args = parseArgs(rest);
  switch (sub) {
    case 'watch':
      await watchCmd(args);
      return;
    case 'scan-once':
      await scanOnceCmd(args);
      return;
    case 'status':
      statusCmd(args);
      return;
    case undefined:
    case '--help':
    case '-h':
      usage();
      return;
    default:
      console.error(`unknown subcommand: ${sub}`);
      usage();
  }
}

const isMain =
  process.argv[1] !== undefined &&
  (import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url.endsWith(process.argv[1]));

if (isMain) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(`[caia-postmerge-watcher] fatal: ${String(e)}`);
    process.exit(1);
  });
}
