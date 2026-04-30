/**
 * SAFETY-002 — sandboxed MCP config tests.
 *
 * Eight cases covering:
 *   1. Wraps a basic node MCP entry into sandbox-exec form.
 *   2. Wraps a python MCP entry (e.g. mac-mcp) into sandbox-exec form.
 *   3. Idempotent: an already-wrapped entry passes through wrapMcpConfig
 *      unchanged.
 *   4. Allowlist enforcement: a `bash` MCP entry is rejected.
 *   5. Public-bind enforcement: an entry with `--host 0.0.0.0` is rejected.
 *   6. Non-Darwin host: the wrapper is skipped but allowlist + public-bind
 *      guards still apply.
 *   7. Custom profile path is threaded through.
 *   8. wrapMcpConfig: bulk-wraps multiple entries.
 */

import { describe, it, expect } from 'vitest';
import {
  wrapMcpEntry,
  wrapMcpConfig,
  isWrappedEntry,
} from './sandboxed-mcp-config';
import {
  SpawnAllowlistError,
  PublicBindError,
} from '@chiefaia/mcp-allowlist-proxy';

describe('SAFETY-002 sandboxed-mcp-config', () => {
  it('1. wraps a basic node MCP entry into sandbox-exec form (Darwin)', () => {
    const out = wrapMcpEntry(
      { command: 'node', args: ['server.js'] },
      { platform: 'darwin', profile: '/tmp/test.sb' },
    );
    expect(out.command).toBe('/usr/bin/sandbox-exec');
    expect(out.args).toContain('-f');
    expect(out.args).toContain('/tmp/test.sb');
    expect(out.args).toContain('--');
    expect(out.args).toContain('node');
    expect(out.args).toContain('server.js');
  });

  it('2. wraps a python MCP entry (mac-mcp shape)', () => {
    const out = wrapMcpEntry(
      { command: 'python3', args: ['-m', 'mac_mcp.server'] },
      { platform: 'darwin', profile: '/tmp/test.sb' },
    );
    expect(out.command).toBe('/usr/bin/sandbox-exec');
    const argv = out.args;
    expect(argv[0]).toBe('-f');
    expect(argv[1]).toBe('/tmp/test.sb');
    // The original cmd + args trail after `--`.
    const dashIdx = argv.indexOf('--');
    expect(argv[dashIdx + 1]).toBe('python3');
    expect(argv[dashIdx + 2]).toBe('-m');
    expect(argv[dashIdx + 3]).toBe('mac_mcp.server');
  });

  it('3. idempotent — already-wrapped entry passes through wrapMcpConfig', () => {
    const wrapped = wrapMcpEntry(
      { command: 'node', args: ['s.js'] },
      { platform: 'darwin', profile: '/tmp/test.sb' },
    );
    const out = wrapMcpConfig(
      { mcpServers: { foo: wrapped } },
      { platform: 'darwin', profile: '/tmp/test.sb' },
    );
    expect(out.mcpServers['foo']).toEqual(wrapped);
  });

  it('4. allowlist rejects an entry whose command is not on STDIO_ALLOWED_COMMANDS', () => {
    expect(() => wrapMcpEntry(
      { command: 'bash', args: ['-c', 'curl https://evil/'] },
      { platform: 'darwin', profile: '/tmp/test.sb' },
    )).toThrow(SpawnAllowlistError);
  });

  it('5. public-bind guard rejects 0.0.0.0 in args', () => {
    expect(() => wrapMcpEntry(
      { command: 'node', args: ['s.js', '--host', '0.0.0.0'] },
      { platform: 'darwin', profile: '/tmp/test.sb' },
    )).toThrow(PublicBindError);
  });

  it('6. non-Darwin: wrapper skipped, but allowlist + public-bind still apply', () => {
    // Allowed cmd, no public bind → entry passes through unwrapped.
    const ok = wrapMcpEntry(
      { command: 'node', args: ['server.js'] },
      { platform: 'linux', profile: '/tmp/test.sb' },
    );
    expect(ok.command).toBe('node');
    expect(isWrappedEntry(ok)).toBe(false);

    // Public bind still rejected on linux.
    expect(() => wrapMcpEntry(
      { command: 'node', args: ['server.js', '--host', '[::]'] },
      { platform: 'linux', profile: '/tmp/test.sb' },
    )).toThrow(PublicBindError);
  });

  it('7. custom profile path is threaded through', () => {
    const out = wrapMcpEntry(
      { command: 'npx', args: ['my-mcp'] },
      { platform: 'darwin', profile: '/etc/caia/custom.sb' },
    );
    expect(out.args).toContain('/etc/caia/custom.sb');
  });

  it('8. wrapMcpConfig — bulk-wraps multiple entries', () => {
    const out = wrapMcpConfig(
      {
        mcpServers: {
          a: { command: 'node', args: ['a.js'] },
          b: { command: 'python3', args: ['b.py'] },
        },
      },
      { platform: 'darwin', profile: '/tmp/test.sb' },
    );
    expect(isWrappedEntry(out.mcpServers['a']!)).toBe(true);
    expect(isWrappedEntry(out.mcpServers['b']!)).toBe(true);
  });
});
