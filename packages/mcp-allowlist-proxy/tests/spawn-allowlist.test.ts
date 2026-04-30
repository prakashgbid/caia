/**
 * Spawn-allowlist + public-bind guard — litellm canonical fix + CVE-2026-23744.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STDIO_ALLOWED_COMMANDS,
  PublicBindError,
  SpawnAllowlistError,
  assertNoPublicBind,
  assertSpawnCommandAllowed,
  basename,
  buildSandboxedSpawn,
  readAllowlistFromEnv,
} from '../src/index.js';

describe('basename', () => {
  it('returns the last segment of a posix path', () => {
    expect(basename('/usr/bin/python3')).toBe('python3');
    expect(basename('node')).toBe('node');
    expect(basename('/Users/MAC/.nvm/versions/node/v20/bin/node')).toBe('node');
  });
  it('handles trailing slashes + back-slashes', () => {
    expect(basename('/opt/homebrew/bin/uvx/')).toBe('uvx');
    expect(basename('C:\\Python\\python3.exe')).toBe('python3.exe');
  });
});

describe('readAllowlistFromEnv', () => {
  it('returns the litellm canonical default when env is empty', () => {
    const list = readAllowlistFromEnv({});
    expect(list).toEqual(DEFAULT_STDIO_ALLOWED_COMMANDS);
  });
  it('parses a custom comma-separated list', () => {
    const list = readAllowlistFromEnv({
      MCP_STDIO_ALLOWED_COMMANDS: 'node,python3, deno ',
    });
    expect(list).toEqual(['node', 'python3', 'deno']);
  });
  it('falls back to default when env value is whitespace only', () => {
    const list = readAllowlistFromEnv({ MCP_STDIO_ALLOWED_COMMANDS: '   ' });
    expect(list).toEqual(DEFAULT_STDIO_ALLOWED_COMMANDS);
  });
});

describe('assertSpawnCommandAllowed', () => {
  it('passes for every entry on the litellm default list', () => {
    for (const c of DEFAULT_STDIO_ALLOWED_COMMANDS) {
      expect(() => assertSpawnCommandAllowed(c)).not.toThrow();
      expect(() => assertSpawnCommandAllowed(`/usr/bin/${c}`)).not.toThrow();
    }
  });
  it('rejects bash, sh, env, curl, /bin/zsh', () => {
    expect(() => assertSpawnCommandAllowed('bash')).toThrow(SpawnAllowlistError);
    expect(() => assertSpawnCommandAllowed('/bin/sh')).toThrow(SpawnAllowlistError);
    expect(() => assertSpawnCommandAllowed('/usr/bin/env')).toThrow();
    expect(() => assertSpawnCommandAllowed('curl')).toThrow();
    expect(() => assertSpawnCommandAllowed('/bin/zsh')).toThrow();
  });
  it('respects a caller-supplied allowlist override', () => {
    expect(() =>
      assertSpawnCommandAllowed('mycli', ['mycli']),
    ).not.toThrow();
    expect(() =>
      assertSpawnCommandAllowed('node', ['mycli']),
    ).toThrow();
  });
});

describe('assertNoPublicBind', () => {
  it('passes on localhost / 127.0.0.1', () => {
    expect(() =>
      assertNoPublicBind('node', ['server', '--host', '127.0.0.1']),
    ).not.toThrow();
    expect(() =>
      assertNoPublicBind('node', ['server', '--host=127.0.0.1']),
    ).not.toThrow();
    expect(() =>
      assertNoPublicBind('node', ['server', '--host=localhost']),
    ).not.toThrow();
  });
  it('rejects 0.0.0.0 in any common shape', () => {
    expect(() =>
      assertNoPublicBind('node', ['server', '--host', '0.0.0.0']),
    ).toThrow(PublicBindError);
    expect(() =>
      assertNoPublicBind('node', ['server', '--host=0.0.0.0']),
    ).toThrow(PublicBindError);
    expect(() =>
      assertNoPublicBind('node', ['server', '--bind', '0.0.0.0:8080']),
    ).toThrow(PublicBindError);
    expect(() =>
      assertNoPublicBind('node', ['server', '0.0.0.0:9000']),
    ).toThrow(PublicBindError);
  });
  it('rejects [::]/:: IPv6 wildcards', () => {
    expect(() =>
      assertNoPublicBind('node', ['server', '--host', '::']),
    ).toThrow(PublicBindError);
    expect(() =>
      assertNoPublicBind('node', ['server', '--host=[::]']),
    ).toThrow(PublicBindError);
  });
});

describe('buildSandboxedSpawn — guards', () => {
  it('rejects a disallowed spawn command', () => {
    expect(() =>
      buildSandboxedSpawn({
        cmd: 'bash',
        args: ['-c', 'echo hi'],
        worktree: '/tmp/wt',
        cacheDir: '/tmp/cache',
        profile: 'scripts/mcp-sandbox.sb',
        platform: 'darwin',
      }),
    ).toThrow(SpawnAllowlistError);
  });
  it('rejects a public-bind argument', () => {
    expect(() =>
      buildSandboxedSpawn({
        cmd: 'node',
        args: ['server.js', '--host', '0.0.0.0'],
        worktree: '/tmp/wt',
        cacheDir: '/tmp/cache',
        profile: 'scripts/mcp-sandbox.sb',
        platform: 'darwin',
      }),
    ).toThrow(PublicBindError);
  });
  it('lets approved (node + 127.0.0.1) spawns through', () => {
    const out = buildSandboxedSpawn({
      cmd: 'node',
      args: ['server.js', '--host', '127.0.0.1'],
      worktree: '/tmp/wt',
      cacheDir: '/tmp/cache',
      profile: 'scripts/mcp-sandbox.sb',
      platform: 'darwin',
    });
    expect(out.cmd).toBe('/usr/bin/sandbox-exec');
  });
});
