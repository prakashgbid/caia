/**
 * `AccessibilityArchitectContract` — the canonical owned-fields declaration
 * for architect #5 of CAIA's 17-architect EA fan-out.
 *
 * Sources of truth:
 *   - spec §1.3 (ArchitectSectionContract + architectMeta)
 *   - spec §2.5 (Accessibility Architect owns `a11y.*`)
 *   - task brief (wcagLevel, ariaRoles, ariaLabels, keyboardNavigationPlan,
 *     focusManagementNotes, colorContrastRequirements,
 *     screenReaderAnnouncementPoints, reducedMotionConsiderations,
 *     formAccessibilitySpec)
 *
 * Naming: the architect's `name` is `"accessibility"`, the owned-field
 * namespace is `a11y.*`. The `accessibility → a11y` alias is resolved by
 * the EA Dispatcher's `fieldBelongsTo` resolver. The canonical precedence
 * ladder in `@caia/architect-kit` keys this architect under `a11y`.
 *
 * Field disjointness with the other 16 architects is the invariant the
 * Dispatcher enforces. All chosen keys live under the `a11y.*` namespace
 * and do not collide with any sibling architect's namespace (Frontend
 * declares `frontend.a11yFloor` and `frontend.a11yNotesForUI` — those
 * are floor/intent fields under the Frontend namespace, distinct from
 * this architect's `a11y.*` conformance spec).
 */

import type {
  ArchitectMeta,
  ArchitectSectionContract,
  ArchitectSectionSpec,
  Ticket
} from './types.js';

// ─── Owned field set ────────────────────────────────────────────────────────

/**
 * Per-field operator fix-hints. The kit's `ArchitectSectionSpec` is
 * intentionally minimal (`path`, `description`, `required`); the fix-hint
 * dictionary lives next to the contract so the system-prompt builder and
 * the future EA Reviewer can surface it without changing kit shape.
 */
export const A11Y_FIELD_FIX_HINTS: Readonly<Record<string, string>> = {
  'a11y.wcagLevel':
    'Locked to "2.2 AA" for V1. Reject any decision that drops below AA or that targets a non-2.2 version.',
  'a11y.ariaRoles':
    'Emit a role ONLY when native semantics are insufficient. Prefer <button>, <nav>, <dialog>, <a> over role overrides. Per-component map.',
  'a11y.ariaLabels':
    'For every interactive component in frontend.componentTree, declare {labelSource: aria-label|aria-labelledby|visibleText, value: string|ref}.',
  'a11y.keyboardNavigationPlan':
    'For every interactive component: tab order, arrow-key semantics for composites (combobox, menu, tabs, grid), Escape/Enter/Space contracts.',
  'a11y.focusManagementNotes':
    'Per component: focus trap (modals/dialogs), focus return target on close, initial focus on mount, focus-ring spec.',
  'a11y.colorContrastRequirements':
    'Per token pair (fg/bg): minimum ratio. 4.5:1 body text, 3:1 large text (≥18pt or 14pt bold), 3:1 UI components and graphical objects.',
  'a11y.screenReaderAnnouncementPoints':
    'Live-region map: which components need aria-live=polite vs assertive, plus state-change announcements (e.g., form-error, async-load).',
  'a11y.reducedMotionConsiderations':
    'Enumerate animations that gate on prefers-reduced-motion: reduce. Provide reduced-motion alternatives (instant transitions, opacity-only fades).',
  'a11y.formAccessibilitySpec':
    'For every form field: label association (<label htmlFor>), error message wiring (aria-describedby + aria-invalid), required indicator (aria-required + visible *), autocomplete tokens.'
};

/**
 * The owned section specs in stable order.
 */
export const A11Y_OWNED_SECTIONS: readonly ArchitectSectionSpec[] = [
  {
    path: 'a11y.wcagLevel',
    description:
      'Target WCAG version + conformance level. Locked to "2.2 AA" for V1. Downstream auditors gate on this value.',
    required: true
  },
  {
    path: 'a11y.ariaRoles',
    description:
      'Per-component ARIA role assignments. Emit only when native semantics are insufficient (composite widgets, custom controls).',
    required: true
  },
  {
    path: 'a11y.ariaLabels',
    description:
      'Per-interactive-component accessible-name source: aria-label string, aria-labelledby reference, or visible-text reference.',
    required: true
  },
  {
    path: 'a11y.keyboardNavigationPlan',
    description:
      'Tab order, arrow-key semantics for composite widgets, Escape/Enter/Space contracts per interactive component.',
    required: true
  },
  {
    path: 'a11y.focusManagementNotes',
    description:
      'Focus trap rules (dialogs/modals), focus return target on close, initial focus on mount, focus-ring spec per component.',
    required: true
  },
  {
    path: 'a11y.colorContrastRequirements',
    description:
      'Per-token-pair contrast floors. 4.5:1 body text, 3:1 large text & UI components & graphical objects. References frontend.tokens.',
    required: true
  },
  {
    path: 'a11y.screenReaderAnnouncementPoints',
    description:
      'Live-region map (polite/assertive) and state-change announcements (form errors, async loads, route changes).',
    required: true
  },
  {
    path: 'a11y.reducedMotionConsiderations',
    description:
      'Animations that gate on prefers-reduced-motion plus their reduced-motion alternatives. Aligns with frontend.motionPreference.',
    required: true
  },
  {
    path: 'a11y.formAccessibilitySpec',
    description:
      'Per-form-field accessibility spec: label association, error announcement wiring, required indicator, autocomplete tokens.',
    required: true
  }
];

/**
 * Flat list of owned field paths. Used by `run()` to validate the
 * subagent's output and by the conformance test suite.
 */
export const A11Y_OWNED_FIELD_KEYS: readonly string[] = A11Y_OWNED_SECTIONS.map(
  s => s.path
);

// ─── Apply predicate ────────────────────────────────────────────────────────

/**
 * Spec §2.5 — Accessibility runs on every ticket that produces UI. The
 * set matches Frontend's `appliesPredicate` because a11y is a per-UI
 * specialisation downstream of Frontend.
 */
export function accessibilityArchitectAppliesPredicate(ticket: Ticket): boolean {
  return (
    ticket.type === 'Page' ||
    ticket.type === 'Widget' ||
    ticket.type === 'Story' ||
    ticket.type === 'Form' ||
    ticket.type === 'List'
  );
}

// ─── Architect meta ─────────────────────────────────────────────────────────

/**
 * Accessibility is a wave-2 architect — depends on Frontend's
 * `componentTree` + `interactionStates`. Precedence rank 3 per spec
 * §5.2 (a11y in CANONICAL_PRECEDENCE_LADDER) — accessibility is treated
 * as a legal-exposure concern, above Frontend (#14), SEO (#4), and
 * Performance (#5), below Security (#1) and DevOps (#2).
 */
export const ACCESSIBILITY_ARCHITECT_META: ArchitectMeta = {
  dependsOn: ['frontend'],
  precedenceLevel: 3,
  fanoutPolicy: 'always',
  appliesPredicate: accessibilityArchitectAppliesPredicate,
  runtimeModel: 'sonnet'
};

// ─── The contract ───────────────────────────────────────────────────────────

export const AccessibilityArchitectContract: ArchitectSectionContract = {
  contractId: 'accessibility-architect.v1',
  architectName: 'accessibility',
  version: '0.1.0',
  sections: A11Y_OWNED_SECTIONS,
  architectMeta: ACCESSIBILITY_ARCHITECT_META
};
