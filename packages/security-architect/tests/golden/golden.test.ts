/**
 * Golden test — canonical Security-architect artifact for a known
 * prakash-tiwari contact-form Story ticket.
 *
 * Locks output shape against drift + verifies end-to-end output +
 * **OWASP TOP-10 GOLDEN**: every category covered with verdict +
 * mitigations + evidence refs + idempotency + dependency declaration.
 */
import { describe, it, expect } from 'vitest';
import { SecurityArchitect } from '../../src/architect.js';
import { OWASP_TOP_10_KEYS, OWASP_TOP_10_NAMES, SECURITY_OWNED_FIELD_KEYS } from '../../src/contract.js';
import { SECURITY_INVARIANTS } from '../../src/invariants.js';
import { validateArchitectOutput } from '../../src/validation.js';
import { buildFakeInput, fakeGoldenSpawner, goldenAssistantText, goldenExpectedOutput } from '../helpers/fakes.js';

describe('golden — prakash-tiwari contact-form Form Story ticket', () => {
  it('assistant text validates cleanly', () => {
    expect(validateArchitectOutput(goldenAssistantText(), SECURITY_OWNED_FIELD_KEYS).ok).toBe(true);
  });

  it('end-to-end produces the canonical ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await new SecurityArchitect({ spawner }).run(buildFakeInput());
    expect(out.architectName).toBe('security');
    expect(out.status).toBe('ok');
    expect(out.confidence).toBeGreaterThan(0.5);
    for (const k of SECURITY_OWNED_FIELD_KEYS) expect(out.architectureFields).toHaveProperty(k);
    const expected = goldenExpectedOutput();
    expect(out.architectureFields).toEqual(expected.architectureFields);
    expect(out.confidence).toBe(expected.confidence);
    expect(out.notes).toBe(expected.notes);
    expect(out.risks).toEqual(expected.risks);
    expect(out.dependencies).toEqual(expected.dependencies);
  });

  it('output passes every Security invariant', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await new SecurityArchitect({ spawner }).run(buildFakeInput());
    for (const inv of SECURITY_INVARIANTS) {
      expect(inv.detect(out.architectureFields), `invariant ${inv.id}`).toBe(true);
    }
  });

  it('idempotent — running twice yields equivalent output', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new SecurityArchitect({ spawner });
    expect(await arch.run(buildFakeInput())).toEqual(await arch.run(buildFakeInput()));
  });

  it('always declares [backend, database] as dependencies', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const out = await new SecurityArchitect({ spawner }).run(buildFakeInput());
    expect(out.dependencies).toContain('backend');
    expect(out.dependencies).toContain('database');
  });
});

