/**
 * SAFETY-003 — bridge from `@chiefaia/tool-output-sanitizer` to the
 * broker's `ToolResultSanitizer` plug-in shape.
 *
 * Two consumers:
 *   1. The executor's broker integration (when claude's postToolUse hook
 *      asks us for a sanitized result substitution).
 *   2. The orchestrator's own MCP server (when it returns tool results
 *      to a calling agent).
 *
 * Per the SAFETY-003 spec, strictness is per-source:
 *   - `paranoid` — web fetches and any unknown source.
 *   - `lenient`  — vendored first-party MCPs (mac-mcp, stolution-remote,
 *                  conductor).
 *
 * Audit-logs every flagged stripping via the supplied logger.
 */

import {
  sanitizeToolResult,
  sanitizeMcpToolResult,
  type Strictness,
  type SanitizedResult,
} from '@chiefaia/tool-output-sanitizer';

/** Broker plug-in shape — kept as a structural import to avoid coupling. */
export interface ToolResultSanitizerInput {
  toolName: string;
  toolArgs: Record<string, unknown>;
  result: unknown;
  taskId: string;
  agentRole: string;
}
export interface ToolResultSanitizerOutput {
  sanitizedResult?: unknown;
  flags: SanitizedResult['flags'];
  rejected: boolean;
}

/** Tool-name → strictness lookup. Add new vendored sources here. */
export const VENDORED_LENIENT_TOOLS = new Set<string>([
  // mac-mcp surface
  'mac_bash',
  'mac_read_file',
  'mac_write_file',
  'mac_list_dir',
  'mac_grep',
  'mac_git',
  // stolution-remote surface
  'stolution_bash',
  'stolution_read_file',
  'stolution_write_file',
  'stolution_list_dir',
  'stolution_grep',
  'stolution_git',
  'stolution_db_query',
  'stolution_db_schema',
  'stolution_docker_logs',
  'stolution_docker_ps',
  'stolution_pm2_list',
  'stolution_pm2_logs',
  'stolution_pm2_restart',
  'stolution_vault_get',
  'stolution_vault_list',
]);

/** Tool-name → strictness lookup for known web/HTTP fetches → paranoid. */
export const PARANOID_TOOLS = new Set<string>([
  'WebFetch',
  'WebSearch',
  'fetch',
  'http_get',
  'http_post',
]);

export function strictnessFor(toolName: string): Strictness {
  if (PARANOID_TOOLS.has(toolName)) return 'paranoid';
  if (VENDORED_LENIENT_TOOLS.has(toolName)) return 'lenient';
  // Unknown source → paranoid (fail-closed).
  return 'paranoid';
}

export interface BridgeOptions {
  /** Override per-tool strictness lookup (test seam). */
  strictnessFor?: (toolName: string) => Strictness;
  /**
   * Optional audit-log sink. Called once per sanitize call with the
   * flag list. Failures are swallowed.
   */
  auditLog?: (entry: {
    taskId: string;
    agentRole: string;
    toolName: string;
    strictness: Strictness;
    flags: SanitizedResult['flags'];
    rejected: boolean;
    tsMsEpoch: number;
  }) => void;
}

/**
 * Build a `ToolResultSanitizer` function suitable for handing to the
 * broker's `HookControlledMode` constructor or to the MCP server's
 * outbound result wrapping.
 */
export function buildToolResultSanitizer(
  opts: BridgeOptions = {},
): (input: ToolResultSanitizerInput) => ToolResultSanitizerOutput {
  const lookup = opts.strictnessFor ?? strictnessFor;
  const audit = opts.auditLog;
  return (input: ToolResultSanitizerInput): ToolResultSanitizerOutput => {
    const strictness = lookup(input.toolName);
    // If the result already looks like an MCP `tools/call` envelope,
    // sanitize each block. Otherwise treat as a raw payload.
    const isMcpEnvelope =
      typeof input.result === 'object' &&
      input.result !== null &&
      'content' in (input.result as object) &&
      Array.isArray((input.result as { content: unknown }).content);

    let payload: unknown;
    let flags: SanitizedResult['flags'];
    let rejected: boolean;

    if (isMcpEnvelope) {
      const r = sanitizeMcpToolResult(input.result, { strictness });
      payload = r.result;
      flags = r.flags;
      rejected = r.rejected;
    } else {
      const r = sanitizeToolResult(input.result, { strictness });
      payload = r.payload;
      flags = r.flags;
      rejected = r.rejected;
    }

    if (audit && flags.length > 0) {
      try {
        audit({
          taskId: input.taskId,
          agentRole: input.agentRole,
          toolName: input.toolName,
          strictness,
          flags,
          rejected,
          tsMsEpoch: Date.now(),
        });
      } catch { /* never break the hook */ }
    }

    return {
      sanitizedResult: payload,
      flags,
      rejected,
    };
  };
}

/**
 * Convenience for the orchestrator's MCP server — wrap a single
 * outbound tool-result envelope.
 *
 * Errors are swallowed (defaulting to the raw result) since the MCP
 * server's wrapping must never fail the underlying tool call.
 */
export function sanitizeOutboundMcpResult<T extends { content: Array<Record<string, unknown>> }>(
  envelope: T,
  ctx: { toolName: string; taskId: string; agentRole: string; toolArgs?: Record<string, unknown> },
  opts: BridgeOptions = {},
): T {
  try {
    const fn = buildToolResultSanitizer(opts);
    const out = fn({
      toolName: ctx.toolName,
      toolArgs: ctx.toolArgs ?? {},
      result: envelope,
      taskId: ctx.taskId,
      agentRole: ctx.agentRole,
    });
    if (out.sanitizedResult && typeof out.sanitizedResult === 'object' && out.sanitizedResult !== null) {
      return out.sanitizedResult as T;
    }
    return envelope;
  } catch {
    return envelope;
  }
}
