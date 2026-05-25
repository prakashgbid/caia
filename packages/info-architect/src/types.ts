/**
 * @caia/info-architect — public type contracts.
 *
 * Sourced from `research/info_architect_agent_spec_2026.md` §3 (the three
 * artifact JSON Schemas). Wave 1 ships TypeScript types only; the
 * standalone Zod-schema package (`@caia/info-architect-types` per spec
 * §14.3) is deferred to Wave 2. Wave-1 type-guards live in `types.ts`
 * and are intentionally loose (every field is asserted shallow); the
 * deep critic-loop validation lives in the agent.
 *
 * Five archetypes referenced throughout:
 *   A — OAuth code-grant
 *   B — API token (PAT-style)
 *   C — DNS-based proof of control
 *   D — Webhook receipt
 *   E — Database / SMTP / SSH endpoint reach
 *
 * (Source: `personal/chiefaia-com-design-prompt.md` §11.3. The IA agent
 * catalogues these in `componentsLibrary` so the onboarding-wizard UI
 * has stable, named primitives to instantiate.)
 */

import type { ProjectState } from '@caia/state-machine';

// ----------------------------------------------------------------------------
// IaInput — what the orchestrator feeds the agent
// ----------------------------------------------------------------------------

export type ProjectType = 'admin' | 'client';

/**
 * Subset of BusinessPlanV2 the IA agent reads. We avoid importing the
 * full BusinessPlanV2 from @caia/interviewer at this layer because (a)
 * it would create a circular workspace dep at compile-time, (b) the IA
 * spec §3 is explicit that the relevant slice is a *projection* of
 * BusinessPlanV2 + tenant onboarding context.
 */
export interface IaBusinessPlanSlice {
  /** Stable revision id of the BusinessPlanV2 used. */
  readonly revisionId: string;
  /** Completeness score, [0..100]. IA agent rejects scores < 80 per spec. */
  readonly completenessScore: number;
  /** Brand voice + design-disposition paragraph from §3.brandVoiceDesign. */
  readonly brandVoiceDesign: string;
  /** Free-form summary of value proposition for the system prompt. */
  readonly valueProposition: string;
  /** Operator's words for the target user. */
  readonly targetUser: string;
  /** Optional roadmap horizon hints. */
  readonly horizonHints?: {
    readonly mvp?: readonly string[];
    readonly oneYear?: readonly string[];
    readonly fiveYear?: readonly string[];
  };
}

export interface IaTenantContext {
  /** Stable tenant identifier (matches caia_meta.tenants.id). */
  readonly tenantId: string;
  /** Tenant slug used for schema name derivation. */
  readonly tenantSlug: string;
  /** Tenant-friendly display name. */
  readonly tenantName: string;
  /** Whether this tenant uses Enterprise tier features. */
  readonly enterpriseTier?: boolean;
}

export interface IaInput {
  /** Project id this IA run is for. */
  readonly projectId: string;
  /** Tenant context. */
  readonly tenantContext: IaTenantContext;
  /** Projection of BusinessPlanV2 the agent reads. */
  readonly businessPlan: IaBusinessPlanSlice;
  /** Project type — drives the locked UI stack (shadcn wrapper vs primitives). */
  readonly projectType: ProjectType;
  /** Optional parent IA revision (for regenerate flows per spec §6.3). */
  readonly parentRevisionId?: string;
}

// ----------------------------------------------------------------------------
// IaOutput — the three canonical artifacts
// ----------------------------------------------------------------------------

export type FrameworkChoice =
  | 'next.js-15'
  | 'next.js-14'
  | 'astro'
  | 'sveltekit'
  | 'remix';

export type NarrativeRole =
  | 'landing'
  | 'conversion'
  | 'content'
  | 'detail'
  | 'listing'
  | 'utility'
  | 'auth'
  | 'legal'
  | 'empty';

export type BuildPath = 'direct' | 'external';

export interface PageRecord {
  readonly slug: string;
  readonly route: string;
  readonly templateRef: string;
  readonly title: string;
  readonly description?: string;
  readonly buildPath?: BuildPath;
  readonly narrativeRole?: NarrativeRole;
}

