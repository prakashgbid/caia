/**
 * Canonical wizard step catalogue.
 *
 * The 7-step wizard mirrors the canonical CAIA pipeline (steps 1-7) per
 * `research/state_machine_handoff_spec_2026.md` §1.2 + the ADR-024 IA
 * insertion at Step 3.5.
 *
 * Each step has:
 *   - `slug` — URL fragment, matches `app/wizard/[step]/page.tsx` param.
 *   - `title` — display title for the layout.
 *   - `description` — one-liner shown under the Progress indicator.
 *   - `fsmStates` — which `@caia/state-machine` ProjectState values the
 *     step "owns". Used by the layout to compute which step is active for
 *     a given project's current state. Sourced from
 *     `@caia/state-machine/src/states.ts` HAPPY_STATES (the post-ADR-024
 *     list, so IA shows up as Step 4 — Architecture).
 *
 * Reuse-first note:
 *   - The state values here are the exact strings exported from
 *     `@caia/state-machine`. We import the type-only `ProjectState` so
 *     compile-time drift between the wizard and the FSM throws.
 */

import type { ProjectState } from '@caia/state-machine';

export interface WizardStep {
  slug: WizardSlug;
  index: number; // 1-based, matches user-facing "Step N"
  title: string;
  description: string;
  fsmStates: ReadonlyArray<ProjectState>;
}

export type WizardSlug =
  | 'onboarding'
  | 'grand-idea'
  | 'interview'
  | 'architecture'
  | 'proposal'
  | 'design'
  | 'atlas';

export const WIZARD_STEPS: ReadonlyArray<WizardStep> = [
  {
    slug: 'onboarding',
    index: 1,
    title: 'Onboarding',
    description: 'Tell us who you are.',
    fsmStates: ['onboarding'],
  },
  {
    slug: 'grand-idea',
    index: 2,
    title: 'Grand Idea',
    description: 'Capture the one-paragraph north star.',
    fsmStates: ['idea-captured'],
  },
  {
    slug: 'interview',
    index: 3,
    title: 'Interview',
    description: 'The Interviewer Agent asks until your business plan is complete.',
    fsmStates: ['interviewing', 'interview-complete'],
  },
  {
    slug: 'architecture',
    index: 4,
    title: 'Information Architecture',
    description: 'The IA Agent emits pages, design-system, and components-library.',
    fsmStates: [
      'information-architecture-in-progress',
      'information-architecture-complete',
    ],
  },
  {
    slug: 'proposal',
    index: 5,
    title: 'Proposal',
    description: 'Business proposal + design-app prompt.',
    fsmStates: ['proposal-generated'],
  },
  {
    slug: 'design',
    index: 6,
    title: 'Design',
    description: 'Upload your external design or generate one from the prompt.',
    fsmStates: ['awaiting-external-design', 'design-uploaded'],
  },
  {
    slug: 'atlas',
    index: 7,
    title: 'Atlas',
    description: 'The ticket tree and the design-id mapping.',
    fsmStates: ['ticket-tree-generated', 'atlas-ready'],
  },
] as const;

export const WIZARD_SLUGS: ReadonlyArray<WizardSlug> = WIZARD_STEPS.map(
  (s) => s.slug,
);

export function isWizardSlug(s: string): s is WizardSlug {
  return (WIZARD_SLUGS as ReadonlyArray<string>).includes(s);
}

export function findStepBySlug(slug: string): WizardStep | undefined {
  return WIZARD_STEPS.find((s) => s.slug === slug);
}

/**
 * Returns the step index (1-based) that owns the given FSM state, or
 * `null` if no step owns it. Used by the layout's Progress to highlight
 * "current step".
 */
export function stepIndexForState(state: ProjectState): number | null {
  const step = WIZARD_STEPS.find((s) =>
    (s.fsmStates as ReadonlyArray<string>).includes(state),
  );
  return step ? step.index : null;
}
