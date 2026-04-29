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
  it('schema accepts a ticket with no inputDependencies (legacy default)', () => {
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

  it('schema rejects unknown kind', () => {
    const t = { ...baseDraft, inputDependencies: [{ kind: 'badger', name: 'x', declaredBy: 'po', declaredAt: 1 }] };
    expect(TicketTemplateV1Schema.safeParse(t).success).toBe(false);
  });

  it('schema rejects unknown declaredBy', () => {
    const t = { ...baseDraft, inputDependencies: [{ kind: 'capability', name: 'x', declaredBy: 'martian', declaredAt: 1 }] };
    expect(TicketTemplateV1Schema.safeParse(t).success).toBe(false);
  });

  it('schema rejects empty name', () => {
    const t = { ...baseDraft, inputDependencies: [{ kind: 'capability', name: '', declaredBy: 'po', declaredAt: 1 }] };
    expect(TicketTemplateV1Schema.safeParse(t).success).toBe(false);
  });

  it('schema accepts a satisfiedBy pointer', () => {
    const t = {
      ...baseDraft,
      inputDependencies: [
        { kind: 'schema' as const, name: 'users', required: true, declaredBy: 'ea' as const, declaredAt: 1, satisfiedBy: 'st_users_42' },
      ],
    };
    const r = TicketTemplateV1Schema.safeParse(t);
    expect(r.success).toBe(true);
    expect(r.success && r.data.inputDependencies[0]!.satisfiedBy).toBe('st_users_42');
  });

  it('schema defaults required=true and description=""', () => {
    const t = {
      ...baseDraft,
      inputDependencies: [
        { kind: 'env' as const, name: 'STRIPE_API_KEY', declaredBy: 'po' as const, declaredAt: 1 },
      ],
    };
    const r = TicketTemplateV1Schema.safeParse(t);
    expect(r.success).toBe(true);
    if (r.success) {
      const e = r.data.inputDependencies[0]!;
      expect(e.required).toBe(true);
      expect(e.description).toBe('');
    }
  });

  it('all 7 dependency kinds are accepted', () => {
    for (const kind of INPUT_DEPENDENCY_KINDS) {
      const t = {
        ...baseDraft,
        inputDependencies: [{ kind, name: 'x', declaredBy: 'po' as const, declaredAt: 1 }],
      };
      expect(TicketTemplateV1Schema.safeParse(t).success).toBe(true);
    }
  });

  it('all 4 declarer roles are accepted', () => {
    for (const declaredBy of INPUT_DEPENDENCY_DECLARERS) {
      const t = {
        ...baseDraft,
        inputDependencies: [{ kind: 'capability' as const, name: 'x', declaredBy, declaredAt: 1 }],
      };
      expect(TicketTemplateV1Schema.safeParse(t).success).toBe(true);
    }
  });

  it('buildDraftTicket forwards inputDependencies into the draft', () => {
    const dep: InputDependency = {
      kind: 'route', name: 'GET /me', description: '', required: true, declaredBy: 'po', declaredAt: 1,
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

  it('buildDraftTicket defaults inputDependencies to []', () => {
    expect(baseDraft.inputDependencies).toEqual([]);
  });
});
