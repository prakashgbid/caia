/**
 * Model routing — pick the right LLM for each task.
 *
 * Rationale per operator (2026-08-27): shallow tasks (label generation,
 * simple doc, small classification) run on cheap+fast models. Complex
 * knowledge work (market research, business plan sections, competitive
 * analysis, financial model, pitch deck copy, MVP breakdown) demands
 * elite reasoning + long-form structured output. Model choice per task
 * is a first-class decision, not an afterthought.
 *
 * Ladders provide graceful fallback if the primary is unavailable or
 * rate-limited. Ordered: elite → strong → cheap.
 */

export type ModelTier = 'elite' | 'strong' | 'balanced' | 'cheap';

export interface ModelLadder {
  primary: string;
  fallbacks: string[];
  maxTokens: number;
  timeoutMs: number;
  tier: ModelTier;
  needsWebSearch: boolean;
  notes: string;
}

/**
 * The task catalogue. Each purpose used in `callOpenRouter({ purpose })`
 * should have a ladder here. Add new purposes as we add new AI call sites.
 */
export const MODEL_LADDER: Record<string, ModelLadder> = {
  // === RESEARCH-GRADE (must ground claims in real sources) ===
  'research.market': {
    primary: 'perplexity/sonar-pro',
    fallbacks: ['perplexity/sonar-reasoning-pro', 'anthropic/claude-sonnet-4.6'],
    maxTokens: 12_000,
    timeoutMs: 120_000,
    tier: 'elite',
    needsWebSearch: true,
    notes: 'TAM/SAM/SOM sizing with cited sources. Reasoning-heavy.',
  },
  'research.competitors': {
    primary: 'perplexity/sonar-pro',
    fallbacks: ['perplexity/sonar-reasoning-pro', 'anthropic/claude-sonnet-4.6'],
    maxTokens: 10_000,
    timeoutMs: 120_000,
    tier: 'elite',
    needsWebSearch: true,
    notes: 'Real competitor discovery — must NOT hallucinate; must cite URLs.',
  },
  'research.icp': {
    primary: 'perplexity/sonar-pro',
    fallbacks: ['perplexity/sonar-reasoning-pro', 'anthropic/claude-sonnet-4.6'],
    maxTokens: 8_000,
    timeoutMs: 90_000,
    tier: 'elite',
    needsWebSearch: true,
    notes: 'ICP grounded in real market segments with citations.',
  },

  // === DEEP LONG-FORM DOCUMENTS ===
  'doc.business-plan.section': {
    primary: 'anthropic/claude-opus-5',
    fallbacks: ['openai/gpt-5.6-luna-pro', 'anthropic/claude-sonnet-4.6'],
    maxTokens: 8_000,
    timeoutMs: 90_000,
    tier: 'elite',
    needsWebSearch: false,
    notes: 'Section-by-section 1500-2500 words each; 12 sections → 20k-30k total.',
  },
  'doc.business-plan.outline': {
    primary: 'openai/gpt-5.6-luna-pro',
    fallbacks: ['anthropic/claude-sonnet-4.6'],
    maxTokens: 3_000,
    timeoutMs: 60_000,
    tier: 'strong',
    needsWebSearch: false,
    notes: 'Outline the sections + key claims to research before section-fill.',
  },
  'doc.pitch-deck': {
    primary: 'anthropic/claude-opus-5',
    fallbacks: ['openai/gpt-5.6-luna-pro'],
    maxTokens: 6_000,
    timeoutMs: 60_000,
    tier: 'elite',
    needsWebSearch: false,
    notes: 'Narrative + speaker notes for real presentation.',
  },
  'doc.financial-model': {
    primary: 'openai/gpt-5.6-luna-pro',
    fallbacks: ['anthropic/claude-opus-5', 'anthropic/claude-sonnet-4.6'],
    maxTokens: 8_000,
    timeoutMs: 90_000,
    tier: 'elite',
    needsWebSearch: false,
    notes: 'Numeric reasoning + structured spreadsheet output.',
  },
  'doc.exec-summary': {
    primary: 'anthropic/claude-sonnet-4.6',
    fallbacks: ['openai/gpt-5.6-luna-pro'],
    maxTokens: 3_000,
    timeoutMs: 45_000,
    tier: 'strong',
    needsWebSearch: false,
    notes: 'Punchy 1-page overview; benefits from strong writing model.',
  },
  'doc.gtm-plan': {
    primary: 'anthropic/claude-sonnet-4.6',
    fallbacks: ['openai/gpt-5.6-luna-pro'],
    maxTokens: 4_000,
    timeoutMs: 45_000,
    tier: 'strong',
    needsWebSearch: false,
    notes: 'GTM specifics grounded in ICP.',
  },
  'doc.short': {
    // Everything short, formulaic, or template-heavy: one-pager, KPI dashboard,
    // README, changelog, cookie banner, ToS boilerplate, OG meta tags.
    primary: 'openai/gpt-4o-mini',
    fallbacks: ['anthropic/claude-haiku-4.5', 'google/gemini-2.5-flash'],
    maxTokens: 3_000,
    timeoutMs: 35_000,
    tier: 'cheap',
    needsWebSearch: false,
    notes: 'Fast + cheap for short/templated docs. No reasoning required.',
  },

  // === IDEA REFINEMENT — smart-question interview ===
  'interview.refiner.next': {
    primary: 'anthropic/claude-opus-5',
    fallbacks: ['anthropic/claude-sonnet-4.6', 'openai/gpt-5.6-luna-pro'],
    maxTokens: 2_000,
    timeoutMs: 45_000,
    tier: 'elite',
    needsWebSearch: false,
    notes: 'Adaptive next-question generation that narrows a broad idea into a finite one. Reasons about what dimensions are still fuzzy and asks the highest-yield question.',
  },
  'interview.refiner.synthesise': {
    primary: 'anthropic/claude-opus-5',
    fallbacks: ['anthropic/claude-sonnet-4.6'],
    maxTokens: 4_000,
    timeoutMs: 60_000,
    tier: 'elite',
    needsWebSearch: false,
    notes: 'Distills the interview into a finite, defensible startup statement + coverage report + open questions.',
  },
  // === MVP BREAKDOWN + CODE GENERATION ===
  'mvp.scaffold.v2': {
    primary: 'anthropic/claude-sonnet-4.6',
    fallbacks: ['openai/gpt-5.6-luna-pro', 'openai/gpt-4o-2024-11-20'],
    maxTokens: 6_000,
    timeoutMs: 60_000,
    tier: 'strong',
    needsWebSearch: false,
    notes: 'Product-thinking + JSON structure. Sonnet-4 balances depth + speed.',
  },
  'mvp.breakdown.enriched': {
    primary: 'anthropic/claude-opus-5',
    fallbacks: ['openai/gpt-5.6-luna-pro'],
    maxTokens: 12_000,
    timeoutMs: 120_000,
    tier: 'elite',
    needsWebSearch: false,
    notes: 'Initiatives → epics → stories with acceptance criteria, effort, deps.',
  },
  'mvp.screen.generate': {
    primary: 'anthropic/claude-sonnet-4.6',
    fallbacks: ['openai/gpt-5.6-luna-pro'],
    maxTokens: 6_000,
    timeoutMs: 90_000,
    tier: 'strong',
    needsWebSearch: false,
    notes: 'React + Tailwind code with real interactivity, not just markup.',
  },
  'mvp.design.recommend': {
    primary: 'anthropic/claude-sonnet-4.6',
    fallbacks: ['openai/gpt-4o-2024-11-20'],
    maxTokens: 2_000,
    timeoutMs: 30_000,
    tier: 'strong',
    needsWebSearch: false,
    notes: 'Design system + style + theme recommendation with justification.',
  },

  // === CONVERSATIONAL + CLASSIFICATION ===
  'interview.turn': {
    primary: 'anthropic/claude-sonnet-4.6',
    fallbacks: ['openai/gpt-4o-2024-11-20'],
    maxTokens: 1_500,
    timeoutMs: 30_000,
    tier: 'strong',
    needsWebSearch: false,
    notes: 'Warm coach tone; needs to remember prior turns cleanly.',
  },
  'interview.summarise': {
    primary: 'anthropic/claude-sonnet-4.6',
    fallbacks: ['openai/gpt-4o-2024-11-20'],
    maxTokens: 2_000,
    timeoutMs: 30_000,
    tier: 'strong',
    needsWebSearch: false,
    notes: 'Distill transcript into structured facts for downstream stages.',
  },
  'landing.generate': {
    primary: 'openai/gpt-4o-mini',
    fallbacks: ['anthropic/claude-haiku-4.5'],
    maxTokens: 4_000,
    timeoutMs: 45_000,
    tier: 'cheap',
    needsWebSearch: false,
    notes: 'One-shot HTML + Tailwind — fast+cheap is fine.',
  },
  'intake.analyze': {
    primary: 'openai/gpt-4o-mini',
    fallbacks: ['anthropic/claude-haiku-4.5'],
    maxTokens: 1_500,
    timeoutMs: 15_000,
    tier: 'cheap',
    needsWebSearch: false,
    notes: 'Template-driven idea intake — JSON classification.',
  },
};

/**
 * Resolve a purpose to its ladder, with safe defaults if unknown.
 * Unknown purposes get the cheap tier so we don't blow budget silently.
 */
export function resolveLadder(purpose: string): ModelLadder {
  return MODEL_LADDER[purpose] ?? {
    primary: 'openai/gpt-4o-mini',
    fallbacks: ['anthropic/claude-haiku-4.5'],
    maxTokens: 2_000,
    timeoutMs: 30_000,
    tier: 'cheap',
    needsWebSearch: false,
    notes: 'unknown purpose — defaulted to cheap tier',
  };
}

/**
 * Estimated per-call cost in USD, for token-cost display in UI.
 * Rough numbers — meant for user-facing "This costs about $0.30" hints, not billing.
 */
export const TIER_COST_HINT: Record<ModelTier, number> = {
  elite:     0.15,
  strong:    0.06,
  balanced:  0.02,
  cheap:     0.002,
};
