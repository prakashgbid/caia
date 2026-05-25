/**
 * LLM caller — mirror of @caia/interviewer's pattern for test injectability.
 *
 * Subscription-only: `DefaultLlmCaller` wraps `@chiefaia/claude-spawner`
 * and sets `rejectIfApiKeyPresent: true`. There is NO API-key escape
 * hatch. Tests use `ScriptedLlmCaller`.
 */

import { ProposalGeneratorError } from './errors.js';

export interface LlmCallOptions {
  systemPrompt?: string;
  modelHint?: 'opus' | 'sonnet' | 'haiku' | (string & {});
  maxBudgetMs?: number;
}

export interface LlmCallResult {
  ok: boolean;
  text: string;
  durationMs: number;
  diagnostic: string | null;
  modelUsed: string;
}

export interface LlmCaller {
  call(prompt: string, opts?: LlmCallOptions): Promise<LlmCallResult>;
}

// ---------- Production caller (lazy claude-spawner) -----------------------

const DEFAULT_MODEL = 'claude-sonnet-4-6';

export class DefaultLlmCaller implements LlmCaller {
  public constructor(
    private readonly opts: {
      binaryPath?: string;
      defaultModel?: string;
      defaultTimeoutMs?: number;
      cwdAllowList?: readonly string[];
    } = {},
  ) {}

  public async call(prompt: string, opts: LlmCallOptions = {}): Promise<LlmCallResult> {
    // Lazy import — the spawner is heavy; production needs it, tests don't.
    let spawner: {
      spawnClaude: (input: unknown) => Promise<{
        ok: boolean;
        stdout: string;
        durationMs: number;
        diagnostic?: string;
      }>;
      parseClaudeJsonEnvelope: (s: string) => { ok: true; text: string } | { ok: false; diagnostic: string };
    };
    try {
      spawner = (await import('@chiefaia/claude-spawner')) as unknown as typeof spawner;
    } catch (err) {
      throw new ProposalGeneratorError(
        'llm_call_failed',
        '@chiefaia/claude-spawner not loadable',
        err,
      );
    }

    const model =
      typeof opts.modelHint === 'string'
        ? resolveModelHint(opts.modelHint)
        : this.opts.defaultModel ?? DEFAULT_MODEL;
    const timeoutMs = opts.maxBudgetMs ?? this.opts.defaultTimeoutMs ?? 120_000;
    const wrapped = opts.systemPrompt ? `<system>${opts.systemPrompt}</system>\n\n${prompt}` : prompt;

    const spawnArgs: Record<string, unknown> = {
      prompt: wrapped,
      options: {
        model,
        timeoutMs,
        outputFormat: 'json',
        ...(this.opts.binaryPath !== undefined ? { binaryPath: this.opts.binaryPath } : {}),
      },
      constraints: {
        rejectIfApiKeyPresent: true,
        ...(this.opts.cwdAllowList !== undefined ? { cwdAllowList: this.opts.cwdAllowList } : {}),
      },
    };

    const result = await spawner.spawnClaude(spawnArgs);
    if (!result.ok) {
      return {
        ok: false,
        text: '',
        durationMs: result.durationMs,
        diagnostic: result.diagnostic ?? 'spawnClaude returned ok=false',
        modelUsed: model,
      };
    }
    const parsed = spawner.parseClaudeJsonEnvelope(result.stdout);
    if (!parsed.ok) {
      return {
        ok: false,
        text: '',
        durationMs: result.durationMs,
        diagnostic: (parsed as { diagnostic: string }).diagnostic,
        modelUsed: model,
      };
    }
    return {
      ok: true,
      text: parsed.text,
      durationMs: result.durationMs,
      diagnostic: null,
      modelUsed: model,
    };
  }
}

function resolveModelHint(hint: string): string {
  switch (hint) {
    case 'opus':
      return 'claude-opus-4-6';
    case 'sonnet':
      return 'claude-sonnet-4-6';
    case 'haiku':
      return 'claude-haiku-4-5-20251001';
    default:
      return hint;
  }
}

// ---------- Test caller (scripted) ----------------------------------------

export type ScriptedResponse =
  | { kind: 'ok'; text: string }
  | { kind: 'fail'; diagnostic: string };

export class ScriptedLlmCaller implements LlmCaller {
  private readonly responses: ScriptedResponse[];
  private readonly callLog: { prompt: string; options: LlmCallOptions | undefined }[] = [];
  private cursor = 0;

  public constructor(responses: ScriptedResponse[]) {
    this.responses = [...responses];
  }

  public async call(prompt: string, opts?: LlmCallOptions): Promise<LlmCallResult> {
    const r = this.responses[this.cursor];
    if (r === undefined) {
      throw new Error(
        `ScriptedLlmCaller exhausted at cursor=${this.cursor}; prompt(prefix)="${prompt.slice(0, 80)}..."`,
      );
    }
    this.cursor += 1;
    this.callLog.push({ prompt, options: opts });
    if (r.kind === 'fail') {
      return { ok: false, text: '', durationMs: 1, diagnostic: r.diagnostic, modelUsed: 'scripted' };
    }
    return { ok: true, text: r.text, durationMs: 1, diagnostic: null, modelUsed: 'scripted' };
  }

  public log(): readonly { prompt: string; options: LlmCallOptions | undefined }[] {
    return [...this.callLog];
  }

  public callCount(): number {
    return this.cursor;
  }
}

/** Robust JSON extraction from an LLM text response (fenced or raw). */
const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;

export function extractJsonObject(text: string): unknown {
  if (!text || text.trim().length === 0) {
    throw new ProposalGeneratorError('llm_call_failed', 'empty LLM response');
  }
  const fenceMatch = FENCE_RE.exec(text);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      /* fall through */
    }
  }
  const firstBrace = text.indexOf('{');
  if (firstBrace >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = firstBrace; i < text.length; i++) {
      const c = text[i]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === '\\') {
        escaped = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          const chunk = text.slice(firstBrace, i + 1);
          try {
            return JSON.parse(chunk);
          } catch {
            // continue scanning
          }
        }
      }
    }
  }
  throw new ProposalGeneratorError(
    'llm_call_failed',
    `LLM response did not contain a parseable JSON object: ${text.slice(0, 200)}...`,
  );
}
