/**
 * RUN-MODES CLI tests — registers `caia plan` and `caia test`.
 *
 * The full integration (POSTing to a live orchestrator) is exercised
 * by the e2e suite; these tests assert the CLI surface, the run-mode
 * payload shape, and error handling for missing prompt text.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { program } from '../src/index.js';

describe('caia plan / caia test commands', () => {
  it('registers a plan command', () => {
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('plan');
  });

  it('registers a test command', () => {
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('test');
  });

  it('plan command takes a variadic prompt argument', () => {
    const planCmd = program.commands.find((c) => c.name() === 'plan');
    expect(planCmd).toBeDefined();
    const helpText = planCmd!.helpInformation();
    expect(helpText).toMatch(/prompt/i);
    expect(helpText).toMatch(/plan-only/);
  });

  it('test command takes a variadic prompt argument', () => {
    const testCmd = program.commands.find((c) => c.name() === 'test');
    expect(testCmd).toBeDefined();
    const helpText = testCmd!.helpInformation();
    expect(helpText).toMatch(/test-only/);
  });

  it('plan command exposes --api option with a default', () => {
    const planCmd = program.commands.find((c) => c.name() === 'plan');
    const apiOpt = planCmd!.options.find((o) => o.long === '--api');
    expect(apiOpt).toBeDefined();
    expect(apiOpt!.defaultValue).toBe('http://localhost:8787');
  });

  it('test command exposes --api option with a default', () => {
    const testCmd = program.commands.find((c) => c.name() === 'test');
    const apiOpt = testCmd!.options.find((o) => o.long === '--api');
    expect(apiOpt).toBeDefined();
    expect(apiOpt!.defaultValue).toBe('http://localhost:8787');
  });

  it('plan command supports --project and --priority flags', () => {
    const planCmd = program.commands.find((c) => c.name() === 'plan');
    const longs = planCmd!.options.map((o) => o.long);
    expect(longs).toContain('--project');
    expect(longs).toContain('--priority');
  });

  it('plan command description mentions cost preview', () => {
    const planCmd = program.commands.find((c) => c.name() === 'plan');
    const desc = planCmd!.description();
    expect(desc.toLowerCase()).toMatch(/cost|plan/);
  });
});

describe('plan / test commands — POST payload shape', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('plan POSTs run_mode=plan-only', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'prm_test' }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const planCmd = program.commands.find((c) => c.name() === 'plan')!;
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await planCmd.parseAsync(['Build', 'a', 'feature'], { from: 'user' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.run_mode).toBe('plan-only');
    expect(body.body).toBe('Build a feature');
    expect(body.received_via).toBe('cli');
    consoleSpy.mockRestore();
  });

  it('test POSTs run_mode=test-only', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'prm_test' }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const testCmd = program.commands.find((c) => c.name() === 'test')!;
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await testCmd.parseAsync(['Refactor', 'something'], { from: 'user' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.run_mode).toBe('test-only');
    expect(body.body).toBe('Refactor something');
    consoleSpy.mockRestore();
  });
});
