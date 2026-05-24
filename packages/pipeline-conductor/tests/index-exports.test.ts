import { describe, expect, it } from 'vitest';

import * as pkg from '../src/index.js';

describe('@caia/pipeline-conductor exports', () => {
  it('ConductorClient', () => {
    expect(pkg.ConductorClient).toBeDefined();
  });
  it('Projector', () => {
    expect(pkg.Projector).toBeDefined();
  });
  it('Forecaster', () => {
    expect(pkg.Forecaster).toBeDefined();
  });
  it('DEFAULT_STAGE_THRESHOLDS', () => {
    expect(pkg.DEFAULT_STAGE_THRESHOLDS.onboarding.dwell).toBe(86_400);
  });
  it('STAGE_NAMES + isStageName', () => {
    expect(pkg.STAGE_NAMES.length).toBe(21);
    expect(pkg.isStageName('onboarding')).toBe(true);
  });
  it('loadEscalationPolicies + checkStuck', () => {
    expect(typeof pkg.loadEscalationPolicies).toBe('function');
    expect(typeof pkg.checkStuck).toBe('function');
  });
  it('WATCHDOG_TICK_SECONDS', () => {
    expect(pkg.WATCHDOG_TICK_SECONDS).toBe(30);
  });
  it('computeStageForecastFromSamples + stagesAfter', () => {
    expect(typeof pkg.computeStageForecastFromSamples).toBe('function');
    expect(pkg.stagesAfter('deployed')).toEqual(['verified']);
  });
});
