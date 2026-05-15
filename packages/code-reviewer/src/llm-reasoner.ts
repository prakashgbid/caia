/**
 * LLM-reasoned tier — see DESIGN.md §6.
 *
 * Spawns the `claude` binary in subprocess (subscription-only path —
 * cribbed from `@chiefaia/critic` and `@chiefaia/reviewer`'s reasoners,
 * compliant with `feedback_no_api_key_billing.md`). The prompt carries:
 *   1. A correctness/bugs-focused system prompt.
 *   2. The 7 code-review dimensions with one-line descriptions.
 *   3. Explicit non-overlap instructions for both siblings (Critic's
 *      block-worthy categories AND advisory Reviewer's craftsmanship-only
 *      dimensions are off-limits).
 *   4. The diff hunks (capped to a configured byte budget).
 *   5. AGENTS.md / conventions excerpts so the LLM grounds in CAIA idioms.
 *   6. A strict JSON output schema.
 *
 * Failures (timeout, parse-error, non-zero exit) cause `ok: false` and the
 * caller drops the LLM-tier findings. Deterministic-tier findings (when
 * added in Phase 2) are always emitted regardless.
 *
 * SUBSCRIPTION-ONLY: deletes ANTHROPIC_API_KEY from the spawn env so the
 * binary cannot fall back to per-token billing under any circumstance.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

import type {
  CodeReviewDimensionId,
  CodeReviewFinding,
  CodeReviewSeverity,
  LlmReviewInput,
  LlmReviewOutput,
  LlmReviewer
} from './types.js';
import {
  ADVISORY_REVIEWER_DENYLIST,
  ALL_DIMENSIONS,
  CRITIC_DENYLIST,
  DEFAULT_SEVERITY,
  SEVERITY_RANK
} from './types.js';

export interface DefaultLlmReviewerOptions {
  binaryPath: string;
  modelTag: string;
  timeoutMs: number;
  /** Test seam — replaces `child_process.spawnSync`. */
  spawnFn?: (
    cmd: string,
    args: readonly string[],
    opts: { input: string; encoding: 'utf-8'; timeout: number; env: NodeJS.ProcessEnv }
  ) => SpawnSyncReturns<string>;
}

const DIMENSION_DESCRIPTIONS: Readonly<Record<CodeReviewDimensionId, string>> = {
  correctness: 'logic errors — off-by-one, wrong operator, missing branch, returns wrong value, mutates wrong target.',
  'bug-risk': 'latent bugs — null/undefined deref, missing await, race condition, unhandled rejection, exception thrown out of finally.',
  style: 'enforceable style violations the project explicitly chose — semicolons, quote style, single-line if-without-braces.',
  'type-safety': 'type errors that compile but are wrong — narrow-then-widen, force-cast around a real type mismatch, missing null in union.',
  'test-coverage': 'new public behavior shipped without a test that exercises it; new branch in existing fn left uncovered.',
  naming: 'incorrect / misleading names — `isValid` that returns side-effect status, plural for singular, type/role mismatch.',
  comments: 'misleading or stale comments — claims `O(n)` on an `O(n²)` loop, references a removed function, contradicts the code.'
};

const SYSTEM_PROMPT = `You are a code reviewer for the CAIA monorepo. Your job is to spot CORRECTNESS, BUGS, STYLE, TYPE SAFETY, TEST COVERAGE, NAMING, and COMMENTS issues that should block merge until fixed. You have block authority — be precise, evidence-based, and avoid speculation.

Tone: a senior engineer leaving substantive PR comments. Bias toward "medium" and "high" for real bugs and correctness issues; emit "low" for style/naming/comment nits; emit "critical" only for clear data-loss / data-corruption / hard crash bugs in production code paths.

CRITICAL — STAY IN YOUR LANE:

(1) Do NOT flag any of these — they belong to the sibling Critic agent:
- security regressions, credential leaks, cost overruns
- hallucination, scope mismatch, wrong direction, lacking information
- premature completion, re-litigation, decision-classifier violations
- git/branch hygiene, tool misuse, CI flakes, recipe rot, false-modesty
- coordination failures, operator confusion, memory drift, incompleteness

(2) Do NOT flag stylistic-only refactors that don't have a correctness component — they belong to the advisory Reviewer agent:
- pure idiom adherence / abstraction quality / suggested refactors with no bug component
- function length / file length / magic numbers / nesting depth as PURELY style — only flag if the structure causes a real bug or readability-blocking confusion
- comment density (missing JSDoc with no correctness implication)
- type-any used as a craftsmanship critique (DO flag if \`any\` masks a real type mismatch — that's "type-safety", not craftsmanship)
- TODO without ticket / console.log left in / duplicate imports as pure style

If a finding could go either way (Reviewer vs Code-Reviewer), only emit it here if it has a CORRECTNESS or BUG component. Otherwise leave it for the advisory Reviewer.

Output STRICT JSON in the shape:
{"findings":[{"dimension":"<id>","severity":"low|medium|high|critical","file":"...","line":123,"issueTitle":"...","description":"...","reproductionSteps":["..."],"suggestedFix":"...","excerpt":"..."}]}
No prose before or after. No markdown fences. Keep total findings <= 10 per chunk; quality over quantity.`;

