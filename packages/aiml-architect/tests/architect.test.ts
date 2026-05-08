import { describe, it, expect } from 'vitest';

import { AIMLArchitect } from '../src/architect.js';
import {
  buildFakeAdapterRegistry,
  buildFakeCurator,
  buildFakeFs,
  buildFakeMentor,
  fixedClock
} from './helpers/fakes.js';

describe('AIMLArchitect (integration)', () => {
  const clock = fixedClock('2026-05-06T12:00:00Z');

  it('exposes config()', () => {
    const a = new AIMLArchitect({
      apprenticeEvalSuiteRoot: '/fake/suites',
      mentor: buildFakeMentor([]),
      curator: buildFakeCurator([]),
      adapterRegistry: buildFakeAdapterRegistry([]),
      fs: buildFakeFs({}),
      clock
    });
    expect(a.config().apprenticeEvalSuiteRoot).toBe('/fake/suites');
  });

  it('selectModel returns a choice', () => {
    const a = new AIMLArchitect({
      mentor: buildFakeMentor([]),
      curator: buildFakeCurator([]),
      adapterRegistry: buildFakeAdapterRegistry([]),
      fs: buildFakeFs({}),
      clock
    });
    const c = a.selectModel({
      taskCategory: 'commit-message',
      contextSizeTokens: 500,
      qualityBar: 'standard'
    });
    expect(c.provider).toBeTruthy();
  });

  it('reviewPromptPattern returns a result', () => {
    const a = new AIMLArchitect({
      mentor: buildFakeMentor([]),
      curator: buildFakeCurator([]),
      adapterRegistry: buildFakeAdapterRegistry([]),
      fs: buildFakeFs({}),
      clock
    });
    const r = a.reviewPromptPattern({
      templateId: 'x',
      template: 'You are a classifier.',
      intendedTaskCategory: 'domain-classification'
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });

  it('coordinateApprenticeLoop returns a verdict', () => {
    const a = new AIMLArchitect({
      mentor: buildFakeMentor([]),
      curator: buildFakeCurator([]),
      adapterRegistry: buildFakeAdapterRegistry([]),
      fs: buildFakeFs({}),
      clock
    });
    const p = a.coordinateApprenticeLoop();
    expect(['retrain', 'hold', 'promote-canary', 'rollback']).toContain(p.decision);
  });

  it('generateConventionsDoc returns markdown', () => {
    const a = new AIMLArchitect({
      mentor: buildFakeMentor([]),
      curator: buildFakeCurator([]),
      adapterRegistry: buildFakeAdapterRegistry([]),
      fs: buildFakeFs({}),
      clock
    });
    expect(a.generateConventionsDoc()).toContain('# AI/ML Architecture');
  });

  it('ownEvalSuite returns suite-not-found when path missing', () => {
    const a = new AIMLArchitect({
      canonicalSuitePath: '/missing.yaml',
      mentor: buildFakeMentor([]),
      curator: buildFakeCurator([]),
      adapterRegistry: buildFakeAdapterRegistry([]),
      fs: buildFakeFs({}),
      clock
    });
    const s = a.ownEvalSuite();
    expect(s.integrityIssues[0]!.kind).toBe('suite-not-found');
  });
});
