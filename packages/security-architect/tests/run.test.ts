/**
 * `run()` tests.
 */
import { describe, it, expect } from 'vitest';
import { SECURITY_ARCHITECT_NAME, SecurityArchitect } from '../src/architect.js';
import { SECURITY_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildUserPrompt, runSecurityArchitect } from '../src/run.js';
import { buildSecuritySystemPrompt } from '../src/system-prompt.js';
import {
  buildFakeInput, fakeGoldenSpawner, fakeSpawnerReturning,
  goldenAssistantText, goldenExpectedOutput
} from './helpers/fakes.js';

describe('runSecurityArchitect — happy path', () => {
  it('produces an ArchitectOutput with the right architectName', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runSecurityArchitect(buildFakeInput(), { spawner, systemPrompt: buildSecuritySystemPrompt(), architectName: SECURITY_ARCHITECT_NAME });
    expect(out.architectName).toBe('security');
  });
  it('output covers every owned field key', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runSecurityArchitect(buildFakeInput(), { spawner, systemPrompt: buildSecuritySystemPrompt(), architectName: SECURITY_ARCHITECT_NAME });
    for (const k of SECURITY_OWNED_FIELD_KEYS) expect(out.architectureFields).toHaveProperty(k);
  });
  it('output status is `ok` on the canonical golden text', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runSecurityArchitect(buildFakeInput(), { spawner, systemPrompt: buildSecuritySystemPrompt(), architectName: SECURITY_ARCHITECT_NAME });
    expect(out.status).toBe('ok');
  });
  it('spend telemetry comes from the spawner, not the assistant', async () => {
    const { fn: spawner } = fakeSpawnerReturning(goldenAssistantText());
    const out = await runSecurityArchitect(buildFakeInput(), { spawner, systemPrompt: buildSecuritySystemPrompt(), architectName: SECURITY_ARCHITECT_NAME });
    expect(out.spend.inputTokens).toBe(1000);
    expect(out.spend.outputTokens).toBe(500);
    expect(out.spend.usdCost).toBe(0.01);
    expect(out.spend.wallClockMs).toBe(1234);
    expect(out.spend.model).toBe('sonnet');
  });
  it('passes the system prompt to the spawner', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runSecurityArchitect(buildFakeInput(), { spawner, systemPrompt: buildSecuritySystemPrompt(), architectName: SECURITY_ARCHITECT_NAME });
    expect(calls[0]?.systemPrompt).toBe(buildSecuritySystemPrompt());
  });
  it('passes the projected user prompt to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runSecurityArchitect(input, { spawner, systemPrompt: buildSecuritySystemPrompt(), architectName: SECURITY_ARCHITECT_NAME });
    expect(calls[0]?.userPrompt).toBe(buildUserPrompt(input));
  });
  it('passes the budget through to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runSecurityArchitect(input, { spawner, systemPrompt: buildSecuritySystemPrompt(), architectName: SECURITY_ARCHITECT_NAME });
    expect(calls[0]?.budget).toEqual(input.budget);
  });
});

describe('runSecurityArchitect — idempotency', () => {
  it('same input → same output', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = await runSecurityArchitect(buildFakeInput(), { spawner, systemPrompt: buildSecuritySystemPrompt(), architectName: SECURITY_ARCHITECT_NAME });
    const b = await runSecurityArchitect(buildFakeInput(), { spawner, systemPrompt: buildSecuritySystemPrompt(), architectName: SECURITY_ARCHITECT_NAME });
    expect(a).toEqual(b);
  });
  it('re-run REPLACES architectureFields (no append)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const r1 = await runSecurityArchitect(buildFakeInput(), { spawner, systemPrompt: buildSecuritySystemPrompt(), architectName: SECURITY_ARCHITECT_NAME });
    const r2 = await runSecurityArchitect(buildFakeInput(), { spawner, systemPrompt: buildSecuritySystemPrompt(), architectName: SECURITY_ARCHITECT_NAME });
    expect(Object.keys(r2.architectureFields).sort()).toEqual(Object.keys(r1.architectureFields).sort());
    expect(Object.keys(r2.architectureFields).length).toBe(SECURITY_OWNED_FIELD_KEYS.length);
  });
});

