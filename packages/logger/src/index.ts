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

export function createLogger(options: LoggerOptions): Logger {
  const { name, level = 'info' } = options;
  const levels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  const minIdx = levels.indexOf(level);

  function emit(msgLevel: LogLevel, msg: string, ctx?: LogContext): void {
    if (levels.indexOf(msgLevel) < minIdx) return;
    const entry = {
      level: msgLevel,
      time: new Date().toISOString(),
      name,
      msg,
      ...ctx,
    };
    const out = msgLevel === 'error' || msgLevel === 'fatal' ? process.stderr : process.stdout;
    out.write(JSON.stringify(entry) + '\n');
  }

  function makeLogger(bindings: LogContext = {}): Logger {
    return {
      trace: (msg, ctx) => emit('trace', msg, { ...bindings, ...ctx }),
      debug: (msg, ctx) => emit('debug', msg, { ...bindings, ...ctx }),
      info: (msg, ctx) => emit('info', msg, { ...bindings, ...ctx }),
      warn: (msg, ctx) => emit('warn', msg, { ...bindings, ...ctx }),
      error: (msg, ctx) => emit('error', msg, { ...bindings, ...ctx }),
      fatal: (msg, ctx) => emit('fatal', msg, { ...bindings, ...ctx }),
      child: (childBindings) => makeLogger({ ...bindings, ...childBindings }),
    };
  }

  return makeLogger();
}
