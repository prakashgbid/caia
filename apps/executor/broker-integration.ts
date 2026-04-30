/**
 * Broker integration — wires the in-process @chiefaia/capability-broker
 * into the executor so spawned `claude --permission-mode hook-controlled`
 * subprocesses can call back into our policy via a Unix-domain socket.
 *
 * This module is the orchestrator-side adapter. Its lifecycle:
 *
 *   start() → boots a BrokerSocketServer at $BROKER_SOCKET, returns
 *             { socketPath, brokerBin, hookEnv, augmentClaudeArgs, shutdown }.
 *   shutdown() → closes the socket server (idempotent).
 *
 * For P0 (per the operator mandate's "broker's policy mapper allows the
 * existing capability set"), the policy is permissive: every tool call
 * is allowed. The point at this stage is to land the *plumbing* (socket
 * server, hook subprocess, ledger entry per call) so future restrictions
 * can tighten without re-touching every spawn site.
 *
 * Reference: caia/docs/capability-broker.md, v2 §3.8.
 */

import * as path from 'path';
import * as fs from 'fs';
import {
  CapabilityBroker,
  StaticSigningKeyProvider,
  CapabilityRegistry,
  HookControlledMode,
  BrokerSocketServer,
  InMemoryLedger,
  CapabilityExecutor,
  type GuardContext,
  type HookPreToolUseInput,
  type HookPreToolUseOutput,
  type HookPostToolUseInput,
} from '@chiefaia/capability-broker';

export const PERMISSION_MODE_HOOK_CONTROLLED = 'hook-controlled';
export const PERMISSION_MODE_BYPASS = 'bypassPermissions';

export interface BrokerIntegration {
  /** UDS path the hook subprocess connects to. */
  socketPath: string;
  /** Path to the `caia-broker-hook` binary that Claude Code spawns. */
  brokerBin: string;
  /** Augment claude argv with the hook flags + permission-mode override. */
  augmentClaudeArgs: (args: readonly string[]) => string[];
  /** Env vars the spawned claude needs so the hook subprocess can find us. */
  hookEnv: (taskId: string, agentRole?: string) => Record<string, string>;
  /** Audit-log accessor (in-memory ledger for P0). */
  ledger: InMemoryLedger;
  /** Idempotent shutdown — closes socket server. */
  shutdown: () => Promise<void>;
}

export interface StartBrokerOptions {
  /** Override UDS path (default: $TMPDIR/caia-broker-<pid>.sock). */
  socketPath?: string;
  /** Override broker binary path (default: resolved from this package). */
  brokerBin?: string;
  /** Per-frame deadline for socket calls. Default 5000 ms. */
  perFrameTimeoutMs?: number;
  /** Optional logger; default stderr line writer. */
  log?: (msg: string) => void;
  /** Optional override registry (test seam). */
  registry?: CapabilityRegistry;
}

function defaultSocketPath(): string {
  const tmp = process.env['TMPDIR'] ?? '/tmp';
  return path.join(tmp, `caia-broker-${process.pid}-${Date.now().toString(36)}.sock`);
}

