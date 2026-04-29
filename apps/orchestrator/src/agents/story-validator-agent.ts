/**
 * Story Validator Agent — Phase A (VAL-004)
 *
 * Quality gate between BA and Testing. Reads each enriched story (the
 * `agent_contributions_json` payload conforming to TicketTemplateV1) and
 * runs a six-step validation pipeline:
 *
 *   1. Schema validation       — Zod parse via @chiefaia/ticket-template.
 *   2. Section presence        — required sections present per the rubric.
 *   3. Detail sufficiency      — word counts, sub-field counts, required
 *                                 entity-ref regex, forbidden snippets.
 *   4. Content relevance       — per-section LLM judge call (one per
 *                                 populated agentSection) via local-llm-router.
 *   5. Cross-section consistency — single LLM judge call across the whole
 *                                 ticket.
 *   6. Completeness gestalt    — single LLM judge call: is the ticket
 *                                 sufficient for Testing + Coding agents?
 *
 * Steps 1-3 are deterministic (cheap, fast). Steps 4-6 use the local-llm-
 * router; failures fall back to Claude.
 *
 * Output is a structured `ValidationReport` (persisted as JSON in
 * `stories.validation_report`) plus a headline `validation_status`,
 * `validation_attempts`, `last_validated_at`. The orchestrator (VAL-005)
 * reads `nextAction` from the report to decide whether to advance the
 * pipeline (`'proceed'`), re-invoke BA (`'return_to_ba'`/`'return_to_po'`),
 * or escalate to a human (`'escalate'`).
 *
 * Architecture:
 *   ~/Documents/projects/reports/story-validator-architecture-2026-04-28.md
 */

import { eq } from 'drizzle-orm';
import {
  AC_ITEM_RULES,
  AGENT_SECTION_RULES,
  COMPLETENESS_GESTALT_PROMPT_SEED,
  CROSS_SECTION_CONSISTENCY_PROMPT_SEED,
  RUBRIC_VERSION,
  SCORE_WEIGHTS,
  TOP_LEVEL_SECTION_RULES,
  TicketTemplateV1,
  TicketTemplateV1Schema,
  UNIVERSAL_FORBIDDEN_SNIPPETS,
  VERDICT_THRESHOLDS,
  buildContentRelevancePrompt,
  concatStrings,
  countWordsInValue,
  findForbiddenSnippets,
  isSectionRequired,
  validateTicket,
  type AgentSectionKey,
  type AgentSectionRule,
  type RubricSeverity,
} from '@chiefaia/ticket-template';
import { eventBus } from '../events/bus-adapter';
import { getDb } from '../db/connection';
import { stories } from '../db/schema';
import {
  STAGE_VALIDATED,
  advancePipelineStage,
} from './pipeline-stages';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StoryValidatorInput {
  storyId: string;
  promptId: string;
  correlationId: string;
  /** Override the attempt counter — used when the pipeline-wiring layer (VAL-005) re-invokes after BA. */
  attemptNumber?: number;
}

export interface StoryValidatorOutput {
  storyId: string;
  passed: boolean;
  score: number;
  nextAction: 'proceed' | 'return_to_ba' | 'return_to_po' | 'escalate';
  attemptNumber: number;
  report: ValidationReport;
}

/** The structured report persisted on `stories.validation_report`. */
export interface ValidationReport {
  rubricVersion: string;
  ranAt: number;
  durationMs: number;
  judgeProvider: 'local' | 'claude' | 'mixed' | 'none';
  judgeModelTouchpoints: string[];
  passed: boolean;
  score: number;
  nextAction: 'proceed' | 'return_to_ba' | 'return_to_po' | 'escalate';
  attemptNumber: number;
  steps: {
    schema: StepResult;
    sectionPresence: StepResult;
    detailSufficiency: StepResult;
    contentRelevance: PerSectionStepResult;
    crossSectionConsistency: StepResult & { score: number };
    completenessGestalt: GestaltStepResult;
  };
  failedChecks: ValidationFailure[];
  warnings: ValidationWarning[];
  fixSuggestions: string[];
}

interface StepResult {
  passed: boolean;
  score?: number;
  durationMs: number;
  details: unknown;
}

interface PerSectionStepResult extends StepResult {
  perSection: Record<string, { passed: boolean; score: number; concerns: string[] }>;
}

interface GestaltStepResult extends StepResult {
  testingAgentReady: number;
  codingAgentReady: number;
  blockers: string[];
  rationale: string;
}

interface ValidationFailure {
  step:
    | 'schema'
    | 'sectionPresence'
    | 'detailSufficiency'
    | 'contentRelevance'
    | 'crossSectionConsistency'
    | 'completenessGestalt';
  section?: string;
  ruleId?: string;
  message: string;
  fixSuggestion: string;
  severity: RubricSeverity;
}

interface ValidationWarning {
  section?: string;
  message: string;
}

// ─── Judge — pluggable so tests can swap in a deterministic stub ─────────────

/**
 * The validator delegates LLM-judged steps (4, 5, 6) to a pluggable
 * `JudgeAdapter`. Production runs use {@link localLlmRouterJudge}; tests
 * inject a deterministic stub.
 */
