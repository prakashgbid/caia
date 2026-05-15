/**
 * LLM-reasoned tier — see DESIGN.md §6.2.
 *
 * Spawns the `claude` binary in subprocess (subscription-only path —
 * cribbed from packages/apprentice-corpus/src/distiller.ts and the sibling
 * Critic agent's `llm-reasoner.ts`). The prompt carries:
 *   1. A craftsmanship-review system prompt (tone: advisory, not adversarial).
 *   2. The 18 craftsmanship dimensions with one-line descriptions.
 *   3. A clear NON-OVERLAP instruction: don't flag Critic categories.
 *   4. The diff hunks (capped to a configured byte budget).
 *   5. AGENTS.md / conventions excerpts so the LLM grounds in CAIA idioms.
 *   6. A strict JSON output schema.
 *
 * Failures (timeout, parse-error, non-zero exit) cause `ok: false` and the
 * caller drops the LLM-tier findings. Deterministic-tier findings are
 * always emitted regardless.
 */

import { spawnClaude } from '@chiefaia/claude-spawner';
import type { spawn } from 'node:child_process';

import type {
  CraftsmanshipDimensionId,
  CraftsmanshipFinding,
  CraftsmanshipSeverity,
  LlmReviewInput,
  LlmReviewOutput,
  LlmReviewer
} from './types.js';
import { ALL_DIMENSIONS, CRITIC_DENYLIST, DEFAULT_SEVERITY, SEVERITY_RANK } from './types.js';

export interface DefaultLlmReviewerOptions {
  binaryPath: string;
  modelTag: string;
  timeoutMs: number;
  /**
   * Test seam — replaces `node:child_process.spawn` used by
   * `@chiefaia/claude-spawner`.
   */
  spawnFn?: typeof spawn;
}

const DIMENSION_DESCRIPTIONS: Readonly<Record<CraftsmanshipDimensionId, string>> = {
  'naming-convention': 'identifier choices that don\'t fit the repo style (single-letter outside iters, snake_case in TS).',
  'function-length': 'function exceeds reasonable length and could split into helpers.',
  'file-length': 'file is too long; split along cohesive seams.',
  'comment-density': 'public symbol added without a JSDoc preamble.',
  'magic-numbers': 'large numeric literal inline rather than as a named constant.',
  'duplicate-imports': 'two imports from the same module that should consolidate.',
  'deep-nesting': 'indent depth exceeds repo convention; flatten with early returns / helpers.',
  'todo-without-ticket': 'TODO/FIXME/XXX without a tracker reference.',
  'console-logging': 'console.log/debug in production source.',
  'type-any': 'explicit `any` annotation/cast in TS source.',
  'idiom-adherence': 'change doesn\'t match the project idiom (factory functions, Option E parameterised constructors).',
  'abstraction-quality': 'wrong abstraction layer chosen (function vs class vs module).',
  'suggested-refactor': 'readable but a clearer expression exists.',
  'test-design': 'tests assert on implementation details rather than behaviour.',
  'error-handling-style': 'try/catch placement, recoverable vs unrecoverable, error-message clarity.',
  'architecture-pattern': 'change introduces a pattern when a better idiom exists in the repo.',
  'documentation-quality': 'README/comments don\'t accurately describe intent.',
  'api-ergonomics': 'public API is awkward to use correctly.'
};

