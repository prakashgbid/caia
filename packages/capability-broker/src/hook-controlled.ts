/**
 * Hook-controlled permission mode adapter (per v2 §3.8).
 *
 * Replaces the Coding Agent's `--permission-mode bypassPermissions` with
 * `--permission-mode hook-controlled --hook-pre-tool-use=$BROKER_BIN preToolUse
 *  --hook-post-tool-use=$BROKER_BIN postToolUse`.
 *
 * Claude Code calls the hook scripts on every tool use, passing a JSON
 * frame on stdin and reading a JSON decision from stdout. The hook
 * scripts route through this adapter to the broker — typically over a
 * local Unix socket.
 *
 * This module is the in-process side: it encodes the decision logic so
 * the same code path is used in unit tests + in the hook subprocess.
 *
 * Reference: caia/docs/capability-broker.md §"Hook-controlled mode",
 * v2 §3.8.
 */

import type { CapabilityName } from './types.js';
import { CapabilityBrokerError, type CapabilityBroker } from './broker.js';
import { CapabilityGuardError } from './runtime-guard.js';
import {
  assertCapabilityForCommand,
  type GuardContext,
  type GuardRule,
} from './runtime-guard.js';

export interface HookPreToolUseInput {
  /** Claude Code session id. */
  sessionId: string;
  /** Tool the model is about to call. */
  toolName: string;
  /** Args the model passed to the tool (verbatim). */
  toolArgs: Record<string, unknown>;
  /** CAIA-side per-task id (passed via env to the hook). */
  taskId: string;
  /** Agent role (passed via env to the hook). */
  agentRole: string;
}

export interface HookPreToolUseOutput {
  /** Decision encoded for Claude Code's hook protocol. */
  decision: 'allow' | 'deny';
  /** Free-form reason; surfaced by Claude Code to the user / log. */
  reason: string;
  /**
   * Optional structured rejection. Used when `decision === 'deny'` to
   * give the orchestrator a queryable failure code.
   */
  details?: {
    capability?: CapabilityName;
    scope?: string;
    code?: string;
  };
}

export interface HookPostToolUseInput extends HookPreToolUseInput {
  /** Tool result the orchestrator captured (already executed). */
  result: unknown;
}

export interface HookPostToolUseOutput {
  /** Whether this execution should be added to the ledger. */
  recordToLedger: boolean;
  /** Optional sanitized result the orchestrator should substitute. */
  sanitizedResult?: unknown;
  /**
   * SAFETY-003: per-pattern flags emitted by the tool-output sanitizer
   * (e.g. "owasp-llm-01-prompt-injection"). The dashboard's "Tool output
   * rejected" page renders these. Empty when no sanitizer is wired.
   */
  sanitizerFlags?: ReadonlyArray<{
    id: string;
    description: string;
    action: 'stripped' | 'flagged' | 'rejected' | 'truncated';
    matchCount: number;
  }>;
  /** True when the entire payload was rejected and substituted with a stub. */
  sanitizerRejected?: boolean;
}

/**
 * SAFETY-003 sanitizer plug-in shape — a function that takes the raw
 * tool result + context and returns a sanitized payload + flags. The
 * caller (orchestrator) wires this in via {@link HookControlledOptions}.
 *
 * We keep the plug-in shape narrow so the broker doesn't need to depend
 * on `@chiefaia/tool-output-sanitizer`. The orchestrator imports both
 * and bridges them.
 */
export type ToolResultSanitizer = (input: {
  toolName: string;
  toolArgs: Record<string, unknown>;
  result: unknown;
  taskId: string;
  agentRole: string;
}) => {
  /** Substituted result. Falsy means "leave the result as-is". */
  sanitizedResult?: unknown;
  flags: ReadonlyArray<{
    id: string;
    description: string;
    action: 'stripped' | 'flagged' | 'rejected' | 'truncated';
    matchCount: number;
  }>;
  rejected: boolean;
};