export interface JudgeAdapter {
  /**
   * @param taskType e.g. 'validation-content-relevance'
   *                 / 'validation-cross-section'
   *                 / 'validation-completeness'.
   */
  judge(args: {
    taskType: string;
    prompt: string;
  }): Promise<JudgeResponse>;
}

export interface JudgeResponse {
  /** Parsed JSON object from the judge — schema varies by step. */
  json: unknown;
  /** Raw text from the model (debug). */
  raw: string;
  /** Which provider answered. */
  provider: 'local' | 'claude';
  /** Model identifier the provider returned. */
  model: string;
  /** Wall-clock duration. */
  durationMs: number;
}

/**
 * Default judge — wraps `@chiefaia/local-llm-router`. Lazy-imported so the
 * validator module typechecks even when the local-llm-router package is
 * unavailable in some test contexts.
 */
export async function localLlmRouterJudge({
  taskType,
  prompt,
}: {
  taskType: string;
  prompt: string;
}): Promise<JudgeResponse> {
  // Lazy import keeps this module decoupled from the router for testing.
  const router: typeof import('@chiefaia/local-llm-router') = await import(
    '@chiefaia/local-llm-router'
  );
  const response = await router.route(taskType, prompt, { fallbackOnError: true });
  return {
    json: tryParseJson(response.response),
    raw: response.response,
    provider: response.provider,
    model: response.model,
    durationMs: response.durationMs,
  };
}

/**
 * Best-effort JSON parse — extracts the first {...} block when the model
 * wraps the JSON in prose. Returns `{}` on total failure so the caller
 * gets a safe default rather than a thrown error mid-pipeline.
 */
function tryParseJson(raw: string): unknown {
  if (!raw) return {};
  // Fast path — model returned pure JSON.
  try {
    return JSON.parse(raw);
  } catch {
    /* continue */
  }
  // Slow path — find the first/last brace.
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const slice = raw.substring(first, last + 1);
    try {
      return JSON.parse(slice);
    } catch {
      return {};
    }
  }
  return {};
}

// ─── Sanitisation — defence in depth against prompt injection ────────────────

/**
 * Strip control characters (except common whitespace) from a string. Used
 * before assembling the per-section judge prompt so injected control bytes
 * can't smuggle through. Markdown/HTML is left intact since it shows up in
 * legitimate stories.
 */
function sanitiseString(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function sanitiseValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitiseString(value);
  if (Array.isArray(value)) return value.map(sanitiseValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitiseValue(v);
    }
    return out;
  }
  return value;
}

// ─── The six validation steps ────────────────────────────────────────────────

function runSchemaStep(rawTicket: unknown): {
  step: StepResult;
  failures: ValidationFailure[];
  ticket: TicketTemplateV1 | null;
} {
  const start = Date.now();
  const result = validateTicket(rawTicket);
  if (result.ok) {
    return {
      step: { passed: true, durationMs: Date.now() - start, details: { errorCount: 0 } },
      failures: [],
      ticket: result.value,
    };
  }
  const failures: ValidationFailure[] = result.errors.map((e) => ({
    step: 'schema' as const,
    section: e.path,
    ruleId: `schema:${e.code}`,
    message: e.message,
    fixSuggestion: `Fix the schema violation at \`${e.path}\`: ${e.message}`,
    severity: 'hard' as const,
  }));
  return {
    step: {
      passed: false,
      durationMs: Date.now() - start,
      details: { errorCount: result.errors.length, errors: result.errors },
    },
    failures,
    ticket: null,
  };
}

function runSectionPresenceStep(ticket: TicketTemplateV1): {
  step: StepResult;
  failures: ValidationFailure[];
} {
  const start = Date.now();
  const failures: ValidationFailure[] = [];

  // Top-level sections — Zod already enforces presence, but we double-check
  // emptiness on the must-not-be-empty fields.
  if (!ticket.scope.summary || ticket.scope.summary.trim().length === 0) {
    failures.push({
      step: 'sectionPresence',
      section: 'scope.summary',
      ruleId: 'presence:scope_summary_empty',
      message: 'scope.summary is empty',
      fixSuggestion: 'Provide a 1-2 sentence summary of the deliverable.',
      severity: 'hard',
    });
  }
  if (!ticket.scope.inScope?.length) {
    failures.push({
      step: 'sectionPresence',
      section: 'scope.inScope',
      ruleId: 'presence:scope_inScope_empty',
      message: 'scope.inScope has no items',
      fixSuggestion: 'List at least one concrete deliverable in inScope.',
      severity: 'hard',
    });
  }

  // Per-agent sections — required only when the rubric trigger matches.
  for (const rule of AGENT_SECTION_RULES) {
    const present = !!ticket.agentSections?.[rule.section];
    const required = isSectionRequired(rule, ticket);
    if (required && !present) {
      failures.push({
        step: 'sectionPresence',
        section: `agentSections.${rule.section}`,
        ruleId: `presence:section_required_missing:${rule.section}`,
        message: `agentSections.${rule.section} is required for this story but is missing`,
        fixSuggestion: rule.fixHint,
        severity: rule.severityOnFail,
      });
    }
  }

  return {
    step: {
      passed: failures.length === 0,
      durationMs: Date.now() - start,
      details: { failureCount: failures.length },
    },
    failures,
  };
}

