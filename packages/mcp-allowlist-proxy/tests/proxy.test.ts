/**
 * MCP allowlist proxy — request inspection + per-task budgets.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { McpAllowlistProxy, type McpPolicy } from '../src/index.js';

function policy(): McpPolicy {
  return {
    name: 'mac-mcp',
    description: 'test policy',
    pinnedSha: 'deadbeefdeadbeefdeadbeef',
    sourceUrl: 'https://example.org/mac-mcp',
    trustTier: 'first-party-caia',
    tools: [
      {
        name: 'mac_bash',
        argsConstraints: {
          command: { kind: 'maxLength', value: 50 },
        },
        maxPerTask: 3,
      },
      {
        name: 'mac_read_file',
        argsConstraints: {
          path: { kind: 'regex', pattern: '^/Users/.+' },
        },
      },
      {
        name: 'mac_db_query',
        argsConstraints: {
          query: { kind: 'forbid', pattern: '(?i)\\bdrop\\b' },
        },
      },
      {
        name: 'mac_choose_format',
        argsConstraints: {
          format: { kind: 'enum', values: ['json', 'yaml'] },
        },
      },
    ],
    allowedHosts: [],
    sandboxProfile: 'scripts/mcp-sandbox.sb',
  };
}

let proxy: McpAllowlistProxy;
beforeEach(() => {
  proxy = new McpAllowlistProxy({ policy: policy() });
});

describe('McpAllowlistProxy.inspect', () => {
  it('allows non-tools/call frames through unchanged', () => {
    const decision = proxy.inspect({
      jsonrpc: '2.0', id: 1, method: 'initialize', params: {},
    });
    expect(decision.kind).toBe('allow');
    expect(decision.toolName).toBe('<non-tools/call>');
  });

  it('allows a known tool call when args are within constraints', () => {
    const decision = proxy.inspect({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'mac_bash', arguments: { command: 'ls -la' } },
    });
    expect(decision.kind).toBe('allow');
  });

  it('denies a tool that is not on the allowlist', () => {
    const decision = proxy.inspect({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'mac_evil_tool', arguments: {} },
    });
    expect(decision.kind).toBe('deny');
    if (decision.kind === 'deny') expect(decision.reason).toMatch(/not on the allowlist/);
  });

  it('denies an arg that violates a regex constraint', () => {
    const decision = proxy.inspect({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'mac_read_file', arguments: { path: '../etc/secret' } },
    });
    expect(decision.kind).toBe('deny');
  });

  it('denies an arg that exceeds maxLength', () => {
    const decision = proxy.inspect({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'mac_bash', arguments: { command: 'a'.repeat(100) } },
    });
    expect(decision.kind).toBe('deny');
    if (decision.kind === 'deny') expect(decision.reason).toMatch(/maxLength=50/);
  });

  it('denies an arg matching a forbid pattern (SQL DROP)', () => {
    const decision = proxy.inspect({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'mac_db_query', arguments: { query: 'select 1; DROP TABLE users; --' } },
    });
    expect(decision.kind).toBe('deny');
  });

  it('allows a forbid-checked arg that does not match the pattern', () => {
    const decision = proxy.inspect({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'mac_db_query', arguments: { query: 'select * from users limit 10;' } },
    });
    expect(decision.kind).toBe('allow');
  });

  it('denies an arg whose enum value is not allowed', () => {
    const decision = proxy.inspect({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'mac_choose_format', arguments: { format: 'pdf' } },
    });
    expect(decision.kind).toBe('deny');
  });

  it('allows an enum arg when its value is in the allowed set', () => {
    const decision = proxy.inspect({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'mac_choose_format', arguments: { format: 'json' } },
    });
    expect(decision.kind).toBe('allow');
  });
});

describe('McpAllowlistProxy.consume', () => {
  it('enforces per-task budget caps over multiple consume calls', () => {
    const taskId = 't-1';
    for (let i = 0; i < 3; i++) {
      const d = proxy.consume({
        jsonrpc: '2.0', id: i, method: 'tools/call',
        params: { name: 'mac_bash', arguments: { command: 'ls' } },
      }, taskId);
      expect(d.kind).toBe('allow');
    }
    const denied = proxy.consume({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'mac_bash', arguments: { command: 'ls' } },
    }, taskId);
    expect(denied.kind).toBe('deny');
    if (denied.kind === 'deny') expect(denied.reason).toMatch(/budget exceeded/);
  });

  it('keeps per-task budgets independent across tasks', () => {
    for (let i = 0; i < 3; i++) {
      proxy.consume({
        jsonrpc: '2.0', id: i, method: 'tools/call',
        params: { name: 'mac_bash', arguments: { command: 'ls' } },
      }, 'task-A');
    }
    const taskBFirst = proxy.consume({
      jsonrpc: '2.0', id: 99, method: 'tools/call',
      params: { name: 'mac_bash', arguments: { command: 'ls' } },
    }, 'task-B');
    expect(taskBFirst.kind).toBe('allow');
  });
});

describe('McpAllowlistProxy.denyFrame', () => {
  it('builds a JSON-RPC error object the proxy can return verbatim', () => {
    const decision = proxy.consume({
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: { name: 'mac_evil', arguments: {} },
    }, 't');
    const frame = McpAllowlistProxy.denyFrame(7, decision);
    expect(frame.error.code).toBe(-32001);
    expect(frame.id).toBe(7);
    expect(frame.error.message).toMatch(/mcp-allowlist-proxy/);
  });
});

describe('McpAllowlistProxy.policyName + pinnedSha', () => {
  it('exposes the policy name + pinned SHA for audit logging', () => {
    expect(proxy.policyName).toBe('mac-mcp');
    expect(proxy.pinnedSha).toBe('deadbeefdeadbeefdeadbeef');
  });
});
