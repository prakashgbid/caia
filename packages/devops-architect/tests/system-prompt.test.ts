/**
 * System-prompt tests.
 */
import { describe, it, expect } from 'vitest';
import { CICD_PROVIDERS, DEPLOY_STRATEGIES, DEVOPS_OWNED_FIELD_KEYS, IAC_TOOLS } from '../src/contract.js';
import { buildDevopsSystemPrompt } from '../src/system-prompt.js';

describe('buildDevopsSystemPrompt', () => {
  it('returns a non-empty string', () => {
    const p = buildDevopsSystemPrompt();
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(500);
  });
  it('is deterministic across calls', () => {
    expect(buildDevopsSystemPrompt()).toBe(buildDevopsSystemPrompt());
  });
  it('contains the Role section', () => {
    const p = buildDevopsSystemPrompt();
    expect(p).toContain('## Role');
    expect(p).toContain("CAIA's DevOps/Deployment Architect");
  });
  it('mentions that it is DISTINCT from deploy-steward', () => {
    const p = buildDevopsSystemPrompt();
    expect(p).toContain('deploy-steward');
    expect(p).toContain('EXECUTES');
  });
  it('mentions that it is DISTINCT from QA Engineer', () => {
    const p = buildDevopsSystemPrompt();
    expect(p).toContain('QA Engineer');
  });
  it('contains the Locked stack section', () => {
    const p = buildDevopsSystemPrompt();
    expect(p).toContain('## Locked stack');
    expect(p).toContain('GitHub Actions');
    expect(p).toContain('Terraform');
    expect(p).toContain('Cloudflare');
  });
  it('lists every CI/CD provider', () => {
    const p = buildDevopsSystemPrompt();
    for (const pr of CICD_PROVIDERS) expect(p).toContain(pr);
  });
  it('lists every IaC tool', () => {
    const p = buildDevopsSystemPrompt();
    for (const t of IAC_TOOLS) expect(p).toContain(t);
  });
  it('lists every deploy strategy', () => {
    const p = buildDevopsSystemPrompt();
    for (const s of DEPLOY_STRATEGIES) expect(p).toContain(s);
  });
  it('declares the deploy-strategy realism table', () => {
    const p = buildDevopsSystemPrompt();
    expect(p).toContain('two-identical-environments');
    expect(p).toContain('traffic-split');
    expect(p).toContain('multi-region');
    expect(p).toContain('multi-instance');
  });
  it('contains the Output JSON schema section', () => {
    const p = buildDevopsSystemPrompt();
    expect(p).toContain('## Output JSON schema');
    expect(p).toContain('architectName');
    expect(p).toContain('architectureFields');
    expect(p).toContain('confidence');
    expect(p).toContain('notes');
    expect(p).toContain('risks');
    expect(p).toContain('status');
  });
  it('references every declared owned field at least once', () => {
    const p = buildDevopsSystemPrompt();
    for (const key of DEVOPS_OWNED_FIELD_KEYS) {
      expect(p).toContain(key);
    }
  });
  it('contains the Decision heuristics section', () => {
    const p = buildDevopsSystemPrompt();
    expect(p).toContain('## Decision heuristics');
    expect(p).toContain('Healthcheck gate is non-negotiable');
  });
  it('contains a Refusal patterns section that rejects out-of-namespace writes', () => {
    const p = buildDevopsSystemPrompt();
    expect(p).toContain('## Refusal patterns');
    expect(p).toContain('devops.*');
  });
  it('contains a Self-check section', () => {
    const p = buildDevopsSystemPrompt();
    expect(p).toContain('## Self-check');
  });
  it('contains an Examples section pointing at golden fixture', () => {
    const p = buildDevopsSystemPrompt();
    expect(p).toContain('## Examples');
    expect(p).toContain('tests/golden');
  });
  it('does not refer to fields outside the `devops.*` namespace as owned', () => {
    const p = buildDevopsSystemPrompt();
    // While `devops.*` may reference other architects' fields by name for
    // cross-validation, none of the foreign field paths should appear in
    // the architectureFields schema list.
    const foreignAsOwned = [
      '"frontend.componentTree"',
      '"backend.apiEndpoints" :',
      '"database.tables" :',
      '"a11y.conformanceMap"'
    ];
    for (const k of foreignAsOwned) expect(p).not.toContain(k);
  });
  it('size is bounded (token-budget proxy: < 24k chars)', () => {
    expect(buildDevopsSystemPrompt().length).toBeLessThan(24_000);
  });
});
