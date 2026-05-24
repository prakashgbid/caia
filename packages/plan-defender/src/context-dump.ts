/**
 * Plan context dump loader + validator.
 *
 * The dump is the load-bearing artifact: the Defender is only as good as
 * the dump it inherits (spec §3.2 + §3.8). Thin dumps produce escalation
 * storms; thick dumps produce a Defender that closes most loops without
 * operator involvement.
 *
 * Validation is permissive on optional fields and strict on required ones.
 * The validator returns a structured ContextDumpValidation so callers can
 * decide whether to reject the dump outright or proceed-with-warnings.
 */

import { dirname, join } from 'node:path';

import type { FsLike } from './fs.js';
import { defaultFs } from './fs.js';
import type {
  ContextDumpValidation,
  ContextDumpValidationError,
  PlanContextDump
} from './types.js';

/** Resolves the canonical context-dump path for a given plan path. */
export function dumpPathForPlan(planPath: string): string {
  const dir = dirname(planPath);
  const base = planPath.slice(dir.length + 1).replace(/\.md$/, '');
  return join(dir, '.context-dumps', `${base}.json`);
}

/** Load + parse a dump from disk. Throws on missing file or invalid JSON. */
export function loadContextDump(
  dumpPath: string,
  fs: FsLike = defaultFs
): PlanContextDump {
  if (!fs.exists(dumpPath)) {
    throw new Error(`context dump not found: ${dumpPath}`);
  }
  const raw = fs.readFile(dumpPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`context dump is not valid JSON: ${dumpPath}: ${(e as Error).message}`);
  }
  return normaliseContextDump(parsed);
}

/** Validate a dump. Returns structured errors + a thickness score. */
export function validateContextDump(dump: PlanContextDump): ContextDumpValidation {
  const errors: ContextDumpValidationError[] = [];

  if (dump.schema_version !== 1) errors.push('wrong-schema-version');
  if (
    typeof dump.plan_path !== 'string' ||
    dump.plan_path === '' ||
    typeof dump.plan_slug !== 'string' ||
    dump.plan_slug === '' ||
    typeof dump.producer_agent_id !== 'string' ||
    dump.producer_agent_id === '' ||
    typeof dump.produced_at !== 'string' ||
    dump.produced_at === '' ||
    !Array.isArray(dump.models_used)
  ) {
    errors.push('missing-required-field');
  }

  // Permissive: empty arrays are technically legal but we surface them as
  // separate signals so the caller can decide to reject thin dumps.
  if (!Array.isArray(dump.decision_points) || dump.decision_points.length === 0) {
    errors.push('no-decision-points');
  }
  if (!Array.isArray(dump.sources_consulted) || dump.sources_consulted.length === 0) {
    errors.push('no-sources-consulted');
  }

  // Reasoning summary length bounds — 500-1500 words per spec.
  const words = typeof dump.reasoning_summary === 'string'
    ? dump.reasoning_summary.split(/\s+/).filter((w) => w !== '').length
    : 0;
  if (words < 100) errors.push('reasoning-summary-too-short');
  if (words > 5000) errors.push('reasoning-summary-too-long');

  return {
    ok: errors.length === 0,
    errors,
    thickness: computeThickness(dump)
  };
}

/**
 * Thickness score 0..1. Weighted combination of:
 *  - reasoning_summary word count (target 500-1500)
 *  - decision_points count (more = thicker)
 *  - sources_consulted count
 *  - alternatives_dropped count
 *  - open_questions count (some = good)
 *  - assumptions count
 */
export function computeThickness(dump: PlanContextDump): number {
  const words = typeof dump.reasoning_summary === 'string'
    ? dump.reasoning_summary.split(/\s+/).filter((w) => w !== '').length
    : 0;
  // Word-count contribution: peaks at 1000 words.
  const wordScore = Math.min(1, words / 1000);

  const dps = (dump.decision_points ?? []).length;
  const dpScore = Math.min(1, dps / 5); // 5+ = full credit

  const srcs = (dump.sources_consulted ?? []).length;
  const srcScore = Math.min(1, srcs / 6); // 6+ = full credit

  const alts = (dump.alternatives_dropped ?? []).length;
  const altScore = Math.min(1, alts / 3);

  const ops = (dump.open_questions ?? []).length;
  // Open questions: some is good, too many is a smell. Peak at 3.
  const opsScore = ops <= 3 ? Math.min(1, ops / 3) : Math.max(0, 1 - (ops - 3) / 10);

  const asps = (dump.assumptions ?? []).length;
  const aspScore = Math.min(1, asps / 4);

  const weighted =
    wordScore * 0.3 +
    dpScore * 0.25 +
    srcScore * 0.2 +
    altScore * 0.1 +
    opsScore * 0.1 +
    aspScore * 0.05;

  return Math.max(0, Math.min(1, weighted));
}

