/**
 * Conductor structured logger — Pino-based.
 * Every module imports createLogger(moduleName) from here.
 *
 * Fields included on every log line:
 *   time, level, msg, module, correlation_id, trace_id, actor,
 *   stage, entity_id, project, domain, build_run_id?, build_step_id?
 *
 * Sinks: stdout (JSON) + rotating file at
 *   ~/Documents/conductor-logs/<module>-<date>.log
 */

import pino from 'pino';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const LOG_DIR = process.env['CONDUCTOR_LOG_DIR']
  ?? path.join(os.homedir(), 'Documents', 'conductor-logs');

function ensureLogDir(): void {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* already exists */ }
}

function logFilePath(moduleName: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${moduleName}-${date}.log`);
}

// Base log level — override via CONDUCTOR_LOG_LEVEL env
const LOG_LEVEL = (process.env['CONDUCTOR_LOG_LEVEL'] ?? 'info') as pino.Level;

export interface LogContext {
  correlation_id?: string;
  trace_id?: string;
  actor?: string;
  stage?: string;
  entity_id?: string;
  project?: string;
  domain?: string;
  build_run_id?: string;
  build_step_id?: string;
  [key: string]: unknown;
}

export type ConductorLogger = pino.Logger<string>;

const _loggers = new Map<string, ConductorLogger>();

/** @no-events — logger factory is infrastructure, not a domain operation */
export function createLogger(moduleName: string, ctx?: LogContext): ConductorLogger {
  const cacheKey = moduleName;
  if (_loggers.has(cacheKey)) {
    const base = _loggers.get(cacheKey)!;
    return ctx ? base.child(ctx as Record<string, unknown>) : base;
  }

  ensureLogDir();

  const streams: pino.StreamEntry[] = [
    { stream: process.stdout, level: LOG_LEVEL },
  ];

  // Only add file stream if we can write to log dir
  try {
    const fileStream = pino.destination({
      dest: logFilePath(moduleName),
      sync: false,
      mkdir: true,
    });
    streams.push({ stream: fileStream, level: LOG_LEVEL });
  } catch {
    // Non-fatal — stdout only
  }

  const logger = pino(
    {
      level: LOG_LEVEL,
      base: { module: moduleName },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level(label) { return { level: label }; },
      },
    },
    pino.multistream(streams, { dedupe: false }),
  ) as ConductorLogger;

  _loggers.set(cacheKey, logger);
  return ctx ? logger.child(ctx as Record<string, unknown>) : logger;
}

/** @no-events — infrastructure flush utility */
export function flushLoggers(): Promise<void> {
  return new Promise(resolve => {
    const loggers = Array.from(_loggers.values());
    let pending = loggers.length;
    if (pending === 0) { resolve(); return; }
    for (const logger of loggers) {
      logger.flush(() => { if (--pending === 0) resolve(); });
    }
  });
}