export function buildPrompt(input: LlmReviewInput): string {
  const dimensionsBlock = ALL_DIMENSIONS
    .map(d => `  - ${d}: ${DIMENSION_DESCRIPTIONS[d]}`)
    .join('\n');
  const conventionsBlock = input.conventionExcerpts.length === 0
    ? '(none — fall back to general TS / Node best practices)'
    : input.conventionExcerpts
        .map(c => `### ${c.heading} (from ${c.source})\n${c.bodyExcerpt}`)
        .join('\n\n');
  const hunksBlock = input.hunks
    .map(h => `### ${h.file} (${h.status})\n${h.header}\n${h.body}`)
    .join('\n\n');
  return `${SYSTEM_PROMPT}

## Code-review dimensions
${dimensionsBlock}

## Project conventions
${conventionsBlock}

## PR metadata
- prNumber: ${input.pr.prNumber}
- branch: ${input.pr.branch}
- baseBranch: ${input.pr.baseBranch}
- title: ${input.pr.title}

## Diff hunks
${hunksBlock}

## Output JSON now:`;
}

export function createDefaultLlmReviewer(opts: DefaultLlmReviewerOptions): LlmReviewer {
  const spawn = opts.spawnFn ?? spawnSync;
  return {
    async review(input: LlmReviewInput): Promise<LlmReviewOutput> {
      const prompt = buildPrompt(input);
      // A.9.13 — small-diff local router path (opt-in via
      // CAIA_REVIEW_LOCAL_FIRST=1). Falls through to claude on any error.
      const localOutput = await trySmallDiffLocalRouter(input, prompt);
      if (localOutput !== null) return localOutput;

      // SUBSCRIPTION-ONLY — strip API-key auth env var so the binary cannot
      // fall through to per-token billing per `feedback_no_api_key_billing.md`.
      const env = { ...process.env };
      delete env['ANTHROPIC_API_KEY'];
      const result = spawn(
        opts.binaryPath,
        ['--print', '--output-format', 'json', '--model', opts.modelTag],
        { input: prompt, encoding: 'utf-8', timeout: opts.timeoutMs, env }
      );
      if (result.error !== null && result.error !== undefined) {
        return {
          findings: [],
          ok: false,
          diagnostic: `claude spawn error: ${result.error.message}`
        };
      }
      if (result.status !== 0) {
        return {
          findings: [],
          ok: false,
          diagnostic: `claude exited ${result.status}: ${(result.stderr ?? '').toString().slice(0, 300)}`
        };
      }
      const stdout = (result.stdout ?? '').toString();
      return parseLlmOutput(stdout);
    }
  };
}

/**
 * A.9.13 — Same shape as the Critic/Reviewer siblings: small diffs route
 * to the local router; everything else falls through to the claude
 * binary subprocess. Returns null on any error.
 */
