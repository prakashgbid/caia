import { describe, it, expect } from 'vitest';
import { runCompletenessLens } from '../src/completeness.js';
import {
  audit,
  cleanComposedArchitecture,
  cleanContracts,
  makeContract,
} from './fixtures.js';

describe('completeness lens', () => {
  it('passes on a clean composed architecture', () => {
    const findings = runCompletenessLens({
      composedArchitecture: cleanComposedArchitecture(),
      auditRows: cleanContracts().map((c) => audit(c.architectName)),
      contracts: cleanContracts(),
    });
    expect(findings).toEqual([]);
  });

  it('flags missing required paths', () => {
    const composed = { ...cleanComposedArchitecture() };
    delete composed['a11y.wcagLevel'];
    const findings = runCompletenessLens({
      composedArchitecture: composed,
      auditRows: cleanContracts().map((c) => audit(c.architectName)),
      contracts: cleanContracts(),
    });
    expect(findings.length).toBe(1);
    expect(findings[0]).toMatchObject({
      architect: 'a11y',
      missingPath: 'a11y.wcagLevel',
    });
  });

  it('treats null and empty-string values as missing', () => {
    const composed = { ...cleanComposedArchitecture(), 'a11y.wcagLevel': null };
    const findings = runCompletenessLens({
      composedArchitecture: composed,
      auditRows: cleanContracts().map((c) => audit(c.architectName)),
      contracts: cleanContracts(),
    });
    expect(findings.length).toBe(1);
  });

  it("skips architects that didn't run (no audit row)", () => {
    const findings = runCompletenessLens({
      composedArchitecture: {},
      auditRows: [],
      contracts: [makeContract('ghost', ['ghost.a'])],
    });
    expect(findings).toEqual([]);
  });

  it('reports failed architects with a single <all> placeholder', () => {
    const findings = runCompletenessLens({
      composedArchitecture: {},
      auditRows: [audit('bad', { status: 'failed' })],
      contracts: [makeContract('bad', ['bad.a', 'bad.b', 'bad.c'])],
    });
    expect(findings.length).toBe(1);
    expect(findings[0]?.missingPath).toBe('<all>');
  });

  it('honors a custom severity', () => {
    const composed = { ...cleanComposedArchitecture() };
    delete composed['a11y.wcagLevel'];
    const findings = runCompletenessLens({
      composedArchitecture: composed,
      auditRows: cleanContracts().map((c) => audit(c.architectName)),
      contracts: cleanContracts(),
      missingRequiredSeverity: 'P0',
    });
    expect(findings[0]?.severity).toBe('P0');
  });

  it('ignores non-required paths', () => {
    const contract = {
      contractId: 'foo.v1',
      architectName: 'foo',
      version: '0.1.0',
      sections: [
        { path: 'foo.req', description: 'r', required: true },
        { path: 'foo.opt', description: 'o', required: false },
      ],
      architectMeta: {
        dependsOn: [],
        precedenceLevel: 99,
        fanoutPolicy: 'always' as const,
        appliesPredicate: () => true,
        runtimeModel: 'sonnet' as const,
      },
    };
    const findings = runCompletenessLens({
      composedArchitecture: { 'foo.req': 1 }, // opt is missing but not required
      auditRows: [audit('foo')],
      contracts: [contract],
    });
    expect(findings).toEqual([]);
  });
});
