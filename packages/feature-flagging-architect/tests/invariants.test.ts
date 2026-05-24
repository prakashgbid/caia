/**
 * Cross-architect invariants — verifies Feature Flagging's contributions
 * to the EA Reviewer's invariant registry (per spec §6.2).
 */

import { describe, it, expect } from 'vitest';

import { FEATURE_FLAGGING_INVARIANTS } from '../src/invariants.js';
import { goldenExpectedOutput } from './helpers/fakes.js';

describe('FEATURE_FLAGGING_INVARIANTS — structural', () => {
  it('declares at least one invariant', () => {
    expect(FEATURE_FLAGGING_INVARIANTS.length).toBeGreaterThan(0);
  });

  it('every invariant has a stable id', () => {
    const seen = new Set<string>();
    for (const inv of FEATURE_FLAGGING_INVARIANTS) {
      expect(inv.id.length).toBeGreaterThan(0);
      expect(seen.has(inv.id)).toBe(false);
      seen.add(inv.id);
    }
  });

  it('every invariant is contributed by `featureFlagging`', () => {
    for (const inv of FEATURE_FLAGGING_INVARIANTS) {
      expect(inv.contributor).toBe('featureFlagging');
    }
  });

  it('every invariant declares a non-empty `reads` list', () => {
    for (const inv of FEATURE_FLAGGING_INVARIANTS) {
      expect(inv.reads.length).toBeGreaterThan(0);
    }
  });

  it('every invariant has a valid severity', () => {
    for (const inv of FEATURE_FLAGGING_INVARIANTS) {
      expect(['fail', 'advisory']).toContain(inv.severity);
    }
  });

  it('every invariant has a non-empty description', () => {
    for (const inv of FEATURE_FLAGGING_INVARIANTS) {
      expect(inv.description.length).toBeGreaterThan(20);
    }
  });
});

