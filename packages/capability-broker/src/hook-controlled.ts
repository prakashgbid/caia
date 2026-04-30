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
}

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
}

export class HookControlledMode {
  private readonly broker: CapabilityBroker;
  private readonly toolToCommand: HookControlledOptions['toolToCommand'];
  private readonly tokensFor: HookControlledOptions['tokensFor'];
  private readonly guardRules: readonly GuardRule[] | undefined;

  constructor(opts: HookControlledOptions) {
    this.broker = opts.broker;
    this.toolToCommand = opts.toolToCommand;
    this.tokensFor = opts.tokensFor;
    this.guardRules = opts.guardRules;
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
   * postToolUse — called after Claude Code has run a tool. Mostly
   * advisory; the orchestrator-side recording is what matters. We
   * surface a sanitized result (via the tool-output sanitizer) and a
   * recordToLedger flag the caller should honour.
   */
  postToolUse(input: HookPostToolUseInput): HookPostToolUseOutput {
    void input;
    void this.broker;
    return {
      recordToLedger: true,
    };
  }
}
