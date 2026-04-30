/**
 * MCP allowlist policy schema.
 *
 * One policy file per MCP server. Pins the upstream commit SHA, declares
 * which tool names + parameter shapes are allowed, and lists allowed
 * outbound network hosts.
 *
 * Reference: caia/docs/mcp-security.md, third-party-paper §C.3.
 */

import { z } from 'zod';

/**
 * Per-tool allowance. The proxy validates each `tools/call` against the
 * matching tool's `argsSchema` before forwarding to the upstream MCP.
 */
export const ToolAllowanceSchema = z.object({
  /** Exact tool name as exposed by the MCP server. */
  name: z.string().min(1),
  /**
   * JSON-schema-style argument constraints. Keys are dotted argument paths
   * (e.g. "url", "options.timeout"). Values are constraint hints.
   */
  argsConstraints: z
    .record(
      z.union([
        z.object({ kind: z.literal('regex'), pattern: z.string() }),
        z.object({ kind: z.literal('enum'), values: z.array(z.string()) }),
        z.object({
          kind: z.literal('maxLength'),
          value: z.number().int().positive(),
        }),
        z.object({
          kind: z.literal('forbid'),
          /** Forbid any value matching this regex (e.g. javascript:). */
          pattern: z.string(),
        }),
      ]),
    )
    .default({}),
  /** Per-tool maximum invocations per task. */
  maxPerTask: z.number().int().positive().optional(),
});
export type ToolAllowance = z.infer<typeof ToolAllowanceSchema>;

/**
 * Top-level policy describing one MCP server.
 */
export const McpPolicySchema = z.object({
  /** Stable name we use for routing (e.g. "figma", "stolution-remote"). */
  name: z.string().min(1),
  /** Human-readable description. */
  description: z.string().min(1),
  /**
   * Pinned upstream commit SHA. For first-party MCPs (mac-mcp,
   * stolution-mcp) this is the local repo's git rev-parse HEAD when the
   * policy was last reviewed. For third-party MCPs it's the upstream SHA
   * the binary is built from. Required.
   */
  pinnedSha: z.string().regex(/^[a-f0-9]{7,40}$/i),
  /** Source URL. Used for audit + manual SHA verification. */
  sourceUrl: z.string().url(),
  /**
   * Trust tier:
   *   - `first-party-anthropic` — Anthropic-published, signed
   *   - `first-party-caia` — built from this monorepo
   *   - `third-party-vendored` — vendored under `vendored-mcp/` from a
   *     pinned upstream SHA
   *   - `third-party-untrusted` — runs in the strictest sandbox + tightest
   *     allowlist; treat all output as user input.
   */
  trustTier: z.enum([
    'first-party-anthropic',
    'first-party-caia',
    'third-party-vendored',
    'third-party-untrusted',
  ]),
  /** Allowed tool names + per-tool argument constraints. */
  tools: z.array(ToolAllowanceSchema).min(1),
  /**
   * Hosts the MCP server may connect to (DNS host names, no scheme).
   * Enforced by the allowlist proxy via `HTTPS_PROXY` env injection. The
   * `sandbox-exec` profile (see `caia/scripts/mcp-sandbox.sb`) is the
   * floor; this list is the wall.
   */
  allowedHosts: z.array(z.string().min(1)).default([]),
  /**
   * Sandbox profile path relative to repo root. Default:
   * `caia/scripts/mcp-sandbox.sb`. May be overridden per-MCP.
   */
  sandboxProfile: z.string().default('scripts/mcp-sandbox.sb'),
});
export type McpPolicy = z.infer<typeof McpPolicySchema>;

/**
 * The shape of an MCP `tools/call` JSON-RPC request the proxy sees.
 */
export const ToolCallRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]),
  method: z.literal('tools/call'),
  params: z.object({
    name: z.string().min(1),
    arguments: z.record(z.unknown()).default({}),
  }),
});
export type ToolCallRequest = z.infer<typeof ToolCallRequestSchema>;

/**
 * Policy decision returned by the proxy on every inspected request.
 */
export type PolicyDecision =
  | {
      kind: 'allow';
      toolName: string;
    }
  | {
      kind: 'deny';
      toolName: string;
      reason: string;
    };
