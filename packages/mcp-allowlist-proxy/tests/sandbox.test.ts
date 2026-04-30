/**
 * Sandboxed-spawn helper — pure-function unit tests.
 */

import { describe, it, expect } from 'vitest';
import { buildSandboxedSpawn } from '../src/index.js';

describe('buildSandboxedSpawn', () => {
  it('wraps the spawn in /usr/bin/sandbox-exec on darwin', () => {
    const out = buildSandboxedSpawn({
      cmd: 'node',
      args: ['/path/to/server.js'],
      worktree: '/tmp/wt',
      cacheDir: '/tmp/cache',
      profile: 'scripts/mcp-sandbox.sb',
      platform: 'darwin',
    });
    expect(out.cmd).toBe('/usr/bin/sandbox-exec');
    expect(out.args).toEqual([
      '-f', 'scripts/mcp-sandbox.sb',
      '-D', 'MCP_WORKTREE=/tmp/wt',
      '-D', 'MCP_CACHE_DIR=/tmp/cache',
      '--', 'node', '/path/to/server.js',
    ]);
  });

  it('injects MCP_WORKTREE + MCP_CACHE_DIR into env', () => {
    const out = buildSandboxedSpawn({
      cmd: 'node',
      args: ['x'],
      worktree: '/tmp/wt',
      cacheDir: '/tmp/cache',
      profile: 'scripts/mcp-sandbox.sb',
      platform: 'darwin',
      spawnOpts: { env: { FOO: 'bar' } },
    });
    expect(out.spawnOpts.env).toMatchObject({
      FOO: 'bar',
      MCP_WORKTREE: '/tmp/wt',
      MCP_CACHE_DIR: '/tmp/cache',
    });
  });

  it('skips sandbox-exec on linux but warns + still injects env', () => {
    const warnings: string[] = [];
    const out = buildSandboxedSpawn({
      cmd: 'node',
      args: ['x'],
      worktree: '/tmp/wt',
      cacheDir: '/tmp/cache',
      profile: 'scripts/mcp-sandbox.sb',
      platform: 'linux',
      warnLog: (m) => warnings.push(m),
    });
    expect(out.cmd).toBe('node');
    expect(out.args).toEqual(['x']);
    expect(warnings[0]).toMatch(/skips sandbox-exec/);
    expect(out.spawnOpts.env).toMatchObject({
      MCP_WORKTREE: '/tmp/wt',
      MCP_CACHE_DIR: '/tmp/cache',
    });
  });

  it('preserves caller spawn opts (cwd, stdio) when wrapping', () => {
    const out = buildSandboxedSpawn({
      cmd: 'node',
      args: ['x'],
      worktree: '/tmp/wt',
      cacheDir: '/tmp/cache',
      profile: 'scripts/mcp-sandbox.sb',
      platform: 'darwin',
      spawnOpts: { cwd: '/tmp/wt', stdio: 'inherit' },
    });
    expect(out.spawnOpts.cwd).toBe('/tmp/wt');
    expect(out.spawnOpts.stdio).toBe('inherit');
  });
});
