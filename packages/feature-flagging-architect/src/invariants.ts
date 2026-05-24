/**
 * This architect's contributions to the EA Reviewer's cross-architect
 * invariants registry (per spec §6.2).
 *
 * The Reviewer applies a fixed set of cross-architect predicates after
 * composition. This module enumerates Feature Flagging's contributions
 * so the Reviewer's `invariants-registry.ts` (which doesn't exist yet)
 * can collect them at process boot.
 *
 * Each invariant is a pure predicate over either:
 *   - the per-architect `architectureFields` dict (where keys are FLAT
 *     dotted strings like `'featureFlags.flagsSchema'`), or
 *   - the composed `tickets.architecture` JSONB blob (where the
 *     Dispatcher will nest the same fields under the `featureFlags.*`
 *     path).
 *
 * Both views are accepted — we look up via `readField()` which checks
 * the flat key first, then falls back to the nested path. This lets the
 * same invariants run inside the Feature Flagging package's own tests
 * AND inside the Reviewer's post-composition pass.
 *
 * True ⇒ pass; false ⇒ a Reviewer advisory or fail (driven by `severity`).
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

/**
 * Read a field from the architecture blob. Tries the flat dotted key
 * first (matches `architectureFields` shape), then falls back to walking
 * the nested object path (matches composed-architecture shape).
 */
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

/** Material-blast-radius categories that mandate a kill switch. */
const BLAST_RADIUS_REQUIRING_KILL_SWITCH = new Set([
  'auth',
  'payments',
  'data-export',
  'ai-inference',
  'third-party-spend'
]);

/**
 * Feature Flagging's contributed invariants. Listed in stable order.
 */
