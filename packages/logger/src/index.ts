import pino from 'pino';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogContext {
  readonly [key: string]: unknown;
}

export interface Logger {
  trace(msg: string, ctx?: LogContext): void;
  debug(msg: string, ctx?: LogContext): void;
  info(msg: string, ctx?: LogContext): void;
  warn(msg: string, ctx?: LogContext): void;
  error(msg: string, ctx?: LogContext): void;
  fatal(msg: string, ctx?: LogContext): void;
  child(bindings: LogContext): Logger;
}

export interface LoggerOptions {
  readonly name: string;
  readonly level?: LogLevel;
  readonly pretty?: boolean;
}

function wrapPino(p: pino.Logger): Logger {
  return {
    trace: (msg, ctx) => (ctx ? p.trace(ctx, msg) : p.trace(msg)),
    debug: (msg, ctx) => (ctx ? p.debug(ctx, msg) : p.debug(msg)),
    info: (msg, ctx) => (ctx ? p.info(ctx, msg) : p.info(msg)),
    warn: (msg, ctx) => (ctx ? p.warn(ctx, msg) : p.warn(msg)),
    error: (msg, ctx) => (ctx ? p.error(ctx, msg) : p.error(msg)),
    fatal: (msg, ctx) => (ctx ? p.fatal(ctx, msg) : p.fatal(msg)),
    child: (bindings) => wrapPino(p.child(bindings as Record<string, unknown>)),
  };
}

export function createLogger(options: LoggerOptions): Logger {
  const { name, level = 'info', pretty = false } = options;

  const transport =
    pretty
      ? pino.transport({ target: 'pino-pretty', options: { colorize: true } })
      : undefined;

  const instance = pino(
    {
      name,
      level,
      // Emit level as string label so consumers see 'info' not 30
      formatters: {
        level: (label) => ({ level: label }),
      },
    },
    transport,
  );

  return wrapPino(instance);
}