export interface TemplateRecord {
  readonly id: string;
  readonly name: string;
  readonly narrativeRole?: NarrativeRole;
  readonly sectionStack: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly intent?: string;
    readonly componentRefs?: readonly string[];
  }>;
}

export interface PagesCatalogue {
  readonly catalogueVersion: string;
  readonly revisionId: string;
  readonly parentRevisionId: string | null;
  readonly createdAt: string;
  readonly site: {
    readonly domain: string;
    readonly name: string;
    readonly tagline: string;
    readonly framework: FrameworkChoice;
    readonly projectType: ProjectType;
  };
  readonly templates: readonly TemplateRecord[];
  readonly pages: readonly PageRecord[];
}

export interface ColorScale {
  readonly '50': string;
  readonly '100': string;
  readonly '200': string;
  readonly '300': string;
  readonly '400': string;
  readonly '500': string;
  readonly '600': string;
  readonly '700': string;
  readonly '800': string;
  readonly '900': string;
  readonly '950'?: string;
}

export interface DesignSystem {
  readonly catalogueVersion: string;
  readonly revisionId: string;
  readonly createdAt: string;
  readonly tailwindConfig: {
    /** Tailwind v3 `theme.extend.colors` map; per shadcn convention. */
    readonly colors: Readonly<Record<string, ColorScale | string>>;
    readonly fontFamily: Readonly<Record<string, readonly string[]>>;
    readonly fontSize: Readonly<Record<string, readonly [string, string]>>;
    readonly spacing: Readonly<Record<string, string>>;
    readonly borderRadius: Readonly<Record<string, string>>;
    readonly boxShadow: Readonly<Record<string, string>>;
  };
  readonly cssVariables: {
    readonly light: Readonly<Record<string, string>>;
    readonly dark: Readonly<Record<string, string>>;
  };
  readonly motionTokens: Readonly<Record<string, string>>;
  /** Optional cross-site reuse name (per IA spec §10). */
  readonly templateName?: string;
}

/**
 * The shadcn primitive identifier — limited to the most common ones at
 * the type layer; the long tail falls through `string`. This is a wave-1
 * compromise; Wave 2 will expand the literal union with the full
 * `shadcn/ui` registry.
 */
export type ShadcnComponentName =
  | 'Button'
  | 'Card'
  | 'Dialog'
  | 'Sheet'
  | 'Tabs'
  | 'Tooltip'
  | 'Accordion'
  | 'Alert'
  | 'Avatar'
  | 'Badge'
  | 'Calendar'
  | 'Checkbox'
  | 'Combobox'
  | 'Command'
  | 'Dropdown'
  | 'Form'
  | 'HoverCard'
  | 'Input'
  | 'Label'
  | 'NavigationMenu'
  | 'Popover'
  | 'Progress'
  | 'RadioGroup'
  | 'ScrollArea'
  | 'Select'
  | 'Separator'
  | 'Skeleton'
  | 'Slider'
  | 'Switch'
  | 'Table'
  | 'Textarea'
  | 'Toast'
  | 'Toggle'
  | 'Carousel'
  | string;

export type AtomicTier = 'atom' | 'molecule' | 'organism' | 'template' | 'page';

/**
 * The 5 credential-UI archetypes (A-E) the IA agent catalogues as canonical
 * organism-tier primitives. Maps directly to the §11.3 archetypes in the
 * `chiefaia-com-design-prompt.md` spec.
 */
export type CredentialArchetype =
  | 'oauth-code-grant'
  | 'api-token'
  | 'dns-proof-of-control'
  | 'webhook-receipt'
  | 'db-smtp-ssh-endpoint-reach';

