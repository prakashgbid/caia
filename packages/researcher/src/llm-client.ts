/**
 * LlmClient — claude binary subprocess wrapper.
 *
 * Mirrors the canonical pattern in `packages/critic/src/llm-reasoner.ts` and
 * `packages/apprentice-corpus/src/distiller.ts`. Subscription-only:
 * `delete env['ANTHROPIC_API_KEY']` before spawn so the binary falls through
 * to the keychain / OAuth subscription session, never per-token billing
 * (`feedback_no_api_key_billing.md`).
 *
 * `claude --print --output-format json` returns:
 *
 *   { "result": "<assistant text>", "is_error": false, ... }
 *
 * — we extract `result` as the LLM's text. We ALSO check `is_error` and
 * `api_error_status` because rate-limited responses can return exit 0 with
 * `is_error: true` and `api_error_status: 429`. The caller treats those as
 * non-ok so the agent surfaces a useful diagnostic instead of trying to
 * parse the rate-limit message as a synthesis result.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

import type { LlmClient, LlmCompletion } from './types.js';

export interface DefaultLlmClientOptions {
  binaryPath: string;
  /** Test seam — replaces `child_process.spawnSync`. */
  spawnFn?: (
    cmd: string,
    args: readonly string[],
    opts: {
      input: string;
      encoding: 'utf-8';
      timeout: number;
      env: NodeJS.ProcessEnv;
      maxBuffer: number;
    }
  ) => SpawnSyncReturns<string>;
}

const MAX_BUFFER = 50 * 1024 * 1024; // 50 MB — synthesis can be large

export function createDefaultLlmClient(opts: DefaultLlmClientOptions): LlmClient {
  const spawn: NonNullable<DefaultLlmClientOptions['spawnFn']> =
    opts.spawnFn ??
    ((cmd, args, sopts): SpawnSyncReturns<string> =>
      spawnSync(cmd, args as readonly string[], sopts) as SpawnSyncReturns<string>);
  return {
    async complete(input: {
      prompt: string;
      timeoutMs: number;
      model?: string;
    }): Promise<LlmCompletion> {
      // A.9.13 — small-payload research questions route to the local
      // router first; fall through to claude on any failure. Off by
      // default (CAIA_REVIEW_LOCAL_FIRST=1 to enable). Researcher has
      // no diff hunks so we gate on prompt byte size — default 16 KB
      // (override via CAIA_RESEARCH_LOCAL_BYTES_MAX). Larger prompts
      // (e.g. multi-source synthesis) still escalate to claude.
      const localOutput = await trySmallPayloadLocalRouter(input);
      if (localOutput !== null) return localOutput;

      const env = { ...process.env };
      delete env['ANTHROPIC_API_KEY'];
      const args: string[] = ['--print', '--output-format', 'json'];
      if (input.model !== undefined && input.model.length > 0) {
        args.push('--model', input.model);
      }
      let result: SpawnSyncReturns<string>;
      try {
        result = spawn(opts.binaryPath, args, {
          input: input.prompt,
          encoding: 'utf-8',
          timeout: input.timeoutMs,
          env,
          maxBuffer: MAX_BUFFER
        });
      } catch (e) {
        return {
          text: '',
          ok: false,
          diagnostic: `spawn threw: ${(e as Error).message}`
        };
      }
      if (result.error !== null && result.error !== undefined) {
        return {
          text: '',
          ok: false,
          diagnostic: `claude spawn error: ${result.error.message}`
        };
      }
      if (result.status !== 0) {
        const stderr = (result.stderr ?? '').toString().slice(0, 600);
        const stdout = (result.stdout ?? '').toString();
        // Some failure modes (rate-limit) emit a JSON envelope on stdout
        // even with non-zero exit. Surface both for the diagnostic.
        const tail =
          stdout.length > 0
            ? `${stderr} | stdout: ${stdout.slice(0, 400)}`
            : stderr;
        return {
          text: '',
          ok: false,
          diagnostic: `claude exited ${result.status}: ${tail}`
        };
      }
      const stdout = (result.stdout ?? '').toString();
      return parseEnvelope(stdout);
    }
  };
}

/** Parse `claude --print --output-format json` envelope, returning `result`. */
export function parseEnvelope(stdout: string): LlmCompletion {
  if (stdout.trim().length === 0) {
    return { text: '', ok: false, diagnostic: 'empty stdout' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    return {
      text: '',
      ok: false,
      diagnostic: `outer JSON parse: ${(e as Error).message}`
    };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { text: '', ok: false, diagnostic: 'envelope not an object' };
  }
  const env = parsed as {
    result?: unknown;
    is_error?: unknown;
    api_error_status?: unknown;
  };
  // Rate-limit / API-error responses come back with `is_error: true` even on
  // exit 0. Surface a useful diagnostic instead of trying to parse the
  // rate-limit message as a synthesis result.
  if (env.is_error === true) {
    const status =
      typeof env.api_error_status === 'number'
        ? `status=${env.api_error_status}`
        : '';
    const msg = typeof env.result === 'string' ? env.result : '';
    return {
      text: '',
      ok: false,
      diagnostic: `claude api_error ${status}: ${msg.slice(0, 200)}`.trim()
    };
  }
  if (typeof env.result !== 'string') {
    return { text: '', ok: false, diagnostic: 'envelope.result not a string' };
  }
  return { text: env.result, ok: true };
}

/**
 * A.9.13 — Try the local router for small research prompts. Returns
 * null on any failure so the caller falls through to the claude binary
 * subprocess. NEVER throws.
 */
async function trySmallPayloadLocalRouter(input: {
  prompt: string;
  timeoutMs: number;
  model?: string;
}): Promise<LlmCompletion | null> {
  if (process.env['CAIA_REVIEW_LOCAL_FIRST'] !== '1') return null;
  const maxBytes = parseEnvInt(
    process.env['CAIA_RESEARCH_LOCAL_BYTES_MAX'],
    16 * 1024,
  );
  const bytes = Buffer.byteLength(input.prompt, 'utf-8');
  if (bytes === 0 || bytes > maxBytes) return null;

  const routerBaseUrl =
    process.env['ROUTER_BASE_URL'] ?? 'http://127.0.0.1:7411';
  const model =
    process.env['CAIA_RESEARCH_LOCAL_MODEL'] ?? 'qwen2.5-coder:14b';
  const timeoutMs = parseEnvInt(
    process.env['CAIA_RESEARCH_LOCAL_TIMEOUT_MS'],
    Math.min(input.timeoutMs, 60_000),
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
          messages: [{ role: 'user', content: input.prompt }],
          temperature: 0.2,
          caia_task_type: 'research-summary',
        }),
        signal: ac.signal,
      });
      if (!r.ok) return null;
      const body = (await r.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = body.choices?.[0]?.message?.content ?? '';
      if (text === '') return null;
      return { text, ok: true };
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

/**
 * Best-effort extraction of the first balanced JSON object from a string. Used
 * to handle cases where the LLM emits prose around its JSON despite being
 * told not to (defensive — the prompt asks for strict JSON).
 */
export function extractFirstJsonBlock(text: string): string | null {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}