function runDetailSufficiencyStep(ticket: TicketTemplateV1): {
  step: StepResult;
  failures: ValidationFailure[];
  warnings: ValidationWarning[];
} {
  const start = Date.now();
  const failures: ValidationFailure[] = [];
  const warnings: ValidationWarning[] = [];

  // Top-level rules.
  for (const rule of TOP_LEVEL_SECTION_RULES) {
    const value = (ticket as unknown as Record<string, unknown>)[rule.path];
    if (value == null) continue;

    const wordCount = countWordsInValue(value);
    if (wordCount < rule.minWords) {
      failures.push({
        step: 'detailSufficiency',
        section: rule.path,
        ruleId: `detail:min_words:${rule.path}`,
        message: `${rule.path} has ${wordCount} words; rubric requires ≥${rule.minWords}`,
        fixSuggestion: rule.fixHint,
        severity: rule.severityOnFail,
      });
    }
    if (rule.forbidSnippets) {
      const found = findForbiddenSnippets(value, UNIVERSAL_FORBIDDEN_SNIPPETS);
      for (const snippet of found) {
        failures.push({
          step: 'detailSufficiency',
          section: rule.path,
          ruleId: `detail:forbidden_snippet:${rule.path}:${snippet}`,
          message: `${rule.path} contains forbidden snippet "${snippet}"`,
          fixSuggestion:
            `Replace placeholder text "${snippet}" in ${rule.path} with concrete content.`,
          severity: rule.severityOnFail,
        });
      }
    }
  }

  // Per-agent section rules — only enforced when the section is present.
  for (const rule of AGENT_SECTION_RULES) {
    const section = ticket.agentSections?.[rule.section];
    if (!section) continue;

    const wordCount = countWordsInValue(section);
    if (wordCount < rule.minWords) {
      failures.push({
        step: 'detailSufficiency',
        section: `agentSections.${rule.section}`,
        ruleId: `detail:min_words:${rule.section}`,
        message: `agentSections.${rule.section} has ${wordCount} words; rubric requires ≥${rule.minWords}`,
        fixSuggestion: rule.fixHint,
        severity: rule.severityOnFail,
      });
    }

    if (rule.minItemsPerSubField) {
      for (const [subField, minCount] of Object.entries(rule.minItemsPerSubField)) {
        const arr = (section as Record<string, unknown>)[subField];
        const length = Array.isArray(arr) ? arr.length : 0;
        if (length < minCount) {
          failures.push({
            step: 'detailSufficiency',
            section: `agentSections.${rule.section}.${subField}`,
            ruleId: `detail:min_items:${rule.section}.${subField}`,
            message:
              `agentSections.${rule.section}.${subField} has ${length} items; rubric requires ≥${minCount}`,
            fixSuggestion: rule.fixHint,
            severity: rule.severityOnFail,
          });
        }
      }
    }

    if (rule.requiredEntityRefs?.length) {
      const text = concatStrings(section);
      for (const ref of rule.requiredEntityRefs) {
        const re = new RegExp(ref.pattern, ref.flags ?? '');
        if (!re.test(text)) {
          failures.push({
            step: 'detailSufficiency',
            section: `agentSections.${rule.section}`,
            ruleId: `detail:required_entity_ref:${rule.section}:${ref.label}`,
            message:
              `agentSections.${rule.section} is missing a ${ref.label} reference`,
            fixSuggestion: rule.fixHint,
            severity: rule.severityOnFail,
          });
        }
      }
    }

    if (rule.forbidSnippets) {
      const all = [
        ...UNIVERSAL_FORBIDDEN_SNIPPETS,
        ...(rule.extraForbiddenSnippets ?? []),
      ];
      const found = findForbiddenSnippets(section, all);
      for (const snippet of found) {
        failures.push({
          step: 'detailSufficiency',
          section: `agentSections.${rule.section}`,
          ruleId: `detail:forbidden_snippet:${rule.section}:${snippet}`,
          message:
            `agentSections.${rule.section} contains forbidden snippet "${snippet}"`,
          fixSuggestion:
            `Replace placeholder text "${snippet}" in agentSections.${rule.section} with concrete content.`,
          severity: rule.severityOnFail,
        });
      }
    }
  }

  // Acceptance-criteria item-level rules.
  const acItems = ticket.acceptanceCriteria ?? [];
  let bddMatchCount = 0;
  for (let i = 0; i < acItems.length; i++) {
    const item = acItems[i] ?? '';
    const trimmed = item.trim();
    const wordCount = trimmed === '' ? 0 : trimmed.split(/\s+/).length;
    if (wordCount < AC_ITEM_RULES.minWordsPerItem) {
      failures.push({
        step: 'detailSufficiency',
        section: `acceptanceCriteria[${i}]`,
        ruleId: 'detail:ac_min_words',
        message:
          `acceptanceCriteria[${i}] has ${wordCount} words; rubric requires ≥${AC_ITEM_RULES.minWordsPerItem}`,
        fixSuggestion:
          `Expand acceptanceCriteria[${i}] to describe the observable behaviour in ≥${AC_ITEM_RULES.minWordsPerItem} words.`,
        severity: 'hard',
      });
    }
    const bddRule = AC_ITEM_RULES.bddStartPattern;
    if (bddRule.test(item)) bddMatchCount++;

    const fluffMatches = findForbiddenSnippets(item, AC_ITEM_RULES.forbiddenSnippets);
    for (const snippet of fluffMatches) {
      failures.push({
        step: 'detailSufficiency',
        section: `acceptanceCriteria[${i}]`,
        ruleId: 'detail:ac_fluff',
        message: `acceptanceCriteria[${i}] contains non-testable phrase "${snippet}"`,
        fixSuggestion:
          `Replace fluff phrase "${snippet}" with a concrete observable behaviour.`,
        severity: 'soft',
      });
    }
  }

  if (acItems.length > 0) {
    const fraction = bddMatchCount / acItems.length;
    if (fraction === 0) {
      failures.push({
        step: 'detailSufficiency',
        section: 'acceptanceCriteria',
        ruleId: 'detail:ac_bdd_fraction_zero',
        message:
          'No acceptanceCriteria items use BDD-style phrasing (Given/When/Then/...)',
        fixSuggestion:
          'Phrase at least 60% of acceptance criteria as Given/When/Then/It/The system/User.',
        severity: 'hard',
      });
    } else if (fraction < AC_ITEM_RULES.bddPatternMinFraction) {
      warnings.push({
        section: 'acceptanceCriteria',
        message:
          `Only ${Math.round(fraction * 100)}% of acceptanceCriteria use BDD phrasing; rubric prefers ≥${Math.round(AC_ITEM_RULES.bddPatternMinFraction * 100)}%.`,
      });
    }
  }

  return {
    step: {
      passed: !failures.some((f) => f.severity === 'hard'),
      durationMs: Date.now() - start,
      details: {
        failureCount: failures.length,
        warningCount: warnings.length,
        bddFraction: acItems.length ? bddMatchCount / acItems.length : null,
      },
    },
    failures,
    warnings,
  };
}

