/**
 * Runtime guard — gates shell commands based on tokens in scope.
 */

import { describe, it, expect } from 'vitest';
import { GUARD_TESTS_SIGNING_KEY } from './__fixtures__/signing-keys.js';
import {
  CapabilityBroker,
  CapabilityGuardError,
  StaticSigningKeyProvider,
  assertCapabilityForCommand,
  createDefaultRegistry,
  guardContextFromTokens,
  type CapabilityToken,
} from '../src/index.js';

function brokerWithAllowlist(): CapabilityBroker {
  const reg = createDefaultRegistry();
  reg.registerAllowlistEntry({
    name: 'git.push.protected',
    agentRole: 'release-bot',
    scopePattern: 'origin/refs/heads/main',
  });
  reg.registerAllowlistEntry({
    name: 'git.push.force',
    agentRole: 'release-bot',
    scopePattern: 'origin/refs/heads/feat/foo',
  });
  reg.registerAllowlistEntry({
    name: 'gh.pr.merge',
    agentRole: 'release-bot',
    scopePattern: 'pr/*',
  });
  reg.registerAllowlistEntry({
    name: 'npm.publish',
    agentRole: 'release-bot',
    scopePattern: 'pkg/@chiefaia/capability-broker',
  });
  return new CapabilityBroker({
    registry: reg,
    signingKey: new StaticSigningKeyProvider(
      GUARD_TESTS_SIGNING_KEY,
    ),
  });
}

function fakeToken(
  overrides: Partial<CapabilityToken>,
): CapabilityToken {
  return {
    tokenId: 'a'.repeat(32),
    name: 'gh.pr.merge',
    scope: 'pr/199',
    agentRole: 'release-bot',
    taskId: 't',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    signature: '00',
    singleUse: true,
    ...overrides,
  };
}

describe('assertCapabilityForCommand', () => {
  it('lets non-matching commands through (e.g. ls, pnpm test)', () => {
    const ctx = guardContextFromTokens([]);
    expect(() =>
      assertCapabilityForCommand('ls', ['-la'], ctx),
    ).not.toThrow();
    expect(() =>
      assertCapabilityForCommand('pnpm', ['test'], ctx),
    ).not.toThrow();
    expect(() =>
      assertCapabilityForCommand('git', ['status'], ctx),
    ).not.toThrow();
    expect(() =>
      assertCapabilityForCommand('git', ['fetch', 'origin'], ctx),
    ).not.toThrow();
  });

  it('blocks "git push origin main" without a capability token', () => {
    const ctx = guardContextFromTokens([]);
    expect(() =>
      assertCapabilityForCommand('git', ['push', 'origin', 'main'], ctx),
    ).toThrow(CapabilityGuardError);
  });

  it('allows "git push origin main" with a matching token', () => {
    const broker = brokerWithAllowlist();
    const tok = broker.issue({
      name: 'git.push.protected',
      scope: 'origin/refs/heads/main',
      agentRole: 'release-bot',
      taskId: 't',
      reason: 'release',
    });
    const ctx = guardContextFromTokens([tok]);
    expect(() =>
      assertCapabilityForCommand('git', ['push', 'origin', 'main'], ctx),
    ).not.toThrow();
  });

  it('blocks "git push --force" without a force token', () => {
    const broker = brokerWithAllowlist();
    const protectedTok = broker.issue({
      name: 'git.push.protected',
      scope: 'origin/refs/heads/main',
      agentRole: 'release-bot',
      taskId: 't',
      reason: 'release',
    });
    const ctx = guardContextFromTokens([protectedTok]);
    // The protected token doesn't authorise --force.
    expect(() =>
      assertCapabilityForCommand(
        'git',
        ['push', '--force', 'origin', 'feat/foo'],
        ctx,
      ),
    ).toThrow(/git\.push\.force/);
  });

  it('allows "git push --force" with a matching force token', () => {
    const broker = brokerWithAllowlist();
    const tok = broker.issue({
      name: 'git.push.force',
      scope: 'origin/refs/heads/feat/foo',
      agentRole: 'release-bot',
      taskId: 't',
      reason: 'rebase',
    });
    const ctx = guardContextFromTokens([tok]);
    expect(() =>
      assertCapabilityForCommand(
        'git',
        ['push', '--force-with-lease', 'origin', 'feat/foo'],
        ctx,
      ),
    ).not.toThrow();
  });

  it('blocks gh pr merge without a token', () => {
    const ctx = guardContextFromTokens([]);
    expect(() =>
      assertCapabilityForCommand('gh', ['pr', 'merge', '199', '--squash'], ctx),
    ).toThrow(/gh\.pr\.merge/);
  });

  it('blocks npm publish without a token', () => {
    const ctx = guardContextFromTokens([]);
    expect(() =>
      assertCapabilityForCommand('npm', ['publish'], ctx),
    ).toThrow(/npm\.publish/);
    expect(() =>
      assertCapabilityForCommand('pnpm', ['publish', '--access', 'public'], ctx),
    ).toThrow(/npm\.publish/);
  });

  it('rejects an expired token even if it would have authorised the command', () => {
    const expired = fakeToken({
      name: 'gh.pr.merge',
      scope: 'pr/199',
      expiresAt: Date.now() - 1000,
    });
    const ctx = guardContextFromTokens([expired]);
    expect(() =>
      assertCapabilityForCommand('gh', ['pr', 'merge', '199'], ctx),
    ).toThrow(/expired/);
  });

  it('rejects when the token scope does not match the requested scope', () => {
    const tok = fakeToken({
      name: 'gh.pr.merge',
      scope: 'pr/200',
    });
    const ctx = guardContextFromTokens([tok]);
    expect(() =>
      assertCapabilityForCommand('gh', ['pr', 'merge', '199'], ctx),
    ).toThrow(/scope/);
  });

  it('blocks supabase db reset without a token', () => {
    const ctx = guardContextFromTokens([]);
    expect(() =>
      assertCapabilityForCommand('supabase', ['db', 'reset'], ctx),
    ).toThrow(/supabase\.db\.reset/);
  });
});
