/**
 * Interviewer LLM caller.
 *
 * BREAKING CHANGE (2026-08-26): Replaced the old `@chiefaia/claude-spawner`
 * -backed DefaultLlmCaller with an OpenRouter-backed implementation per
 * the [[openrouter-only]] hard rule. All CAIA AI calls now route through
 * @caia/openrouter-client. The public LlmCaller/LlmCallOptions/LlmCallResult
 * contract is unchanged so downstream code (question-generator, critic,
 * business-plan accumulator) needs no edits.
 *
 * The `modelHint` field is now interpreted as:
 *   - 'opus' | 'sonnet' | 'haiku'  → 'auto' (paid tier, task-aware routing)
 *   - 'free' or unset              → 'free' (free-tier ladder)
 *   - anything else (bare string)  → passed through as an explicit
 *                                     OpenRouter model id
 */

import {
  callOpenRouter,
  extractJson as extractJsonFromClient,
  type ORCallOptions,
} from '@caia/openrouter-client';
import { InterviewerError } from './errors.js';
import type { LlmCallOptions, LlmCallResult, LlmCaller } from './types.js';

export interface DefaultLlmCallerOptions {
  /** Deprecated: kept in signature so callers still compile; ignored. */
  readonly binaryPath?: string;
  /** Default model selection when none specified in the call. */
  readonly defaultModel?: 'free' | 'auto' | string;
  /** Default per-call timeout in ms. Defaults to 90_000. */
  readonly defaultTimeoutMs?: number;
  /** Deprecated: ignored (was used by claude-spawner constraints). */
  readonly cwdAllowList?: readonly string[];
  /**
   * Optional purpose label suffix, e.g. 'interview' → all calls get
   * purpose='interview.<step>'. Defaults to 'interviewer'.
   */
  readonly purposePrefix?: string;
  /** Optional tenant id for BYOK key resolution. */
  readonly tenantId?: string | null;
}

const DEFAULT_MODEL: 'free' | 'auto' | string = 'free';

function resolveModelHint(hint: string | undefined): 'free' | 'auto' | string {
  if (!hint || hint === '') return DEFAULT_MODEL;
  if (hint === 'free' || hint === 'auto') return hint;
  if (hint === 'opus' || hint === 'sonnet' || hint === 'haiku') return 'auto';
  return hint;
}

/**
 * OpenRouter-backed LlmCaller. Drop-in replacement for the old
 * claude-spawner version.
 */
export class DefaultLlmCaller implements LlmCaller {
  public constructor(private readonly opts: DefaultLlmCallerOptions = {}) {}

  public async call(prompt: string, opts: LlmCallOptions = {}): Promise<LlmCallResult> {
    const model = resolveModelHint(opts.modelHint) ?? this.opts.defaultModel ?? DEFAULT_MODEL;
    const timeoutMs = opts.maxBudgetMs ?? this.opts.defaultTimeoutMs ?? 90_000;
    const purpose = `${this.opts.purposePrefix ?? 'interviewer'}.call`;
    const orOpts: ORCallOptions = {
      purpose,
      userPrompt: prompt,
      model,
      timeoutMs,
      maxTokens: 4096,
    };
    if (opts.systemPrompt) orOpts.systemPrompt = opts.systemPrompt;
    if (this.opts.tenantId !== undefined) orOpts.tenantId = this.opts.tenantId;

    const r = await callOpenRouter(orOpts);
    if (r.ok === true) {
      return {
        ok: true,
        text: r.text,
        durationMs: r.latencyMs,
        diagnostic: null,
        modelUsed: r.model,
      };
    }
    const tried = r.modelsAttempted.join(',');
    const last = r.modelsAttempted[r.modelsAttempted.length - 1] ?? model;
    return {
      ok: false,
      text: '',
      durationMs: r.latencyMs,
      diagnostic: `openrouter: ${r.error} (retryable=${r.retryable}, attempts=${r.attempts}, tried=${tried})`,
      modelUsed: last,
    };
  }
}

/**
 * Extract a JSON object from a possibly-prose-wrapped LLM response.
 * Kept for backwards compatibility — thin wrapper over the client's
 * extractJson, but raises InterviewerError on failure to match the
 * downstream error-handling contract.
 */
export function extractJsonObject(text: string): unknown {
  if (!text || text.trim().length === 0) {
    throw new InterviewerError('llm_parse_error', 'empty LLM response');
  }
  const r = extractJsonFromClient(text);
  if (r.ok !== true) throw new InterviewerError('llm_parse_error', `no JSON in response: ${r.reason}`);
  return r.value;
}

/**
 * A scripted LLM caller for tests. Matches prompts against step patterns
 * (string include or RegExp test) and returns the associated canned
 * response. Preserves the pre-refactor contract used by the interviewer
 * test suite (hits(), totalCalls(), log(), defaultResponse fallback).
 */
export interface ScriptedLlmStep {
  readonly match: string | RegExp;
  readonly response: string | object;
  readonly delayMs?: number;
}

export class ScriptedLlmCaller implements LlmCaller {
  private readonly callLog: { prompt: string; response: string }[] = [];
  private readonly hitCounts = new Map<number, number>();
  public constructor(
    private readonly steps: readonly ScriptedLlmStep[],
    private readonly defaultResponse?: string,
  ) {}

  public async call(prompt: string, _opts?: LlmCallOptions): Promise<LlmCallResult> {
    void _opts;
    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i]!;
      const matches = typeof step.match === 'string' ? prompt.includes(step.match) : step.match.test(prompt);
      if (matches) {
        this.hitCounts.set(i, (this.hitCounts.get(i) ?? 0) + 1);
        const text = typeof step.response === 'string' ? step.response : JSON.stringify(step.response);
        if (step.delayMs && step.delayMs > 0) await new Promise<void>((r) => setTimeout(r, step.delayMs));
        this.callLog.push({ prompt, response: text });
        return { ok: true, text, durationMs: step.delayMs ?? 1, diagnostic: null, modelUsed: 'scripted' };
      }
    }
    if (this.defaultResponse !== undefined) {
      this.callLog.push({ prompt, response: this.defaultResponse });
      return { ok: true, text: this.defaultResponse, durationMs: 1, diagnostic: null, modelUsed: 'scripted' };
    }
    return { ok: false, text: '', durationMs: 0, diagnostic: `no scripted step matched (prompt preview: ${prompt.slice(0, 120)})`, modelUsed: 'scripted' };
  }

  public log(): ReadonlyArray<{ prompt: string; response: string }> { return [...this.callLog]; }
  public hits(stepIndex: number): number { return this.hitCounts.get(stepIndex) ?? 0; }
  public totalCalls(): number { return this.callLog.length; }
}
