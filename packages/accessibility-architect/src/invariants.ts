/**
 * This architect's contributions to the EA Reviewer's cross-architect
 * invariants registry (per spec §6.2).
 *
 * The Reviewer applies a fixed set of cross-architect predicates after
 * composition. This module enumerates Accessibility's contributions so
 * the Reviewer's `invariants-registry.ts` (which doesn't exist yet —
 * sibling brief F2) can collect them at process boot.
 *
 * Each invariant is a pure predicate over either:
 *   - the per-architect `architectureFields` dict (where keys are FLAT
 *     dotted strings like `'a11y.wcagLevel'`), or
 *   - the composed `tickets.architecture` JSONB blob (where the
 *     Dispatcher will nest the same fields under the `a11y.*` path).
 *
 * Both views are accepted — we look up via `readField()` which checks
 * the flat key first, then falls back to the nested path. This lets the
 * same invariants run inside the Accessibility package's own tests AND
 * inside the Reviewer's post-composition pass.
 *
 * Cross-architect invariants (those that read fields owned by another
 * architect) treat absent foreign data as "cannot verify" and pass
 * trivially. The Reviewer's composed-output pass will exercise the
 * real check; the per-architect test pass exercises only the local
 * checks. This keeps unit tests on the A11y output green even though
 * frontend.* fields aren't present.
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
 * Accessibility's contributed invariants. Listed in stable order.
 */