function defaultBrokerBin(): string {
  // The bin file is shipped in @chiefaia/capability-broker's dist.
  // Resolve relative to require so it works from monorepo + global installs.
  const candidates = [
    // Workspace dev path:
    path.resolve(__dirname, '..', '..', 'packages', 'capability-broker', 'dist', 'bin', 'broker-hook.js'),
    // Sibling-of-current-app path (when published):
    path.resolve(__dirname, '..', 'node_modules', '@chiefaia', 'capability-broker', 'dist', 'bin', 'broker-hook.js'),
    // Repo-root node_modules:
    path.resolve(__dirname, '..', '..', 'node_modules', '@chiefaia', 'capability-broker', 'dist', 'bin', 'broker-hook.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  // Fall back to the workspace dev path (build will produce it).
  return candidates[0]!;
}

function defaultRegistry(): CapabilityRegistry {
  // P0: register no capabilities — the hook's `toolToCommand` returns null
  // for every tool, which the HookControlledMode default-allows.
  return new CapabilityRegistry();
}

/**
 * For P0, no Claude tool maps to a privileged shell command. This keeps
 * the broker permissive while the audit-log + plumbing land. As we
 * tighten the policy, this is the function we extend.
 */
export function p0ToolToCommand(_toolName: string, _toolArgs: Record<string, unknown>):
  { cmd: string; args: readonly string[] } | null {
  return null;
}

/**
 * Build the GuardContext lookup. Per P0, no tokens are issued — the
 * registry is empty so nothing requires one. Returns an empty context.
 */
export function emptyTokensFor(_taskId: string): GuardContext {
  return { tokens: [] };
}

export async function startBrokerIntegration(opts: StartBrokerOptions = {}): Promise<BrokerIntegration> {
  const log = opts.log ?? ((m: string) => process.stderr.write(`[broker] ${m}\n`));
  const socketPath = opts.socketPath ?? defaultSocketPath();
  const brokerBin = opts.brokerBin ?? defaultBrokerBin();
  const registry = opts.registry ?? defaultRegistry();

  const signingKey = new StaticSigningKeyProvider(
    process.env['CAPABILITY_BROKER_SIGNING_KEY']
      ?? 'caia-broker-p0-dev-only-not-a-secret-rotate-before-prod',
  );
  const broker = new CapabilityBroker({ registry, signingKey });
  const ledger = new InMemoryLedger();
  // CapabilityExecutor isn't used in the hook path itself, but we wire
  // it so the audit-log surface is available to the dashboard query.
  void new CapabilityExecutor({ broker, ledger, handlers: new Map() });

  const hook = new HookControlledMode({
    broker,
    toolToCommand: p0ToolToCommand,
    tokensFor: emptyTokensFor,
  });

  const server = new BrokerSocketServer({
    socketPath,
    hook,
    perFrameTimeoutMs: opts.perFrameTimeoutMs ?? 5000,
    log: (ev) => {
      if (ev.kind === 'frame-error' || ev.kind === 'parse-error') {
        log(`${ev.kind}: ${ev.message}`);
      } else if (ev.kind === 'listen') {
        log(`socket listening at ${ev.socketPath}`);
      }
    },
  });

  await server.start();

  let shutdownDone = false;
  const shutdown = async (): Promise<void> => {
    if (shutdownDone) return;
    shutdownDone = true;
    await server.stop();
  };

  process.on('exit', () => {
    if (!shutdownDone) {
      try { fs.unlinkSync(socketPath); } catch { /* gone */ }
    }
  });

  return {
    socketPath,
    brokerBin,
    augmentClaudeArgs: (args: readonly string[]) => augmentClaudeArgs(args, brokerBin),
    hookEnv: (taskId: string, agentRole = 'coding-agent') => ({
      CAIA_BROKER_SOCKET: socketPath,
      CAIA_BROKER_TASK_ID: taskId,
      CAIA_BROKER_AGENT_ROLE: agentRole,
    }),
    ledger,
    shutdown,
  };
}

/**
 * Replace `--permission-mode bypassPermissions` (anywhere in argv) with
 * `--permission-mode hook-controlled --hook-pre-tool-use=<bin> preToolUse
 *  --hook-post-tool-use=<bin> postToolUse`.
 *
 * If the input already has hook-controlled, just appends the hook flags
 * (idempotent).
 *
 * Pure function — used by both the dispatcher and the unit tests.
 */
export function augmentClaudeArgs(
  args: readonly string[],
  brokerBin: string,
): string[] {
  const out: string[] = [];
  let i = 0;
  let didReplace = false;
  while (i < args.length) {
    const a = args[i]!;
    if (a === '--permission-mode' && i + 1 < args.length) {
      out.push('--permission-mode', PERMISSION_MODE_HOOK_CONTROLLED);
      didReplace = true;
      i += 2;
      continue;
    }
    out.push(a);
    i += 1;
  }
  if (!didReplace) {
    // No --permission-mode in argv — insert one. Place right after
    // --print to keep the flag near the head of argv (matches the docs).
    const insertIdx = out.indexOf('--print') + 1 || 0;
    out.splice(insertIdx, 0, '--permission-mode', PERMISSION_MODE_HOOK_CONTROLLED);
  }
  // Append hook flags. Use `--flag=value` form so quoted spaces in the
  // path survive shell escaping (Claude Code parses `=value` directly).
  out.push(`--hook-pre-tool-use=${brokerBin} preToolUse`);
  out.push(`--hook-post-tool-use=${brokerBin} postToolUse`);
  return out;
}

/** Re-export hook input/output types for tests + downstream callers. */
export type {
  HookPreToolUseInput,
  HookPreToolUseOutput,
  HookPostToolUseInput,
};
