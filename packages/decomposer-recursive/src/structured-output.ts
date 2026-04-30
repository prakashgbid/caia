/**
 * Structured-output helper for LLM calls.
 *
 * Every classifier / decomposer in this package routes through
 * `@chiefaia/local-llm-router` and asks the model to emit JSON
 * conforming to a Zod schema. This helper:
 *
 *   1. Wraps the system+user prompt in a JSON-only envelope.
 *   2. Calls `route(taskType, prompt)`.
 *   3. Extracts JSON from the response (the model may wrap the JSON
 *      in markdown fences or surrounding prose; we tolerate both).
 *   4. Parses against the Zod schema.
 *   5. On parse failure, retries up to `maxRetries` times with the
 *      Zod error appended to the user prompt as feedback. (The
 *      rationale: this is the same reflexive-retry pattern Reflexion
 *      formalised — the model gets told what went wrong and tries
 *      again.)
 *
 * The helper does NOT enforce the cancellation signal — the underlying
 * router doesn't accept one in its current API. The orchestrator (PR 2)
 * checks `signal.aborted` between top-level recursion steps so a
 * cancel still bounds wall-clock by ~one outstanding LLM call.
 *
 * Cost tracking: PR 1 returns a coarse cost estimate from the routing
 * rule's claude cost string (per 1000 calls). PR 4 wires this through
 * to the spend-cap when Track 1 lands.
 */

import { z } from 'zod';
import { route } from '@chiefaia/local-llm-router';
import { perCallCostFromRuleString, getRoute } from '@chiefaia/local-llm-router';
import type { LLMResponse } from '@chiefaia/local-llm-router';

export interface StructuredOutputOptions {
  /** Routing-rule task type, e.g. 'po-decomposer-scope-detection'. */
  taskType: string;
  /** System-level instructions (role + invariants). */
  systemPrompt: string;
  /** User-level prompt (the actual data). */
  userPrompt: string;
  /** Max retries on Zod parse failure. Default 2 (so 3 attempts total). */
  maxRetries?: number;
  /** Optional cancellation signal — checked before each retry. */
  signal?: AbortSignal;
}

export interface StructuredOutputResult<T> {
  data: T;
  /** The raw text the model returned on the successful attempt. */
  rawResponse: string;
  /** Provider that won (telemetry). */
  provider: 'local' | 'claude';
  /** Concrete model that produced the response (telemetry). */
  model: string;
  /** Wall-clock ms across all attempts (sum). */
  durationMs: number;
  /** USD spend estimate across all attempts. */
  costUsd: number;
  /** Number of attempts taken (1-indexed). 1 = no retry. */
  attempts: number;
  /** Token usage on the WINNING attempt. */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/**
 * Thrown when even the last retry produced output that doesn't
 * conform to the schema. The caller sees the final Zod error and the
 * model's last raw response so it can decide to escalate (model
 * swap, file a `decomposition-stuck` blocker, or surface to dashboard).
 */
export class StructuredOutputParseError extends Error {
  public readonly attempts: number;
  public readonly lastRaw: string;
  public readonly zodError: z.ZodError;
  public readonly taskType: string;

