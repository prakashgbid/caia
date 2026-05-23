import { parseClaudeJsonEnvelope, spawnClaude } from '@chiefaia/claude-spawner';
import { InterviewerError } from './errors.js';
import type { LlmCallOptions, LlmCallResult, LlmCaller } from './types.js';

export interface DefaultLlmCallerOptions {
  readonly binaryPath?: string;
  readonly defaultModel?: string;
  readonly defaultTimeoutMs?: number;
  readonly cwdAllowList?: readonly string[];
}

const DEFAULT_MODEL = 'claude-opus-4-6';

export class DefaultLlmCaller implements LlmCaller {
  public constructor(private readonly opts: DefaultLlmCallerOptions = {}) {}

  public async call(prompt: string, opts: LlmCallOptions = {}): Promise<LlmCallResult> {
    const model = typeof opts.modelHint === 'string' ? resolveModelHint(opts.modelHint) : (this.opts.defaultModel ?? DEFAULT_MODEL);
    const timeoutMs = opts.maxBudgetMs ?? this.opts.defaultTimeoutMs ?? 90_000;
    const wrapped = opts.systemPrompt ? `<system>${opts.systemPrompt}</system>\n\n${prompt}` : prompt;
    const spawnOpts: Parameters<typeof spawnClaude>[0] = {
      prompt: wrapped,
      options: {
        model, timeoutMs,
        outputFormat: 'json' as const,
        ...(this.opts.binaryPath !== undefined ? { binaryPath: this.opts.binaryPath } : {}),
      },
      constraints: {
        rejectIfApiKeyPresent: true,
        ...(this.opts.cwdAllowList !== undefined ? { cwdAllowList: this.opts.cwdAllowList } : {}),
      },
    };
    const result = await spawnClaude(spawnOpts);
    if (!result.ok) {
      return { ok: false, text: '', durationMs: result.durationMs, diagnostic: result.diagnostic ?? 'spawnClaude returned ok=false', modelUsed: model };
    }
    const parsed = parseClaudeJsonEnvelope(result.stdout);
    if (!parsed.ok) {
      return { ok: false, text: '', durationMs: result.durationMs, diagnostic: (parsed as { ok: false; diagnostic: string }).diagnostic, modelUsed: model };
    }
    return { ok: true, text: parsed.text, durationMs: result.durationMs, diagnostic: null, modelUsed: model };
  }
}

function resolveModelHint(hint: string): string {
  switch (hint) {
    case 'opus': return 'claude-opus-4-6';
    case 'sonnet': return 'claude-sonnet-4-6';
    case 'haiku': return 'claude-haiku-4-5-20251001';
    default: return hint;
  }
}

const FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;

export function extractJsonObject(text: string): unknown {
  if (!text || text.trim().length === 0) throw new InterviewerError('llm_parse_error', 'empty LLM response');
  const fenceMatch = FENCE_RE.exec(text);
  if (fenceMatch && fenceMatch[1]) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* fall through */ }
  }
  const firstBrace = text.indexOf('{');
  if (firstBrace >= 0) {
    let depth = 0; let inString = false; let escaped = false;
    for (let i = firstBrace; i < text.length; i++) {
      const c = text[i]!;
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          const chunk = text.slice(firstBrace, i + 1);
          try { return JSON.parse(chunk); }
          catch {
            i = text.indexOf('{', i + 1);
            if (i < 0) break;
            depth = 0; inString = false;
          }
        }
      }
    }
  }
  try { return JSON.parse(text.trim()); }
  catch (e) { throw new InterviewerError('llm_parse_error', `could not extract JSON: ${(e as Error).message}`, { preview: text.slice(0, 200) }); }
}

export interface ScriptedLlmStep {
  readonly match: string | RegExp;
  readonly response: string | object;
  readonly delayMs?: number;
}

export class ScriptedLlmCaller implements LlmCaller {
  private readonly callLog: { prompt: string; response: string }[] = [];
  private readonly hitCounts = new Map<number, number>();
  public constructor(private readonly steps: readonly ScriptedLlmStep[], private readonly defaultResponse?: string) {}

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
