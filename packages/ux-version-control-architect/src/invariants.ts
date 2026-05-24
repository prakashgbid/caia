/**
 * UX Version Control's contributions to the EA Reviewer's cross-architect
 * invariants registry (per spec §6.2).
 *
 * The forward-creating revert invariant + the preservation guarantee are
 * the single most important contract guarantees. Destructive revert and
 * hard-delete of design versions are hard contract violations.
 *
 * Each invariant is a pure predicate over either:
 *   - the per-architect `architectureFields` dict (where keys are FLAT
 *     dotted strings like `'uxVersionControl.revertOperation'`), or
 *   - the composed `tickets.architecture` JSONB blob (where the
 *     Dispatcher will nest the same fields under the `uxVersionControl.*`
 *     path).
 *
 * Both views are accepted — we look up via `readField()` which checks
 * the flat key first, then falls back to the nested path.
 */

export type InvariantSeverity = 'fail' | 'advisory';

export interface ArchitectInvariant {
  id: string;
  /** Architect that contributed this invariant. */
  contributor: string;
  /** Other architects whose fields this invariant reads. */
  reads: readonly string[];
  /** Severity if the predicate returns false. */
  severity: InvariantSeverity;
  /** Operator-facing description for the Reviewer's audit log. */
  description: string;
  /**
   * The predicate. Receives the JSONB blob (flat-keyed
   * `architectureFields` view OR nested composed-architecture view).
   * Pure + synchronous.
   */
  detect(architecture: Readonly<Record<string, unknown>>): boolean;
}

function readField(arch: Readonly<Record<string, unknown>>, path: string): unknown {
  if (path in arch) return arch[path];
  const parts = path.split('.');
  let cursor: unknown = arch;
  for (const part of parts) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export const UX_VERSION_CONTROL_INVARIANTS: readonly ArchitectInvariant[] = [
  {
    id: 'uxVersionControl.revert-is-forward-creating',
    contributor: 'ux-version-control',
    reads: ['uxVersionControl.revertOperation'],
    severity: 'fail',
    description:
      'Every UX-version revert MUST be forward-creating: appended to the chain tip, never overwriting prior history. `revertOperation.forwardCreating` must be the literal boolean `true`. Destructive revert is a hard contract violation.',
    detect(arch): boolean {
      const op = readField(arch, 'uxVersionControl.revertOperation');
      if (!isObject(op)) return false;
      return op.forwardCreating === true;
    }
  },
  {
    id: 'uxVersionControl.preservation-is-immutable-r2',
    contributor: 'ux-version-control',
    reads: ['uxVersionControl.designVersionRetention'],
    severity: 'fail',
    description:
      'Preservation guarantee MUST be the literal `"immutable-r2-storage"`. Every uploaded UX is preserved forever in immutable R2 (spec §2.15). Tenant override may shorten active-window retention but never the preservation guarantee.',
    detect(arch): boolean {
      const r = readField(arch, 'uxVersionControl.designVersionRetention');
      if (!isObject(r)) return false;
      return r.preservationGuarantee === 'immutable-r2-storage';
    }
  },
  {
    id: 'uxVersionControl.gdpr-uses-tombstone-not-hard-delete',
    contributor: 'ux-version-control',
    reads: ['uxVersionControl.designVersionRetention'],
    severity: 'fail',
    description:
      'GDPR delete MUST use tombstone + anonymization, never hard delete of the version row. `gdprInteraction` must be `"anonymize-in-version"` or `"purge-and-tombstone"`.',
    detect(arch): boolean {
      const r = readField(arch, 'uxVersionControl.designVersionRetention');
      if (!isObject(r)) return false;
      const g = r.gdprInteraction;
      return g === 'anonymize-in-version' || g === 'purge-and-tombstone';
    }
  },
  {
    id: 'uxVersionControl.audit-trail-is-append-only',
    contributor: 'ux-version-control',
    reads: ['uxVersionControl.auditTrail'],
    severity: 'fail',
    description:
      'Audit trail MUST be append-only and tamper-evident. `auditTrail.immutability` must equal "append-only".',
    detect(arch): boolean {
      const at = readField(arch, 'uxVersionControl.auditTrail');
      if (!isObject(at)) return false;
      return at.immutability === 'append-only';
    }
  },
  {
    id: 'uxVersionControl.audit-retention-meets-regulatory-floor',
    contributor: 'ux-version-control',
    reads: ['uxVersionControl.auditTrail'],
    severity: 'fail',
    description:
      'Audit retention must be >= 7 years (2555 days) regulatory floor. Without this, the audit trail cannot survive a compliance audit.',
    detect(arch): boolean {
      const at = readField(arch, 'uxVersionControl.auditTrail');
      if (!isObject(at)) return false;
      const days = typeof at.retentionDays === 'number' ? at.retentionDays : -1;
      return days >= 2555;
    }
  },
  {
    id: 'uxVersionControl.audit-attributes-operator-time-version',
    contributor: 'ux-version-control',
    reads: ['uxVersionControl.auditTrail'],
    severity: 'fail',
    description:
      'Audit trail attributedFields MUST include who (operator id), when (UTC timestamp), AND versionId. Without these three, the audit log cannot correlate a revert to a design state.',
    detect(arch): boolean {
      const at = readField(arch, 'uxVersionControl.auditTrail');
      if (!isObject(at)) return false;
      const fields = at.attributedFields;
      if (!Array.isArray(fields)) return false;
      return fields.includes('who') && fields.includes('when') && fields.includes('versionId');
    }
  },
  {
    id: 'uxVersionControl.diff-layers-cover-five-dimensions',
    contributor: 'ux-version-control',
    reads: ['uxVersionControl.diffVisualizationSpec'],
    severity: 'advisory',
    description:
      'Diff visualization should cover the five canonical layers proven by @caia/atlas-design-snapshotter (PR #538): tree, token, copy, asset, interactivity. Missing layers cascade into incomplete diff narration.',
    detect(arch): boolean {
      const d = readField(arch, 'uxVersionControl.diffVisualizationSpec');
      if (!isObject(d)) return false;
      const layers = d.diffLayers;
      if (!Array.isArray(layers)) return false;
      const required = ['tree', 'token', 'copy', 'asset', 'interactivity'];
      for (const r of required) if (!layers.includes(r)) return false;
      return true;
    }
  },
  {
    id: 'uxVersionControl.branching-default-off-in-v1',
    contributor: 'ux-version-control',
    reads: ['uxVersionControl.branchingStrategy'],
    severity: 'advisory',
    description:
      'V1 posture: branching is OFF by default. `branchingStrategy.forkAllowed` should be `false` unless an operator opt-in is justified in `notes`. Enabling fork without a merge policy risks orphan branches.',
    detect(arch): boolean {
      const b = readField(arch, 'uxVersionControl.branchingStrategy');
      if (!isObject(b)) return false;
      // Advisory: it's fine to be `false`. If `true`, we require a non-null mergeStrategy.
      if (b.forkAllowed !== true) return true;
      return typeof b.mergeStrategy === 'string' && b.mergeStrategy.length > 0;
    }
  }
];