describe('golden — OWASP TOP-10 coverage (canonical assertion)', () => {
  const arch = goldenExpectedOutput().architectureFields;
  const owasp = arch['security.owaspMitigations'] as Record<string, unknown>;

  it('declares entry for every OWASP Top-10 2021 key (A01..A10)', () => {
    for (const k of OWASP_TOP_10_KEYS) {
      expect(owasp, `owaspMitigations must contain ${k} (${OWASP_TOP_10_NAMES[k]})`).toHaveProperty(k);
    }
  });

  it('every entry declares a verdict in {mitigated, accepted-risk, not-applicable}', () => {
    const allowed = new Set(['mitigated', 'accepted-risk', 'not-applicable']);
    for (const k of OWASP_TOP_10_KEYS) {
      const entry = owasp[k] as Record<string, unknown>;
      expect(entry.verdict).toBeDefined();
      expect(allowed.has(entry.verdict as string)).toBe(true);
    }
  });

  it('every entry declares at least one concrete mitigation', () => {
    for (const k of OWASP_TOP_10_KEYS) {
      const entry = owasp[k] as Record<string, unknown>;
      const mits = entry.mitigations as unknown[];
      expect(Array.isArray(mits)).toBe(true);
      expect(mits.length).toBeGreaterThan(0);
      for (const m of mits) {
        expect(typeof m).toBe('string');
        expect((m as string).length).toBeGreaterThan(5);
      }
    }
  });

  it('every entry declares at least one evidence reference', () => {
    for (const k of OWASP_TOP_10_KEYS) {
      const entry = owasp[k] as Record<string, unknown>;
      const refs = entry.evidenceRefs as unknown[];
      expect(Array.isArray(refs)).toBe(true);
      expect(refs.length).toBeGreaterThan(0);
    }
  });

  it('all 10 verdicts in the golden are `mitigated`', () => {
    for (const k of OWASP_TOP_10_KEYS) {
      const entry = owasp[k] as Record<string, unknown>;
      expect(entry.verdict).toBe('mitigated');
    }
  });

  it('A01 cross-references authorization + RLS', () => {
    const refs = (owasp.a01_brokenAccessControl as Record<string, unknown>).evidenceRefs as string[];
    expect(refs.some(r => r.includes('authorization'))).toBe(true);
    expect(refs.some(r => r.includes('rlsPolicies'))).toBe(true);
  });

  it('A03 cross-references inputValidation', () => {
    const refs = (owasp.a03_injection as Record<string, unknown>).evidenceRefs as string[];
    expect(refs.some(r => r.includes('inputValidation'))).toBe(true);
  });

  it('A07 cross-references authenticationStrategy + auditLog', () => {
    const refs = (owasp.a07_authFailures as Record<string, unknown>).evidenceRefs as string[];
    expect(refs.some(r => r.includes('authenticationStrategy'))).toBe(true);
    expect(refs.some(r => r.includes('audit'))).toBe(true);
  });

  it('A09 cross-references auditLogRequirements', () => {
    const refs = (owasp.a09_loggingMonitoringFailures as Record<string, unknown>).evidenceRefs as string[];
    expect(refs.some(r => r.includes('audit'))).toBe(true);
  });
});

describe('golden — upstream cross-validation', () => {
  it('input includes Backend upstream output', () => {
    const input = buildFakeInput();
    expect(input.upstream.outputs.backend).toBeDefined();
    expect(input.upstream.outputs.backend!.architectureFields['backend.apiEndpoints']).toBeDefined();
  });

  it('input includes Database upstream output', () => {
    const input = buildFakeInput();
    expect(input.upstream.outputs.database).toBeDefined();
    expect(input.upstream.outputs.database!.architectureFields['database.rlsPolicies']).toBeDefined();
  });

  it('golden tenantIsolationGuarantees matches Database tenantIsolationStrategy', () => {
    const input = buildFakeInput();
    const dbModel = (input.upstream.outputs.database!.architectureFields['database.tenantIsolationStrategy'] as Record<string, unknown>).model;
    const secModel = (goldenExpectedOutput().architectureFields['security.tenantIsolationGuarantees'] as Record<string, unknown>).model;
    expect(secModel).toBe(dbModel);
  });

  it('golden inputValidation references Backend `ContactCreate` schema', () => {
    const iv = goldenExpectedOutput().architectureFields['security.inputValidation'] as Record<string, unknown>;
    const perEndpoint = iv.perEndpoint as Record<string, unknown>;
    const endpoint = perEndpoint['POST /api/contacts'] as Record<string, unknown>;
    expect(endpoint.requestSchemaRef).toBe('ContactCreate');
  });

  it('golden Security rate limit tightens Backend (never loosens)', () => {
    const input = buildFakeInput();
    const bk = (input.upstream.outputs.backend!.architectureFields['backend.rateLimits'] as Record<string, unknown>).perEndpoint as Record<string, unknown>;
    const sec = (goldenExpectedOutput().architectureFields['security.rateLimitingRules'] as Record<string, unknown>).perEndpoint as Record<string, unknown>;
    expect((sec['POST /api/contacts'] as Record<string, unknown>).max as number).toBeLessThanOrEqual((bk['POST /api/contacts'] as Record<string, unknown>).max as number);
  });
});
