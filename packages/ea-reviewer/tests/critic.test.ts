import { describe, it, expect } from 'vitest';
import {
  HeuristicCriticAdapter,
  NullCriticAdapter,
  FixedCriticAdapter,
} from '../src/critic.js';

describe('HeuristicCriticAdapter', () => {
  it('returns no findings when criteria tokens appear in composed corpus', async () => {
    const adapter = new HeuristicCriticAdapter();
    const findings = await adapter.judge({
      composedArchitecture: {
        'frontend.componentTree': [{ id: 'signup-form', kind: 'form' }],
      },
      acceptanceCriteria: ['user can sign up via signup form'],
      auditRows: [],
    });
    expect(findings).toEqual([]);
  });

  it('flags criteria with no architecture overlap', async () => {
    const adapter = new HeuristicCriticAdapter();
    const findings = await adapter.judge({
      composedArchitecture: { 'frontend.tokens': { colors: {} } },
      acceptanceCriteria: ['quantum entanglement protocols enable telepathy'],
      auditRows: [],
    });
    expect(findings.length).toBe(1);
    expect(findings[0]?.blameArchitect).toBe('global');
  });

  it('handles empty acceptance criteria', async () => {
    const adapter = new HeuristicCriticAdapter();
    expect(
      await adapter.judge({
        composedArchitecture: {},
        acceptanceCriteria: [],
        auditRows: [],
      }),
    ).toEqual([]);
  });

  it('ignores criteria with only short / stop-word tokens', async () => {
    const adapter = new HeuristicCriticAdapter();
    const findings = await adapter.judge({
      composedArchitecture: {},
      acceptanceCriteria: ['this is a', 'with from when'], // all stop / short
      auditRows: [],
    });
    expect(findings).toEqual([]);
  });

  it('recursively gathers strings from nested objects', async () => {
    const adapter = new HeuristicCriticAdapter();
    const findings = await adapter.judge({
      composedArchitecture: {
        'security.cspPolicy': { frameSrc: 'authentication-required-policy' },
      },
      acceptanceCriteria: ['authentication required'],
      auditRows: [],
    });
    expect(findings).toEqual([]);
  });
});

describe('NullCriticAdapter', () => {
  it('returns no findings regardless of input', async () => {
    const adapter = new NullCriticAdapter();
    expect(
      await adapter.judge({
        composedArchitecture: {},
        acceptanceCriteria: ['a'],
        auditRows: [],
      }),
    ).toEqual([]);
  });
});

describe('FixedCriticAdapter', () => {
  it('returns the canned findings', async () => {
    const canned = [
      {
        acceptanceCriterion: 'x',
        blameArchitect: 'analytics' as const,
        reason: 'forced',
        severity: 'P0' as const,
      },
    ];
    const adapter = new FixedCriticAdapter(canned);
    expect(
      await adapter.judge({
        composedArchitecture: {},
        acceptanceCriteria: [],
        auditRows: [],
      }),
    ).toEqual(canned);
  });
});
