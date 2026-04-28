/**
 * Behavioural tests for the v1 ticket template — schema, validator, builder.
 *
 * These tests double as the spec: anything not covered here is not part of
 * the contract. When v2 ships, copy this file to template-v2.test.ts and
 * keep both passing.
 */

import { describe, expect, it } from 'vitest';
import {
  AGENT_SECTION_KEYS,
  COMPLEXITY_VALUES,
  MAX_ACCEPTANCE_CRITERIA,
  MIN_ACCEPTANCE_CRITERIA,
  NATURE_VALUES,
  TICKET_TEMPLATE_VERSION,
  TicketTemplateV1Schema,
  assertValidTicket,
  buildDraftTicket,
  isValidTicket,
  validateTicket,
} from './index';

const ts = 1_700_000_000_000; // deterministic timestamp

const baseDraft = buildDraftTicket({
  rootPromptId: 'prm_abc12345_0123456789abcdef',
  requirementId: 'req_001',
  parentEpic: 'epic_auth_001',
  domainPrimary: 'auth',
  domainAll: ['auth', 'api-integration'],
  nature: 'feature',
  complexity: 'medium',
  summary: 'Implement OAuth2 login.',
  inScope: ['Google OAuth2', 'Session token issuance'],
  outOfScope: ['Account merging'],
  acceptanceCriteria: [
    'User can log in via Google',
    'Session token returned on success',
    'Failed logins surface a clear error message',
  ],
  verificationPlan: ['pnpm test:integration auth-oauth2'],
  upstream: ['story_user-model_001'],
  files: ['src/auth/oauth.ts'],
  poDecomposedAt: ts,
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('exports the v1 version literal', () => {
    expect(TICKET_TEMPLATE_VERSION).toBe('v1');
  });

  it('locks acceptance-criteria bounds', () => {
    expect(MIN_ACCEPTANCE_CRITERIA).toBe(3);
    expect(MAX_ACCEPTANCE_CRITERIA).toBe(10);
  });

  it('exposes the canonical nature and complexity sets', () => {
    expect(NATURE_VALUES).toContain('feature');
    expect(NATURE_VALUES).toContain('bug-fix');
    expect(COMPLEXITY_VALUES).toEqual(['low', 'medium', 'high', 'spike']);
  });

  it('exposes every per-agent section key', () => {
    expect(AGENT_SECTION_KEYS).toEqual([
      'architecture',
      'database',
      'api',
      'ui',
      'security',
      'testing',
      'release',
      'observability',
    ]);
  });
});

// ─── Builder + happy-path validation ─────────────────────────────────────────

describe('buildDraftTicket', () => {
  it('builds a structurally valid v1 ticket from minimum PO inputs', () => {
    const result = validateTicket(baseDraft);
    expect(result.ok).toBe(true);
  });

  it('seeds empty agentSections so BA can fill them later', () => {
    expect(baseDraft.agentSections).toEqual({});
  });

  it('stamps metadata.templateVersion to the package version literal', () => {
    expect(baseDraft.metadata.templateVersion).toBe(TICKET_TEMPLATE_VERSION);
  });

  it('preserves the supplied poDecomposedAt timestamp', () => {
    expect(baseDraft.metadata.poDecomposedAt).toBe(ts);
  });

  it('defaults outOfScope, downstream, and files when omitted', () => {
    const minimal = buildDraftTicket({
      rootPromptId: 'prm_x_y',
      requirementId: 'req_x',
      domainPrimary: 'auth',
      domainAll: ['auth'],
      nature: 'feature',
      complexity: 'low',
      summary: 'thing',
      inScope: ['a'],
      acceptanceCriteria: ['a', 'b', 'c'],
      verificationPlan: ['vp'],
    });
    expect(minimal.scope.outOfScope).toEqual([]);
    expect(minimal.dependencies.downstream).toEqual([]);
    expect(minimal.dependencies.files).toEqual([]);
  });
});

// ─── Required-section enforcement ────────────────────────────────────────────

describe('required sections', () => {
  it('rejects a ticket with fewer than MIN acceptance criteria', () => {
    const bad = { ...baseDraft, acceptanceCriteria: ['only one'] };
    const result = validateTicket(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const errs = result.errors.filter((e) => e.path === 'acceptanceCriteria');
      expect(errs.length).toBeGreaterThan(0);
    }
  });

  it('rejects a ticket with more than MAX acceptance criteria', () => {
    const tooMany = Array.from({ length: MAX_ACCEPTANCE_CRITERIA + 1 }, (_, i) => `ac-${i}`);
    const bad = { ...baseDraft, acceptanceCriteria: tooMany };
    const result = validateTicket(bad);
    expect(result.ok).toBe(false);
  });

  it('rejects a ticket with empty inScope', () => {
    const bad = { ...baseDraft, scope: { ...baseDraft.scope, inScope: [] } };
    expect(validateTicket(bad).ok).toBe(false);
  });

  it('rejects a ticket with empty verificationPlan', () => {
    const bad = { ...baseDraft, verificationPlan: [] };
    expect(validateTicket(bad).ok).toBe(false);
  });

  it('rejects a ticket missing context.rootPromptId', () => {
    const bad = {
      ...baseDraft,
      context: { ...baseDraft.context, rootPromptId: '' },
    };
    expect(validateTicket(bad).ok).toBe(false);
  });

  it('rejects an unknown nature value', () => {
    const bad = { ...baseDraft, context: { ...baseDraft.context, nature: 'mystery' } };
    expect(validateTicket(bad).ok).toBe(false);
  });

  it('rejects an unknown complexity value', () => {
    const bad = { ...baseDraft, context: { ...baseDraft.context, complexity: 'epic' } };
    expect(validateTicket(bad).ok).toBe(false);
  });

  it('rejects an unknown top-level key (strict mode)', () => {
    const bad = { ...baseDraft, surplus: 'no extra fields allowed' };
    expect(validateTicket(bad).ok).toBe(false);
  });
});