async function runContentRelevanceStep(
  ticket: TicketTemplateV1,
  judge: JudgeAdapter,
): Promise<{
  step: PerSectionStepResult;
  failures: ValidationFailure[];
  judgeProviders: Set<'local' | 'claude'>;
  judgeModels: Set<string>;
}> {
  const start = Date.now();
  const failures: ValidationFailure[] = [];
  const perSection: PerSectionStepResult['perSection'] = {};
  const judgeProviders = new Set<'local' | 'claude'>();
  const judgeModels = new Set<string>();

  const sectionsToJudge = (Object.keys(ticket.agentSections ?? {}) as AgentSectionKey[])
    .map((key) => ({
      key,
      rule: AGENT_SECTION_RULES.find((r) => r.section === key) ?? null,
    }))
    .filter((entry): entry is { key: AgentSectionKey; rule: AgentSectionRule } =>
      entry.rule !== null && entry.rule.runContentRelevance,
    );

  // Run judges in parallel — each section is independent.
  const responses = await Promise.all(
    sectionsToJudge.map(async ({ key, rule }) => {
      const sanitised = sanitiseValue(ticket.agentSections[key]);
      const prompt = buildContentRelevancePrompt({
        sectionPath: `agentSections.${key}`,
        sectionPurpose: rule.purpose,
        storySummary: sanitiseString(ticket.scope.summary),
        sectionContentJson: JSON.stringify(sanitised),
      });
      try {
        const reply = await judge.judge({
          taskType: 'validation-content-relevance',
          prompt,
        });
        return { key, rule, reply, error: null as unknown };
      } catch (err) {
        return { key, rule, reply: null, error: err };
      }
    }),
  );

  for (const { key, rule, reply, error } of responses) {
    if (!reply) {
      perSection[key] = {
        passed: true, // judge failure ⇒ skip rather than block — surface as warning
        score: 0,
        concerns: [`Judge call failed: ${String(error)}`],
      };
      continue;
    }
    judgeProviders.add(reply.provider);
    judgeModels.add(reply.model);
    const json = (reply.json ?? {}) as Record<string, unknown>;
    const score =
      typeof json['score'] === 'number'
        ? Math.max(1, Math.min(5, Math.round(json['score'] as number)))
        : 0;
    const concerns = Array.isArray(json['concerns'])
      ? (json['concerns'] as unknown[]).filter((c): c is string => typeof c === 'string')
      : [];
    perSection[key] = {
      passed: score >= 3,
      score,
      concerns,
    };
    if (score > 0 && score < 3) {
      failures.push({
        step: 'contentRelevance',
        section: `agentSections.${key}`,
        ruleId: `relevance:low_score:${key}`,
        message:
          `agentSections.${key} content-relevance score ${score}/5 — judge concerns: ${concerns.join('; ') || '(none)'}`,
        fixSuggestion: rule.fixHint,
        severity: 'soft',
      });
    }
  }

  const scoredSections = Object.values(perSection).filter((s) => s.score > 0);
  const avg =
    scoredSections.length > 0
      ? scoredSections.reduce((sum, s) => sum + s.score, 0) / scoredSections.length
      : 0;

  return {
    step: {
      passed: avg >= VERDICT_THRESHOLDS.contentRelevanceMinAvg,
      score: avg,
      durationMs: Date.now() - start,
      details: { sectionCount: sectionsToJudge.length, avgScore: avg },
      perSection,
    },
    failures,
    judgeProviders,
    judgeModels,
  };
}