const SYSTEM_PROMPT = `You are a craftsmanship-focused code reviewer for the CAIA monorepo. Your job is to suggest how the change could be cleaner, more readable, more idiomatic — but you do NOT block merges. You are advisory.

Tone: a senior engineer leaving thoughtful PR comments. Bias toward "consider" and "suggestion"; emit "nit" only for clear cosmetic improvements; emit "praise" when you see exemplary craftsmanship worth highlighting.

CRITICAL: do NOT flag any of the following — they belong to the sibling Critic agent and Reviewer must stay disjoint:
- security regressions, credential leaks, cost overruns
- hallucination, scope mismatch, wrong direction, lacking information
- premature completion, re-litigation, decision-classifier violations
- git/branch hygiene, tool misuse, CI flakes, recipe rot, false-modesty
- coordination failures, operator confusion, memory drift, incompleteness

Output STRICT JSON in the shape:
{"findings":[{"dimension":"<id>","severity":"praise|nit|suggestion|consider","file":"...","line":123,"suggestionTitle":"...","description":"...","suggestedChange":"...","excerpt":"..."}]}
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

## Craftsmanship dimensions
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
  return {
    async review(input: LlmReviewInput): Promise<LlmReviewOutput> {
      const prompt = buildPrompt(input);
      // A.9.13 — try local router for small diffs first; fall through
      // to claude-spawner on any failure. Off by default — set
      // CAIA_REVIEW_LOCAL_FIRST=1 to enable.
      const localOutput = await trySmallDiffLocalRouter(input, prompt);
      if (localOutput !== null) return localOutput;

      const result = await spawnClaude({
        prompt,
        options: {
          binaryPath: opts.binaryPath,
          model: opts.modelTag,
          timeoutMs: opts.timeoutMs,
          ...(opts.spawnFn !== undefined ? { spawnFn: opts.spawnFn } : {})
        }
      });
      if (!result.ok) {
        const diag = result.diagnostic ?? 'unknown failure';
        return {
          findings: [],
          ok: false,
          diagnostic: diag.startsWith('failed to spawn')
            ? `claude spawn error: ${diag.slice('failed to spawn '.length)}`
            : diag.startsWith('child process error')
              ? `claude spawn error: ${diag.slice('child process error: '.length)}`
              : diag
        };
      }
      return parseLlmOutput(result.stdout);
    }
  };
}

/**
 * A.9.13 — Local-router shortcut. Counts diff body lines across all
 * hunks; if under CAIA_REVIEW_LOCAL_DIFF_LINES_MAX (default 200) and
 * CAIA_REVIEW_LOCAL_FIRST=1, POSTs the same prompt to the local
 * router at /v1/chat/completions with caia_task_type=code-review-light.
 * Returns null on any error so the caller falls through to the claude
 * binary subprocess.
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
    .filter((f): f is Omit<CraftsmanshipFinding, 'id' | 'source' | 'detectorId'> => f !== null);
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

function sanitiseLlmFinding(raw: unknown): Omit<CraftsmanshipFinding, 'id' | 'source' | 'detectorId'> | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const dim = r['dimension'];
  if (typeof dim !== 'string') return null;
  // Reject anything that landed on Critic's denylist — defense in depth on
  // top of the prompt instruction.
  if (CRITIC_DENYLIST.has(dim)) return null;
  if (!ALL_DIMENSIONS.includes(dim as CraftsmanshipDimensionId)) return null;
  const dimension = dim as CraftsmanshipDimensionId;
  const file = typeof r['file'] === 'string' ? r['file'] : '';
  if (file === '') return null;
  const line = typeof r['line'] === 'number' && Number.isFinite(r['line']) ? r['line'] : 0;
  const suggestionTitle = typeof r['suggestionTitle'] === 'string' && r['suggestionTitle'].length > 0
    ? r['suggestionTitle']
    : 'unspecified';
  const description = typeof r['description'] === 'string' ? r['description'] : '';
  if (description === '') return null;
  const sevRaw = r['severity'];
  const severity: CraftsmanshipSeverity = (sevRaw === 'praise' || sevRaw === 'nit' || sevRaw === 'suggestion' || sevRaw === 'consider')
    ? sevRaw
    : DEFAULT_SEVERITY[dimension];
  // Cap LLM-suggested severity at the dimension's default — we don't want a
  // chatty model promoting nits to "consider".
  const finalSev: CraftsmanshipSeverity = SEVERITY_RANK[severity] <= SEVERITY_RANK[DEFAULT_SEVERITY[dimension]]
    ? severity
    : DEFAULT_SEVERITY[dimension];
  const excerptRaw = typeof r['excerpt'] === 'string' ? r['excerpt'].slice(0, 200) : '';
  const suggestedChange = typeof r['suggestedChange'] === 'string' ? r['suggestedChange'] : undefined;

  const out: Omit<CraftsmanshipFinding, 'id' | 'source' | 'detectorId'> = {
    dimension,
    severity: finalSev,
    file,
    line,
    suggestionTitle,
    description,
    excerpt: excerptRaw
  };
  if (suggestedChange !== undefined) {
    out.suggestedChange = suggestedChange;
  }
  return out;
}
