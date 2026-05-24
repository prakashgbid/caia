/**
 * `run()` tests.
 */
import { describe, it, expect } from 'vitest';
import { DEVOPS_ARCHITECT_NAME, DevopsArchitect } from '../src/architect.js';
import { DEVOPS_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildUserPrompt, runDevopsArchitect } from '../src/run.js';
import { buildDevopsSystemPrompt } from '../src/system-prompt.js';
import {
  buildFakeInput, fakeGoldenSpawner, fakeSpawnerReturning,
  goldenAssistantText, goldenExpectedOutput
} from './helpers/fakes.js';

describe('runDevopsArchitect - happy path', () => {
  it('produces an ArchitectOutput with the right architectName', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runDevopsArchitect(buildFakeInput(), { spawner, systemPrompt: buildDevopsSystemPrompt(), architectName: DEVOPS_ARCHITECT_NAME });
    expect(out.architectName).toBe('devops');
  });
  it('output covers every owned field key', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runDevopsArchitect(buildFakeInput(), { spawner, systemPrompt: buildDevopsSystemPrompt(), architectName: DEVOPS_ARCHITECT_NAME });
    for (const k of DEVOPS_OWNED_FIELD_KEYS) expect(out.architectureFields).toHaveProperty(k);
  });
  it('output status is `ok` on the canonical golden text', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runDevopsArchitect(buildFakeInput(), { spawner, systemPrompt: buildDevopsSystemPrompt(), architectName: DEVOPS_ARCHITECT_NAME });
    expect(out.status).toBe('ok');
  });
  it('spend telemetry comes from the spawner, not the assistant', async () => {
    const { fn: spawner } = fakeSpawnerReturning(goldenAssistantText());
    const out = await runDevopsArchitect(buildFakeInput(), { spawner, systemPrompt: buildDevopsSystemPrompt(), architectName: DEVOPS_ARCHITECT_NAME });
    expect(out.spend.inputTokens).toBe(1000);
    expect(out.spend.outputTokens).toBe(500);
    expect(out.spend.usdCost).toBe(0.01);
    expect(out.spend.wallClockMs).toBe(1234);
    expect(out.spend.model).toBe('sonnet');
  });
  it('passes the system prompt to the spawner', async () => {
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runDevopsArchitect(buildFakeInput(), { spawner, systemPrompt: buildDevopsSystemPrompt(), architectName: DEVOPS_ARCHITECT_NAME });
    expect(calls[0]?.systemPrompt).toBe(buildDevopsSystemPrompt());
  });
  it('passes the projected user prompt to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runDevopsArchitect(input, { spawner, systemPrompt: buildDevopsSystemPrompt(), architectName: DEVOPS_ARCHITECT_NAME });
    expect(calls[0]?.userPrompt).toBe(buildUserPrompt(input));
  });
  it('passes the budget through to the spawner', async () => {
    const input = buildFakeInput();
    const { fn: spawner, calls } = fakeGoldenSpawner();
    await runDevopsArchitect(input, { spawner, systemPrompt: buildDevopsSystemPrompt(), architectName: DEVOPS_ARCHITECT_NAME });
    expect(calls[0]?.budget).toEqual(input.budget);
  });
});

describe('runDevopsArchitect - idempotency', () => {
  it('same input -> same output', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = await runDevopsArchitect(buildFakeInput(), { spawner, systemPrompt: buildDevopsSystemPrompt(), architectName: DEVOPS_ARCHITECT_NAME });
    const b = await runDevopsArchitect(buildFakeInput(), { spawner, systemPrompt: buildDevopsSystemPrompt(), architectName: DEVOPS_ARCHITECT_NAME });
    expect(a).toEqual(b);
  });
  it('re-run REPLACES architectureFields (no append)', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const r1 = await runDevopsArchitect(buildFakeInput(), { spawner, systemPrompt: buildDevopsSystemPrompt(), architectName: DEVOPS_ARCHITECT_NAME });
    const r2 = await runDevopsArchitect(buildFakeInput(), { spawner, systemPrompt: buildDevopsSystemPrompt(), architectName: DEVOPS_ARCHITECT_NAME });
    expect(Object.keys(r2.architectureFields).sort()).toEqual(Object.keys(r1.architectureFields).sort());
    expect(Object.keys(r2.architectureFields).length).toBe(DEVOPS_OWNED_FIELD_KEYS.length);
  });
});