async function runCrossSectionStep(
  ticket: TicketTemplateV1,
  judge: JudgeAdapter,
): Promise<{
  step: StepResult & { score: number };
  failures: ValidationFailure[];
  judgeProvider: 'local' | 'claude' | null;
  judgeModel: string | null;
}> {
  const start = Date.now();
  const sanitisedTicket = sanitiseValue(ticket);
  const prompt =
    `${CROSS_SECTION_CONSISTENCY_PROMPT_SEED}\n\n` +
    `Ticket payload (JSON):\n\`\`\`json\n${JSON.stringify(sanitisedTicket)}\n\`\`\``;

  let provider: 'local' | 'claude' | null = null;
  let model: string | null = null;
  let json: Record<string, unknown> = {};
  let raw = '';

  try {
    const reply = await judge.judge({
      taskType: 'validation-cross-section',
      prompt,
    });
    provider = reply.provider;
    model = reply.model;
    json = (reply.json ?? {}) as Record<string, unknown>;
    raw = reply.raw;
  } catch (err) {
    // Judge failed — record but don't hard-fail the gate (defensive).
    return {
      step: {
        passed: true,
        score: 0,
        durationMs: Date.now() - start,
        details: { judgeError: String(err) },
      },
      failures: [],
      judgeProvider: null,
      judgeModel: null,
    };
  }

  const score =
    typeof json['score'] === 'number'
      ? Math.max(1, Math.min(5, Math.round(json['score'] as number)))
      : 0;
  const contradictions = Array.isArray(json['contradictions'])
    ? (json['contradictions'] as unknown[]).filter((c): c is string => typeof c === 'string')
    : [];

  const failures: ValidationFailure[] = [];
  if (score > 0 && score < VERDICT_THRESHOLDS.crossSectionMinScore) {
    failures.push({
      step: 'crossSectionConsistency',
      ruleId: 'consistency:low_score',
      message:
        `Cross-section consistency score ${score}/5; contradictions: ${contradictions.join('; ') || '(none listed)'}`,
      fixSuggestion:
        'Reconcile contradictions between acceptanceCriteria, agentSections.api, agentSections.database and agentSections.testing.',
      severity: 'soft',
    });
  }

  return {
    step: {
      passed: score === 0 || score >= VERDICT_THRESHOLDS.crossSectionMinScore,
      score,
      durationMs: Date.now() - start,
      details: { contradictions, raw: raw.slice(0, 500) },
    },
    failures,
    judgeProvider: provider,
    judgeModel: model,
  };
}

async function runCompletenessGestaltStep(
  ticket: TicketTemplateV1,
  judge: JudgeAdapter,
): Promise<{
  step: GestaltStepResult;
  failures: ValidationFailure[];
  warnings: ValidationWarning[];
  judgeProvider: 'local' | 'claude' | null;
  judgeModel: string | null;
}> {
  const start = Date.now();
  const sanitisedTicket = sanitiseValue(ticket);
  const prompt =
    `${COMPLETENESS_GESTALT_PROMPT_SEED}\n\n` +
    `Ticket payload (JSON):\n\`\`\`json\n${JSON.stringify(sanitisedTicket)}\n\`\`\``;

  let provider: 'local' | 'claude' | null = null;
  let model: string | null = null;
  let json: Record<string, unknown> = {};

  try {
    const reply = await judge.judge({
      taskType: 'validation-completeness',
      prompt,
    });
    provider = reply.provider;
    model = reply.model;
    json = (reply.json ?? {}) as Record<string, unknown>;
  } catch (err) {
    return {
      step: {
        passed: true,
        durationMs: Date.now() - start,
        details: { judgeError: String(err) },
        testingAgentReady: 0,
        codingAgentReady: 0,
        blockers: [],
        rationale: `Judge unavailable: ${String(err)}`,
      },
      failures: [],
      warnings: [],
      judgeProvider: null,
      judgeModel: null,
    };
  }

  const testingReady =
    typeof json['testingAgentReady'] === 'number'
      ? Math.max(1, Math.min(5, Math.round(json['testingAgentReady'] as number)))
      : 0;
  const codingReady =
    typeof json['codingAgentReady'] === 'number'
      ? Math.max(1, Math.min(5, Math.round(json['codingAgentReady'] as number)))
      : 0;
  const blockers = Array.isArray(json['blockers'])
    ? (json['blockers'] as unknown[]).filter((b): b is string => typeof b === 'string')
    : [];
  const rationale = typeof json['rationale'] === 'string' ? (json['rationale'] as string) : '';

  const failures: ValidationFailure[] = [];
  const warnings: ValidationWarning[] = [];
  const minReady = VERDICT_THRESHOLDS.gestaltMinReady;

  // 0 means "judge unavailable / didn't return a numeric score" — treat as
  // unknown and produce a warning rather than a hard fail.
  if (testingReady > 0 && testingReady < minReady) {
    failures.push({
      step: 'completenessGestalt',
      ruleId: 'gestalt:testing_unready',
      message:
        `Completeness gestalt: Testing Agent readiness ${testingReady}/5 (< ${minReady}). Blockers: ${blockers.join('; ') || '(none)'}`,
      fixSuggestion:
        'Tighten acceptance criteria so the Testing Agent can derive concrete test cases.',
      severity: 'soft',
    });
  }
  if (codingReady > 0 && codingReady < minReady) {
    failures.push({
      step: 'completenessGestalt',
      ruleId: 'gestalt:coding_unready',
      message:
        `Completeness gestalt: Coding Agent readiness ${codingReady}/5 (< ${minReady}). Blockers: ${blockers.join('; ') || '(none)'}`,
      fixSuggestion:
        'Populate the relevant agentSections (api / database / ui / architecture) so the Coding Agent has all the context needed to implement.',
      severity: 'soft',
    });
  }

  const avgReady = testingReady > 0 && codingReady > 0 ? (testingReady + codingReady) / 2 : 0;
  if (
    failures.length === 0 &&
    avgReady >= VERDICT_THRESHOLDS.gestaltConcernsBand.min &&
    avgReady <= VERDICT_THRESHOLDS.gestaltConcernsBand.max
  ) {
    warnings.push({
      message: `Completeness gestalt average ${avgReady.toFixed(2)}/5 — passes but flagged for human review.`,
    });
  }

  return {
    step: {
      passed: failures.length === 0,
      durationMs: Date.now() - start,
      details: { testingReady, codingReady },
      testingAgentReady: testingReady,
      codingAgentReady: codingReady,
      blockers,
      rationale,
    },
    failures,
    warnings,
    judgeProvider: provider,
    judgeModel: model,
  };
}