/** Coerce an unknown parsed JSON into a PlanContextDump, defaulting missing fields. */
export function normaliseContextDump(raw: unknown): PlanContextDump {
  if (raw === null || typeof raw !== 'object') {
    throw new Error('context dump must be a JSON object');
  }
  const o = raw as Record<string, unknown>;
  return {
    schema_version: o['schema_version'] === 1 ? 1 : 1,
    plan_path: asString(o['plan_path']),
    plan_slug: asString(o['plan_slug']),
    producer_agent_id: asString(o['producer_agent_id']),
    producer_session_id: asString(o['producer_session_id']),
    produced_at: asString(o['produced_at']),
    models_used: asStringArray(o['models_used']),
    reasoning_summary: asString(o['reasoning_summary']),
    decision_points: asArray(o['decision_points']).map((d) => normaliseDecisionPoint(d)),
    sources_consulted: asArray(o['sources_consulted']).map((s) => normaliseSource(s)),
    open_questions: asArray(o['open_questions']).map((q) => normaliseOpenQuestion(q)),
    alternatives_dropped: asArray(o['alternatives_dropped']).map((a) => normaliseAlt(a)),
    invitations_to_scrutiny: asStringArray(o['invitations_to_scrutiny']),
    assumptions: asArray(o['assumptions']).map((a) => normaliseAssumption(a))
  };
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
function asArray(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object');
}

function normaliseDecisionPoint(o: Record<string, unknown>): PlanContextDump['decision_points'][number] {
  const confRaw = o['confidence'];
  const confidence: 'low' | 'medium' | 'high' =
    confRaw === 'low' || confRaw === 'high' ? confRaw : 'medium';
  return {
    decision: asString(o['decision']),
    options_considered: asStringArray(o['options_considered']),
    chosen: asString(o['chosen']),
    rationale: asString(o['rationale']),
    confidence,
    revisitable_if: asString(o['revisitable_if'])
  };
}

function normaliseSource(o: Record<string, unknown>): PlanContextDump['sources_consulted'][number] {
  const typeRaw = o['type'];
  const validTypes = ['web', 'memory-file', 'caia-file', 'research-doc', 'adr', 'principle', 'conversation'] as const;
  const type = (validTypes as readonly string[]).includes(typeRaw as string)
    ? (typeRaw as PlanContextDump['sources_consulted'][number]['type'])
    : 'web';
  const out: PlanContextDump['sources_consulted'][number] = {
    type,
    citation: asString(o['citation']),
    relevance: asString(o['relevance'])
  };
  if (typeof o['quoted_excerpt'] === 'string') out.quoted_excerpt = o['quoted_excerpt'];
  return out;
}

function normaliseOpenQuestion(o: Record<string, unknown>): PlanContextDump['open_questions'][number] {
  const resRaw = o['candidate_resolution'];
  const candidate_resolution: PlanContextDump['open_questions'][number]['candidate_resolution'] =
    resRaw === 'operator-only' || resRaw === 'will-emerge-during-build'
      ? resRaw
      : 'reviewable-with-more-research';
  return {
    question: asString(o['question']),
    why_unresolved: asString(o['why_unresolved']),
    affects: asStringArray(o['affects']),
    candidate_resolution
  };
}

function normaliseAlt(o: Record<string, unknown>): PlanContextDump['alternatives_dropped'][number] {
  const out: PlanContextDump['alternatives_dropped'][number] = {
    alternative: asString(o['alternative']),
    why_dropped: asString(o['why_dropped'])
  };
  if (typeof o['revisit_trigger'] === 'string') out.revisit_trigger = o['revisit_trigger'];
  return out;
}

function normaliseAssumption(o: Record<string, unknown>): PlanContextDump['assumptions'][number] {
  return {
    assumption: asString(o['assumption']),
    why_assumed_true: asString(o['why_assumed_true']),
    blast_radius_if_false: asString(o['blast_radius_if_false'])
  };
}

/** Compose a stub dump — useful for tests and for the smoke-test bootstrap. */
export function makeStubContextDump(overrides: Partial<PlanContextDump> = {}): PlanContextDump {
  const base: PlanContextDump = {
    schema_version: 1,
    plan_path: '/tmp/stub-plan.md',
    plan_slug: 'stub-plan',
    producer_agent_id: 'stub-producer',
    producer_session_id: 'stub-session',
    produced_at: new Date().toISOString(),
    models_used: ['claude-sonnet-4-6'],
    reasoning_summary: 'Stub reasoning summary used by tests. ' .repeat(40),
    decision_points: [
      {
        decision: 'Stub decision',
        options_considered: ['option-a', 'option-b'],
        chosen: 'option-a',
        rationale: 'option-a aligned with the existing pattern',
        confidence: 'high',
        revisitable_if: 'requirements change'
      }
    ],
    sources_consulted: [
      {
        type: 'caia-file',
        citation: '/path/to/file',
        relevance: 'establishes the precedent'
      }
    ],
    open_questions: [],
    alternatives_dropped: [],
    invitations_to_scrutiny: [],
    assumptions: []
  };
  return { ...base, ...overrides };
}
