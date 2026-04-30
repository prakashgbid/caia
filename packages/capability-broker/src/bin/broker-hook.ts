#!/usr/bin/env node
/**
 * `caia-broker-hook` — the subprocess Claude Code invokes for
 * `--hook-pre-tool-use` / `--hook-post-tool-use`.
 *
 * Protocol: read one JSON frame from stdin, write one JSON frame to
 * stdout. Argv selects the op (`preToolUse` / `postToolUse`). All other
 * context (taskId, agentRole, socketPath) is provided via env vars set
 * by the executor when it spawns Claude Code.
 *
 * On any error we default-deny — a missing or crashing broker MUST NOT
 * silently allow privileged operations. This is the v2 §3.8 fail-closed
 * contract.
 */

import { callBrokerSocket } from '../socket-client.js';
import type { BrokerWireFrame } from '../socket-server.js';
import type {
  HookPreToolUseInput,
  HookPreToolUseOutput,
  HookPostToolUseInput,
  HookPostToolUseOutput,
} from '../hook-controlled.js';

async function readStdin(): Promise<string> {
  return new Promise<string>((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
    // If stdin is a TTY (no piped input) we just resolve empty.
    if (process.stdin.isTTY) resolve('');
  });
}

function writeJson(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function failClosed(message: string, code: string): void {
  const out: HookPreToolUseOutput = {
    decision: 'deny',
    reason: `caia-broker-hook: ${message}`,
    details: { code },
  };
  writeJson(out);
}

async function main(): Promise<number> {
  const op = process.argv[2];
  if (op !== 'preToolUse' && op !== 'postToolUse') {
    failClosed(`unknown op '${op}' (expected preToolUse or postToolUse)`, 'bad_argv');
    return 2;
  }
  const socketPath = process.env['CAIA_BROKER_SOCKET'];
  if (!socketPath) {
    failClosed('CAIA_BROKER_SOCKET env not set', 'missing_socket_env');
    return 2;
  }
  const taskId = process.env['CAIA_BROKER_TASK_ID'] ?? '';
  const agentRole = process.env['CAIA_BROKER_AGENT_ROLE'] ?? 'coding-agent';

  const stdin = await readStdin();
  let claudeFrame: { sessionId?: string; toolName?: string; toolArgs?: Record<string, unknown>; result?: unknown } = {};
  if (stdin.trim()) {
    try {
      claudeFrame = JSON.parse(stdin);
    } catch (err) {
      failClosed(
        `stdin JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
        'stdin_parse_error',
      );
      return 2;
    }
  }
  const sessionId = claudeFrame.sessionId ?? '';
  const toolName = claudeFrame.toolName ?? '';
  const toolArgs = claudeFrame.toolArgs ?? {};

  const wireFrame: BrokerWireFrame = op === 'preToolUse'
    ? {
        op,
        payload: {
          sessionId,
          toolName,
          toolArgs,
          taskId,
          agentRole,
        } satisfies HookPreToolUseInput,
      }
    : {
        op,
        payload: {
          sessionId,
          toolName,
          toolArgs,
          taskId,
          agentRole,
          result: claudeFrame.result,
        } satisfies HookPostToolUseInput,
      };

  const timeoutMs = Number(process.env['CAIA_BROKER_TIMEOUT_MS'] ?? '5000') || 5000;
  const out = await callBrokerSocket<HookPreToolUseOutput | HookPostToolUseOutput>(
    wireFrame,
    { socketPath, timeoutMs },
  );
  writeJson(out);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    failClosed(err instanceof Error ? err.message : String(err), 'unhandled');
    process.exit(2);
  },
);
