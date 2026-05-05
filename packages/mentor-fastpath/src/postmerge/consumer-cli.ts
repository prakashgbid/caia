#!/usr/bin/env node
/**
 * CLI entrypoint for the postmerge consumer.
 *
 * Subcommands:
 *
 *   watch [--db <path>] [--offset <path>] [--memory <dir>] [--interval-ms 30000]
 *     Long-running poll loop. Subscribes to PRMerged / RegressionDetected
 *     / EvidenceGateFailure events on the bus and writes proposals.
 *
 *   process-once [...same flags]
 *     One iteration, then exit. Useful for cron + Stage-6 verify.
 *
 *   status [--offset <path>]
 *     Print one-line JSON: {lastOffset, processedCount, offsetDbPath}.
 *
 * Defaults:
 *   --db      $CAIA_EVENT_BUS_DB_PATH or
 *             ~/Library/Application Support/caia/events/events.sqlite
 *   --offset  ${db}.postmerge-consumer-offset.sqlite
 *   --memory  $CAIA_MEMORY_DIR
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  countProcessed,
  getLastProcessedOffset,
  openOffsetDb
} from '../offset-store.js';
import {
  DEFAULT_POSTMERGE_POLL_INTERVAL_MS,
  processPostMergeOnce,
  runPostMergeConsumer
} from './consumer.js';

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

function defaultOffsetPath(busDb: string): string {
  return `${busDb}.postmerge-consumer-offset.sqlite`;
}

function resolveMemoryDir(args: Argv): string {
  const flag = args.flags['memory'];
  if (flag) return flag;
  const env = process.env['CAIA_MEMORY_DIR'];
  if (env) return env;
  console.error(
    '--memory <dir> is required (or set CAIA_MEMORY_DIR env var)'
  );
  process.exit(2);
}

async function watchCmd(args: Argv): Promise<void> {
  const busDb = args.flags['db'] ?? defaultBusDbPath();
  const offsetDb = args.flags['offset'] ?? defaultOffsetPath(busDb);
  const memory = resolveMemoryDir(args);
  const intervalMs = Number(
    args.flags['interval-ms'] ?? DEFAULT_POSTMERGE_POLL_INTERVAL_MS
  );

  const ac = new AbortController();
  const stop = (): void => {
    ac.abort();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  await runPostMergeConsumer({
    eventsDbPath: busDb,
    offsetDbPath: offsetDb,
    memoryDir: memory,
    pollIntervalMs: intervalMs,
    abortSignal: ac.signal
  });
}

async function processOnceCmd(args: Argv): Promise<void> {
  const busDb = args.flags['db'] ?? defaultBusDbPath();
  const offsetDb = args.flags['offset'] ?? defaultOffsetPath(busDb);
  const memory = resolveMemoryDir(args);
  const stats = await processPostMergeOnce({
    eventsDbPath: busDb,
    offsetDbPath: offsetDb,
    memoryDir: memory
  });
  console.log(JSON.stringify({ ok: true, ...stats }));
}

function statusCmd(args: Argv): void {
  const busDb = args.flags['db'] ?? defaultBusDbPath();
  const offsetDbPath = args.flags['offset'] ?? defaultOffsetPath(busDb);
  const offsetDb = openOffsetDb(offsetDbPath);
  try {
    const lastOffset = getLastProcessedOffset(offsetDb);
    const processedCount = countProcessed(offsetDb);
    console.log(JSON.stringify({ lastOffset, processedCount, offsetDbPath }));
  } finally {
    offsetDb.close();
  }
}

function usage(): never {
  console.error(
    [
      'Usage: caia-postmerge-consumer <subcommand> [flags]',
      '',
      'Subcommands:',
      '  watch         Long-running poll loop (LaunchAgent-friendly).',
      '  process-once  One iteration, then exit.',
      '  status        Print one-line JSON: lastOffset + processedCount.',
      '',
      'Flags:',
      '  --db <path>           events.sqlite (default: $CAIA_EVENT_BUS_DB_PATH)',
      '  --offset <path>       offset-store DB (default: <db>.postmerge-consumer-offset.sqlite)',
      '  --memory <dir>        agent/memory dir (default: $CAIA_MEMORY_DIR)',
      '  --interval-ms 30000   poll interval (watch only)'
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
    case 'process-once':
      await processOnceCmd(args);
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
    console.error(`[caia-postmerge-consumer] fatal: ${String(e)}`);
    process.exit(1);
  });
}
