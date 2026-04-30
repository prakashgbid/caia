/**
 * Hook-controlled permission mode (v2 §3.8).
 */

import { describe, it, expect } from 'vitest';
import { HOOK_TESTS_SIGNING_KEY } from './__fixtures__/signing-keys.js';
import {
  CapabilityBroker,
  HookControlledMode,
  StaticSigningKeyProvider,
  createDefaultRegistry,
  guardContextFromTokens,
  type CapabilityToken,
} from '../src/index.js';

function setup(): {
  broker: CapabilityBroker;
  hook: HookControlledMode;
} {
  const reg = createDefaultRegistry();
  reg.registerAllowlistEntry({
    name: 'gh.pr.merge',
    agentRole: 'release-bot',
    scopePattern: 'pr/*',
  });
  const broker = new CapabilityBroker({
    registry: reg,
    signingKey: new StaticSigningKeyProvider(
      HOOK_TESTS_SIGNING_KEY,
    ),
  });
  const hook = new HookControlledMode({
    broker,
    toolToCommand: (toolName, args) => {
      if (toolName === 'Bash') {
        const cmd = String(args['command'] ?? '');
        const split = cmd.split(/\s+/).filter(Boolean);
        if (split.length === 0) return null;
        return { cmd: split[0]!, args: split.slice(1) };
      }
      return null;
    },
    tokensFor: (taskId) => {
      const tok = tokens.get(taskId);
      return tok ? guardContextFromTokens([tok]) : guardContextFromTokens([]);
    },
  });
  return { broker, hook };
}

const tokens = new Map<string, CapabilityToken>();

describe('HookControlledMode.preToolUse', () => {
  it('allows tools that have no privileged-command mapping', () => {
    const { hook } = setup();
    const out = hook.preToolUse({
      sessionId: 's',
      toolName: 'Read',
      toolArgs: { path: '/x' },
      taskId: 't',
      agentRole: 'release-bot',
    });
    expect(out.decision).toBe('allow');
  });

  it('denies "git push origin main" without a token', () => {
    tokens.clear();
    const { hook } = setup();
    const out = hook.preToolUse({
      sessionId: 's',
      toolName: 'Bash',
      toolArgs: { command: 'git push origin main' },
      taskId: 't',
      agentRole: 'release-bot',
    });
    expect(out.decision).toBe('deny');
    expect(out.details?.code).toBe('capability_guard_error');
  });

  it('allows "gh pr merge 199" with a matching token', () => {
    const { broker, hook } = setup();
    const tok = broker.issue({
      name: 'gh.pr.merge',
      scope: 'pr/199',
      agentRole: 'release-bot',
      taskId: 'task-merge',
      reason: 'merge release',
    });
    tokens.clear();
    tokens.set('task-merge', tok);
    const out = hook.preToolUse({
      sessionId: 's',
      toolName: 'Bash',
      toolArgs: { command: 'gh pr merge 199' },
      taskId: 'task-merge',
      agentRole: 'release-bot',
    });
    expect(out.decision).toBe('allow');
  });

  it('returns recordToLedger=true from postToolUse by default', () => {
    const { hook } = setup();
    const out = hook.postToolUse({
      sessionId: 's',
      toolName: 'Bash',
      toolArgs: { command: 'ls' },
      taskId: 't',
      agentRole: 'release-bot',
      result: { ok: true },
    });
    expect(out.recordToLedger).toBe(true);
  });
});