  constructor(
    taskType: string,
    attempts: number,
    lastRaw: string,
    zodError: z.ZodError,
  ) {
    super(
      `[decomposer-recursive] structured-output parse failed for task ` +
        `"${taskType}" after ${String(attempts)} attempt(s): ` +
        zodError.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
    this.name = 'StructuredOutputParseError';
    this.taskType = taskType;
    this.attempts = attempts;
    this.lastRaw = lastRaw;
    this.zodError = zodError;
  }
}

/**
 * Thrown when the user passed an `AbortSignal` and it fired before /
 * during a retry. The orchestrator catches this to short-circuit
 * recursion.
 */
export class StructuredOutputCancelled extends Error {
  constructor(taskType: string) {
    super(`[decomposer-recursive] cancelled before completing "${taskType}"`);
    this.name = 'StructuredOutputCancelled';
  }
}

const JSON_ONLY_INSTRUCTION =
  '\n\nReturn ONLY a single JSON object that matches the schema described above. ' +
  'No markdown fences, no surrounding prose, no explanations. ' +
  'If you cannot answer, return JSON with the best-effort fields populated and ' +
  'a low confidence value — never return prose.';

/**
 * Run an LLM call expecting a Zod-shaped JSON response, with bounded
 * retry on parse failure.
 */
export async function callStructured<T extends z.ZodTypeAny>(
  schema: T,
  options: StructuredOutputOptions,
): Promise<StructuredOutputResult<z.infer<T>>> {
  const maxRetries = options.maxRetries ?? 2;
  const totalAttempts = maxRetries + 1;

  let totalDurationMs = 0;
  let totalCostUsd = 0;
  let lastRaw = '';
  let lastZodError: z.ZodError | null = null;

  let userPrompt = options.userPrompt;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    if (options.signal?.aborted) {
      throw new StructuredOutputCancelled(options.taskType);
    }

    const fullPrompt =
      `${options.systemPrompt}${JSON_ONLY_INSTRUCTION}\n\n` +
      `=== USER ===\n${userPrompt}\n=== END USER ===`;

    let resp: LLMResponse;
    try {
      resp = await route(options.taskType, fullPrompt);
    } catch (err) {
      // Network / model errors propagate. The caller decides whether
      // to escalate or retry at a higher level (model swap, etc.).
      throw err;
    }

    totalDurationMs += resp.durationMs;
    totalCostUsd += estimateCallCost(options.taskType, resp);
    lastRaw = resp.response;

    const json = extractJson(resp.response);
    if (json === null) {
      lastZodError = new z.ZodError([
        {
          code: 'custom',
          path: [],
          message:
            'No JSON object found in model response — wrap the answer in a single { ... } object.',
        },
      ]);
    } else {
      const parseResult = schema.safeParse(json);
      if (parseResult.success) {
        return {
          data: parseResult.data as z.infer<T>,
          rawResponse: resp.response,
          provider: resp.provider,
          model: resp.model,
          durationMs: totalDurationMs,
          costUsd: totalCostUsd,
          attempts: attempt,
          ...(resp.usage ? { usage: resp.usage } : {}),
        };
      }
      lastZodError = parseResult.error;
    }

    // If we have retries left, append the parse error and try again.
    if (attempt < totalAttempts && lastZodError) {
      userPrompt =
        `${options.userPrompt}\n\n=== PRIOR-ATTEMPT FAILURE ===\n` +
        `Your previous response did not parse against the required schema. ` +
        `The validator reported:\n` +
        lastZodError.issues
          .map((iss) => ` - ${iss.path.join('.') || '(root)'}: ${iss.message}`)
          .join('\n') +
        `\nFix every listed issue and return ONLY a single JSON object.`;
    }
  }

  throw new StructuredOutputParseError(
    options.taskType,
    totalAttempts,
    lastRaw,
    lastZodError ?? new z.ZodError([]),
  );
}

/**
 * Best-effort JSON extractor. Tries:
 *   1. Raw `JSON.parse` of the whole response.
 *   2. Stripping markdown fences (```json ... ``` or ``` ... ```).
 *   3. Greedy match for the outermost `{...}` block.
 *
 * Returns the parsed object, or `null` if no JSON object is recoverable.
 */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();

  // Direct parse.
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Fall through.
  }

  // Markdown-fence parse.
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenceMatch && fenceMatch[1]) {
    const inner = fenceMatch[1].trim();
    try {
      return JSON.parse(inner) as unknown;
    } catch {
      // Fall through.
    }
  }

  // Outermost-object parse.
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const slice = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(slice) as unknown;
    } catch {
      // Fall through.
    }
  }

  return null;
}

/**
 * Estimate the per-call USD spend by reading the rule's
 * `estimatedCostClaude` string ("$X per 1000 calls") and dividing by 1000.
 *
 * The estimate is intentionally coarse: it's used for the audit-row
 * `costUsd` field and for the spend-guard pre-check (PR 4 wires that).
 * Production cost-attribution would require token-level pricing.
 */
function estimateCallCost(taskType: string, resp: LLMResponse): number {
  // Local calls are free.
  if (resp.provider === 'local') return 0;
  const rule = getRoute(taskType);
  return perCallCostFromRuleString(rule.estimatedCostClaude);
}