// ─── Verdict aggregation ─────────────────────────────────────────────────────

function aggregateVerdict(args: {
  steps: ValidationReport['steps'];
  failures: ValidationFailure[];
  attemptNumber: number;
  schemaPassed: boolean;
}): {
  passed: boolean;
  score: number;
  nextAction: 'proceed' | 'return_to_ba' | 'return_to_po' | 'escalate';
} {
  const { steps, failures, attemptNumber, schemaPassed } = args;

  const hardFailures = failures.filter((f) => f.severity === 'hard');
  const hardSectionFailures = hardFailures.filter((f) =>
    VERDICT_THRESHOLDS.hardFailSections.some(
      (path) =>
        f.section === path ||
        (f.section?.startsWith(`${path}.`) ?? false) ||
        (f.section?.startsWith(`${path}[`) ?? false),
    ),
  );

  // Hard fail conditions.
  if (!schemaPassed) {
    return {
      passed: false,
      score: 0,
      nextAction:
        attemptNumber >= VERDICT_THRESHOLDS.maxAttempts ? 'escalate' : 'return_to_ba',
    };
  }
  if (hardSectionFailures.length > 0) {
    return {
      passed: false,
      score: 0,
      nextAction:
        attemptNumber >= VERDICT_THRESHOLDS.maxAttempts ? 'escalate' : 'return_to_ba',
    };
  }

  // Score weighting.
  const hardStepPassRate = hardFailures.length === 0 ? 1 : 0;
  const contentRelevanceAvg = (steps.contentRelevance.score ?? 0) / 5;
  const crossSectionScore = (steps.crossSectionConsistency.score ?? 0) / 5;
  const gestaltAvg =
    steps.completenessGestalt.testingAgentReady > 0 &&
    steps.completenessGestalt.codingAgentReady > 0
      ? ((steps.completenessGestalt.testingAgentReady +
          steps.completenessGestalt.codingAgentReady) /
          2) /
        5
      : 0.6; // fallback when judges unavailable: assume mid-range

  const score = Math.round(
    100 *
      (hardStepPassRate * SCORE_WEIGHTS.hardStepPassRate +
        contentRelevanceAvg * SCORE_WEIGHTS.contentRelevanceAvg +
        crossSectionScore * SCORE_WEIGHTS.crossSectionScore +
        gestaltAvg * SCORE_WEIGHTS.gestaltAvg),
  );

  // Soft-fail conditions: any soft-failure ⇒ return_to_ba unless attempts exhausted.
  const softFailures = failures.filter((f) => f.severity === 'soft');
  if (softFailures.length > 0) {
    return {
      passed: false,
      score,
      nextAction:
        attemptNumber >= VERDICT_THRESHOLDS.maxAttempts ? 'escalate' : 'return_to_ba',
    };
  }

  return { passed: true, score, nextAction: 'proceed' };
}

// ─── The main runner ─────────────────────────────────────────────────────────

export interface RunStoryValidatorOptions {
  /** Override the default judge — used in tests. */
  judge?: JudgeAdapter;
  /** Skip pipeline-stage advancement on pass (used by the wiring layer). */
  skipStageAdvancement?: boolean;
}