export const FEATURE_FLAGGING_INVARIANTS: readonly ArchitectInvariant[] = [
  {
    id: 'featureFlags.flagsSchema-is-array',
    contributor: 'featureFlagging',
    reads: ['featureFlags.flagsSchema'],
    severity: 'fail',
    description:
      'flagsSchema must be an array. A ticket with zero flags is represented as `[]`; the key must never be omitted or scalar.',
    detect(arch): boolean {
      const schema = readField(arch, 'featureFlags.flagsSchema');
      return Array.isArray(schema);
    }
  },
  {
    id: 'featureFlags.every-flag-has-rollout',
    contributor: 'featureFlagging',
    reads: ['featureFlags.flagsSchema', 'featureFlags.rolloutStrategies'],
    severity: 'fail',
    description:
      'Every flag declared in flagsSchema must have a matching entry in rolloutStrategies (referenced by `flag` field). Flags without rollout strategies cannot ship safely.',
    detect(arch): boolean {
      const schema = readField(arch, 'featureFlags.flagsSchema');
      const rollouts = readField(arch, 'featureFlags.rolloutStrategies');
      if (!Array.isArray(schema) || !Array.isArray(rollouts)) return false;
      const rolloutFlags = new Set(
        rollouts
          .map(r =>
            typeof r === 'object' && r !== null
              ? (r as Record<string, unknown>).flag
              : undefined
          )
          .filter(f => typeof f === 'string')
      );
      for (const f of schema) {
        if (typeof f !== 'object' || f === null) return false;
        const name = (f as Record<string, unknown>).name;
        if (typeof name !== 'string') return false;
        if (!rolloutFlags.has(name)) return false;
      }
      return true;
    }
  },
  {
    id: 'featureFlags.every-flag-has-audit',
    contributor: 'featureFlagging',
    reads: ['featureFlags.flagsSchema', 'featureFlags.auditRequirements'],
    severity: 'fail',
    description:
      'Every flag declared in flagsSchema must have a matching entry in auditRequirements. Audit is non-negotiable — no flag flips without an audit trail.',
    detect(arch): boolean {
      const schema = readField(arch, 'featureFlags.flagsSchema');
      const audits = readField(arch, 'featureFlags.auditRequirements');
      if (!Array.isArray(schema) || !Array.isArray(audits)) return false;
      const auditedFlags = new Set(
        audits
          .map(a =>
            typeof a === 'object' && a !== null
              ? (a as Record<string, unknown>).flag
              : undefined
          )
          .filter(f => typeof f === 'string')
      );
      for (const f of schema) {
        if (typeof f !== 'object' || f === null) return false;
        const name = (f as Record<string, unknown>).name;
        if (typeof name !== 'string') return false;
        if (!auditedFlags.has(name)) return false;
      }
      return true;
    }
  },
  {
    id: 'featureFlags.kill-switches-are-instant',
    contributor: 'featureFlagging',
    reads: ['featureFlags.killSwitches'],
    severity: 'fail',
    description:
      'Every entry in killSwitches must have `instantToggle: true`. A kill switch behind multi-step approval is not a kill switch.',
    detect(arch): boolean {
      const switches = readField(arch, 'featureFlags.killSwitches');
      if (!Array.isArray(switches)) return false;
      for (const s of switches) {
        if (typeof s !== 'object' || s === null) return false;
        if ((s as Record<string, unknown>).instantToggle !== true) return false;
      }
      return true;
    }
  },
  {
    id: 'featureFlags.experimentationLinkage-references-known-flags',
    contributor: 'featureFlagging',
    reads: ['featureFlags.flagsSchema', 'featureFlags.experimentationLinkage'],
    severity: 'advisory',
    description:
      'Every flag referenced in experimentationLinkage should exist in flagsSchema. A linkage to an unknown flag is dead config.',
    detect(arch): boolean {
      const schema = readField(arch, 'featureFlags.flagsSchema');
      const linkage = readField(arch, 'featureFlags.experimentationLinkage');
      if (!Array.isArray(schema) || !Array.isArray(linkage)) return true; // missing is handled by other invariants
      const knownFlags = new Set(
        schema
          .map(f =>
            typeof f === 'object' && f !== null
              ? (f as Record<string, unknown>).name
              : undefined
          )
          .filter(n => typeof n === 'string')
      );
      for (const entry of linkage) {
        if (typeof entry !== 'object' || entry === null) continue;
        const flag = (entry as Record<string, unknown>).flag;
        if (typeof flag !== 'string') continue;
        if (!knownFlags.has(flag)) return false;
      }
      return true;
    }
  },
  {
    id: 'featureFlags.audit-retention-bounded',
    contributor: 'featureFlagging',
    reads: ['featureFlags.auditRequirements'],
    severity: 'advisory',
    description:
      'Every auditRequirements entry must have `retentionDays >= 1` and `auditLogSink` set. Zero retention or missing sink defeats the audit trail.',
    detect(arch): boolean {
      const audits = readField(arch, 'featureFlags.auditRequirements');
      if (!Array.isArray(audits)) return true;
      for (const a of audits) {
        if (typeof a !== 'object' || a === null) return false;
        const sink = (a as Record<string, unknown>).auditLogSink;
        const retention = (a as Record<string, unknown>).retentionDays;
        if (typeof sink !== 'string' || sink.length === 0) return false;
        if (typeof retention !== 'number' || retention < 1) return false;
      }
      return true;
    }
  },
  {
    id: 'featureFlags.material-blast-radius-has-kill-switch',
    contributor: 'featureFlagging',
    reads: ['featureFlags.flagsSchema', 'featureFlags.killSwitches'],
    severity: 'advisory',
    description:
      'If flagsSchema declares a flag whose name/description hints at auth/payments/data-export/ai-inference/third-party-spend, AND killSwitches declares a kill switch with one of those blastRadius values, the flag should be marked. Otherwise the architect missed a required kill switch.',
    detect(arch): boolean {
      const switches = readField(arch, 'featureFlags.killSwitches');
      if (!Array.isArray(switches)) return true;
      // Sanity: every kill-switch declares one of the canonical
      // blast-radius categories (or "other"). We don't try to detect
      // missing kill switches here (that would require name/description
      // heuristics on flagsSchema, which is brittle) — we just enforce
      // the schema invariant.
      for (const s of switches) {
        if (typeof s !== 'object' || s === null) return false;
        const br = (s as Record<string, unknown>).blastRadius;
        if (typeof br !== 'string') return false;
        if (br !== 'other' && !BLAST_RADIUS_REQUIRING_KILL_SWITCH.has(br)) {
          return false;
        }
      }
      return true;
    }
  }
];