describe('runDevopsArchitect - failure modes', () => {
  it('returns status=failed when the spawner fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('', false);
    const out = await runDevopsArchitect(buildFakeInput(), { spawner, systemPrompt: buildDevopsSystemPrompt(), architectName: DEVOPS_ARCHITECT_NAME });
    expect(out.status).toBe('failed');
    expect(out.failureReason).toBeTruthy();
    expect(Object.keys(out.architectureFields)).toEqual([]);
  });
  it('failed-spawn output still declares [backend,database,security] dependencies', async () => {
    const { fn: spawner } = fakeSpawnerReturning('', false);
    const out = await runDevopsArchitect(buildFakeInput(), { spawner, systemPrompt: buildDevopsSystemPrompt(), architectName: DEVOPS_ARCHITECT_NAME });
    expect(out.dependencies).toEqual(['backend', 'database', 'security']);
  });
  it('returns status=partial when validation fails', async () => {
    const { fn: spawner } = fakeSpawnerReturning('{"architectName":"devops"}');
    const out = await runDevopsArchitect(buildFakeInput(), { spawner, systemPrompt: buildDevopsSystemPrompt(), architectName: DEVOPS_ARCHITECT_NAME });
    expect(out.status).toBe('partial');
    expect(out.failureReason).toBeTruthy();
    expect(out.risks.length).toBeGreaterThan(0);
  });
  it('partial-validation output still declares [backend,database,security] dependencies', async () => {
    const { fn: spawner } = fakeSpawnerReturning('{"architectName":"devops"}');
    const out = await runDevopsArchitect(buildFakeInput(), { spawner, systemPrompt: buildDevopsSystemPrompt(), architectName: DEVOPS_ARCHITECT_NAME });
    expect(out.dependencies).toEqual(['backend', 'database', 'security']);
  });
  it('returns status=partial when assistant text is not JSON', async () => {
    const { fn: spawner } = fakeSpawnerReturning('not json at all');
    const out = await runDevopsArchitect(buildFakeInput(), { spawner, systemPrompt: buildDevopsSystemPrompt(), architectName: DEVOPS_ARCHITECT_NAME });
    expect(out.status).toBe('partial');
  });
});

describe('runDevopsArchitect - dependency declaration', () => {
  it('always declares [backend, database, security] as upstream', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await runDevopsArchitect(buildFakeInput(), { spawner, systemPrompt: buildDevopsSystemPrompt(), architectName: DEVOPS_ARCHITECT_NAME });
    expect(out.dependencies).toContain('backend');
    expect(out.dependencies).toContain('database');
    expect(out.dependencies).toContain('security');
  });
  it('preserves sibling-ticket IDs alongside upstream architects', async () => {
    const c = { ...goldenExpectedOutput(), dependencies: ['ticket-pt-001'] };
    const { fn: spawner } = fakeSpawnerReturning(JSON.stringify(c));
    const out = await runDevopsArchitect(buildFakeInput(), { spawner, systemPrompt: buildDevopsSystemPrompt(), architectName: DEVOPS_ARCHITECT_NAME });
    expect(out.dependencies).toContain('backend');
    expect(out.dependencies).toContain('database');
    expect(out.dependencies).toContain('security');
    expect(out.dependencies).toContain('ticket-pt-001');
  });
  it('does not duplicate upstream architects in dependencies', async () => {
    const c = { ...goldenExpectedOutput(), dependencies: ['backend', 'database', 'security', 'backend'] };
    const { fn: spawner } = fakeSpawnerReturning(JSON.stringify(c));
    const out = await runDevopsArchitect(buildFakeInput(), { spawner, systemPrompt: buildDevopsSystemPrompt(), architectName: DEVOPS_ARCHITECT_NAME });
    const counts = new Map<string, number>();
    for (const d of out.dependencies) counts.set(d, (counts.get(d) ?? 0) + 1);
    expect(counts.get('backend')).toBe(1);
    expect(counts.get('database')).toBe(1);
    expect(counts.get('security')).toBe(1);
  });
});

describe('buildUserPrompt', () => {
  it('serialises the ticket', () => { expect(buildUserPrompt(buildFakeInput())).toContain('ticket-pt-devops-001'); });
  it('serialises Backend upstream (apiEndpoints)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('POST');
    expect(p).toContain('/api/contacts');
    expect(p).toContain('backend.apiEndpoints');
  });
  it('serialises Database upstream (migrations)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('database.migrations');
    expect(p).toContain('0001_create_contacts');
  });
  it('serialises Security upstream (secretsHandling)', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('security.secretsHandling');
  });
  it('includes vaultNamespace', () => { expect(buildUserPrompt(buildFakeInput())).toContain('tenant/prakash-tiwari'); });
  it('includes schemaName', () => { expect(buildUserPrompt(buildFakeInput())).toContain('tenant_prakash_tiwari'); });
  it('includes tenantId', () => { expect(buildUserPrompt(buildFakeInput())).toContain('tenant-prakash-tiwari'); });
  it('includes onboarding infrastructure choices', () => {
    const p = buildUserPrompt(buildFakeInput());
    expect(p).toContain('github-actions');
    expect(p).toContain('cloudflare');
    expect(p).toContain('terraform');
  });
  it('passes through reviewer feedback', () => {
    const input = { ...buildFakeInput(), reviewerFeedback: { reason: 'pick rolling instead of canary', severity: 'P1' as const } };
    expect(buildUserPrompt(input)).toContain('pick rolling instead of canary');
  });
});

describe('DevopsArchitect - class-level integration', () => {
  it('uses the architect class with a fake spawner', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const a = new DevopsArchitect({ spawner });
    const out = await a.run(buildFakeInput());
    expect(out.architectName).toBe('devops');
    expect(out.status).toBe('ok');
  });
});