describe('FEATURE_FLAGGING_INVARIANTS — predicate behaviour against the golden fixture', () => {
  const goldenArch = goldenExpectedOutput().architectureFields;

  it('every invariant passes against the canonical good output', () => {
    for (const inv of FEATURE_FLAGGING_INVARIANTS) {
      const ok = inv.detect(goldenArch);
      expect(ok, `invariant ${inv.id} should pass on the golden fixture`).toBe(true);
    }
  });

  it('flagsSchema-is-array fails when flagsSchema is not an array', () => {
    const inv = FEATURE_FLAGGING_INVARIANTS.find(
      i => i.id === 'featureFlags.flagsSchema-is-array'
    );
    expect(inv).toBeDefined();
    const corrupted = { ...goldenArch, 'featureFlags.flagsSchema': { not: 'an-array' } };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('flagsSchema-is-array passes on empty array (no flags is OK)', () => {
    const inv = FEATURE_FLAGGING_INVARIANTS.find(
      i => i.id === 'featureFlags.flagsSchema-is-array'
    );
    expect(inv!.detect({ ...goldenArch, 'featureFlags.flagsSchema': [] })).toBe(true);
  });

  it('every-flag-has-rollout fails when a flag has no rollout entry', () => {
    const inv = FEATURE_FLAGGING_INVARIANTS.find(
      i => i.id === 'featureFlags.every-flag-has-rollout'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'featureFlags.rolloutStrategies': [
        // Only the first flag has a rollout; the second is missing.
        { flag: 'ticket-pt-042.new-booking-flow', kind: 'canary', steps: [] }
      ]
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('every-flag-has-audit fails when a flag has no audit entry', () => {
    const inv = FEATURE_FLAGGING_INVARIANTS.find(
      i => i.id === 'featureFlags.every-flag-has-audit'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'featureFlags.auditRequirements': [
        {
          flag: 'ticket-pt-042.new-booking-flow',
          toggleRoles: ['operator'],
          requiresChangeRecord: true,
          auditLogSink: 'default-cloudwatch',
          retentionDays: 365,
          reviewCadenceDays: 90
        }
      ]
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('kill-switches-are-instant fails when instantToggle is false', () => {
    const inv = FEATURE_FLAGGING_INVARIANTS.find(
      i => i.id === 'featureFlags.kill-switches-are-instant'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'featureFlags.killSwitches': [
        {
          flag: 'ticket-pt-042.new-booking-flow',
          blastRadius: 'payments',
          instantToggle: false,
          bypassReviewQuorum: true,
          notificationChannels: []
        }
      ]
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('kill-switches-are-instant passes on empty array (no kill switches)', () => {
    const inv = FEATURE_FLAGGING_INVARIANTS.find(
      i => i.id === 'featureFlags.kill-switches-are-instant'
    );
    expect(inv!.detect({ ...goldenArch, 'featureFlags.killSwitches': [] })).toBe(true);
  });

  it('experimentationLinkage-references-known-flags fails on unknown flag reference', () => {
    const inv = FEATURE_FLAGGING_INVARIANTS.find(
      i => i.id === 'featureFlags.experimentationLinkage-references-known-flags'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'featureFlags.experimentationLinkage': [
        {
          flag: 'never-declared-flag',
          abTestId: 'abtest-foo',
          variants: [],
          holdoutPercent: 5,
          primaryMetric: 'x',
          startDate: '2026-06-01',
          durationCapDays: 28
        }
      ]
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('experimentationLinkage-references-known-flags passes on empty linkage', () => {
    const inv = FEATURE_FLAGGING_INVARIANTS.find(
      i => i.id === 'featureFlags.experimentationLinkage-references-known-flags'
    );
    expect(inv!.detect({ ...goldenArch, 'featureFlags.experimentationLinkage': [] })).toBe(
      true
    );
  });

  it('audit-retention-bounded fails when retentionDays is 0', () => {
    const inv = FEATURE_FLAGGING_INVARIANTS.find(
      i => i.id === 'featureFlags.audit-retention-bounded'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'featureFlags.auditRequirements': [
        {
          flag: 'ticket-pt-042.new-booking-flow',
          toggleRoles: ['operator'],
          requiresChangeRecord: true,
          auditLogSink: 'default-cloudwatch',
          retentionDays: 0,
          reviewCadenceDays: 90
        }
      ]
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('audit-retention-bounded fails when auditLogSink is empty', () => {
    const inv = FEATURE_FLAGGING_INVARIANTS.find(
      i => i.id === 'featureFlags.audit-retention-bounded'
    );
    const corrupted = {
      ...goldenArch,
      'featureFlags.auditRequirements': [
        {
          flag: 'ticket-pt-042.new-booking-flow',
          toggleRoles: ['operator'],
          requiresChangeRecord: true,
          auditLogSink: '',
          retentionDays: 365,
          reviewCadenceDays: 90
        }
      ]
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('material-blast-radius-has-kill-switch rejects unknown blastRadius value', () => {
    const inv = FEATURE_FLAGGING_INVARIANTS.find(
      i => i.id === 'featureFlags.material-blast-radius-has-kill-switch'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'featureFlags.killSwitches': [
        {
          flag: 'ticket-pt-042.new-booking-flow',
          blastRadius: 'banana-radius',
          instantToggle: true,
          bypassReviewQuorum: true,
          notificationChannels: []
        }
      ]
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('material-blast-radius-has-kill-switch accepts "other" as a valid category', () => {
    const inv = FEATURE_FLAGGING_INVARIANTS.find(
      i => i.id === 'featureFlags.material-blast-radius-has-kill-switch'
    );
    const ok = {
      ...goldenArch,
      'featureFlags.killSwitches': [
        {
          flag: 'ticket-pt-042.new-booking-flow',
          blastRadius: 'other',
          instantToggle: true,
          bypassReviewQuorum: false,
          notificationChannels: ['slack:#general']
        }
      ]
    };
    expect(inv!.detect(ok)).toBe(true);
  });
});

describe('FEATURE_FLAGGING_INVARIANTS — nested-architecture view', () => {
  it('every invariant also works against the nested composed-architecture shape', () => {
    // Build a nested view as the Dispatcher would compose it.
    const flat = goldenExpectedOutput().architectureFields;
    const nested: Record<string, unknown> = {
      featureFlags: {
        flagsSchema: flat['featureFlags.flagsSchema'],
        rolloutStrategies: flat['featureFlags.rolloutStrategies'],
        killSwitches: flat['featureFlags.killSwitches'],
        experimentationLinkage: flat['featureFlags.experimentationLinkage'],
        auditRequirements: flat['featureFlags.auditRequirements']
      }
    };
    for (const inv of FEATURE_FLAGGING_INVARIANTS) {
      const ok = inv.detect(nested);
      expect(ok, `invariant ${inv.id} should pass on the nested view`).toBe(true);
    }
  });
});