async function trySmallDiffLocalRouter(
  input: LlmReviewInput,
  prompt: string,
): Promise<LlmReviewOutput | null> {
  if (process.env['CAIA_REVIEW_LOCAL_FIRST'] !== '1') return null;
  const maxLines = parseEnvInt(
    process.env['CAIA_REVIEW_LOCAL_DIFF_LINES_MAX'],
    200,
  );
  let totalLines = 0;
  for (const h of input.hunks) {
    if (h.body) totalLines += h.body.split('\n').length;
  }
  if (totalLines === 0 || totalLines > maxLines) return null;

  const routerBaseUrl =
    process.env['ROUTER_BASE_URL'] ?? 'http://127.0.0.1:7411';
  const model = process.env['CAIA_REVIEW_LOCAL_MODEL'] ?? 'qwen2.5-coder:14b';
  const timeoutMs = parseEnvInt(
    process.env['CAIA_REVIEW_LOCAL_TIMEOUT_MS'],
    45_000,
  );
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(`${routerBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          caia_task_type: 'code-review-light',
        }),
        signal: ac.signal,
      });
      if (!r.ok) return null;
      const body = (await r.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = body.choices?.[0]?.message?.content ?? '';
      if (text === '') return null;
      const synthetic = JSON.stringify({ result: text });
      const parsed = parseLlmOutput(synthetic);
      return parsed.ok ? parsed : null;
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

function parseEnvInt(v: string | undefined, def: number): number {
  if (v === undefined) return def;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
}

/** Noop reviewer — used when `enableLlmReasoning` is false. */
export const noopLlmReviewer: LlmReviewer = {
  async review(): Promise<LlmReviewOutput> {
    return { findings: [], ok: true };
  }
};

/** Parse the `claude --print --output-format json` envelope, then the
 * inner JSON the prompt asked for. Robust against extra whitespace and
 * leading/trailing prose. */
export function parseLlmOutput(stdout: string): LlmReviewOutput {
  let outer: unknown;
  try {
    outer = JSON.parse(stdout);
  } catch (e) {
    return { findings: [], ok: false, diagnostic: `outer JSON parse: ${(e as Error).message}` };
  }
  if (
    typeof outer !== 'object'
    || outer === null
    || typeof (outer as { result?: unknown }).result !== 'string'
  ) {
    return { findings: [], ok: false, diagnostic: 'envelope missing "result" string' };
  }
  const inner = (outer as { result: string }).result;
  const block = extractFirstJsonObject(inner);
  if (block === null) {
    return { findings: [], ok: false, diagnostic: 'no JSON object in inner result' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(block);
  } catch (e) {
    return { findings: [], ok: false, diagnostic: `inner JSON parse: ${(e as Error).message}` };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { findings: [], ok: false, diagnostic: 'inner not an object' };
  }
  const findingsRaw = (parsed as { findings?: unknown }).findings;
  if (!Array.isArray(findingsRaw)) {
    return { findings: [], ok: true };
  }
  const findings = findingsRaw
    .map(f => sanitiseLlmFinding(f))
    .filter((f): f is Omit<CodeReviewFinding, 'id' | 'source' | 'detectorId'> => f !== null);
  return { findings, ok: true };
}

function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function sanitiseLlmFinding(raw: unknown): Omit<CodeReviewFinding, 'id' | 'source' | 'detectorId'> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const dim = r['dimension'];
  if (typeof dim !== 'string') return null;
  // Defense in depth on top of the prompt — drop anything that landed on
  // either sibling's denylist.
  if (CRITIC_DENYLIST.has(dim)) return null;
  if (ADVISORY_REVIEWER_DENYLIST.has(dim)) return null;
  if (!ALL_DIMENSIONS.includes(dim as CodeReviewDimensionId)) return null;
  const dimension = dim as CodeReviewDimensionId;
  const file = typeof r['file'] === 'string' ? r['file'] : '';
  if (file === '') return null;
  const line = typeof r['line'] === 'number' && Number.isFinite(r['line']) ? r['line'] : 0;
  const issueTitle = typeof r['issueTitle'] === 'string' && r['issueTitle'].length > 0
    ? r['issueTitle']
    : 'unspecified';
  const description = typeof r['description'] === 'string' ? r['description'] : '';
  if (description === '') return null;
  const sevRaw = r['severity'];
  const severity: CodeReviewSeverity = (sevRaw === 'low' || sevRaw === 'medium' || sevRaw === 'high' || sevRaw === 'critical')
    ? sevRaw
    : DEFAULT_SEVERITY[dimension];
  // Cap LLM-suggested severity at the dimension's default ceiling — except
  // we let the model promote when the dimension's default is already high
  // (correctness/bug-risk) and it volunteers a critical bug.
  const finalSev: CodeReviewSeverity = capSeverity(severity, DEFAULT_SEVERITY[dimension]);
  const excerptRaw = typeof r['excerpt'] === 'string' ? r['excerpt'].slice(0, 200) : '';
  const suggestedFix = typeof r['suggestedFix'] === 'string' ? r['suggestedFix'] : undefined;
  const reproRaw = r['reproductionSteps'];
  const reproductionSteps = Array.isArray(reproRaw)
    ? reproRaw.filter((s): s is string => typeof s === 'string').slice(0, 6)
    : undefined;

  const out: Omit<CodeReviewFinding, 'id' | 'source' | 'detectorId'> = {
    dimension,
    severity: finalSev,
    file,
    line,
    issueTitle,
    description,
    excerpt: excerptRaw
  };
  if (suggestedFix !== undefined) out.suggestedFix = suggestedFix;
  if (reproductionSteps !== undefined && reproductionSteps.length > 0) {
    out.reproductionSteps = reproductionSteps;
  }
  return out;
}

/** Cap the LLM-suggested severity. For correctness/bug-risk we permit
 * promotion up to `critical` because data-loss bugs are real. For other
 * dimensions, cap at the default to avoid a chatty model promoting style
 * to high. */
function capSeverity(suggested: CodeReviewSeverity, defaultForDimension: CodeReviewSeverity): CodeReviewSeverity {
  if (defaultForDimension === 'high') {
    // Allow promotion to critical for correctness/bug-risk — caps still apply.
    return suggested;
  }
  return SEVERITY_RANK[suggested] <= SEVERITY_RANK[defaultForDimension]
    ? suggested
    : defaultForDimension;
}
