/**
 * Behavioural tests for the migration-0025 inputDependencies field on the
 * v1 ticket schema.
 */

import { describe, expect, it } from 'vitest';
import {
  TicketTemplateV1Schema,
  buildDraftTicket,
  INPUT_DEPENDENCY_KINDS,
  INPUT_DEPENDENCY_DECLARERS,
  type InputDependency,
} from './index';

const baseDraft = buildDraftTicket({
  rootPromptId: 'pr_1',
  requirementId: 'req_1',
  domainPrimary: 'auth',
  domainAll: ['auth'],
  nature: 'feature',
  complexity: 'medium',
  summary: 'Build user profile page',
  inScope: ['profile read'],
  acceptanceCriteria: ['shows username', 'shows email', 'shows avatar'],
  verificationPlan: ['unit test', 'integration test'],
});

describe('input-dependencies (migration 0025)', () => {
  it('schema accepts a ticket with no inputDependencies (legacy default to [])', () => {
    const result = TicketTemplateV1Schema.safeParse(baseDraft);
    expect(result.success).toBe(true);
    expect(result.success && result.data.inputDependencies).toEqual([]);
  });

  it('schema accepts an inputDependencies array with valid entries', () => {
    const dep: InputDependency = {
      kind: 'capability',
      name: 'login flow',
      description: 'must already authenticate the user',
      required: true,
      declaredBy: 'po',
      declaredAt: 1730000000000,
    };
    const ticket = { ...baseDraft, inputDependencies: [dep] };
    const result = TicketTemplateV1Schema.safeParse(ticket);
    expect(result.success).toBe(true);
    expect(result.success && result.data.inputDependencies).toEqual([dep]);
  });

  it('schema rejects an inputDependency with an unknown kind', () => {
    const ticket = {
      ...baseDraft,
      inputDependencies: [
        { kind: 'badger', name: 'x', declaredBy: 'po', declaredAt: 1 },
      ],
    };
    expect(TicketTemplateV1Schema.safeParse(ticket).success).toBe(false);
  });

  it('schema rejects an inputDependency with an unknown declaredBy', () => {
    const ticket = {
      ...baseDraft,
      inputDependencies: [
        { kind: 'capability', name: 'x', declaredBy: 'martian', declaredAt: 1 },
      ],
    };
    expect(TicketTemplateV1Schema.safeParse(ticket).success).toBe(false);
  });

  it('schema rejects an inputDependency with empty name', () => {
    const ticket = {
      ...baseDraft,
      inputDependencies: [
        { kind: 'capability', name: '', declaredBy: 'po', declaredAt: 1 },
      ],
    };
    expect(TicketTemplateV1Schema.safeParse(ticket).success).toBe(false);
  });

  it('schema accepts a satisfiedBy pointer to a story id', () => {
    const ticket = {
      ...baseDraft,
      inputDependencies: [
        {
          kind: 'schema' as const,
          name: 'users table',
          required: true,
          declaredBy: 'ea' as const,
          declaredAt: 1,
          satisfiedBy: 'story_users_table_42',
        },
      ],
    };
    const result = TicketTemplateV1Schema.safeParse(ticket);
    expect(result.success).toBe(true);
    expect(result.success && result.data.inputDependencies[0]!.satisfiedBy)
      .toBe('story_users_table_42');
  });

  it('schema defaults required=true and description="" when omitted', () => {
    const ticket = {
      ...baseDraft,
      inputDependencies: [
        {
          kind: 'env' as const,
          name: 'STRIPE_API_KEY',
          declaredBy: 'po' as const,
          declaredAt: 1,
        },
      ],
    };
    const result = TicketTemplateV1Schema.safeParse(ticket);
    expect(result.success).toBe(true);
    if (result.success) {
      const entry = result.data.inputDependencies[0]!;
      expect(entry.required).toBe(true);
      expect(entry.description).toBe('');
    }
  });

  it('all 7 dependency kinds are accepted', () => {
    for (const kind of INPUT_DEPENDENCY_KINDS) {
      const ticket = {
        ...baseDraft,
        inputDependencies: [
          { kind, name: 'x', declaredBy: 'po' as const, declaredAt: 1 },
        ],
      };
      expect(TicketTemplateV1Schema.safeParse(ticket).success).toBe(true);
    }
  });

  it('all 4 declarer roles are accepted', () => {
    for (const declaredBy of INPUT_DEPENDENCY_DECLARERS) {
      const ticket = {
        ...baseDraft,
        inputDependencies: [
          { kind: 'capability' as const, name: 'x', declaredBy, declaredAt: 1 },
        ],
      };
      expect(TicketTemplateV1Schema.safeParse(ticket).success).toBe(true);
    }
  });

  it('buildDraftTicket forwards inputDependencies into the draft', () => {
    const dep: InputDependency = {
      kind: 'route',
      name: 'GET /me',
      description: '',
      required: true,
      declaredBy: 'po',
      declaredAt: 1,
    };
    const draft = buildDraftTicket({
      rootPromptId: 'pr_1',
      requirementId: 'req_1',
      domainPrimary: 'auth',
      domainAll: ['auth'],
      nature: 'feature',
      complexity: 'medium',
      summary: 'x',
      inScope: ['x'],
      acceptanceCriteria: ['a', 'b', 'c'],
      verificationPlan: ['v'],
      inputDependencies: [dep],
    });
    expect(draft.inputDependencies).toEqual([dep]);
    expect(TicketTemplateV1Schema.safeParse(draft).success).toBe(true);
  });

  it('buildDraftTicket defaults inputDependencies to [] when not provided', () => {
    expect(baseDraft.inputDependencies).toEqual([]);
  });
});
