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

import { spawnClaude } from '@chiefaia/claude-spawner';
import type { spawn, spawnSync, SpawnSyncReturns } from 'node:child_process';

import type { LlmClient, LlmCompletion } from './types.js';

export interface DefaultLlmClientOptions {
  binaryPath: string;
  /**
   * Test seam — back-compat shim. New callers should use {@link spawnImpl}
   * which matches `@chiefaia/claude-spawner`'s `spawnFn` shape. Setting
   * `spawnFn` is a no-op now; the client routes through claude-spawner.
   */
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
  /**
   * Test seam — replaces `node:child_process.spawn` used by
   * `@chiefaia/claude-spawner`. Inject a fake child for testing.
   */
  spawnImpl?: typeof spawn;
}

export function createDefaultLlmClient(opts: DefaultLlmClientOptions): LlmClient {
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

      const result = await spawnClaude({
        prompt: input.prompt,
        options: {
          binaryPath: opts.binaryPath,
          ...(input.model !== undefined && input.model.length > 0 ? { model: input.model } : {}),
          timeoutMs: input.timeoutMs,
          ...(opts.spawnImpl !== undefined ? { spawnFn: opts.spawnImpl } : {})
        }
      });
      if (!result.ok) {
        const diag = result.diagnostic ?? 'unknown failure';
        // Preserve the legacy diagnostic shapes so consumers' regex
        // checks for "spawn threw" / "claude spawn error" / "claude exited"
        // still hit.
        if (diag.startsWith('failed to spawn')) {
          return {
            text: '',
            ok: false,
            diagnostic: `spawn threw: ${diag.slice('failed to spawn '.length)}`
          };
        }
        if (diag.startsWith('child process error')) {
          return {
            text: '',
            ok: false,
            diagnostic: `claude spawn error: ${diag.slice('child process error: '.length)}`
          };
        }
        if (result.rc !== null && result.rc !== 0) {
          const stderr = result.stderr.slice(0, 600);
          const tail =
            result.stdout.length > 0
              ? `${stderr} | stdout: ${result.stdout.slice(0, 400)}`
              : stderr;
          return {
            text: '',
            ok: false,
            diagnostic: `claude exited ${String(result.rc)}: ${tail}`
          };
        }
        return { text: '', ok: false, diagnostic: diag };
      }
      return parseEnvelope(result.stdout);
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
