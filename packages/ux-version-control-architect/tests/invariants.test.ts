/**
 * Cross-architect invariants — verifies UX Version Control's contributions
 * to the EA Reviewer's invariant registry (per spec §6.2).
 *
 * The forward-creating revert invariant + preservation guarantee are the
 * most important ones.
 */

import { describe, it, expect } from 'vitest';

import { UX_VERSION_CONTROL_INVARIANTS } from '../src/invariants.js';
import { goldenExpectedOutput } from './helpers/fakes.js';

describe('UX_VERSION_CONTROL_INVARIANTS — structural', () => {
  it('declares at least one invariant', () => {
    expect(UX_VERSION_CONTROL_INVARIANTS.length).toBeGreaterThan(0);
  });

  it('every invariant has a stable id', () => {
    const seen = new Set<string>();
    for (const inv of UX_VERSION_CONTROL_INVARIANTS) {
      expect(inv.id.length).toBeGreaterThan(0);
      expect(seen.has(inv.id)).toBe(false);
      seen.add(inv.id);
    }
  });

  it('every invariant is contributed by `ux-version-control`', () => {
    for (const inv of UX_VERSION_CONTROL_INVARIANTS) {
      expect(inv.contributor).toBe('ux-version-control');
    }
  });

  it('every invariant declares a non-empty `reads` list', () => {
    for (const inv of UX_VERSION_CONTROL_INVARIANTS) {
      expect(inv.reads.length).toBeGreaterThan(0);
    }
  });

  it('every invariant has a valid severity', () => {
    for (const inv of UX_VERSION_CONTROL_INVARIANTS) {
      expect(['fail', 'advisory']).toContain(inv.severity);
    }
  });

  it('every invariant has a non-empty description', () => {
    for (const inv of UX_VERSION_CONTROL_INVARIANTS) {
      expect(inv.description.length).toBeGreaterThan(20);
    }
  });
});

