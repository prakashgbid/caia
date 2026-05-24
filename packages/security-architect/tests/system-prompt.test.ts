/**
 * System-prompt tests — spec §11(b).
 */
import { describe, it, expect } from 'vitest';
import { OWASP_TOP_10_KEYS, OWASP_TOP_10_NAMES, SECURITY_OWNED_FIELD_KEYS } from '../src/contract.js';
import { buildSecuritySystemPrompt } from '../src/system-prompt.js';

describe('buildSecuritySystemPrompt', () => {
  it('returns a non-empty string', () => {
    const p = buildSecuritySystemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(500);
  });
  it('is deterministic across calls', () => {
    expect(buildSecuritySystemPrompt()).toBe(buildSecuritySystemPrompt());
  });
  it('contains Role section', () => {
    const p = buildSecuritySystemPrompt();
    expect(p).toContain('## Role');
    expect(p).toContain("CAIA's Security Architect");
  });
  it('contains Locked stack section with the locked tech', () => {
    const p = buildSecuritySystemPrompt();
    expect(p).toContain('## Locked stack');
    expect(p).toContain('Cloudflare Access');
    expect(p).toContain('JWT');
    expect(p).toContain('OAuth');
    expect(p).toContain('Vault');
    expect(p).toContain('OWASP');
    expect(p).toContain('schema-per-tenant');
  });
  it('contains Output JSON schema section', () => {
    const p = buildSecuritySystemPrompt();
    expect(p).toContain('## Output JSON schema');
    expect(p).toContain('architectName');
    expect(p).toContain('architectureFields');
    expect(p).toContain('confidence');
    expect(p).toContain('notes');
    expect(p).toContain('risks');
    expect(p).toContain('status');
  });
  it('references every declared owned field at least once', () => {
    const p = buildSecuritySystemPrompt();
    for (const key of SECURITY_OWNED_FIELD_KEYS) expect(p).toContain(key);
  });
  it('references every OWASP Top-10 key at least once', () => {
    const p = buildSecuritySystemPrompt();
    for (const key of OWASP_TOP_10_KEYS) expect(p).toContain(key);
  });
  it('references every OWASP Top-10 human-readable name', () => {
    const p = buildSecuritySystemPrompt();
    for (const key of OWASP_TOP_10_KEYS) expect(p).toContain(OWASP_TOP_10_NAMES[key]);
  });
  it('contains Decision heuristics section with deny-by-default + tenant_id', () => {
    const p = buildSecuritySystemPrompt();
    expect(p).toContain('## Decision heuristics');
    expect(p).toContain('Deny-by-default');
    expect(p).toContain('tenant_id');
  });
  it('contains Refusal patterns section that rejects out-of-namespace writes', () => {
    const p = buildSecuritySystemPrompt();
    expect(p).toContain('## Refusal patterns');
    expect(p).toContain('security.*');
  });
  it('refuses unsafe-inline and unsafe-eval', () => {
    const p = buildSecuritySystemPrompt();
    expect(p).toContain('unsafe-inline');
    expect(p).toContain('unsafe-eval');
    expect(p.toLowerCase()).toContain('never');
  });
  it('contains Self-check section', () => {
    expect(buildSecuritySystemPrompt()).toContain('## Self-check');
  });
  it('contains Examples section pointing at golden fixture', () => {
    const p = buildSecuritySystemPrompt();
    expect(p).toContain('## Examples');
    expect(p).toContain('tests/golden');
  });
  it('size bounded (< 32k chars)', () => {
    expect(buildSecuritySystemPrompt().length).toBeLessThan(32000);
  });
  it('mentions Cloudflare Access as auth default', () => {
    expect(buildSecuritySystemPrompt()).toContain('Cloudflare Access');
  });
  it('mentions @caia/secrets-adapter as the secrets backend', () => {
    expect(buildSecuritySystemPrompt()).toContain('@caia/secrets-adapter');
  });
  it('emphasises wave-2 upstream (backend + database)', () => {
    const p = buildSecuritySystemPrompt();
    expect(p).toContain('upstream');
    expect(p).toContain('backend');
    expect(p).toContain('database');
  });
});