describe('runSecurityArchitect — failure modes', () => {
  it('returns status=failed when the spawner fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('', false);
    const out = await runSecurityArchitect(buildFakeInput(), { spawner, systemPrompt: buildSecuritySystemPrompt(), architectName: SECURITY_ARCHITECT_NAME });
    expect(out.status).toBe('failed');
    expect(out.failureReason).toBeTruthy();
    expect(Object.keys(out.architectureFields)).toEqual([]);
  });
  it('failed-spawn output still declares [backend,database] dependencies', async () => {
    const { fn: spawner } = fakeSpawnerReturning('', false);
    const out = await runSecurityArchitect(buildFakeInput(), { spawner, systemPrompt: buildSecuritySystemPrompt(), architectName: SECURITY_ARCHITECT_NAME });
    expect(out.dependencies).toEqual(['backend', 'database']);
  });
  it('returns status=partial when validation fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('{"architectName":"security"}');
    const out = await runSecurityArchitect(buildFakeInput(), { spawner, systemPrompt: buildSecuritySystemPrompt(), architectName: SECURITY_ARCHITECT_NAME });
    expect(out.status).toBe('partial');
    expect(out.failureReason).toBeTruthy();
    expect(out.risks.length).toBeGreaterThan(0);
  });
  it('partial-validation output still declares [backend,database] dependencies', async () => {
    const { fn: spawner } = fakeSpawnerReturning('{"architectName":"security"}');
    const out = await runSecurityArchitect(buildFakeInput(), { spawner, systemPrompt: buildSecuritySystemPrompt(), architectName: SECURITY_ARCHITECT_NAME });
    expect(out.dependencies).toEqual(['backend', 'database']);
  });
  it('returns status=partial when assistant text is not JSON', async () => {
    const { fn: spawner } = fakeSpawnerReturning('not json at all');
    const out = await runSecurityArchitect(buildFakeInput(), { spawner, systemPrompt: buildSecuritySystemPrompt(), architectName: SECURITY_ARCHITECT_NAME });
    expect(out.status).toBe('partial');
  });
});

describe('runSecurityArchitect — dependency declaration', () => {
  it('always declares [backend, database] as upstream', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runSecurityArchitect(buildFakeInput(), { spawner, systemPrompt: buildSecuritySystemPrompt(), architectName: SECURITY_ARCHITECT_NAME });
    expect(out.dependencies).toContain('backend');
    expect(out.dependencies).toContain('database');
  });
  it('preserves sibling-ticket IDs alongside upstream architects', async () => {
    const c = { ...goldenExpectedOutput(), dependencies: ['ticket-pt-001'] };
    const { fn: spawner } = fakeSpawnerReturning(JSON.stringify(c));
    const out = await runSecurityArchitect(buildFakeInput(), { spawner, systemPrompt: buildSecuritySystemPrompt(), architectName: SECURITY_ARCHITECT_NAME });
    expect(out.dependencies).toContain('backend');
    expect(out.dependencies).toContain('database');
    expect(out.dependencies).toContain('ticket-pt-001');
  });
  it('does not duplicate upstream architects in dependencies', async () => {
    const c = { ...goldenExpectedOutput(), dependencies: ['backend', 'database', 'backend'] };
    const { fn: spawner } = fakeSpawnerReturning(JSON.stringify(c));
    const out = await runSecurityArchitect(buildFakeInput(), { spawner, systemPrompt: buildSecuritySystemPrompt(), architectName: SECURITY_ARCHITECT_NAME });
    const counts = new Map<string, number>();
    for (const d of out.dependencies) counts.set(d, (counts.get(d) ?? 0) + 1);
    expect(counts.get('backend')).toBe(1);
    expect(counts.get('database')).toBe(1);
  });
});

describe('buildUserPrompt', () => {
  it('serialises the ticket', () => { expect(buildUserPrompt(buildFakeInput())).toContain('ticket-pt-sec-001'); });
  it('serialises Backend upstream (apiEndpoints)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('POST');
    expect(p).toContain('/api/contacts');
    expect(p).toContain('backend.apiEndpoints');
  });
  it('serialises Database upstream (rlsPolicies)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('database.rlsPolicies');
    expect(p).toContain('tenant_isolation');
  });
  it('includes vaultNamespace', () => { expect(buildUserPrompt(buildFakeInput())).toContain('tenant/prakash-tiwari'); });
  it('includes schemaName', () => { expect(buildUserPrompt(buildFakeInput())).toContain('tenant_prakash_tiwari'); });
  it('includes tenantId', () => { expect(buildUserPrompt(buildFakeInput())).toContain('tenant-prakash-tiwari'); });
  it('passes through reviewer feedback', () => {
    const input = { ...buildFakeInput(), reviewerFeedback: { reason: 'CSP must use strict-dynamic', severity: 'P1' as const } };
    expect(buildUserPrompt(input)).toContain('CSP must use strict-dynamic');
  });
});

describe('SecurityArchitect — class-level integration', () => {
  it('uses the architect class with a fake spawner', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new SecurityArchitect({ spawner });
    const out = await a.run(buildFakeInput());
    expect(out.architectName).toBe('security');
    expect(out.status).toBe('ok');
  });
});
