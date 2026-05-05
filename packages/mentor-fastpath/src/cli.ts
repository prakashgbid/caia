#!/usr/bin/env node
/**
 * CLI entrypoint for the Mentor Phase-1 reactive fast-path.
 *
 * Subcommands:
 *
 *   watch [--db <path>] [--memory <dir>] [--interval <ms>] [--batch <n>]
 *     Long-running daemon. Polls the events.sqlite for new
 *     OperatorCorrection events; classifies + synthesizes + writes
 *     proposals under <memoryDir>/proposals/. Used by the LaunchAgent
 *     in PR-3.
 *
 *   process-once [--db <path>] [--memory <dir>] [--batch <n>]
 *     One-shot: process whatever new events exist right now and exit.
 *     Useful for cron-style cleanup or on-demand manual catch-up.
 *
 *   status [--db <path>]
 *     One-line summary: last processed offset + total processed count.
 *
 * Defaults:
 *   --db      $CAIA_EVENT_BUS_DB_PATH or
 *             $HOME/Library/Application Support/caia/events/events.sqlite
 *   --memory  $CAIA_MEMORY_DIR (no default — fail loudly if not set or
 *             passed; we will not silently write to the wrong dir).
 *   --interval 10000 (ms) — meets the ≤1 minute correction-to-action SLO.
 *   --batch   100
 *
 * Both env vars + flags are honored; flags win when both supplied.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_BATCH_SIZE,
  DEFAULT_POLL_INTERVAL_MS,
  processOnce,
  runConsumer
} from './consumer.js';
import { makeProposalCallback } from './proposal-callback.js';
import {
  countProcessed,
  getLastProcessedOffset,
  openOffsetDb
} from './offset-store.js';

const DEFAULT_DB_PATH = join(
  homedir(),
  'Library',
  'Application Support',
  'caia',
  'events',
  'events.sqlite'
);

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

function defaultDbPath(): string {
  return process.env['CAIA_EVENT_BUS_DB_PATH'] ?? DEFAULT_DB_PATH;
}

function resolveMemoryDir(args: Argv): string {
  const flagDir = args.flags['memory'];
  const envDir = process.env['CAIA_MEMORY_DIR'];
  const memoryDir = flagDir ?? envDir;
  if (!memoryDir) {
    throw new Error(
      'CAIA_MEMORY_DIR is required (set the env var or pass --memory <dir>)'
    );
  }
  return memoryDir;
}

async function watch(args: Argv): Promise<void> {
  const eventsDbPath = args.flags['db'] ?? defaultDbPath();
  const memoryDir = resolveMemoryDir(args);
  const pollIntervalMs = Number(
    args.flags['interval'] ?? String(DEFAULT_POLL_INTERVAL_MS)
  );
  const batchSize = Number(args.flags['batch'] ?? String(DEFAULT_BATCH_SIZE));

  const onClassified = makeProposalCallback({ memoryDir });

  const controller = new AbortController();
  const sigHandler = (): void => {
    console.log('[mentor-fastpath] received signal; shutting down');
    controller.abort();
  };
  process.on('SIGINT', sigHandler);
  process.on('SIGTERM', sigHandler);

  console.log(
    `[mentor-fastpath] watch starting; eventsDb=${eventsDbPath} memoryDir=${memoryDir}`
  );
  await runConsumer({
    eventsDbPath,
    pollIntervalMs,
    batchSize,
    onClassified,
    abortSignal: controller.signal
  });
}

async function once(args: Argv): Promise<void> {
  const eventsDbPath = args.flags['db'] ?? defaultDbPath();
  const memoryDir = resolveMemoryDir(args);
  const batchSize = Number(args.flags['batch'] ?? String(DEFAULT_BATCH_SIZE));

  const onClassified = makeProposalCallback({ memoryDir });
  const n = await processOnce({
    eventsDbPath,
    batchSize,
    onClassified
  });
  console.log(JSON.stringify({ ok: true, processed: n }));
}

function status(args: Argv): void {
  const eventsDbPath = args.flags['db'] ?? defaultDbPath();
  const offsetDbPath =
    args.flags['offset-db'] ?? `${eventsDbPath}.fastpath-offset.sqlite`;
  const db = openOffsetDb(offsetDbPath);
  const lastOffset = getLastProcessedOffset(db);
  const total = countProcessed(db);
  db.close();
  console.log(
    JSON.stringify({
      ok: true,
      offsetDb: offsetDbPath,
      lastOffset,
      processedCount: total
    })
  );
}

function usage(): never {
  console.error(
    [
      'Usage: caia-mentor-fastpath <subcommand> [flags]',
      '',
      'Subcommands:',
      '  watch [--db <path>] [--memory <dir>] [--interval <ms>] [--batch <n>]',
      '  process-once [--db <path>] [--memory <dir>] [--batch <n>]',
      '  status [--db <path>] [--offset-db <path>]',
      '',
      'Env vars:',
      '  CAIA_EVENT_BUS_DB_PATH    events.sqlite path',
      '  CAIA_MEMORY_DIR           memory dir (proposals land in <dir>/proposals/)'
    ].join('\n')
  );
  process.exit(2);
}

/**
 * CLI dispatcher. Exported so tests can drive subcommands directly
 * without needing a child-process spawn.
 */
export async function main(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  const args = parseArgs(rest);
  switch (sub) {
    case 'watch':
      await watch(args);
      return;
    case 'process-once':
      await once(args);
      return;
    case 'status':
      status(args);
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
    console.error(`[mentor-fastpath] fatal: ${String(e)}`);
    process.exit(1);
  });
}
