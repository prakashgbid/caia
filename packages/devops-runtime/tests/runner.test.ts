import { describe, expect, it } from 'vitest';
import {
  dispatchStrategy,
  isRuntimeDeployStrategy,
  preflight,
  STRATEGY_INFRA_REQUIREMENTS,
} from '../src/runner.js';
import { devopsSlice, recordingAdapter, fakeClock } from './fixtures.js';

describe('runner.preflight', () => {
  it('returns null when strategy is implementable and infra matches', () => {
    expect(preflight(devopsSlice({}))).toBeNull();
  });

  it('rejects unsupported strategies (e.g. a future spec name)', () => {
    const result = preflight(devopsSlice({
      deployStrategy: {
        strategy: 'experimental-yolo' as any,
      },
    }));
    expect(result?.kind).toBe('unsupported-strategy');
    if (result?.kind === 'unsupported-strategy') {
      expect(result.strategy).toBe('experimental-yolo');
      expect(result.reason).toContain('does not implement');
    }
  });

  it('rejects canary when traffic-split is missing', () => {
    const result = preflight(devopsSlice({
      deployStrategy: { strategy: 'canary' },
      infrastructureAsCode: { tool: 'terraform', capabilities: ['multi-instance'] },
    }));
    expect(result?.kind).toBe('infra-mismatch');
    if (result?.kind === 'infra-mismatch') {
      expect(result.missing).toEqual(['traffic-split']);
    }
  });

  it('rejects blue-green when two-identical-environments missing', () => {
    const result = preflight(devopsSlice({
      deployStrategy: { strategy: 'blue-green' },
      infrastructureAsCode: { tool: 'terraform', capabilities: [] },
    }));
    expect(result?.kind).toBe('infra-mismatch');
    if (result?.kind === 'infra-mismatch') {
      expect(result.missing).toEqual(['two-identical-environments']);
    }
  });

  it('rejects rolling when multi-instance missing', () => {
    const result = preflight(devopsSlice({
      deployStrategy: { strategy: 'rolling' },
      infrastructureAsCode: { tool: 'terraform', capabilities: ['traffic-split'] },
    }));
    expect(result?.kind).toBe('infra-mismatch');
  });

  it('accepts recreate with empty capabilities (no infra requirement)', () => {
    const result = preflight(devopsSlice({
      deployStrategy: { strategy: 'recreate' as any },
      infrastructureAsCode: { tool: 'terraform', capabilities: [] },
    }));
    // recreate is `unsupported-strategy` not infra-mismatch because the
    // runtime gates it explicitly (see runner.ts).
    expect(result).toBeNull();
  });
});

describe('runner.STRATEGY_INFRA_REQUIREMENTS', () => {
  it('has an entry for every supported strategy', () => {
    expect(Object.keys(STRATEGY_INFRA_REQUIREMENTS).sort()).toEqual(
      ['blue-green', 'canary', 'recreate', 'ring-deployment', 'rolling'],
    );
  });
});

describe('isRuntimeDeployStrategy', () => {
  it('recognises supported strategies', () => {
    expect(isRuntimeDeployStrategy('canary')).toBe(true);
    expect(isRuntimeDeployStrategy('blue-green')).toBe(true);
    expect(isRuntimeDeployStrategy('rolling')).toBe(true);
  });

  it('rejects unknown strategies', () => {
    expect(isRuntimeDeployStrategy('shadow')).toBe(false);
    expect(isRuntimeDeployStrategy('')).toBe(false);
  });
});

describe('dispatchStrategy', () => {
  it('runs canary when strategy is canary', async () => {
    const adapter = recordingAdapter();
    const result = await dispatchStrategy({
      adapter,
      ticketId: 'TKT-1',
      solutionId: 'sol-1',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap-1',
      devops: devopsSlice(),
      clock: fakeClock(),
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.result.strategy).toBe('canary');
      expect(result.result.ok).toBe(true);
      expect(result.result.phases.map((p) => p.phase)).toEqual(['canary-10', 'canary-50', 'canary-100']);
    }
  });

  it('runs blue-green when strategy is blue-green', async () => {
    const adapter = recordingAdapter();
    const result = await dispatchStrategy({
      adapter,
      ticketId: 'TKT-1',
      solutionId: 'sol-1',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap-1',
      devops: devopsSlice({
        deployStrategy: { strategy: 'blue-green' },
      }),
      clock: fakeClock(),
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.result.phases.map((p) => p.phase)).toEqual(['green-up', 'cutover']);
    }
  });

  it('runs rolling when strategy is rolling', async () => {
    const adapter = recordingAdapter();
    const result = await dispatchStrategy({
      adapter,
      ticketId: 'TKT-1',
      solutionId: 'sol-1',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap-1',
      devops: devopsSlice({
        deployStrategy: { strategy: 'rolling', maxSurge: 2 },
      }),
      clock: fakeClock(),
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.result.phases.map((p) => p.phase)).toEqual(['batch-1/2', 'batch-2/2']);
    }
  });

  it('rejects ring-deployment (gated)', async () => {
    const adapter = recordingAdapter();
    const result = await dispatchStrategy({
      adapter,
      ticketId: 'TKT-1',
      solutionId: 'sol-1',
      gitSha: 'abc',
      targetEnv: 'production',
      capabilityTokenId: 'cap-1',
      devops: devopsSlice({
        deployStrategy: { strategy: 'ring-deployment' },
        infrastructureAsCode: { tool: 'terraform', capabilities: ['multi-region'] },
      }),
      clock: fakeClock(),
    });
    expect(result.kind).toBe('unsupported-strategy');
    if (result.kind === 'unsupported-strategy') {
      expect(result.reason).toContain('gated');
    }
  });
});
