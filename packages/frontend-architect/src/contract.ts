/**
 * `FrontendArchitectContract` — the canonical owned-fields declaration for
 * architect #1 of CAIA's 17-architect EA fan-out.
 *
 * Sources of truth:
 *   - spec §1.3 (ArchitectSectionContract + architectMeta)
 *   - spec §2.1 (Frontend Architect owns `frontend.*`)
 *   - task brief (componentTree, propsContract, stateModel,
 *     designTokenReferences, a11yNotesForUI, routingNotes, interactionStates)
 *
 * The reconciled superset below includes both the spec §2.1 stack-lock
 * fields and the task brief's per-ticket-structure fields. Every field
 * is marked `required: true` because downstream architects (A11y,
 * Performance, Analytics) read these — missing fields cascade.
 *
 * Field disjointness with the other 16 architects is the invariant the
 * Dispatcher enforces. The chosen keys all live under the `frontend.*`
 * namespace and do not collide with any sibling architect's namespace.
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
export const FRONTEND_FIELD_FIX_HINTS: Readonly<Record<string, string>> = {
  'frontend.framework':
    'Default to {"name":"next","version":"15.x","router":"app"}. Reject any decision that overrides the locked stack.',
  'frontend.componentLibrary':
    'Default to {"name":"shadcn/ui","tailwindVersion":"3.x","radixVersion":"1.x"}.',
  'frontend.stateMgmt':
    'Prefer Server Components. Reach for zustand only when state must persist across navigations or be shared between sibling components.',
  'frontend.routeConfig':
    'Map the ticket to an App Router segment under `app/`. Include `loading.tsx` and `error.tsx` placements.',
  'frontend.tokens':
    'Source tokens from `designVersion.tokens` (anchor `meta`). If a required token is absent, list it under `risks` rather than inventing one.',
  'frontend.breakpoints':
    'Default to Tailwind defaults (sm, md, lg, xl, 2xl) unless `designVersion` overrides.',
  'frontend.a11yFloor':
    'For every interactive widget in `componentTree`, declare the required HTML element. Defer ARIA detail to the A11y Architect.',
  'frontend.motionPreference':
    'Default: every transition longer than 200ms gates on `prefers-reduced-motion: no-preference`.',
  'frontend.componentTree':
    'Project the design into a tree of { id, kind, children, propsContractRef? } nodes. Every interactive widget must be a leaf with an `id`.',
  'frontend.propsContract':
    'Output one entry per non-leaf component. Use Zod-style type descriptors (string, number, boolean, array, object).',
  'frontend.stateModel':
    'For each interactive component, declare {kind: server|client|url|zustand, store?: string, derivedFrom?: string[]}. Default to "server".',
  'frontend.designTokenReferences':
    'For each component, list the token keys it uses. Tokens must exist in `frontend.tokens`.',
  'frontend.a11yNotesForUI':
    'For each interactive component, note: semantic element, label source, focus-management hint, expected keyboard behaviour.',
  'frontend.routingNotes':
    'Tie back to `frontend.routeConfig`. Always include the segment kind (page|layout|loading|error|not-found).',
  'frontend.interactionStates':
    'For each interactive component, output an object with keys hover, focus, active, error, empty, loading, disabled. Each value is a short description (or "n/a").'
};

/**
 * The owned section specs in stable order.
 */
export const FRONTEND_OWNED_SECTIONS: readonly ArchitectSectionSpec[] = [
  {
    path: 'frontend.framework',
    description:
      'Locked: Next.js 15 App Router. Output the framework + version so downstream architects can validate compatibility.',
    required: true
  },
  {
    path: 'frontend.componentLibrary',
    description:
      'Locked: shadcn/ui on top of Radix primitives + Tailwind. Output the library + version + token-source.',
    required: true
  },
  {
    path: 'frontend.stateMgmt',
    description:
      'State management choice — zustand for client-side ephemeral state; Server Components default for everything else.',
    required: true
  },
  {
    path: 'frontend.routeConfig',
    description:
      'Per-ticket route placement: route segment, layout, loading/error boundaries, dynamic-segment shape.',
    required: true
  },
  {
    path: 'frontend.tokens',
    description:
      'Design tokens lifted verbatim from intake IR (colors, spacing, typography). Reject any token invented by the architect.',
    required: true
  },
  {
    path: 'frontend.breakpoints',
    description:
      'Responsive breakpoints supported by this ticket. Inherits from `designVersion`.',
    required: true
  },
  {
    path: 'frontend.a11yFloor',
    description:
      'UI-author intent: which semantic elements are mandatory (e.g. <button> not <div role="button">), tab-order intent, focus-trap intent.',
    required: true
  },
  {
    path: 'frontend.motionPreference',
    description:
      'Respect `prefers-reduced-motion`. Output the motion contract: which animations gate on the media query, which never animate.',
    required: true
  },
  {
    path: 'frontend.componentTree',
    description:
      'The canonical declaration of which React components compose this ticket, with parent → child nesting. Analytics and A11y read this as the source of truth.',
    required: true
  },
  {
    path: 'frontend.propsContract',
    description:
      'For every component declared in `componentTree`, the TypeScript props contract (prop name → type).',
    required: true
  },
  {
    path: 'frontend.stateModel',
    description:
      'Per-component state model: which props are client-state, which are server-state, which derive from URL params, which are global zustand stores.',
    required: true
  },
  {
    path: 'frontend.designTokenReferences',
    description:
      'Per-component token references: which design tokens each component consumes. Lets the Performance Architect compute critical-CSS hints.',
    required: true
  },
  {
    path: 'frontend.a11yNotesForUI',
    description:
      'UI-author accessibility intent per component. The A11y Architect uses these as input to its conformance map. NOT the full a11y spec — that lives under `a11y.*`.',
    required: true
  },
  {
    path: 'frontend.routingNotes',
    description:
      'App Router specifics for this ticket: which segment file (page/layout/loading/error/not-found), parallel routes, intercepting routes, search params, dynamic segments.',
    required: true
  },
  {
    path: 'frontend.interactionStates',
    description:
      'Per-interactive-component state coverage: hover, focus, active, error, empty, loading, disabled.',
    required: true
  }
];

/**
 * Flat list of owned field paths. Used by `run()` to validate the
 * subagent's output and by the conformance test suite.
 */
export const FRONTEND_OWNED_FIELD_KEYS: readonly string[] = FRONTEND_OWNED_SECTIONS.map(
  s => s.path
);

// ─── Apply predicate ────────────────────────────────────────────────────────

/**
 * Spec §2.1 — Frontend runs on Page, Widget, and Story ticket types.
 * Form and List are Story sub-types we also handle.
 */
export function frontendArchitectAppliesPredicate(ticket: Ticket): boolean {
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
 * Frontend is a wave-1 architect (`dependsOn: []`). Precedence rank 14
 * per spec §5.2 — deliberately below A11y/SEO/Perf so those critics can
 * override visual decisions that violate hard constraints.
 */
export const FRONTEND_ARCHITECT_META: ArchitectMeta = {
  dependsOn: [],
  precedenceLevel: 14,
  fanoutPolicy: 'always',
  appliesPredicate: frontendArchitectAppliesPredicate,
  runtimeModel: 'sonnet'
};

// ─── The contract ───────────────────────────────────────────────────────────

export const FrontendArchitectContract: ArchitectSectionContract = {
  contractId: 'frontend-architect.v1',
  architectName: 'frontend',
  version: '0.1.0',
  sections: FRONTEND_OWNED_SECTIONS,
  architectMeta: FRONTEND_ARCHITECT_META
};