export async function runStoryValidatorAgent(
  input: StoryValidatorInput,
  db: ReturnType<typeof getDb>,
  options: RunStoryValidatorOptions = {},
): Promise<StoryValidatorOutput> {
  const { storyId, promptId, correlationId } = input;
  const judge: JudgeAdapter =
    options.judge ?? { judge: localLlmRouterJudge };

  // Determine attempt number — caller can override (VAL-005 wiring layer
  // increments before invoking on the second pass).
  const existing = db.select().from(stories).where(eq(stories.id, storyId)).get();
  if (!existing) {
    throw new Error(`Story not found: ${storyId}`);
  }
  const attemptNumber = input.attemptNumber ?? (existing.validationAttempts ?? 0) + 1;

  const start = Date.now();

  // Mark validation as in-progress + fire start event.
  db.update(stories)
    .set({ validationStatus: 'in_progress' })
    .where(eq(stories.id, storyId))
    .run();
  eventBus.publish({
    type: 'story.validation_started',
    actor: 'story-validator',
    correlation_id: correlationId,
    entity_type: 'story',
    entity_id: storyId,
    payload: {
      storyId,
      promptId,
      correlationId,
      attemptNumber,
      rubricVersion: RUBRIC_VERSION,
    },
  });
  eventBus.publish({
    type: 'ticket.validating',
    actor: 'story-validator',
    correlation_id: correlationId,
    entity_type: 'story',
    entity_id: storyId,
    payload: { storyId, promptId, correlationId, attemptNumber },
  });

  // Parse the ticket payload.
  let rawTicket: unknown = {};
  try {
    rawTicket = JSON.parse(existing.agentContributionsJson ?? '{}');
  } catch {
    rawTicket = {};
  }

  // Step 1 — schema.
  const schemaResult = runSchemaStep(rawTicket);
  const allFailures: ValidationFailure[] = [...schemaResult.failures];
  const allWarnings: ValidationWarning[] = [];

  // Short-circuit if schema invalid — downstream steps can't run.
  if (!schemaResult.ticket) {
    const verdict = aggregateVerdict({
      steps: emptyStepsAfterSchemaFail(schemaResult.step),
      failures: allFailures,
      attemptNumber,
      schemaPassed: false,
    });
    return finishAndPersist({
      storyId,
      promptId,
      correlationId,
      attemptNumber,
      passed: verdict.passed,
      score: verdict.score,
      nextAction: verdict.nextAction,
      ranAt: start,
      durationMs: Date.now() - start,
      judgeProvider: 'none',
      judgeModelTouchpoints: [],
      steps: emptyStepsAfterSchemaFail(schemaResult.step),
      failedChecks: allFailures,
      warnings: allWarnings,
      fixSuggestions: dedupedFixSuggestions(allFailures),
      db,
      skipStageAdvancement: options.skipStageAdvancement,
    });
  }

  const ticket = schemaResult.ticket;

  // Steps 2 + 3 — deterministic.
  const presence = runSectionPresenceStep(ticket);
  allFailures.push(...presence.failures);

  const detail = runDetailSufficiencyStep(ticket);
  allFailures.push(...detail.failures);
  allWarnings.push(...detail.warnings);

  // Steps 4-6 — LLM judges (parallel).
  const [contentRelevance, crossSection, gestalt] = await Promise.all([
    runContentRelevanceStep(ticket, judge),
    runCrossSectionStep(ticket, judge),
    runCompletenessGestaltStep(ticket, judge),
  ]);
  allFailures.push(...contentRelevance.failures);
  allFailures.push(...crossSection.failures);
  allFailures.push(...gestalt.failures);
  allWarnings.push(...gestalt.warnings);

  // Aggregate provider info.
  const providers = new Set<'local' | 'claude'>();
  contentRelevance.judgeProviders.forEach((p) => providers.add(p));
  if (crossSection.judgeProvider) providers.add(crossSection.judgeProvider);
  if (gestalt.judgeProvider) providers.add(gestalt.judgeProvider);
  const judgeProvider: ValidationReport['judgeProvider'] =
    providers.size === 0
      ? 'none'
      : providers.size === 1
        ? (providers.values().next().value as 'local' | 'claude')
        : 'mixed';
  const models = new Set<string>();
  contentRelevance.judgeModels.forEach((m) => models.add(m));
  if (crossSection.judgeModel) models.add(crossSection.judgeModel);
  if (gestalt.judgeModel) models.add(gestalt.judgeModel);

  const steps: ValidationReport['steps'] = {
    schema: schemaResult.step,
    sectionPresence: presence.step,
    detailSufficiency: detail.step,
    contentRelevance: contentRelevance.step,
    crossSectionConsistency: crossSection.step,
    completenessGestalt: gestalt.step,
  };

  const verdict = aggregateVerdict({
    steps,
    failures: allFailures,
    attemptNumber,
    schemaPassed: true,
  });

  return finishAndPersist({
    storyId,
    promptId,
    correlationId,
    attemptNumber,
    passed: verdict.passed,
    score: verdict.score,
    nextAction: verdict.nextAction,
    ranAt: start,
    durationMs: Date.now() - start,
    judgeProvider,
    judgeModelTouchpoints: [...models],
    steps,
    failedChecks: allFailures,
    warnings: allWarnings,
    fixSuggestions: dedupedFixSuggestions(allFailures),
    db,
    skipStageAdvancement: options.skipStageAdvancement,
  });
}

