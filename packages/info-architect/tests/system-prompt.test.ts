import { describe, expect, it } from 'vitest';

import {
  buildIaSystemPrompt,
  CREDENTIAL_ARCHETYPES,
  IA_PILLARS,
} from '../src/system-prompt.js';
import { buildIaInput } from './fixtures.js';

describe('IA system prompt — pillars', () => {
  it('enumerates exactly 11 pillars per spec §9', () => {
    expect(IA_PILLARS.length).toBe(11);
  });

  it('names every pillar with a Pillar-N prefix', () => {
    for (let i = 0; i < IA_PILLARS.length; i++) {
      expect(IA_PILLARS[i]!.startsWith(`Pillar ${String(i + 1)} —`)).toBe(true);
    }
  });

  it('covers Routes & Sitemap (Pillar 1)', () => {
    expect(IA_PILLARS[0]).toContain('Routes');
  });

  it('covers the shadcn-locked routing/component-library pillar (Pillar 11)', () => {
    expect(IA_PILLARS[10]).toContain('shadcn-locked');
  });
});

describe('IA system prompt — credential archetypes', () => {
  it('enumerates exactly 5 archetypes A-E', () => {
    expect(CREDENTIAL_ARCHETYPES.length).toBe(5);
    expect(CREDENTIAL_ARCHETYPES.map((a) => a.id)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
    ]);
  });

  it('maps every archetype to a stable key', () => {
    const keys = CREDENTIAL_ARCHETYPES.map((a) => a.key);
    expect(keys).toEqual([
      'oauth-code-grant',
      'api-token',
      'dns-proof-of-control',
      'webhook-receipt',
      'db-smtp-ssh-endpoint-reach',
    ]);
  });

  it('every archetype carries a non-empty description', () => {
    for (const a of CREDENTIAL_ARCHETYPES) {
      expect(a.description.length).toBeGreaterThan(50);
    }
  });

  it('CREDENTIAL_ARCHETYPES is frozen', () => {
    expect(Object.isFrozen(CREDENTIAL_ARCHETYPES)).toBe(true);
  });
});

describe('IA system prompt — buildIaSystemPrompt', () => {
  it('mentions ADR-024 by name', () => {
    const p = buildIaSystemPrompt(buildIaInput());
    expect(p).toContain('ADR-024');
  });

  it('mentions every pillar by name', () => {
    const p = buildIaSystemPrompt(buildIaInput());
    for (const pillar of IA_PILLARS) {
      expect(p).toContain(pillar);
    }
  });

  it('mentions every credential archetype by id', () => {
    const p = buildIaSystemPrompt(buildIaInput());
    for (const a of CREDENTIAL_ARCHETYPES) {
      expect(p).toContain(`Archetype ${a.id}`);
      expect(p).toContain(a.key);
    }
  });

  it('includes the project context (id, tenant, project type)', () => {
    const input = buildIaInput();
    const p = buildIaSystemPrompt(input);
    expect(p).toContain(input.projectId);
    expect(p).toContain(input.tenantContext.tenantSlug);
    expect(p).toContain('client');
  });

  it('declares the @stolution/ui-shadcn wrapper for admin projects', () => {
    const p = buildIaSystemPrompt(buildIaInput({ projectType: 'admin' }));
    expect(p).toContain('@stolution/ui-shadcn');
  });

  it('declares the @website-factory/components path for client projects', () => {
    const p = buildIaSystemPrompt(buildIaInput({ projectType: 'client' }));
    expect(p).toContain('@website-factory/components');
  });

  it('honours operator extras', () => {
    const p = buildIaSystemPrompt(buildIaInput(), {
      extraInstructions: ['Always cite ADR-061 for the stack lock'],
    });
    expect(p).toContain('Always cite ADR-061 for the stack lock');
  });

  it('emits a model-hint marker when modelHint is set', () => {
    const p = buildIaSystemPrompt(buildIaInput(), { modelHint: 'opus' });
    expect(p).toContain('model-hint: opus');
  });

  it('is deterministic given identical inputs', () => {
    const a = buildIaSystemPrompt(buildIaInput());
    const b = buildIaSystemPrompt(buildIaInput());
    expect(a).toBe(b);
  });

  it('respects the catalogueVersion option marker', () => {
    const p = buildIaSystemPrompt(buildIaInput(), { catalogueVersion: '2.0.0' });
    expect(p).toContain('catalogue-version: 2.0.0');
  });
});
