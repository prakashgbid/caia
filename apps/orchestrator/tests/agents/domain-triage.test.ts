/**
 * Domain Triage classifier tests (EA-MESH-002).
 *
 * Covers keyword-pass triage (deterministic) plus LLM-fallback resilience
 * when the local-llm-router throws. Macro-domains: ui, backend, data,
 * platform, quality-security, integrations.
 */

import { runDomainTriage, MACRO_DOMAINS, type MacroDomain } from '../../src/agents/domain-triage';
import * as router from '@chiefaia/local-llm-router';

jest.mock('@chiefaia/local-llm-router', () => ({
  __esModule: true,
  route: jest.fn(),
}));

const routeMock = router.route as jest.MockedFunction<typeof router.route>;

describe('runDomainTriage', () => {
  beforeEach(() => {
    routeMock.mockReset();
  });

  it('classifies a simple UI feature as ui', async () => {
    const result = await runDomainTriage(
      {
        title: 'Add user profile page',
        description: 'Create a React component to display user avatar and display-name',
        primaryDomain: 'ui-frontend',
      },
      { keywordOnly: true },
    );
    expect(result.inScopeDomains).toContain('ui');
  });

  it('classifies cross-domain stories as multiple domains', async () => {
    const result = await runDomainTriage(
      {
        title: 'Add real-time notifications',
        description:
          'WebSocket UI component, BFF subscription route, notifications DB table, observability metrics',
        primaryDomain: 'api-integration',
      },
      { keywordOnly: true },
    );
    expect(result.inScopeDomains).toEqual(
      expect.arrayContaining(['ui', 'backend', 'data', 'platform']),
    );
  });

  it('classifies data migration as data domain', async () => {
    const result = await runDomainTriage(
      {
        title: 'Migrate orders to event sourcing',
        description: 'Design event log, projections, and backfill strategy from CRUD',
        primaryDomain: 'data-storage',
      },
      { keywordOnly: true },
    );
    expect(result.inScopeDomains).toContain('data');
  });

  it('classifies a11y/security work as quality-security', async () => {
    const result = await runDomainTriage(
      {
        title: 'Add WCAG 2.1 AA conformance tests',
        description: 'axe-core audit pipeline, CI job that fails on regressions',
        primaryDomain: 'ui-frontend',
      },
      { keywordOnly: true },
    );
    expect(result.inScopeDomains).toContain('quality-security');
  });

  it('classifies infrastructure work as platform', async () => {
    const result = await runDomainTriage(
      {
        title: 'Add observability instrumentation',
        description: 'Add logging, metrics, and traces to all services',
        primaryDomain: 'devops',
      },
      { keywordOnly: true },
    );
    expect(result.inScopeDomains).toContain('platform');
  });

  it('classifies Stripe integration as integrations', async () => {
    const result = await runDomainTriage(
      {
        title: 'Add Stripe checkout',
        description: 'Integrate Stripe payment API, handle webhooks',
        primaryDomain: 'api-integration',
      },
      { keywordOnly: true },
    );
    expect(result.inScopeDomains).toContain('integrations');
  });

  it('defaults to backend if no domains match the keyword pass', async () => {
    const result = await runDomainTriage(
      {
        title: 'Update README',
        description: 'Make the documentation more descriptive',
        primaryDomain: 'backend',
      },
      { keywordOnly: true },
    );
    expect(result.inScopeDomains).toContain('backend');
  });

  it('returns sorted domains', async () => {
    const result = await runDomainTriage(
      {
        title: 'Add real-time notifications with secure auth',
        description: 'WebSocket, BFF, DB, observability, security audit',
        primaryDomain: 'api-integration',
      },
      { keywordOnly: true },
    );
    expect(result.inScopeDomains).toEqual([...result.inScopeDomains].sort());
  });

  it('falls back to keyword pass when the LLM call rejects', async () => {
    routeMock.mockRejectedValueOnce(new Error('Ollama unavailable'));

    const result = await runDomainTriage({
      title: 'Add user profile page with database',
      description: 'React component + Postgres schema + API route',
      primaryDomain: 'api-integration',
    });

    expect(result.inScopeDomains).toBeDefined();
    expect(result.inScopeDomains.length).toBeGreaterThan(0);
  });

  it('flags all six domains for an end-to-end e-commerce story', async () => {
    const result = await runDomainTriage(
      {
        title: 'E-commerce checkout feature',
        description: `
          UI: React checkout flow
          Backend: BFF /checkout route, order service, payment orchestration
          Data: orders table, payment logs
          Platform: observability for payment pipeline
          Quality: security audit, payment compliance
          Integrations: Stripe API, analytics
        `,
        primaryDomain: 'api-integration',
      },
      { keywordOnly: true },
    );
    expect(result.inScopeDomains).toEqual(
      expect.arrayContaining(['ui', 'backend', 'data', 'platform', 'quality-security', 'integrations']),
    );
  });

  it('returns only valid macro-domain values', async () => {
    routeMock.mockRejectedValue(new Error('skip llm'));
    const result = await runDomainTriage({
      title: 'Any ticket',
      description: 'Any description',
    });
    for (const domain of result.inScopeDomains) {
      expect(MACRO_DOMAINS).toContain(domain as MacroDomain);
    }
  });
});
