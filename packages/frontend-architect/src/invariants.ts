/**
 * This architect's contributions to the EA Reviewer's cross-architect
 * invariants registry (per spec §6.2).
 *
 * The Reviewer applies a fixed set of cross-architect predicates after
 * composition. This module enumerates Frontend's contributions so the
 * Reviewer's `invariants-registry.ts` (which doesn't exist yet — sibling
 * brief F2) can collect them at process boot.
 *
 * Each invariant is a pure predicate over either:
 *   - the per-architect `architectureFields` dict (where keys are FLAT
 *     dotted strings like `'frontend.componentTree'`), or
 *   - the composed `tickets.architecture` JSONB blob (where the
 *     Dispatcher will nest the same fields under the `frontend.*` path).
 *
 * Both views are accepted — we look up via `readField()` which checks
 * the flat key first, then falls back to the nested path. This lets the
 * same invariants run inside the Frontend package's own tests AND
 * inside the Reviewer's post-composition pass.
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

/**
 * Frontend's contributed invariants. Listed in stable order.
 */
export const FRONTEND_INVARIANTS: readonly ArchitectInvariant[] = [
  {
    id: 'frontend.componentTree-nonempty',
    contributor: 'frontend',
    reads: ['frontend.componentTree'],
    severity: 'fail',
    description:
      'Every Frontend output must have at least one component in `componentTree`. An empty tree means the architect failed to project the design.',
    detect(arch): boolean {
      const tree = readField(arch, 'frontend.componentTree');
      return Array.isArray(tree) && tree.length > 0;
    }
  },
  {
    id: 'frontend.tokens-source-from-design',
    contributor: 'frontend',
    reads: ['frontend.tokens', 'frontend.designTokenReferences'],
    severity: 'advisory',
    description:
      'Every token referenced in `designTokenReferences` should exist in `tokens`. Missing tokens cascade into runtime style errors.',
    detect(arch): boolean {
      const tokens = readField(arch, 'frontend.tokens');
      const refs = readField(arch, 'frontend.designTokenReferences');
      if (typeof tokens !== 'object' || tokens === null) return false;
      if (typeof refs !== 'object' || refs === null) return true; // no refs ⇒ trivially pass
      const tokenKeys = new Set(Object.keys(tokens as Record<string, unknown>));
      for (const [, refList] of Object.entries(refs as Record<string, unknown>)) {
        if (!Array.isArray(refList)) continue;
        for (const ref of refList) {
          if (typeof ref === 'string' && !tokenKeys.has(ref)) return false;
        }
      }
      return true;
    }
  },
  {
    id: 'frontend.interactionStates-cover-all-seven',
    contributor: 'frontend',
    reads: ['frontend.interactionStates'],
    severity: 'advisory',
    description:
      'Every interactive component should declare all seven interaction states (hover, focus, active, error, empty, loading, disabled) — even if the value is "n/a".',
    detect(arch): boolean {
      const states = readField(arch, 'frontend.interactionStates');
      if (typeof states !== 'object' || states === null) return false;
      const required = ['hover', 'focus', 'active', 'error', 'empty', 'loading', 'disabled'];
      for (const [, perComp] of Object.entries(states as Record<string, unknown>)) {
        if (typeof perComp !== 'object' || perComp === null) return false;
        const got = new Set(Object.keys(perComp as Record<string, unknown>));
        for (const r of required) if (!got.has(r)) return false;
      }
      return true;
    }
  },
  {
    id: 'frontend.framework-is-next-app-router',
    contributor: 'frontend',
    reads: ['frontend.framework'],
    severity: 'fail',
    description:
      'The locked stack mandates Next.js App Router. Any framework decision other than Next.js is a hard violation.',
    detect(arch): boolean {
      const fw = readField(arch, 'frontend.framework');
      if (typeof fw !== 'object' || fw === null) return false;
      const name = (fw as Record<string, unknown>).name;
      return name === 'next';
    }
  }
];
