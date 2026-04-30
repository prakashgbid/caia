/**
 * Deterministic command-allowlist proxy in front of an MCP server.
 *
 * Behaviour:
 *   1. Every JSON-RPC request from the agent is parsed.
 *   2. For `tools/call` requests, the proxy looks up the tool's allowance
 *      and validates the argument constraints (regex, enum, maxLength,
 *      forbid) against the supplied arguments.
 *   3. A `tools/call` to an unlisted tool, or one whose args fail
 *      validation, is rejected synchronously with a JSON-RPC error.
 *   4. Allowed requests are forwarded verbatim to the upstream MCP.
 *
 * Reference: caia/docs/mcp-security.md, third-party-paper §C.3.
 */

import {
  McpPolicySchema,
  ToolCallRequestSchema,
  type McpPolicy,
  type PolicyDecision,
  type ToolAllowance,
} from './policy.js';

export interface ProxyOptions {
  policy: McpPolicy;
  /** Optional per-task counter (in-memory by default). */
  counters?: Map<string, number>;
}

export class McpAllowlistProxy {
  private readonly policy: McpPolicy;
  private readonly counters: Map<string, number>;

  constructor(opts: ProxyOptions) {
    this.policy = McpPolicySchema.parse(opts.policy);
    this.counters = opts.counters ?? new Map();
  }

  get policyName(): string {
    return this.policy.name;
  }

  get pinnedSha(): string {
    return this.policy.pinnedSha;
  }

  /**
   * Return the decision the proxy would emit for a given JSON-RPC frame.
   * Pure function — does not forward, does not increment counters; use
   * `.consume()` once you have committed to forwarding.
   */
  inspect(rawFrame: unknown): PolicyDecision {
    const parsed = ToolCallRequestSchema.safeParse(rawFrame);
    if (!parsed.success) {
      // Non-`tools/call` traffic (initialize, list_tools, etc.) is allowed
      // through unchanged.
      return { kind: 'allow', toolName: '<non-tools/call>' };
    }
    const { name, arguments: args } = parsed.data.params;
    const tool = this.policy.tools.find((t) => t.name === name);
    if (!tool) {
      return {
        kind: 'deny',
        toolName: name,
        reason: `tool '${name}' is not on the allowlist for MCP '${this.policy.name}'`,
      };
    }
    const argResult = this.validateArgs(tool, args);
    if (argResult.kind === 'deny') {
      return argResult;
    }
    return { kind: 'allow', toolName: name };
  }

  /**
   * Atomic consume: inspect + (on allow) increment per-task counter +
   * enforce maxPerTask cap. Use this on the forwarding path.
   */
  consume(rawFrame: unknown, taskId: string): PolicyDecision {
    const decision = this.inspect(rawFrame);
    if (decision.kind === 'deny') return decision;
    if (decision.toolName === '<non-tools/call>') return decision;
    const tool = this.policy.tools.find((t) => t.name === decision.toolName);
    if (!tool || tool.maxPerTask === undefined) return decision;
    const key = `${taskId}|${decision.toolName}`;
    const used = this.counters.get(key) ?? 0;
    if (used >= tool.maxPerTask) {
      return {
        kind: 'deny',
        toolName: decision.toolName,
        reason: `per-task budget exceeded: tool='${decision.toolName}' task='${taskId}' used=${used} limit=${tool.maxPerTask}`,
      };
    }
    this.counters.set(key, used + 1);
    return decision;
  }

  /**
   * Build a JSON-RPC error frame the proxy emits when it denies a call.
   */
  static denyFrame(id: string | number, decision: PolicyDecision): {
    jsonrpc: '2.0';
    id: string | number;
    error: { code: number; message: string };
  } {
    if (decision.kind !== 'deny') {
      throw new Error('denyFrame called with allow decision');
    }
    return {
      jsonrpc: '2.0',
      id,
      error: {
        // -32001 — application-specific JSON-RPC error code
        code: -32001,
        message: `mcp-allowlist-proxy: ${decision.reason}`,
      },
    };
  }

  private validateArgs(
    tool: ToolAllowance,
    args: Record<string, unknown>,
  ): PolicyDecision {
    for (const [path, constraint] of Object.entries(tool.argsConstraints)) {
      const value = pluck(args, path);
      switch (constraint.kind) {
        case 'regex': {
          if (typeof value !== 'string') {
            return {
              kind: 'deny',
              toolName: tool.name,
              reason: `arg '${path}' must be a string for regex constraint`,
            };
          }
          if (!compilePattern(constraint.pattern).test(value)) {
            return {
              kind: 'deny',
              toolName: tool.name,
              reason: `arg '${path}'='${truncate(value)}' does not match required pattern /${constraint.pattern}/`,
            };
          }
          break;
        }
        case 'enum': {
          if (typeof value !== 'string' || !constraint.values.includes(value)) {
            return {
              kind: 'deny',
              toolName: tool.name,
              reason: `arg '${path}'='${String(value)}' not one of [${constraint.values.join(', ')}]`,
            };
          }
          break;
        }
        case 'maxLength': {
          if (typeof value !== 'string') {
            return {
              kind: 'deny',
              toolName: tool.name,
              reason: `arg '${path}' must be a string for maxLength constraint`,
            };
          }
          if (value.length > constraint.value) {
            return {
              kind: 'deny',
              toolName: tool.name,
              reason: `arg '${path}' length=${value.length} exceeds maxLength=${constraint.value}`,
            };
          }
          break;
        }
        case 'forbid': {
          if (typeof value === 'string' && compilePattern(constraint.pattern).test(value)) {
            return {
              kind: 'deny',
              toolName: tool.name,
              reason: `arg '${path}' matches forbidden pattern /${constraint.pattern}/`,
            };
          }
          break;
        }
      }
    }
    return { kind: 'allow', toolName: tool.name };
  }
}

/**
 * Build a RegExp from a pattern string. Supports the `(?i)` POSIX-style
 * inline-flag prefix for case-insensitive matching (which JavaScript's
 * native RegExp parser doesn't), since that's the form most operators
 * write into policy files.
 */
function compilePattern(pattern: string): RegExp {
  let flags = '';
  let body = pattern;
  while (body.startsWith('(?')) {
    const close = body.indexOf(')');
    if (close === -1 || close > 6) break;
    const flagBlob = body.slice(2, close);
    if (!/^[imsux]+$/.test(flagBlob)) break;
    flags += flagBlob;
    body = body.slice(close + 1);
  }
  return new RegExp(body, flags);
}

/** Resolve a dotted path against a nested object. */
function pluck(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function truncate(s: string, n = 80): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '…';
}
