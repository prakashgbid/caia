/**
 * Cross-architect invariants — verifies Time Machine's contributions to
 * the EA Reviewer's invariant registry (per spec §6.2).
 *
 * The forward-creating revert invariant is the most important one.
 */

import { describe, it, expect } from 'vitest';

import { TIME_MACHINE_INVARIANTS } from '../src/invariants.js';
import { goldenExpectedOutput } from './helpers/fakes.js';

describe('TIME_MACHINE_INVARIANTS — structural', () => {
  it('declares at least one invariant', () => {
    expect(TIME_MACHINE_INVARIANTS.length).toBeGreaterThan(0);
  });

  it('every invariant has a stable id', () => {
    const seen = new Set<string>();
    for (const inv of TIME_MACHINE_INVARIANTS) {
      expect(inv.id.length).toBeGreaterThan(0);
      expect(seen.has(inv.id)).toBe(false);
      seen.add(inv.id);
    }
  });

  it('every invariant is contributed by `time-machine`', () => {
    for (const inv of TIME_MACHINE_INVARIANTS) {
      expect(inv.contributor).toBe('time-machine');
    }
  });

  it('every invariant declares a non-empty `reads` list', () => {
    for (const inv of TIME_MACHINE_INVARIANTS) {
      expect(inv.reads.length).toBeGreaterThan(0);
    }
  });

  it('every invariant has a valid severity', () => {
    for (const inv of TIME_MACHINE_INVARIANTS) {
      expect(['fail', 'advisory']).toContain(inv.severity);
    }
  });

  it('every invariant has a non-empty description', () => {
    for (const inv of TIME_MACHINE_INVARIANTS) {
      expect(inv.description.length).toBeGreaterThan(20);
    }
  });
});

describe('TIME_MACHINE_INVARIANTS — predicate behaviour against the golden fixture', () => {
  const goldenArch = goldenExpectedOutput().architectureFields;

  it('every invariant passes against the canonical good output', () => {
    for (const inv of TIME_MACHINE_INVARIANTS) {
      const ok = inv.detect(goldenArch);
      expect(ok, `invariant ${inv.id} should pass on the golden fixture`).toBe(true);
    }
  });

  it('revert-is-forward-creating FAILS when revertOperation.forwardCreating is false', () => {
    const inv = TIME_MACHINE_INVARIANTS.find(
      i => i.id === 'timeMachine.revert-is-forward-creating'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'timeMachine.revertOperation': {
        ...(goldenArch['timeMachine.revertOperation'] as Record<string, unknown>),
        forwardCreating: false
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
    expect(inv!.severity).toBe('fail');
  });

  it('revert-is-forward-creating FAILS when forwardCreating is missing', () => {
    const inv = TIME_MACHINE_INVARIANTS.find(
      i => i.id === 'timeMachine.revert-is-forward-creating'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'timeMachine.revertOperation': {
        invocation: 'caia time-machine revert --snapshot <key>',
        scope: 'feature'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('versioning-is-append-only FAILS when immutability is not append-only', () => {
    const inv = TIME_MACHINE_INVARIANTS.find(
      i => i.id === 'timeMachine.versioning-is-append-only'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'timeMachine.versioningStrategy': {
        ...(goldenArch['timeMachine.versioningStrategy'] as Record<string, unknown>),
        immutability: 'mutable'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('audit-trail-is-append-only FAILS when immutability is rewritable', () => {
    const inv = TIME_MACHINE_INVARIANTS.find(
      i => i.id === 'timeMachine.audit-trail-is-append-only'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'timeMachine.auditTrail': {
        ...(goldenArch['timeMachine.auditTrail'] as Record<string, unknown>),
        immutability: 'rewritable'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('audit-retention-floor-snapshot-retention FAILS when audit retention drops below snapshot retention', () => {
    const inv = TIME_MACHINE_INVARIANTS.find(
      i => i.id === 'timeMachine.audit-retention-floor-snapshot-retention'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'timeMachine.auditTrail': {
        ...(goldenArch['timeMachine.auditTrail'] as Record<string, unknown>),
        retentionDays: 30
      },
      'timeMachine.snapshotRetention': {
        ...(goldenArch['timeMachine.snapshotRetention'] as Record<string, unknown>),
        retentionDays: 90
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('audit-attributes-operator-and-time FAILS when `who` is missing', () => {
    const inv = TIME_MACHINE_INVARIANTS.find(
      i => i.id === 'timeMachine.audit-attributes-operator-and-time'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'timeMachine.auditTrail': {
        ...(goldenArch['timeMachine.auditTrail'] as Record<string, unknown>),
        attributedFields: ['when', 'fromSnapshot', 'toSnapshot']
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('audit-attributes-operator-and-time FAILS when `when` is missing', () => {
    const inv = TIME_MACHINE_INVARIANTS.find(
      i => i.id === 'timeMachine.audit-attributes-operator-and-time'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'timeMachine.auditTrail': {
        ...(goldenArch['timeMachine.auditTrail'] as Record<string, unknown>),
        attributedFields: ['who', 'fromSnapshot', 'toSnapshot']
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('data-consistency-depends-on-db-lifecycle FAILS when dependsOnDatabaseLifecycle is false', () => {
    const inv = TIME_MACHINE_INVARIANTS.find(
      i => i.id === 'timeMachine.data-consistency-depends-on-db-lifecycle'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'timeMachine.dataConsistency': {
        ...(goldenArch['timeMachine.dataConsistency'] as Record<string, unknown>),
        dependsOnDatabaseLifecycle: false
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('description-length-within-budget FAILS when maxWords is unbounded', () => {
    const inv = TIME_MACHINE_INVARIANTS.find(
      i => i.id === 'timeMachine.description-length-within-budget'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'timeMachine.descriptionGeneration': {
        ...(goldenArch['timeMachine.descriptionGeneration'] as Record<string, unknown>),
        minWords: 5,
        maxWords: 100
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
    expect(inv!.severity).toBe('advisory');
  });
});
