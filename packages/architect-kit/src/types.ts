/**
 * @caia/architect-kit — shared types for every specialist architect.
 *
 * Sourced from research/17_architect_framework_spec_2026.md §1.
 *
 * These types are deliberately framework-agnostic. They reference upstream
 * artifacts (Ticket, BusinessPlan, RenderableDesign, TenantContext) as
 * opaque shapes — each architect package only consumes the fields it needs,
 * so we keep the surface narrow and structural (not nominal). Real
 * implementations in @chiefaia/ticket-template, @caia/intake, @caia/atlas,
 * and @caia/tenant-provisioner can extend these shapes; consumers don't
 * have to import those packages just to use architect-kit.
 */

// ─── Upstream artifacts (structural shapes — extend in producer packages) ──

/**
 * The canonical phase-1 ticket. Architects read everything they need from
 * this object plus the upstream context. The full Zod-validated shape lives
 * in `@chiefaia/ticket-template`; this declaration captures the fields the
 * architect framework actually depends on. Cast or import the producer's
 * type at the call site if you need the full shape.
 */
export interface Ticket {
  id: string;
  /** Discriminator used by `appliesPredicate` (Page / Widget / Story / etc.). */
  type: string;
  /** Story / module / epic / initiative / task / subtask. */
  scope?: string;
  parent_id?: string | null;
  /** Composed JSONB output filled by architects (key = section path). */
  architecture?: Record<string, unknown>;
  /** Acceptance criteria — drives the EA Reviewer's correctness lens. */
  acceptance_criteria?: readonly string[];
  /** Business-requirements blob (free-form, from intake). */
  business_requirements?: Record<string, unknown>;
  /** Quality tags — drives `appliesPredicate` (a11y, seo, performance, ...). */
  quality_tags?: readonly string[];
  /** Optional extension surface — architects may read additional fields. */
  [key: string]: unknown;
}

/**
 * The interviewer/intake step-3 output. Architects use this for "why" — the
 * goals, audience, brand-voice, constraints that shape every section.
 */
export interface BusinessPlan {
  ventureName: string;
  oneLiner: string;
  audience: string;
  goals: readonly string[];
  brandVoice?: string;
  constraints?: readonly string[];
  /** Free-form passthrough for additional interviewer outputs. */
  [key: string]: unknown;
}

/**
 * The Atlas step-6 RenderableDesign — version-pinned IR + anchor map for the
 * UX uploaded by the operator. Architects use anchor IDs to refer to design
 * regions (frontend wires its component tree to anchors; a11y annotates
 * landmarks at anchors; seo emits OG/title tags pinned to page anchors).
 */
export interface RenderableDesign {
  versionId: string;
  /** Optional URI of the snapshot blob (PNG/PDF) the IR was extracted from. */
  snapshotUri?: string;
  /** Anchor map (anchorId → IR node ref). */
  anchors: ReadonlyArray<{
    anchorId: string;
    kind: string;
    bbox?: { x: number; y: number; w: number; h: number };
    /** Architect-readable metadata (text content, role, breakpoint, ...). */
    meta?: Record<string, unknown>;
  }>;
  /** Free-form passthrough — atlas may emit more fields. */
  [key: string]: unknown;
}

/**
 * Per-tenant context propagated through the dispatcher to every architect.
 * Drives credential resolution, billing posture, data-residency selection,
 * and BYOK overrides.
 */
export interface TenantContext {
  tenantId: string;
  schemaName: string;
  vaultNamespace: string;
  billingPosture: 'subscription' | 'byok';
  creditBalance: { usdAvailable: number };
  /** Optional BYOK credentials handle — not the secret itself; an opaque ref. */
  byok?: { credentialRef?: string };
  compliance?: { dataResidency: string };
}

// ─── Per-architect runtime inputs ──────────────────────────────────────────

/**
 * Per-architect token / wall-clock / cost budget. The dispatcher derives
 * default budgets from the architect's `architectMeta.runtimeModel` plus
 * the tenant's billing posture, then per-call lowers them based on observed
 * spend trends.
 */
export interface ArchitectBudget {
  maxInputTokens: number;
  maxOutputTokens: number;
  maxWallClockMs: number;
  preferredModel: 'haiku' | 'sonnet' | 'opus';
  hardCostCeilingUsd: number;
}

/**
 * Reviewer feedback returned to a re-run architect. Populated only on
 * iterations 2..N of an EA Reviewer cycle; absent on first run.
 */
export interface ReviewerFeedback {
  reason: string;
  severity: 'P0' | 'P1' | 'P2';
  /** Reviewer-suggested fields/values that should change. Free-form. */
  hints?: Record<string, unknown>;
}

/**
 * The bundle of upstream outputs an architect may read. Populated by the
 * dispatcher: wave-1 architects see an empty bag; wave-2 architects see
 * their wave-1 dependencies; wave-3 sees both.
 */
export interface ArchitectUpstreamContext {
  /** Map architect name → its ArchitectOutput. Read-only. */
  readonly outputs: Readonly<Record<string, ArchitectOutput>>;
}

/**
 * The single input every architect's `run()` consumes.
 */
export interface ArchitectInput {
  ticket: Ticket;
  upstream: ArchitectUpstreamContext;
  businessPlan: BusinessPlan;
  designVersion: RenderableDesign;
  tenantContext: TenantContext;
  budget: ArchitectBudget;
  reviewerFeedback?: ReviewerFeedback;
}

// ─── Per-architect runtime outputs ─────────────────────────────────────────

export interface ArchitectToolCall {
  toolName: string;
  argsHash: string;
  durationMs: number;
  ok: boolean;
}

export interface ArchitectSpend {
  inputTokens: number;
  outputTokens: number;
  usdCost: number;
  wallClockMs: number;
  model: string;
}

/**
 * Per-architect output. The dispatcher composes `architectureFields` from
 * each architect into a single disjoint-key JSONB blob, then writes to
 * `tickets.architecture`.
 */
export interface ArchitectOutput {
  architectName: string;
  /**
   * JSONB fields keyed by the architect's `SectionContract.sections` keys.
   * The set of keys must match the contract's declared set exactly (the
   * dispatcher validates this and triggers a retry on mismatch).
   */
  architectureFields: Record<string, unknown>;
  /** 0..1. Sub-0.6 confidence triggers EA Reviewer scrutiny. */
  confidence: number;
  notes: string;
  /** Sibling ticket IDs this output depends on. */
  dependencies: readonly string[];
  /** ≤5 short risk descriptors surfaced to the reviewer + dashboard. */
  risks: readonly string[];
  toolCalls: readonly ArchitectToolCall[];
  spend: ArchitectSpend;
  status: 'ok' | 'partial' | 'failed';
  failureReason?: string;
}

// ─── Tool definition (placeholder until @caia/claude-spawner exports it) ──

/**
 * An architect-specific tool the dispatcher allows in the spawned subagent.
 * Mirrors the Anthropic tool-use schema. We declare it here (instead of
 * importing from `@caia/claude-spawner`) so architect-kit has zero runtime
 * deps and remains independently PR-able.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  /** Anthropic tool input schema (JSON Schema). Opaque to architect-kit. */
  inputSchema: unknown;
}