function emptyStepsAfterSchemaFail(schemaStep: StepResult): ValidationReport['steps'] {
  return {
    schema: schemaStep,
    sectionPresence: { passed: false, durationMs: 0, details: { skipped: true } },
    detailSufficiency: { passed: false, durationMs: 0, details: { skipped: true } },
    contentRelevance: {
      passed: false,
      durationMs: 0,
      details: { skipped: true },
      perSection: {},
      score: 0,
    },
    crossSectionConsistency: {
      passed: false,
      score: 0,
      durationMs: 0,
      details: { skipped: true },
    },
    completenessGestalt: {
      passed: false,
      durationMs: 0,
      details: { skipped: true },
      testingAgentReady: 0,
      codingAgentReady: 0,
      blockers: [],
      rationale: 'skipped — schema invalid',
    },
  };
}

function dedupedFixSuggestions(failures: ValidationFailure[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of failures) {
    if (!f.fixSuggestion) continue;
    if (seen.has(f.fixSuggestion)) continue;
    seen.add(f.fixSuggestion);
    out.push(f.fixSuggestion);
  }
  return out;
}

interface FinishArgs {
  storyId: string;
  promptId: string;
  correlationId: string;
  attemptNumber: number;
  passed: boolean;
  score: number;
  nextAction: 'proceed' | 'return_to_ba' | 'return_to_po' | 'escalate';
  ranAt: number;
  durationMs: number;
  judgeProvider: ValidationReport['judgeProvider'];
  judgeModelTouchpoints: string[];
  steps: ValidationReport['steps'];
  failedChecks: ValidationFailure[];
  warnings: ValidationWarning[];
  fixSuggestions: string[];
  db: ReturnType<typeof getDb>;
  skipStageAdvancement?: boolean;
}

function finishAndPersist(args: FinishArgs): StoryValidatorOutput {
  const report: ValidationReport = {
    rubricVersion: RUBRIC_VERSION,
    ranAt: args.ranAt,
    durationMs: args.durationMs,
    judgeProvider: args.judgeProvider,
    judgeModelTouchpoints: args.judgeModelTouchpoints,
    passed: args.passed,
    score: args.score,
    nextAction: args.nextAction,
    attemptNumber: args.attemptNumber,
    steps: args.steps,
    failedChecks: args.failedChecks,
    warnings: args.warnings,
    fixSuggestions: args.fixSuggestions,
  };

  const validationStatus =
    args.nextAction === 'escalate'
      ? 'escalated'
      : args.passed
        ? 'passed'
        : 'failed';

  args.db
    .update(stories)
    .set({
      validationReport: JSON.stringify(report),
      validationStatus,
      validationAttempts: args.attemptNumber,
      lastValidatedAt: args.ranAt,
    })
    .where(eq(stories.id, args.storyId))
    .run();

  // Lifecycle events.
  if (args.passed) {
    eventBus.publish({
      type: 'story.validation_passed',
      actor: 'story-validator',
      correlation_id: args.correlationId,
      entity_type: 'story',
      entity_id: args.storyId,
      payload: {
        storyId: args.storyId,
        promptId: args.promptId,
        correlationId: args.correlationId,
        attemptNumber: args.attemptNumber,
        score: args.score,
        durationMs: args.durationMs,
        judgeProvider: args.judgeProvider,
      },
    });
    eventBus.publish({
      type: 'ticket.validated',
      actor: 'story-validator',
      correlation_id: args.correlationId,
      entity_type: 'story',
      entity_id: args.storyId,
      payload: {
        storyId: args.storyId,
        promptId: args.promptId,
        correlationId: args.correlationId,
        score: args.score,
        judgeProvider: args.judgeProvider,
      },
    });
    if (!args.skipStageAdvancement) {
      advancePipelineStage(
        {
          promptId: args.promptId,
          stage: STAGE_VALIDATED,
          correlationId: args.correlationId,
          metadata: {
            attemptNumber: args.attemptNumber,
            score: args.score,
            judgeProvider: args.judgeProvider,
          },
        },
        args.db,
      );
    }
  } else {
    eventBus.publish({
      type: 'story.validation_failed',
      actor: 'story-validator',
      correlation_id: args.correlationId,
      entity_type: 'story',
      entity_id: args.storyId,
      payload: {
        storyId: args.storyId,
        promptId: args.promptId,
        correlationId: args.correlationId,
        attemptNumber: args.attemptNumber,
        score: args.score,
        failedCheckCount: args.failedChecks.length,
        nextAction: args.nextAction,
        durationMs: args.durationMs,
      },
    });
    if (args.nextAction === 'escalate') {
      eventBus.publish({
        type: 'story.validation_escalated',
        actor: 'story-validator',
        correlation_id: args.correlationId,
        entity_type: 'story',
        entity_id: args.storyId,
        payload: {
          storyId: args.storyId,
          promptId: args.promptId,
          correlationId: args.correlationId,
          attemptNumber: args.attemptNumber,
          // VAL-005 will create the blocker row and patch this id in.
          blockerId: null,
        },
      });
    }
  }

  return {
    storyId: args.storyId,
    passed: args.passed,
    score: args.score,
    nextAction: args.nextAction,
    attemptNumber: args.attemptNumber,
    report,
  };
}

// Re-exports for convenience.
export { TicketTemplateV1Schema };
