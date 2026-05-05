#!/usr/bin/env node
/**
 * CLI entrypoint for the Mentor event bus.
 *
 * Subcommands:
 *   tail [--type <T>] [--correlation <id>] [--since <offset>] [--interval <ms>]
 *     Live-tail the events.sqlite. Polls every `interval` ms (default 1000).
 *
 *   record-correction "<text>" [--context "<ctx>"] [--mode manual|regex|llm]
 *     Emit OperatorCorrection. The first positional arg is the correction
 *     text; --context lets the operator attach the chat-message that
 *     prompted the correction.
 *
 *   serve [--port <P>] [--host <H>]
 *     Start the HTTP server (cross-machine ingestion). Used by the
 *     LaunchAgent in PR-δ.
 *
 *   count [--type <T>] [--since-iso <ISO>]
 *     Print a one-line JSON count. Useful for status dashboards / CI checks.
 *
 * The events.sqlite path defaults to:
 *   ${LOCAL_PREVIEW_INSTALL_ROOT or $HOME}/Library/Application Support/caia/events/events.sqlite
 *
 * Override via $CAIA_EVENT_BUS_DB_PATH (also used by the LaunchAgent in PR-δ).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { Client } from './client.js';
import { startServer } from './server.js';
import { loadSecret } from './auth.js';
import { openDatabase, queryEvents } from './sqlite.js';
import { startMemoryWatcher } from './memory-watcher.js';
import type { EmittedEvent } from './types.js';
import type { OperatorCorrectionPayload } from './types.js';

const DEFAULT_DB_PATH = join(
  homedir(),
  'Library',
  'Application Support',
  'caia',
  'events',
  'events.sqlite'
);

function defaultDbPath(): string {
  return process.env['CAIA_EVENT_BUS_DB_PATH'] ?? DEFAULT_DB_PATH;
}

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

async function tail(args: Argv): Promise<void> {
  const dbPath = args.flags['db'] ?? defaultDbPath();
  const interval = Number(args.flags['interval'] ?? 1000);
  const filterType = args.flags['type'];
  const filterCorrelation = args.flags['correlation'];
  let lastOffset = Number(args.flags['since'] ?? 0);

  const db = openDatabase(dbPath, undefined, true);
  console.log(`[tail] watching ${dbPath} (interval=${interval}ms, since=${lastOffset})`);
  let aborted = false;
  process.on('SIGINT', () => {
    aborted = true;
  });
  process.on('SIGTERM', () => {
    aborted = true;
  });

  while (!aborted) {
    const opts: Parameters<typeof queryEvents>[1] = {
      sinceOffset: lastOffset,
      limit: 1000,
      order: 'asc'
    };
    if (filterType) opts.eventType = filterType;
    if (filterCorrelation) opts.correlationId = filterCorrelation;

    const rows = queryEvents(db, opts);
    for (const row of rows) {
      printRow(row);
      lastOffset = Math.max(lastOffset, row.ingest_offset);
    }
    await sleep(interval);
  }
  db.close();
}

function printRow(row: ReturnType<typeof queryEvents>[number]): void {
  const summary = {
    offset: row.ingest_offset,
    type: row.event_type,
    at: row.emitted_at,
    host: row.hostname,
    proc: row.process_name,
    correlation: row.correlation_id,
    parent: row.parent_event_id,
    schemaVersion: row.schema_version,
    validation: row.validation_failed === 1 ? 'failed' : 'ok',
    payload: safeParse(row.payload_json)
  };
  console.log(JSON.stringify(summary));
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recordCorrection(args: Argv): Promise<void> {
  const text = args.positional[0];
  if (!text) {
    console.error('usage: caia-mentor record-correction "<text>" [--context "<ctx>"] [--mode manual|regex|llm]');
    process.exit(2);
  }

  const dbPath = args.flags['db'] ?? defaultDbPath();
  const mode = args.flags['mode'];
  const detectionMode: 'manual' | 'regex' | 'llm' =
    mode === 'regex' || mode === 'llm' ? mode : 'manual';

  const client = new Client({
    dbPath,
    processName: 'caia-mentor-cli'
  });
  const payload: OperatorCorrectionPayload = {
    correctionText: text,
    detectionMode
  };
  const ctx = args.flags['context'];
  if (ctx) payload.context = ctx;
  const id = client.emit('OperatorCorrection', payload);
  client.close();

  if (id === null) {
    console.error('emit returned null — see warnings above');
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, id, mode: detectionMode }));
}

async function watchMemory(args: Argv): Promise<void> {
  const dbPath = args.flags['db'] ?? defaultDbPath();
  const memoryDir =
    args.flags['path'] ??
    process.env['CAIA_MEMORY_DIR'] ??
    join(homedir(), 'Documents', 'projects', 'caia', 'agent', 'memory');
  const debounceMs = Number(args.flags['debounce'] ?? 500);

  const client = new Client({
    dbPath,
    processName: 'caia-mentor-memory-watcher'
  });
  const watcher = startMemoryWatcher({
    client,
    rootDir: memoryDir,
    debounceMs
  });
  const stop = (): void => {
    watcher.close();
    client.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  await new Promise<void>(() => undefined);
}

async function serve(args: Argv): Promise<void> {
  const dbPath = args.flags['db'] ?? defaultDbPath();
  const host = args.flags['host'] ?? process.env['CAIA_EVENT_BUS_BIND'] ?? '127.0.0.1';
  const port = Number(args.flags['port'] ?? process.env['CAIA_EVENT_BUS_PORT'] ?? 5180);
  const secret = loadSecret();
  const db = openDatabase(dbPath, undefined, true);

  const running = await startServer({ db, host, port, secret });
  const stop = (): void => {
    running.close().then(() => {
      db.close();
      process.exit(0);
    });
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  await new Promise<void>(() => undefined);
}

function count(args: Argv): void {
  const dbPath = args.flags['db'] ?? defaultDbPath();
  const eventType = args.flags['type'];
  const sinceIso = args.flags['since-iso'];
  const db = openDatabase(dbPath, undefined, true);
  const opts: Parameters<typeof queryEvents>[1] = { limit: 1 };
  if (eventType) opts.eventType = eventType;
  if (sinceIso) opts.sinceIso = sinceIso;
  // Use a quick aggregate via SELECT COUNT(*) by re-using countEvents from sqlite.
  // We avoid importing countEvents to keep the CLI module bundle small;
  // queryEvents+limit:1 + a separate COUNT scan would do, but the counter
  // is nicer.
  const rows: EmittedEvent[] = [];
  for (const row of queryEvents(db, { ...opts, limit: 1 })) {
    rows.push({
      id: row.id,
      type: row.event_type,
      schemaVersion: row.schema_version,
      correlationId: row.correlation_id,
      parentEventId: row.parent_event_id,
      emittedAt: row.emitted_at,
      hostname: row.hostname,
      processName: row.process_name,
      payload: null,
      validationFailed: row.validation_failed === 1,
      ingestOffset: row.ingest_offset
    });
  }
  // Aggregate count via SQL.
  const where: string[] = [];
  const params: Record<string, string | number> = {};
  if (eventType) {
    where.push('event_type = @eventType');
    params['eventType'] = eventType;
  }
  if (sinceIso) {
    where.push('emitted_at >= @sinceIso');
    params['sinceIso'] = sinceIso;
  }
  const sql = `SELECT COUNT(*) AS n FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const r = db.prepare(sql).get(params) as { n: number } | undefined;
  const total = r?.n ?? 0;
  db.close();

  console.log(JSON.stringify({ count: total, eventType: eventType ?? null, sinceIso: sinceIso ?? null }));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const args = parseArgs(argv.slice(1));

  switch (cmd) {
    case 'tail':
      await tail(args);
      return;
    case 'record-correction':
      await recordCorrection(args);
      return;
    case 'serve':
      await serve(args);
      return;
    case 'watch-memory':
      await watchMemory(args);
      return;
    case 'count':
      count(args);
      return;
    default:
      console.error(
        'usage: caia-mentor {tail|record-correction|serve|count|watch-memory}\n' +
          '  Defaults can be overridden via env:\n' +
          '    CAIA_EVENT_BUS_DB_PATH        — events.sqlite path\n' +
          '    CAIA_EVENT_BUS_BIND           — server host (default 127.0.0.1)\n' +
          '    CAIA_EVENT_BUS_PORT           — server port (default 5180)\n' +
          '    CAIA_EVENT_BUS_SECRET[_PATH]  — HMAC shared secret (≥32 chars)\n' +
          '    CAIA_MEMORY_DIR               — agent/memory dir to watch'
      );
      process.exit(2);
  }
}

main().catch((err: unknown) => {
  console.error('[caia-mentor] fatal:', err);
  process.exit(1);
});
