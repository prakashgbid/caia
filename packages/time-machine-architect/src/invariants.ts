/**
 * Time Machine's contributions to the EA Reviewer's cross-architect
 * invariants registry. The forward-creating revert invariant is the
 * single most important one — destructive revert is a hard contract
 * violation.
 */

export type InvariantSeverity = 'fail' | 'advisory';

export interface ArchitectInvariant {
  id: string;
  contributor: string;
  reads: readonly string[];
  severity: InvariantSeverity;
  description: string;
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

export const TIME_MACHINE_INVARIANTS: readonly ArchitectInvariant[] = [
  {
    id: 'timeMachine.revert-is-forward-creating',
    contributor: 'time-machine',
    reads: ['timeMachine.revertOperation'],
    severity: 'fail',
    description:
      'Every Time Machine revert MUST be forward-creating: appended to the chain tip, never overwriting prior history. `revertOperation.forwardCreating` must be the literal boolean `true`. Destructive revert is a hard contract violation.',
    detect(arch): boolean {
      const op = readField(arch, 'timeMachine.revertOperation');
      if (!isObject(op)) return false;
      return op.forwardCreating === true;
    }
  },
  {
    id: 'timeMachine.versioning-is-append-only',
    contributor: 'time-machine',
    reads: ['timeMachine.versioningStrategy'],
    severity: 'fail',
    description:
      'Versioning strategy MUST be append-only. Snapshots are never overwritten in place. `versioningStrategy.immutability` must equal "append-only".',
    detect(arch): boolean {
      const vs = readField(arch, 'timeMachine.versioningStrategy');
      if (!isObject(vs)) return false;
      return vs.immutability === 'append-only';
    }
  },
  {
    id: 'timeMachine.audit-trail-is-append-only',
    contributor: 'time-machine',
    reads: ['timeMachine.auditTrail'],
    severity: 'fail',
    description:
      'Audit trail MUST be append-only and tamper-evident. `auditTrail.immutability` must equal "append-only".',
    detect(arch): boolean {
      const at = readField(arch, 'timeMachine.auditTrail');
      if (!isObject(at)) return false;
      return at.immutability === 'append-only';
    }
  },
  {
    id: 'timeMachine.audit-retention-floor-snapshot-retention',
    contributor: 'time-machine',
    reads: ['timeMachine.auditTrail', 'timeMachine.snapshotRetention'],
    severity: 'fail',
    description:
      'Audit retention must be >= snapshot retention. Operators must be able to query the audit log for the lifetime of every snapshot it references.',
    detect(arch): boolean {
      const at = readField(arch, 'timeMachine.auditTrail');
      const sr = readField(arch, 'timeMachine.snapshotRetention');
      if (!isObject(at) || !isObject(sr)) return false;
      const auditDays = typeof at.retentionDays === 'number' ? at.retentionDays : -1;
      const snapDays = typeof sr.retentionDays === 'number' ? sr.retentionDays : -1;
      if (auditDays < 0 || snapDays < 0) return false;
      return auditDays >= snapDays;
    }
  },
  {
    id: 'timeMachine.audit-attributes-operator-and-time',
    contributor: 'time-machine',
    reads: ['timeMachine.auditTrail'],
    severity: 'fail',
    description:
      'Audit trail attributedFields MUST include who (operator id) AND when (UTC timestamp). Without operator + time, the audit log is not actionable.',
    detect(arch): boolean {
      const at = readField(arch, 'timeMachine.auditTrail');
      if (!isObject(at)) return false;
      const fields = at.attributedFields;
      if (!Array.isArray(fields)) return false;
      return fields.includes('who') && fields.includes('when');
    }
  },
  {
    id: 'timeMachine.data-consistency-depends-on-db-lifecycle',
    contributor: 'time-machine',
    reads: ['timeMachine.dataConsistency'],
    severity: 'fail',
    description:
      "Time Machine MUST acknowledge it depends on Database Architect's dataLifecycle. `dataConsistency.dependsOnDatabaseLifecycle` must be the literal boolean `true`. Otherwise revert may break GDPR or retention contracts.",
    detect(arch): boolean {
      const dc = readField(arch, 'timeMachine.dataConsistency');
      if (!isObject(dc)) return false;
      return dc.dependsOnDatabaseLifecycle === true;
    }
  },
  {
    id: 'timeMachine.description-length-within-budget',
    contributor: 'time-machine',
    reads: ['timeMachine.descriptionGeneration'],
    severity: 'advisory',
    description:
      'Auto-generated descriptions should stay within the spec §2.14 budget (5-15 words by default). Wider windows produce noisy audit feeds.',
    detect(arch): boolean {
      const dg = readField(arch, 'timeMachine.descriptionGeneration');
      if (!isObject(dg)) return false;
      const minW = typeof dg.minWords === 'number' ? dg.minWords : -1;
      const maxW = typeof dg.maxWords === 'number' ? dg.maxWords : -1;
      if (minW < 1 || maxW < minW) return false;
      return maxW <= 30;
    }
  }
];