export interface ComponentRecord {
  /** Stable globally-unique id; format `cmp-<atomic-tier>-<slug>`. */
  readonly id: string;
  readonly atomicTier: AtomicTier;
  readonly displayName: string;
  /** Reference to a shadcn primitive, or null for composed organisms. */
  readonly shadcnComponent: ShadcnComponentName | null;
  /** Tailwind class string the codegen emits as the wrapper. */
  readonly tailwindClasses: string;
  /** Variants the operator can pick from. */
  readonly variants: readonly string[];
  /** Slots the component exposes for children. */
  readonly slots: readonly string[];
  /** Enumerated states (resting / hover / loading / error / etc.). */
  readonly states: readonly string[];
  /** Other components this one composes. */
  readonly composedOf: readonly string[];
  /** Back-references to pages this component is used in. */
  readonly usedInPages: readonly string[];
  /** Set when this component is one of the 5 credential archetypes. */
  readonly credentialArchetype?: CredentialArchetype;
}

export interface ComponentsLibrary {
  readonly catalogueVersion: string;
  readonly revisionId: string;
  readonly createdAt: string;
  readonly components: readonly ComponentRecord[];
}

export interface IaOutput {
  readonly pagesCatalogue: PagesCatalogue;
  readonly designSystem: DesignSystem;
  readonly componentsLibrary: ComponentsLibrary;
}

// ----------------------------------------------------------------------------
// Agent / persistence / state-machine adapter interfaces
// ----------------------------------------------------------------------------

export interface IaAgent {
  /**
   * Produce the three IA artifacts from the input. Implementations MUST
   * be subscription-only — pay-per-token API-key billing is forbidden.
   * Throws `InfoArchitectError('subscription_only_violation')` if an
   * API-key env var is present.
   */
  design(input: IaInput): Promise<IaOutput>;
}

export interface IaPersistence {
  /** Tenant schema name (e.g. `caia_pt`). */
  readonly tenantSchema: string;
  /** Apply the per-tenant template migration. Idempotent. */
  ensureSchema(): Promise<void>;
  /** Read the IA input bundle for a project. */
  readInput(projectId: string): Promise<IaInput | null>;
  /** Write all three artifacts atomically. Returns the persisted revision id. */
  writeArtifacts(
    projectId: string,
    output: IaOutput,
  ): Promise<{ revisionId: string; writtenAt: string }>;
  /** Read the latest persisted artifact set for a project. */
  readLatestArtifacts(projectId: string): Promise<IaOutput | null>;
}

export interface FsmTransition {
  readonly from: ProjectState;
  readonly to: ProjectState;
}

export interface IaStateMachineAdapter {
  /** Read the project's current FSM state. */
  currentState(projectId: string): Promise<ProjectState>;
  /** Transition the project to a new state with a reason + payload. */
  transition(
    projectId: string,
    to: ProjectState,
    payload: {
      reason: string;
      triggeredById: string;
      payload?: Readonly<Record<string, unknown>>;
    },
  ): Promise<FsmTransition>;
}

// ----------------------------------------------------------------------------
// Validation helpers (loose; deep schema validation deferred to Wave 2)
// ----------------------------------------------------------------------------

/** Returns true if `value` plausibly shapes as IaInput. */
export function isIaInput(value: unknown): value is IaInput {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<IaInput>;
  if (typeof v.projectId !== 'string' || v.projectId.length === 0) return false;
  if (typeof v.projectType !== 'string') return false;
  if (v.projectType !== 'admin' && v.projectType !== 'client') return false;
  if (typeof v.tenantContext !== 'object' || v.tenantContext === null) return false;
  if (typeof v.businessPlan !== 'object' || v.businessPlan === null) return false;
  return true;
}

/** Returns true if `value` plausibly shapes as IaOutput. */
export function isIaOutput(value: unknown): value is IaOutput {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<IaOutput>;
  return (
    typeof v.pagesCatalogue === 'object' &&
    v.pagesCatalogue !== null &&
    typeof v.designSystem === 'object' &&
    v.designSystem !== null &&
    typeof v.componentsLibrary === 'object' &&
    v.componentsLibrary !== null
  );
}

/** Lower bound on critic score per IA spec §6.2 + §9.13. */
export const IA_CRITIC_SCORE_FLOOR = 85;

/** Lower bound on BusinessPlanV2 completeness for IA to run, per spec §6.2. */
export const IA_INPUT_COMPLETENESS_FLOOR = 80;