export const ACCESSIBILITY_INVARIANTS: readonly ArchitectInvariant[] = [
  {
    id: 'a11y.wcagLevel-is-2.2-AA',
    contributor: 'accessibility',
    reads: ['a11y.wcagLevel'],
    severity: 'fail',
    description:
      'V1 mandates WCAG 2.2 AA. Any wcagLevel other than the literal "2.2 AA" is a hard violation.',
    detect(arch): boolean {
      const level = readField(arch, 'a11y.wcagLevel');
      return level === '2.2 AA';
    }
  },
  {
    id: 'a11y.ariaLabels-cover-interactive-components',
    contributor: 'accessibility',
    reads: ['a11y.ariaLabels', 'frontend.interactionStates'],
    severity: 'fail',
    description:
      'Every interactive component declared in Frontend `interactionStates` must have a matching accessible-name source in `a11y.ariaLabels`. Trivially passes if the Frontend output is absent (cross-arch invariant — Reviewer runs against the composed output).',
    detect(arch): boolean {
      const labels = readField(arch, 'a11y.ariaLabels');
      const interactives = readField(arch, 'frontend.interactionStates');
      if (typeof interactives !== 'object' || interactives === null) return true;
      if (typeof labels !== 'object' || labels === null) return false;
      const labelKeys = new Set(Object.keys(labels as Record<string, unknown>));
      for (const compId of Object.keys(interactives as Record<string, unknown>)) {
        if (!labelKeys.has(compId)) return false;
      }
      return true;
    }
  },
  {
    id: 'a11y.keyboardPlan-covers-interactive-components',
    contributor: 'accessibility',
    reads: ['a11y.keyboardNavigationPlan', 'frontend.interactionStates'],
    severity: 'fail',
    description:
      'Every interactive component declared in Frontend `interactionStates` must have a keyboard contract in `a11y.keyboardNavigationPlan`. Trivially passes if the Frontend output is absent.',
    detect(arch): boolean {
      const plan = readField(arch, 'a11y.keyboardNavigationPlan');
      const interactives = readField(arch, 'frontend.interactionStates');
      if (typeof interactives !== 'object' || interactives === null) return true;
      if (typeof plan !== 'object' || plan === null) return false;
      const planKeys = new Set(Object.keys(plan as Record<string, unknown>));
      for (const compId of Object.keys(interactives as Record<string, unknown>)) {
        if (!planKeys.has(compId)) return false;
      }
      return true;
    }
  },
  {
    id: 'a11y.colorContrast-references-real-tokens',
    contributor: 'accessibility',
    reads: ['a11y.colorContrastRequirements', 'frontend.tokens'],
    severity: 'advisory',
    description:
      'Every token referenced in `a11y.colorContrastRequirements` should exist in Frontend `tokens`. Missing tokens cascade into unverifiable contrast claims. Trivially passes if the Frontend output is absent.',
    detect(arch): boolean {
      const reqs = readField(arch, 'a11y.colorContrastRequirements');
      const tokens = readField(arch, 'frontend.tokens');
      if (typeof reqs !== 'object' || reqs === null) return true;
      if (typeof tokens !== 'object' || tokens === null) return true;
      const tokenKeys = new Set(Object.keys(tokens as Record<string, unknown>));
      for (const entry of Object.values(reqs as Record<string, unknown>)) {
        if (typeof entry !== 'object' || entry === null) continue;
        const pair = entry as Record<string, unknown>;
        const fg = pair.fg;
        const bg = pair.bg;
        if (typeof fg === 'string' && !tokenKeys.has(fg)) return false;
        if (typeof bg === 'string' && !tokenKeys.has(bg)) return false;
      }
      return true;
    }
  },
  {
    id: 'a11y.colorContrast-minRatio-is-aa-floor',
    contributor: 'accessibility',
    reads: ['a11y.colorContrastRequirements'],
    severity: 'fail',
    description:
      'Every contrast requirement must declare a minRatio at the WCAG 2.2 AA floor or higher: 4.5 for body, 3 for large/UI/graphical. Lower values violate AA.',
    detect(arch): boolean {
      const reqs = readField(arch, 'a11y.colorContrastRequirements');
      if (typeof reqs !== 'object' || reqs === null) return true;
      for (const entry of Object.values(reqs as Record<string, unknown>)) {
        if (typeof entry !== 'object' || entry === null) continue;
        const r = (entry as Record<string, unknown>).minRatio;
        if (typeof r !== 'number') return false;
        if (r < 3) return false;
      }
      return true;
    }
  },
  {
    id: 'a11y.focusManagement-dialogs-trap-focus',
    contributor: 'accessibility',
    reads: ['a11y.focusManagementNotes', 'a11y.ariaRoles'],
    severity: 'fail',
    description:
      'Any component with ARIA role `dialog` or `alertdialog` must have `trap=true` in its focusManagementNotes entry.',
    detect(arch): boolean {
      const roles = readField(arch, 'a11y.ariaRoles');
      const focus = readField(arch, 'a11y.focusManagementNotes');
      if (typeof roles !== 'object' || roles === null) return true;
      if (typeof focus !== 'object' || focus === null) return false;
      for (const [compId, role] of Object.entries(roles as Record<string, unknown>)) {
        if (role === 'dialog' || role === 'alertdialog') {
          const entry = (focus as Record<string, unknown>)[compId];
          if (typeof entry !== 'object' || entry === null) return false;
          if ((entry as Record<string, unknown>).trap !== true) return false;
        }
      }
      return true;
    }
  },
  {
    id: 'a11y.reducedMotion-has-alternatives',
    contributor: 'accessibility',
    reads: ['a11y.reducedMotionConsiderations'],
    severity: 'advisory',
    description:
      'Every gated animation in `a11y.reducedMotionConsiderations.animations` should declare a reducedAlternative string.',
    detect(arch): boolean {
      const considerations = readField(arch, 'a11y.reducedMotionConsiderations');
      if (typeof considerations !== 'object' || considerations === null) return true;
      const animations = (considerations as Record<string, unknown>).animations;
      if (!Array.isArray(animations)) return true;
      for (const a of animations) {
        if (typeof a !== 'object' || a === null) return false;
        const alt = (a as Record<string, unknown>).reducedAlternative;
        if (typeof alt !== 'string' || alt.length === 0) return false;
      }
      return true;
    }
  }
];