export interface HookControlledOptions {
  broker: CapabilityBroker;
  /**
   * Map a (toolName, toolArgs) pair to a (cmd, argv) shape so the
   * runtime guard can pattern-match against `DEFAULT_GUARD_RULES`. The
   * orchestrator supplies this — different agent harnesses spell tool
   * calls differently.
   */
  toolToCommand: (
    toolName: string,
    toolArgs: Record<string, unknown>,
  ) => { cmd: string; args: readonly string[] } | null;
  /**
   * Tokens currently in scope for the task. Looked up by name. Sourced
   * from the broker's per-task token cache.
   */
  tokensFor: (taskId: string) => GuardContext;
  /** Optional override list of guard rules. Falls through to defaults. */
  guardRules?: readonly GuardRule[];
  /**
   * SAFETY-003: optional sanitizer. When set, every postToolUse call
   * runs the result through it and surfaces flags + a substituted
   * payload via {@link HookPostToolUseOutput}.
   */
  sanitizer?: ToolResultSanitizer;
  /**
   * SAFETY-003: optional audit-log sink for sanitizer flags. Called
   * synchronously per postToolUse; failures are swallowed to keep the
   * hook fast.
   */
  auditLog?: (entry: {
    taskId: string;
    agentRole: string;
    toolName: string;
    flags: ReadonlyArray<{
      id: string;
      action: 'stripped' | 'flagged' | 'rejected' | 'truncated';
      matchCount: number;
    }>;
    rejected: boolean;
    tsMsEpoch: number;
  }) => void;
}

export class HookControlledMode {
  private readonly broker: CapabilityBroker;
  private readonly toolToCommand: HookControlledOptions['toolToCommand'];
  private readonly tokensFor: HookControlledOptions['tokensFor'];
  private readonly guardRules: readonly GuardRule[] | undefined;
  private readonly sanitizer: ToolResultSanitizer | undefined;
  private readonly auditLog: HookControlledOptions['auditLog'] | undefined;

  constructor(opts: HookControlledOptions) {
    this.broker = opts.broker;
    this.toolToCommand = opts.toolToCommand;
    this.tokensFor = opts.tokensFor;
    this.guardRules = opts.guardRules;
    this.sanitizer = opts.sanitizer;
    this.auditLog = opts.auditLog;
  }

  /**
   * preToolUse — called before Claude Code dispatches a tool. Returns
   * `{ decision: 'allow' | 'deny', reason }`. The hook subprocess writes
   * this JSON to stdout.
   */
  preToolUse(input: HookPreToolUseInput): HookPreToolUseOutput {
    const mapping = this.toolToCommand(input.toolName, input.toolArgs);
    if (!mapping) {
      // Tool isn't mapped to any known privileged command → allow by
      // default (this hook only gates the privileged set; everything
      // else flows through Claude Code's own permission UI).
      return {
        decision: 'allow',
        reason: `tool '${input.toolName}' has no privileged-command mapping; not gated by capability broker`,
      };
    }
    const ctx = this.tokensFor(input.taskId);
    try {
      assertCapabilityForCommand(
        mapping.cmd,
        mapping.args,
        ctx,
        this.guardRules,
      );
      return {
        decision: 'allow',
        reason: `command '${mapping.cmd} ${mapping.args.join(' ')}' authorised by capability broker`,
      };
    } catch (err) {
      if (err instanceof CapabilityGuardError) {
        return {
          decision: 'deny',
          reason: err.message,
          details: {
            capability: err.capability,
            scope: err.scope,
            code: 'capability_guard_error',
          },
        };
      }
      if (err instanceof CapabilityBrokerError) {
        return {
          decision: 'deny',
          reason: err.message,
          details: { code: err.code },
        };
      }
      return {
        decision: 'deny',
        reason: String(err),
      };
    }
  }

  /**
   * postToolUse — called after Claude Code has run a tool. Sanitizes
   * the result (when a sanitizer is wired) so the agent's context
   * receives the cleaned payload, and emits an audit-log entry per
   * flag the sanitizer raised.
   */
  postToolUse(input: HookPostToolUseInput): HookPostToolUseOutput {
    void this.broker;
    if (!this.sanitizer) {
      return { recordToLedger: true };
    }
    const r = this.sanitizer({
      toolName: input.toolName,
      toolArgs: input.toolArgs,
      result: input.result,
      taskId: input.taskId,
      agentRole: input.agentRole,
    });
    if (this.auditLog && r.flags.length > 0) {
      try {
        this.auditLog({
          taskId: input.taskId,
          agentRole: input.agentRole,
          toolName: input.toolName,
          flags: r.flags.map((f) => ({ id: f.id, action: f.action, matchCount: f.matchCount })),
          rejected: r.rejected,
          tsMsEpoch: Date.now(),
        });
      } catch { /* audit log must never break the hook path */ }
    }
    const out: HookPostToolUseOutput = {
      recordToLedger: true,
      sanitizerFlags: r.flags,
      sanitizerRejected: r.rejected,
    };
    if (r.sanitizedResult !== undefined) out.sanitizedResult = r.sanitizedResult;
    return out;
  }
}