// ─── Per-agent sections ──────────────────────────────────────────────────────

describe('agent sections', () => {
  it('accepts a fully-populated architecture section', () => {
    const enriched = {
      ...baseDraft,
      agentSections: {
        architecture: {
          contributedBy: 'ea-agent',
          contributedAt: ts,
          adrReferences: ['ADR-0003'],
          constraints: ['Stateless JWT only'],
          notes: 'OAuth tokens never stored server-side.',
        },
      },
    };
    expect(validateTicket(enriched).ok).toBe(true);
  });

  it('rejects an agent section missing contributedBy', () => {
    const enriched = {
      ...baseDraft,
      agentSections: {
        architecture: { contributedAt: ts, adrReferences: [], constraints: [], notes: '' },
      },
    };
    expect(validateTicket(enriched).ok).toBe(false);
  });

  it('rejects an agent section with negative contributedAt', () => {
    const enriched = {
      ...baseDraft,
      agentSections: {
        api: {
          contributedBy: 'bff-agent',
          contributedAt: -5,
          routes: [],
          errorContract: '',
        },
      },
    };
    expect(validateTicket(enriched).ok).toBe(false);
  });

  it('rejects an api route with an unknown method', () => {
    const enriched = {
      ...baseDraft,
      agentSections: {
        api: {
          contributedBy: 'bff-agent',
          contributedAt: ts,
          routes: [{ method: 'TRACE', path: '/x' }],
          errorContract: '',
        },
      },
    };
    expect(validateTicket(enriched).ok).toBe(false);
  });

  it('accepts a testing section with default coverage target', () => {
    const enriched = {
      ...baseDraft,
      agentSections: {
        testing: {
          contributedBy: 'testing-agent',
          contributedAt: ts,
          unitTestPaths: ['src/auth/oauth.test.ts'],
          integrationTestPaths: [],
        },
      },
    };
    const result = validateTicket(enriched);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.agentSections.testing?.coverageTarget).toBe(0.8);
    }
  });

  it('rejects a testing coverageTarget out of [0,1]', () => {
    const enriched = {
      ...baseDraft,
      agentSections: {
        testing: {
          contributedBy: 'testing-agent',
          contributedAt: ts,
          coverageTarget: 1.5,
        },
      },
    };
    expect(validateTicket(enriched).ok).toBe(false);
  });
});

// ─── BA enrichment metadata ─────────────────────────────────────────────────

describe('baEnrichment block', () => {
  it('accepts a fully-populated BA enrichment block', () => {
    const enriched = {
      ...baseDraft,
      baEnrichment: {
        enrichedBy: 'ba-agent',
        enrichedAt: ts,
        inputsRequested: [
          { agent: 'ea-agent', correlationId: 'cor-1', status: 'replied', repliedAt: ts },
        ],
        completenessChecksPassed: true,
        notes: 'all sections present',
      },
    };
    expect(validateTicket(enriched).ok).toBe(true);
  });

  it('rejects an unknown inputsRequested status', () => {
    const enriched = {
      ...baseDraft,
      baEnrichment: {
        enrichedBy: 'ba-agent',
        enrichedAt: ts,
        inputsRequested: [{ agent: 'ea-agent', correlationId: 'cor-1', status: 'maybe' }],
        completenessChecksPassed: false,
      },
    };
    expect(validateTicket(enriched).ok).toBe(false);
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

describe('helper exports', () => {
  it('isValidTicket returns true for a valid draft', () => {
    expect(isValidTicket(baseDraft)).toBe(true);
  });

  it('isValidTicket returns false for garbage', () => {
    expect(isValidTicket({ foo: 'bar' })).toBe(false);
  });

  it('assertValidTicket throws with field-level summary on invalid input', () => {
    expect(() => assertValidTicket({ foo: 'bar' })).toThrow(/ticket-template: invalid payload/);
  });

  it('assertValidTicket returns the typed payload on valid input', () => {
    const value = assertValidTicket(baseDraft);
    expect(value.context.domainPrimary).toBe('auth');
  });

  it('TicketTemplateV1Schema is exported and parseable', () => {
    const parsed = TicketTemplateV1Schema.safeParse(baseDraft);
    expect(parsed.success).toBe(true);
  });
});

// ─── Round-trip JSON ─────────────────────────────────────────────────────────

describe('round-trip JSON', () => {
  it('serialises and deserialises a valid ticket without loss', () => {
    const json = JSON.stringify(baseDraft);
    const parsed = JSON.parse(json) as unknown;
    const result = validateTicket(parsed);
    expect(result.ok).toBe(true);
  });
});
