import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runDomainTriage, MACRO_DOMAINS, type MacroDomain } from '../domain-triage';
import * as router from '@chiefaia/local-llm-router';

// Mock the router
vi.mock('@chiefaia/local-llm-router', () => ({
  route: vi.fn(),
}));

describe('runDomainTriage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should classify simple UI feature as ui only', async () => {
    const result = await runDomainTriage(
      {
        title: 'Add user profile page',
        description: 'Create a React component to display user avatar and display-name',
        primaryDomain: 'ui-frontend',
      },
      { keywordOnly: true }, // Skip LLM for determinism
    );

    expect(result.inScopeDomains).toContain('ui');
  });

  it('should classify cross-domain feature as multiple domains', async () => {
    const result = await runDomainTriage(
      {
        title: 'Add real-time notifications',
        description: 'WebSocket UI component, BFF subscription route, notifications DB table, observability metrics',
        primaryDomain: 'api-integration',
      },
      { keywordOnly: true },
    );

    expect(result.inScopeDomains).toEqual(expect.arrayContaining(['ui', 'backend', 'data', 'platform']));
  });

  it('should classify data migration as data domain', async () => {
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

  it('should classify security work as quality-security', async () => {
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

  it('should classify infrastructure work as platform', async () => {
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

  it('should classify Stripe integration as integrations', async () => {
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

  it('should default to backend if no domains match', async () => {
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

  it('should always return sorted domains', async () => {
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

  it('should fallback to keywords on LLM failure', async () => {
    vi.mocked(router.route).mockRejectedValue(new Error('Ollama unavailable'));

    const result = await runDomainTriage({
      title: 'Add user profile page with database',
      description: 'React component + Postgres schema + API route',
      primaryDomain: 'api-integration',
    });

    // Should have fallen back to keyword pass
    expect(result.inScopeDomains).toBeDefined();
    expect(result.inScopeDomains.length).toBeGreaterThan(0);
  });

  it('should include all domains for multi-agent collab stories', async () => {
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

  it('should have valid macro-domain values', async () => {
    const result = await runDomainTriage({
      title: 'Any ticket',
      description: 'Any description',
    });

    for (const domain of result.inScopeDomains) {
      expect(MACRO_DOMAINS).toContain(domain as MacroDomain);
    }
  });
});
