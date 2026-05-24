/**
 * Defender responder — the LLM-backed adapter that turns a question +
 * context dump into a structured DefenderAnswer.
 *
 * Production wires this to `@chiefaia/claude-spawner`, spawning a fresh
 * Claude Code subagent with the canonical Defender system prompt.
 * Subscription-only by construction (no API key) per P1 + P14.
 *
 * Tests substitute a deterministic stub via the `ResponderAdapter` seam.
 *
 * The responder is intentionally stateless. The spawner threads round
 * history through the `ResponderInput.history` field so the underlying
 * LLM call has all prior Q&A turns visible.
 */

import { spawnClaude } from '@chiefaia/claude-spawner';

import { buildDefenderPrompt } from './system-prompt.js';
import type {
  DefenderAnswer,
  PlanContextDump,
  ResponderAdapter,
  ResponderInput
} from './types.js';

export interface ClaudeResponderConfig {
  /** Override binary path for the spawner. */
  binaryPath?: string;
  /** Override timeout (ms). */
  timeoutMs?: number;
  /** Model id — Sonnet default; Opus for thick dumps or high stakes (spec §3.3). */
  model?: 'sonnet' | 'opus';
  /** Auto-Opus when context dump > N tokens or escalation rate climbs. */
  autoOpusOnThickness?: boolean;
}

export function createClaudeResponder(cfg: ClaudeResponderConfig = {}): ResponderAdapter {
  return {
    async respond(input: ResponderInput): Promise<DefenderAnswer> {
      const planMarkdown = await loadPlanBody(input.contextDump);
      const head = buildDefenderPrompt(input.contextDump, planMarkdown);
      const conversation = renderHistory(input);
      const tail = `\n\n## Reviewer's question (round ${input.round})\n${input.question.question}\n${
        input.question.scope ? `\n_Scope: ${input.question.scope}_\n` : ''
      }${input.question.context ? `\n_Context: ${input.question.context}_\n` : ''}`;
      const fullPrompt = `${head}\n\n${conversation}${tail}`;
      const model = pickModel(cfg, input.contextDump);
      const result = await spawnClaude({
        prompt: fullPrompt,
        options: {
          ...(cfg.binaryPath !== undefined ? { binaryPath: cfg.binaryPath } : {}),
          model,
          timeoutMs: cfg.timeoutMs ?? 90_000
        }
      });
      if (!result.ok) {
        return {
          round: input.round,
          answer: `Defender spawn failed: ${result.diagnostic ?? 'unknown'}`,
          cited_sources: [],
          confidence: 'low',
          recommended_action: 'escalate-to-operator',
          notes_for_reviewer: 'Spawn error — escalate so the operator can decide.',
          ts: new Date().toISOString()
        };
      }
      return parseDefenderAnswer(result.stdout, input.round);
    }
  };
}

/**
 * Stub responder for tests + the bootstrap smoke test (when Claude is not
 * available). Uses simple heuristics over the dump to pick a response.
 *
 * The stub is intentionally honest: if it can't ground an answer in the
 * dump, it returns confidence: low / recommended_action: escalate.
 */
export class StubResponder implements ResponderAdapter {
  public calls: ResponderInput[] = [];
  constructor(private readonly outputs?: DefenderAnswer[]) {}

  async respond(input: ResponderInput): Promise<DefenderAnswer> {
    this.calls.push(input);
    if (this.outputs !== undefined) {
      const i = Math.min(this.calls.length - 1, this.outputs.length - 1);
      const tpl = this.outputs[i];
      if (tpl !== undefined) {
        return { ...tpl, round: input.round };
      }
    }
    return synthesizeAnswerFromDump(input);
  }
}

/** Last-resort deterministic answer composer driven by the dump. */
function synthesizeAnswerFromDump(input: ResponderInput): DefenderAnswer {
  const q = input.question.question.toLowerCase();
  // Try matching a decision point first.
  for (const dp of input.contextDump.decision_points) {
    if (q.includes(dp.decision.slice(0, 20).toLowerCase()) || q.includes(dp.chosen.toLowerCase())) {
      return {
        round: input.round,
        answer: `The producer chose "${dp.chosen}" for "${dp.decision}". Rationale: ${dp.rationale}`,
        cited_sources: [`decision_point:${dp.decision.slice(0, 60)}`],
        confidence: dp.confidence,
        recommended_action: 'plan-stands',
        ts: new Date().toISOString()
      };
    }
  }
  // Match an open question — escalate or note it's unresolved.
  for (const oq of input.contextDump.open_questions) {
    if (q.includes(oq.question.slice(0, 20).toLowerCase())) {
      return {
        round: input.round,
        answer: `Producer flagged this as unresolved. Why: ${oq.why_unresolved}. Resolution path: ${oq.candidate_resolution}.`,
        cited_sources: [`open_question:${oq.question.slice(0, 60)}`],
        confidence: 'low',
        recommended_action:
          oq.candidate_resolution === 'operator-only'
            ? 'escalate-to-operator'
            : 'plan-needs-revision',
        notes_for_reviewer:
          oq.candidate_resolution === 'operator-only'
            ? 'Producer marked this operator-only.'
            : 'Producer flagged this as reviewable with more research.',
        ts: new Date().toISOString()
      };
    }
  }
  // Fallback — low confidence + acknowledge gap.
  return {
    round: input.round,
    answer: `The context dump does not directly cover this question. The closest signal is the reasoning summary's framing of the problem, but the producer did not record a specific decision for it.`,
    cited_sources: ['reasoning_summary'],
    confidence: 'low',
    recommended_action: 'plan-needs-revision',
    notes_for_reviewer:
      'Defender could not find a precise grounding in the dump. Consider rephrasing or escalating.',
    ts: new Date().toISOString()
  };
}

