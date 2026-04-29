import pino from 'pino';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * HARDEN-007: shared redaction defaults applied to every logger created
 * via `createLogger({ ..., includeDefaultRedactPaths: true })`. Chosen
 * to cover the secrets we know flow through the orchestrator + workers:
 *
 *   - vault tokens (broker auth + raw vault tokens)
 *   - github_pat (Coding Agent's git operations)
 *   - generic auth headers + api keys + bearer tokens
 *   - cookies / sessions
 *   - the `value` / `secret` / `password` field names used by
 *     @chiefaia/secrets-broker payloads
 *
 * The list is intentionally conservative; hosts can OPT OUT by leaving
 * `includeDefaultRedactPaths` unset (default false to preserve existing
 * behaviour). Add additional patterns via the per-host `redactPaths`
 * array — the two are concatenated.
 */
export const DEFAULT_REDACT_PATHS: readonly string[] = Object.freeze([
  // Field names commonly carrying secrets.
  'value', '*.value', '*.*.value',
  'secret', '*.secret', '*.*.secret',
  'password', '*.password',
  'token', '*.token', '*.*.token',
  'apiKey', '*.apiKey',
  'api_key', '*.api_key',
  'authorization', '*.authorization',
  'cookie', '*.cookie',
  'session', '*.session',
  // Stolution-specific.
  'vault_token', '*.vault_token',
  'vaultToken', '*.vaultToken',
  'github_pat', '*.github_pat',
  'githubPat', '*.githubPat',
  // HTTP request/response structured logs (pino convention).
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-vault-token"]',
  'res.headers["set-cookie"]',
]);

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

/**
 * Hook fired AFTER a warn/error/fatal log line is emitted, with the merged
 * (bindings ∪ ctx) view of the structured fields. Used by the bus transport
 * to fan warn/error lines onto `system.error` events without coupling
 * `@chiefaia/logger` to the event bus directly. Errors thrown from the hook
 * are swallowed — observability must never break the caller.
 */
export type WarnOrErrorHook = (entry: {
  level: 'warn' | 'error' | 'fatal';
  msg: string;
  fields: LogContext;
  loggerName: string;
}) => void;

export interface LoggerOptions {
  readonly name: string;
  readonly level?: LogLevel;
  readonly pretty?: boolean;
  /**
   * Field paths to redact from emitted log lines, e.g. ['value', '*.secret'].
   * Forwarded directly to pino's `redact.paths` option. The censor token is
   * always `[REDACTED]`.
   */
  readonly redactPaths?: readonly string[];
  /**
   * HARDEN-007: include the shared DEFAULT_REDACT_PATHS list in addition
   * to the per-host `redactPaths`. Default false to preserve existing
   * behaviour for hosts that haven't migrated.
   */
  readonly includeDefaultRedactPaths?: boolean;
  /**
   * Optional hook invoked after every warn/error/fatal log line, with the
   * merged structured-field view (bindings ∪ ctx). Designed to be wired to
   * the event bus by the host app so warn/error lines fan out as
   * `system.error` events. Hook errors are swallowed.
   */
  readonly onWarnOrError?: WarnOrErrorHook;
}

function fireHook(
  hook: WarnOrErrorHook | undefined,
  loggerName: string,
  level: 'warn' | 'error' | 'fatal',
  msg: string,
  bindings: LogContext,
  ctx: LogContext | undefined,
): void {
  if (!hook) return;
  try {
    hook({
      level,
      msg,
      loggerName,
      fields: ctx ? { ...bindings, ...ctx } : { ...bindings },
    });
  } catch {
    // Swallow — never let the bus transport break the caller.
  }
}

function wrapPino(
  p: pino.Logger,
  loggerName: string,
  bindings: LogContext,
  hook: WarnOrErrorHook | undefined,
): Logger {
  return {
    trace: (msg, ctx) => (ctx ? p.trace(ctx, msg) : p.trace(msg)),
    debug: (msg, ctx) => (ctx ? p.debug(ctx, msg) : p.debug(msg)),
    info: (msg, ctx) => (ctx ? p.info(ctx, msg) : p.info(msg)),
    warn: (msg, ctx) => {
      if (ctx) p.warn(ctx, msg);
      else p.warn(msg);
      fireHook(hook, loggerName, 'warn', msg, bindings, ctx);
    },
    error: (msg, ctx) => {
      if (ctx) p.error(ctx, msg);
      else p.error(msg);
      fireHook(hook, loggerName, 'error', msg, bindings, ctx);
    },
    fatal: (msg, ctx) => {
      if (ctx) p.fatal(ctx, msg);
      else p.fatal(msg);
      fireHook(hook, loggerName, 'fatal', msg, bindings, ctx);
    },
    child: (childBindings) =>
      wrapPino(
        p.child(childBindings as Record<string, unknown>),
        loggerName,
        { ...bindings, ...childBindings },
        hook,
      ),
  };
}

export function createLogger(options: LoggerOptions): Logger {
  const { name, level = 'info', pretty = false, redactPaths, includeDefaultRedactPaths = false, onWarnOrError } = options;

  const transport =
    pretty
      ? pino.transport({ target: 'pino-pretty', options: { colorize: true } })
      : undefined;

  const pinoOpts: pino.LoggerOptions = {
    name,
    level,
    // Emit level as string label so consumers see 'info' not 30
    formatters: {
      level: (label) => ({ level: label }),
    },
  };
  // HARDEN-007: prepend DEFAULT_REDACT_PATHS when opted-in. Hosts that
  // pass includeDefaultRedactPaths: true get the shared baseline automatically.
  const mergedRedact: string[] = [
    ...(includeDefaultRedactPaths ? DEFAULT_REDACT_PATHS : []),
    ...(redactPaths ?? []),
  ];
  if (mergedRedact.length > 0) {
    pinoOpts.redact = { paths: mergedRedact, censor: '[REDACTED]' };
  }
  const instance = pino(pinoOpts, transport);

  return wrapPino(instance, name, {}, onWarnOrError);
}

// ─── Bus transport ───────────────────────────────────────────────────────────

/**
 * Minimal contract a host app's event-bus must satisfy for the logger transport.
 * Kept structural to avoid coupling `@chiefaia/logger` to the bus package.
 */
export interface LoggerEventBus {
  publish(partial: {
    type: 'system.error';
    actor: string;
    correlation_id?: string;
    causation_id?: string;
    entity_type?: string;
    entity_id?: string;
    project_slug?: string;
    domain_slugs?: string[];
    payload: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    severity?: 'warning' | 'error';
  }): unknown;
}

export interface BusTransportOptions {
  readonly bus: LoggerEventBus;
  /** Actor recorded on every emitted system.error event. */
  readonly actor: string;
  /**
   * Optional list of LoggerName prefixes to drop. Used by `apps/pipeline-pulse`
   * to silence its own emitter, and by tests to avoid recursion when the
   * transport itself logs.
   */
  readonly excludeLoggerNames?: readonly string[];
}

/**
 * Build a `WarnOrErrorHook` that publishes a `system.error` bus event for
 * every warn/error/fatal log line emitted via the logger.
 *
 * Severity mapping: warn → 'warning', error/fatal → 'error'.
 *
 * The hook extracts `correlation_id`, `causation_id`, `project_slug`,
 * `entity_type`, `entity_id` from the log line's structured fields when
 * present; everything else lands inside `payload` so we don't lose context.
 */
export function busTransport(options: BusTransportOptions): WarnOrErrorHook {
  const { bus, actor, excludeLoggerNames = [] } = options;
  const exclude = new Set(excludeLoggerNames);

  return ({ level, msg, fields, loggerName }) => {
    if (exclude.has(loggerName)) return;
    const fieldRecord = fields as Record<string, unknown>;
    const {
      correlation_id,
      causation_id,
      project_slug,
      entity_type,
      entity_id,
      domain_slugs,
      ...rest
    } = fieldRecord;

    const partial: Parameters<LoggerEventBus['publish']>[0] = {
      type: 'system.error',
      actor,
      severity: level === 'warn' ? 'warning' : 'error',
      payload: {
        level,
        msg,
        logger: loggerName,
        ...rest,
      },
    };
    if (typeof correlation_id === 'string') partial.correlation_id = correlation_id;
    if (typeof causation_id === 'string') partial.causation_id = causation_id;
    if (typeof project_slug === 'string') partial.project_slug = project_slug;
    if (typeof entity_type === 'string') partial.entity_type = entity_type;
    if (typeof entity_id === 'string') partial.entity_id = entity_id;
    if (Array.isArray(domain_slugs)) {
      partial.domain_slugs = domain_slugs.filter(
        (d): d is string => typeof d === 'string',
      );
    }
    bus.publish(partial);
  };
}