describe('UX_VERSION_CONTROL_INVARIANTS — predicate behaviour against the golden fixture', () => {
  const goldenArch = goldenExpectedOutput().architectureFields;

  it('every invariant passes against the canonical good output', () => {
    for (const inv of UX_VERSION_CONTROL_INVARIANTS) {
      const ok = inv.detect(goldenArch);
      expect(ok, `invariant ${inv.id} should pass on the golden fixture`).toBe(true);
    }
  });

  it('revert-is-forward-creating FAILS when revertOperation.forwardCreating is false', () => {
    const inv = UX_VERSION_CONTROL_INVARIANTS.find(
      i => i.id === 'uxVersionControl.revert-is-forward-creating'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'uxVersionControl.revertOperation': {
        ...(goldenArch['uxVersionControl.revertOperation'] as Record<string, unknown>),
        forwardCreating: false
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
    expect(inv!.severity).toBe('fail');
  });

  it('revert-is-forward-creating FAILS when forwardCreating is missing', () => {
    const inv = UX_VERSION_CONTROL_INVARIANTS.find(
      i => i.id === 'uxVersionControl.revert-is-forward-creating'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'uxVersionControl.revertOperation': {
        invocation: 'caia ux-version-control revert --version <versionId>',
        scope: 'design'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('preservation-is-immutable-r2 FAILS when preservationGuarantee is changed', () => {
    const inv = UX_VERSION_CONTROL_INVARIANTS.find(
      i => i.id === 'uxVersionControl.preservation-is-immutable-r2'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'uxVersionControl.designVersionRetention': {
        ...(goldenArch['uxVersionControl.designVersionRetention'] as Record<
          string,
          unknown
        >),
        preservationGuarantee: 'best-effort-ephemeral'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
    expect(inv!.severity).toBe('fail');
  });

  it('gdpr-uses-tombstone-not-hard-delete FAILS when gdprInteraction is hard-delete', () => {
    const inv = UX_VERSION_CONTROL_INVARIANTS.find(
      i => i.id === 'uxVersionControl.gdpr-uses-tombstone-not-hard-delete'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'uxVersionControl.designVersionRetention': {
        ...(goldenArch['uxVersionControl.designVersionRetention'] as Record<
          string,
          unknown
        >),
        gdprInteraction: 'hard-delete'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('gdpr-uses-tombstone-not-hard-delete PASSES for purge-and-tombstone variant', () => {
    const inv = UX_VERSION_CONTROL_INVARIANTS.find(
      i => i.id === 'uxVersionControl.gdpr-uses-tombstone-not-hard-delete'
    );
    expect(inv).toBeDefined();
    const variant = {
      ...goldenArch,
      'uxVersionControl.designVersionRetention': {
        ...(goldenArch['uxVersionControl.designVersionRetention'] as Record<
          string,
          unknown
        >),
        gdprInteraction: 'purge-and-tombstone'
      }
    };
    expect(inv!.detect(variant)).toBe(true);
  });

  it('audit-trail-is-append-only FAILS when immutability is rewritable', () => {
    const inv = UX_VERSION_CONTROL_INVARIANTS.find(
      i => i.id === 'uxVersionControl.audit-trail-is-append-only'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'uxVersionControl.auditTrail': {
        ...(goldenArch['uxVersionControl.auditTrail'] as Record<string, unknown>),
        immutability: 'rewritable'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('audit-retention-meets-regulatory-floor FAILS below 2555 days', () => {
    const inv = UX_VERSION_CONTROL_INVARIANTS.find(
      i => i.id === 'uxVersionControl.audit-retention-meets-regulatory-floor'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'uxVersionControl.auditTrail': {
        ...(goldenArch['uxVersionControl.auditTrail'] as Record<string, unknown>),
        retentionDays: 30
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('audit-attributes-operator-time-version FAILS when `who` is missing', () => {
    const inv = UX_VERSION_CONTROL_INVARIANTS.find(
      i => i.id === 'uxVersionControl.audit-attributes-operator-time-version'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'uxVersionControl.auditTrail': {
        ...(goldenArch['uxVersionControl.auditTrail'] as Record<string, unknown>),
        attributedFields: ['when', 'versionId', 'parentVersionId']
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('audit-attributes-operator-time-version FAILS when `when` is missing', () => {
    const inv = UX_VERSION_CONTROL_INVARIANTS.find(
      i => i.id === 'uxVersionControl.audit-attributes-operator-time-version'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'uxVersionControl.auditTrail': {
        ...(goldenArch['uxVersionControl.auditTrail'] as Record<string, unknown>),
        attributedFields: ['who', 'versionId', 'parentVersionId']
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('audit-attributes-operator-time-version FAILS when `versionId` is missing', () => {
    const inv = UX_VERSION_CONTROL_INVARIANTS.find(
      i => i.id === 'uxVersionControl.audit-attributes-operator-time-version'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'uxVersionControl.auditTrail': {
        ...(goldenArch['uxVersionControl.auditTrail'] as Record<string, unknown>),
        attributedFields: ['who', 'when', 'parentVersionId']
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('diff-layers-cover-five-dimensions FAILS when a canonical layer is missing', () => {
    const inv = UX_VERSION_CONTROL_INVARIANTS.find(
      i => i.id === 'uxVersionControl.diff-layers-cover-five-dimensions'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'uxVersionControl.diffVisualizationSpec': {
        ...(goldenArch['uxVersionControl.diffVisualizationSpec'] as Record<
          string,
          unknown
        >),
        diffLayers: ['tree', 'token', 'copy', 'asset'] // missing 'interactivity'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
    expect(inv!.severity).toBe('advisory');
  });

  it('branching-default-off-in-v1 PASSES when forkAllowed=false (golden default)', () => {
    const inv = UX_VERSION_CONTROL_INVARIANTS.find(
      i => i.id === 'uxVersionControl.branching-default-off-in-v1'
    );
    expect(inv).toBeDefined();
    expect(inv!.detect(goldenArch)).toBe(true);
  });

  it('branching-default-off-in-v1 PASSES when forkAllowed=true with a non-empty mergeStrategy', () => {
    const inv = UX_VERSION_CONTROL_INVARIANTS.find(
      i => i.id === 'uxVersionControl.branching-default-off-in-v1'
    );
    expect(inv).toBeDefined();
    const variant = {
      ...goldenArch,
      'uxVersionControl.branchingStrategy': {
        ...(goldenArch['uxVersionControl.branchingStrategy'] as Record<string, unknown>),
        forkAllowed: true,
        mergeStrategy: 'manual-merge'
      }
    };
    expect(inv!.detect(variant)).toBe(true);
  });

  it('branching-default-off-in-v1 FAILS when forkAllowed=true with no merge strategy', () => {
    const inv = UX_VERSION_CONTROL_INVARIANTS.find(
      i => i.id === 'uxVersionControl.branching-default-off-in-v1'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'uxVersionControl.branchingStrategy': {
        ...(goldenArch['uxVersionControl.branchingStrategy'] as Record<string, unknown>),
        forkAllowed: true,
        mergeStrategy: ''
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });
});