function pickModel(cfg: ClaudeResponderConfig, dump: PlanContextDump): string {
  if (cfg.model === 'opus') return 'opus';
  if (cfg.autoOpusOnThickness === true) {
    // Heuristic: > 50k chars of cumulative prompt material → Opus.
    const charBudget =
      dump.reasoning_summary.length +
      dump.decision_points.reduce((s, d) => s + d.rationale.length + d.decision.length, 0) +
      dump.sources_consulted.reduce((s, src) => s + src.relevance.length, 0);
    if (charBudget > 50_000) return 'opus';
  }
  return cfg.model ?? 'sonnet';
}

function renderHistory(input: ResponderInput): string {
  if (input.history.length === 0) return '## No prior rounds — this is round 1';
  const lines: string[] = ['## Prior rounds (oldest first)'];
  for (const { q, a } of input.history) {
    lines.push(`\n### Round ${q.round}`);
    lines.push(`**Reviewer asked:** ${q.question}`);
    if (q.scope !== undefined) lines.push(`_Scope:_ ${q.scope}`);
    lines.push(`**You answered:** ${a.answer}`);
    lines.push(`_Cited:_ ${a.cited_sources.join(', ') || '(none)'}; _confidence:_ ${a.confidence}; _action:_ ${a.recommended_action}`);
  }
  return lines.join('\n');
}

async function loadPlanBody(dump: PlanContextDump): Promise<string> {
  // Best-effort: try to read the plan markdown via fs. Defaults to the
  // dump's reasoning_summary if the plan file isn't reachable (e.g. in
  // tests).
  try {
    const fs = await import('node:fs');
    if (fs.existsSync(dump.plan_path)) {
      return fs.readFileSync(dump.plan_path, 'utf8');
    }
  } catch {
    /* swallow */
  }
  return `# ${dump.plan_slug}\n\n_Plan body unavailable; relying on context dump._\n\n${dump.reasoning_summary}`;
}

/** Parse a JSON envelope from the model's stdout into a DefenderAnswer. */
export function parseDefenderAnswer(raw: string, round: number): DefenderAnswer {
  const json = extractJsonObject(raw);
  if (json === null) {
    return {
      round,
      answer: 'Defender produced no parseable JSON.',
      cited_sources: [],
      confidence: 'low',
      recommended_action: 'escalate-to-operator',
      notes_for_reviewer: `Raw output: ${raw.slice(0, 500)}`,
      ts: new Date().toISOString()
    };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch (e) {
    return {
      round,
      answer: `JSON parse error: ${(e as Error).message}`,
      cited_sources: [],
      confidence: 'low',
      recommended_action: 'escalate-to-operator',
      ts: new Date().toISOString()
    };
  }
  const answer = typeof parsed['answer'] === 'string' ? parsed['answer'] : '';
  const cited_sources = Array.isArray(parsed['cited_sources'])
    ? parsed['cited_sources'].filter((s): s is string => typeof s === 'string')
    : [];
  const confRaw = parsed['confidence'];
  const confidence: 'low' | 'medium' | 'high' =
    confRaw === 'high' || confRaw === 'medium' ? confRaw : 'low';
  const recRaw = parsed['recommended_action'];
  const recommended_action: 'plan-stands' | 'plan-needs-revision' | 'escalate-to-operator' =
    recRaw === 'plan-stands' || recRaw === 'plan-needs-revision' || recRaw === 'escalate-to-operator'
      ? recRaw
      : 'plan-needs-revision';
  const out: DefenderAnswer = {
    round,
    answer,
    cited_sources,
    confidence,
    recommended_action,
    ts: new Date().toISOString()
  };
  if (typeof parsed['notes_for_reviewer'] === 'string') {
    out.notes_for_reviewer = parsed['notes_for_reviewer'];
  }
  return out;
}

function extractJsonObject(raw: string): string | null {
  // Try wrapped envelope first.
  try {
    const envelope = JSON.parse(raw) as { result?: string };
    if (envelope && typeof envelope === 'object' && typeof envelope.result === 'string') {
      const inner = findFirstObject(envelope.result);
      if (inner !== null) return inner;
    }
  } catch {
    /* not an envelope */
  }
  // Try fenced code block.
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1] !== undefined) {
    const inner = findFirstObject(fence[1]);
    if (inner !== null) return inner;
  }
  return findFirstObject(raw);
}

function findFirstObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
