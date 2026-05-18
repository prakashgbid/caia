// messages-api.ts — SPS gateway MVP (2026-05-17).
//
// Adds two client-scoped paths over the existing router:
//   POST /cowork/v1/messages            Anthropic Messages shape, conditional policy
//   POST /cowork/v1/chat/completions    OpenAI Chat shape,        conditional policy
//   POST /openclaw/v1/messages          Anthropic Messages shape, local-only policy
//   POST /openclaw/v1/chat/completions  OpenAI Chat shape,        local-only policy
//
// Policy:
//   openclaw → ALL prompts route local. If classifier returns
//     recommended_tier='claude' or needs_escalation=true, we return
//     HTTP 503 with an explicit local-only error. NO cloud fallback.
//
//   2026-05-18 patch (Bug 1 — operator-observed cascade): the classifier's
//   abstain path defaults novel/short prompts (e.g. "what is 2+2") to
//   intent='unknown', confidence=0.3, recommended_tier='claude'. For
//   openclaw that defaulted straight into 503 local-only-policy-block
//   even on trivial prompts, then the failure cascade left empty
//   assistant turns in the session JSONL which the TUI renders as
//   '[object Object]' on subsequent turns (the operator-observed Bug 2
//   was downstream of Bug 1). The 503 should only fire for HIGH-confidence
//   cloud-required prompts. Low-confidence unknowns FALL BACK TO LOCAL —
//   try the local model rather than block. See OPENCLAW_LOW_CONFIDENCE_*
//   constants + decidePolicy() below.
//
//   cowork → conditional. Classifier picks:
//     local-*  → serve locally via routerRoute(forceLocal:true)
//     claude   → forward to Headroom proxy at 127.0.0.1:8787, which compresses
//                + forwards to api.anthropic.com using the inbound OAuth
//                Bearer header. NEVER injects an API key.
//
// SSE on local path is SYNTHESIZED from the final completion (the router's
// underlying ollama-adapter is non-streaming as of 2026-05-17). SSE on the
// cloud path is passed through unchanged from Headroom → caller. This is an
// MVP limitation; true token-by-token streaming on local path is a follow-up.
//
// Standing rule (feedback_billing.md, 2026-05-14):
//   Subscription / first-party auth only. Cloud path forwards inbound
//   Authorization/x-api-key headers unchanged. We do NOT synthesize API keys.
//   429 from upstream surfaces to the caller as-is — NO alternate-model fallback.

import type { Context } from 'hono';
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { classify, type IntentResult } from './classifier.js';
import { route as routerRoute } from './router.js';

export type SpsClient = 'cowork' | 'openclaw';

const HEADROOM_BASE_URL = process.env['SPS_HEADROOM_BASE_URL'] ?? 'http://127.0.0.1:8787';

// 2026-05-18 (Bug 1): openclaw low-confidence fallback to local.
//
// When the classifier abstains on a novel/short prompt it emits
// intent='unknown' with confidence ≤ 0.3 and recommended_tier='claude'
// (see classifier.ts abstainResult / tierForIntent default). The local
// model can almost always handle these — they're typically trivial
// ("what is 2+2", "say hi", "ping") that the classifier just couldn't
// label. Block ONLY when the classifier is genuinely confident the
// prompt exceeds local capability. Threshold chosen so the classifier's
// own "ambiguous → unknown + confidence < 0.5" hint (system-prompt
// instruction) maps to "try local anyway".
const OPENCLAW_LOW_CONFIDENCE_THRESHOLD = 0.5;
const OPENCLAW_LOW_CONFIDENCE_FALLBACK_TIER = 'local-7b';

// 2026-05-18 (Bug 2 — defensive): if upstream serialization bugs (TUI,
// LiteLLM adapter, or our own JSON.stringify slips) inject the literal
// '[object Object]' into a message content, the local model will start
// hallucinating "JavaScript serialization artifact" explanations
// instead of answering the actual prompt. Strip it before classify +
// before dispatching to the local model. We log a warning so the source
// can be traced — if this fires, there's a real upstream bug to fix.
const OBJECT_OBJECT_LITERAL = /\[object Object\]/g;

// Anthropic Messages request — minimal schema we care about.
interface AnthropicContentBlock {
  type: string;
  text?: string;
  // tool_use / tool_result fields are passed through opaquely.
  [k: string]: unknown;
}
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}
interface AnthropicMessagesRequest {
  model?: string;
  messages: AnthropicMessage[];
  system?: string | AnthropicContentBlock[];
  max_tokens?: number;
  stream?: boolean;
  tools?: unknown[];
  temperature?: number;
  metadata?: unknown;
}

// OpenAI chat-completions request — minimal schema we care about.
interface OpenAIChatRequest {
  model?: string;
  messages: Array<{ role: string; content: string | AnthropicContentBlock[] }>;
  max_tokens?: number;
  stream?: boolean;
  temperature?: number;
  caia_task_type?: string;
}

// Headers we propagate untouched on cloud-bound requests.
const PASSTHROUGH_HEADERS = [
  'authorization',
  'x-api-key',
  'anthropic-version',
  'anthropic-beta',
  'anthropic-dangerous-direct-browser-access',
  'user-agent',
  'x-stainless-helper-method',
  'x-stainless-lang',
  'x-stainless-package-version',
  'x-stainless-runtime',
  'x-stainless-runtime-version',
] as const;

function flattenContent(c: AnthropicMessage['content']): string {
  if (typeof c === 'string') return c;
  return c
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text ?? '')
    .join('\n');
}
function flattenSystem(s: AnthropicMessagesRequest['system']): string {
  if (s === undefined) return '';
  if (typeof s === 'string') return s;
  return s
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text ?? '')
    .join('\n');
}
function joinMessagesAsPrompt(messages: AnthropicMessage[]): string {
  return messages.map((m) => flattenContent(m.content)).join('\n\n');
}

/**
 * Strip the literal '[object Object]' from text content blocks across an
 * Anthropic-shape messages array. Mutates the array in place. Returns the
 * count of stripped occurrences (callers log when > 0 so upstream
 * serialization bugs become visible).
 */
function sanitizeObjectObjectMessages(messages: AnthropicMessage[]): number {
  let hits = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      if (OBJECT_OBJECT_LITERAL.test(m.content)) {
        const stripped = m.content.replace(OBJECT_OBJECT_LITERAL, '');
        hits += m.content.length !== stripped.length ? 1 : 0;
        m.content = stripped;
      }
      continue;
    }
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === 'text' && typeof b.text === 'string' &&
          OBJECT_OBJECT_LITERAL.test(b.text)) {
        const before = b.text;
        b.text = b.text.replace(OBJECT_OBJECT_LITERAL, '');
        if (before.length !== b.text.length) hits += 1;
      }
    }
  }
  return hits;
}

/** Same defense for OpenAI-chat-shape messages. */
function sanitizeObjectObjectChat(
  messages: Array<{ role: string; content: string | AnthropicContentBlock[] }>,
): number {
  let hits = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      if (OBJECT_OBJECT_LITERAL.test(m.content)) {
        const stripped = m.content.replace(OBJECT_OBJECT_LITERAL, '');
        if (m.content.length !== stripped.length) hits += 1;
        m.content = stripped;
      }
      continue;
    }
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === 'text' && typeof b.text === 'string' &&
          OBJECT_OBJECT_LITERAL.test(b.text)) {
        const before = b.text;
        b.text = b.text.replace(OBJECT_OBJECT_LITERAL, '');
        if (before.length !== b.text.length) hits += 1;
      }
    }
  }
  return hits;
}

function logSanitization(
  client: SpsClient,
  shape: 'messages' | 'chat',
  hits: number,
): void {
  if (hits <= 0) return;
  const line = JSON.stringify({
    sps_gw: true,
    ts: new Date().toISOString(),
    client,
    shape,
    warning: 'object-object-literal-stripped',
    hits,
    note:
      'Incoming message content contained literal "[object Object]". ' +
      'Upstream serialization bug — trace TUI/LiteLLM/adapter chain.',
  });
  process.stderr.write(`${line}\n`);
}

type PolicyDecision =
  | { kind: 'local'; reason: string; tier: string }
  | { kind: 'cloud'; reason: string; tier: string }
  | { kind: 'local-only-block'; reason: string; tier: string };

function decidePolicy(client: SpsClient, intent: IntentResult): PolicyDecision {
  const wantsCloud =
    intent.recommended_tier === 'claude' || intent.needs_escalation;
  const tier = intent.recommended_tier;
  if (client === 'openclaw') {
    if (wantsCloud) {
      // Bug 1 (2026-05-18): low-confidence-unknown override. The
      // classifier's abstain path returns tier='claude' even when it
      // means "I don't know" rather than "this needs Claude". Treat
      // "unknown or low confidence" as a vote for local, not for the
      // 503 block. The block stays for high-confidence cloud-required
      // prompts (e.g. confident new-design/architect with confidence ≥
      // OPENCLAW_LOW_CONFIDENCE_THRESHOLD).
      const isLowConfidenceUnknown =
        intent.intent === 'unknown' ||
        intent.confidence < OPENCLAW_LOW_CONFIDENCE_THRESHOLD;
      if (isLowConfidenceUnknown) {
        return {
          kind: 'local',
          reason:
            `openclaw low-confidence fallback to local ` +
            `(was tier=${tier}, intent=${intent.intent}, ` +
            `confidence=${intent.confidence}, threshold=${OPENCLAW_LOW_CONFIDENCE_THRESHOLD})`,
          tier: OPENCLAW_LOW_CONFIDENCE_FALLBACK_TIER,
        };
      }
      return {
        kind: 'local-only-block',
        reason: `tier=${tier}, needs_escalation=${intent.needs_escalation}, high-confidence-cloud (confidence=${intent.confidence})`,
        tier,
      };
    }
    return { kind: 'local', reason: `tier=${tier} (openclaw forced-local)`, tier };
  }
  // cowork
  if (wantsCloud) return { kind: 'cloud', reason: `tier=${tier}`, tier };
  return { kind: 'local', reason: `tier=${tier}`, tier };
}

function logDecision(
  client: SpsClient,
  shape: 'messages' | 'chat',
  intent: IntentResult,
  decision: PolicyDecision,
  promptLenChars: number,
): void {
  const line = JSON.stringify({
    sps_gw: true,
    ts: new Date().toISOString(),
    client,
    shape,
    intent: intent.intent,
    confidence: intent.confidence,
    recommended_tier: intent.recommended_tier,
    needs_escalation: intent.needs_escalation,
    decision: decision.kind,
    decision_reason: decision.reason,
    prompt_len_chars: promptLenChars,
  });
  // Single-line JSON to stderr so launchd's logfile captures it without
  // mingling with the existing console.log output.
  process.stderr.write(`${line}\n`);
}

function buildHeadroomHeaders(c: Context): Record<string, string> {
  const out: Record<string, string> = { 'content-type': 'application/json' };
  for (const h of PASSTHROUGH_HEADERS) {
    const v = c.req.header(h);
    if (typeof v === 'string' && v.length > 0) {
      out[h] = v;
    }
  }
  // Default anthropic-version if caller didn't set it.
  if (out['anthropic-version'] === undefined) {
    out['anthropic-version'] = '2023-06-01';
  }
  // Tag so Headroom logs can attribute calls to the gateway.
  out['x-sps-gateway'] = 'cowork-cloud-forward';
  return out;
}

async function forwardToHeadroom(
  c: Context,
  rawBody: string,
  pathSuffix: '/v1/messages' | '/v1/chat/completions',
): Promise<Response> {
  const url = `${HEADROOM_BASE_URL}${pathSuffix}`;
  const headers = buildHeadroomHeaders(c);
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: rawBody,
    });
  } catch (e) {
    return c.json(
      {
        type: 'error',
        error: {
          type: 'api_error',
          message: `headroom-unreachable: ${(e as Error).message}`,
        },
        caia: { gateway: 'sps', upstream_url: url },
      },
      502,
    );
  }
  // Pass status + body + headers back to caller unchanged.
  const respHeaders = new Headers();
  upstream.headers.forEach((v, k) => {
    // Skip headers that conflict with our streaming wrapper.
    const lk = k.toLowerCase();
    if (lk === 'content-length' || lk === 'transfer-encoding') return;
    respHeaders.set(k, v);
  });
  respHeaders.set('x-sps-gateway-decision', 'cloud-via-headroom');
  return new Response(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  });
}

async function serveLocalMessages(
  c: Context,
  body: AnthropicMessagesRequest,
  decision: PolicyDecision,
): Promise<Response> {
  const sysPrompt = flattenSystem(body.system);
  const userPrompt = joinMessagesAsPrompt(body.messages);
  const fullPrompt = sysPrompt.length > 0
    ? `${sysPrompt}\n\n---\n\n${userPrompt}`
    : userPrompt;

  // Use a synthesized task type so the routing-config falls through to its
  // local-default (qwen2.5-coder:7b). forceLocal:true means even an
  // adversarial-prefilter hit can't escalate — we surface that as an error.
  const taskType = 'sps-gw-messages';
  let llmRes;
  try {
    llmRes = await routerRoute(taskType, fullPrompt, {
      forceLocal: true,
      fallbackOnError: false,
    });
  } catch (e) {
    return c.json(
      {
        type: 'error',
        error: {
          type: 'api_error',
          message: `local-dispatch-failed: ${(e as Error).message}`,
        },
        caia: { gateway: 'sps', decision: decision.kind, tier: decision.tier },
      },
      502,
    );
  }

  const messageId = `msg_caia_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const responseText = llmRes.response;
  const usage = {
    input_tokens: llmRes.usage?.promptTokens ?? 0,
    output_tokens: llmRes.usage?.completionTokens ?? 0,
  };

  if (body.stream === true) {
    return streamSSE(c, async (stream) => {
      // Anthropic Messages SSE event stream.
      // ref: https://docs.anthropic.com/en/api/messages-streaming
      const msgStart = {
        type: 'message_start',
        message: {
          id: messageId,
          type: 'message',
          role: 'assistant',
          model: llmRes.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: usage.input_tokens, output_tokens: 0 },
        },
      };
      await stream.writeSSE({ event: 'message_start', data: JSON.stringify(msgStart) });
      await stream.writeSSE({
        event: 'content_block_start',
        data: JSON.stringify({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
      });
      // Slice the completion into pseudo-tokens so the consumer sees an SSE
      // shape it understands. ~80 chars/chunk is a reasonable midpoint
      // between event count and per-event overhead.
      const CHUNK = 80;
      for (let i = 0; i < responseText.length; i += CHUNK) {
        const piece = responseText.slice(i, i + CHUNK);
        await stream.writeSSE({
          event: 'content_block_delta',
          data: JSON.stringify({
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: piece },
          }),
        });
      }
      await stream.writeSSE({
        event: 'content_block_stop',
        data: JSON.stringify({ type: 'content_block_stop', index: 0 }),
      });
      await stream.writeSSE({
        event: 'message_delta',
        data: JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: usage.output_tokens },
        }),
      });
      await stream.writeSSE({
        event: 'message_stop',
        data: JSON.stringify({ type: 'message_stop' }),
      });
    });
  }

  return c.json({
    id: messageId,
    type: 'message',
    role: 'assistant',
    model: llmRes.model,
    content: [{ type: 'text', text: responseText }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage,
    caia: {
      gateway: 'sps',
      decision: decision.kind,
      tier: decision.tier,
      provider: llmRes.provider,
      duration_ms: llmRes.durationMs,
    },
  });
}

async function serveLocalChat(
  c: Context,
  body: OpenAIChatRequest,
  decision: PolicyDecision,
): Promise<Response> {
  const userPrompt = body.messages
    .map((m) => (typeof m.content === 'string' ? m.content : flattenContent(m.content)))
    .join('\n\n');
  const taskType = body.caia_task_type ?? 'sps-gw-chat';
  let llmRes;
  try {
    llmRes = await routerRoute(taskType, userPrompt, {
      forceLocal: true,
      fallbackOnError: false,
    });
  } catch (e) {
    return c.json(
      {
        error: 'local-dispatch-failed',
        message: (e as Error).message,
        caia: { gateway: 'sps', decision: decision.kind, tier: decision.tier },
      },
      502,
    );
  }
  return c.json({
    id: `caia-router-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: llmRes.model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: llmRes.response },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: llmRes.usage?.promptTokens ?? 0,
      completion_tokens: llmRes.usage?.completionTokens ?? 0,
      total_tokens: llmRes.usage?.totalTokens ?? 0,
    },
    caia: {
      gateway: 'sps',
      decision: decision.kind,
      tier: decision.tier,
      provider: llmRes.provider,
      duration_ms: llmRes.durationMs,
    },
  });
}

function localOnlyBlockMessages(c: Context, decision: PolicyDecision, intent: IntentResult): Response {
  return c.json(
    {
      type: 'error',
      error: {
        type: 'overloaded_error',
        message:
          'local-only policy: this prompt requires escalation but openclaw is local-only. ' +
          `(${decision.reason})`,
      },
      caia: {
        gateway: 'sps',
        client: 'openclaw',
        decision: 'local-only-block',
        recommended_tier: intent.recommended_tier,
        intent: intent.intent,
        confidence: intent.confidence,
        needs_escalation: intent.needs_escalation,
      },
    },
    503,
  );
}

function localOnlyBlockChat(c: Context, decision: PolicyDecision, intent: IntentResult): Response {
  return c.json(
    {
      error: 'local-only-policy-block',
      message:
        'local-only policy: this prompt requires escalation but openclaw is local-only. ' +
        `(${decision.reason})`,
      caia: {
        gateway: 'sps',
        client: 'openclaw',
        decision: 'local-only-block',
        recommended_tier: intent.recommended_tier,
        intent: intent.intent,
        confidence: intent.confidence,
        needs_escalation: intent.needs_escalation,
      },
    },
    503,
  );
}

// ─── public entrypoint ────────────────────────────────────────────────

interface MountOpts {
  ollamaBaseUrl: string;
  classifierModel: string;
}

export function mountClientRoutes(app: Hono, opts: MountOpts): void {
  for (const client of ['cowork', 'openclaw'] as const) {
    app.post(`/${client}/v1/messages`, (c) => handleMessagesPath(c, client, opts));
    app.post(`/${client}/v1/chat/completions`, (c) => handleChatPath(c, client, opts));
  }
}

async function handleMessagesPath(
  c: Context,
  client: SpsClient,
  opts: MountOpts,
): Promise<Response> {
  const rawBody = await c.req.text();
  let body: AnthropicMessagesRequest;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json(
      { type: 'error', error: { type: 'invalid_request_error', message: 'invalid-json' } },
      400,
    );
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json(
      { type: 'error', error: { type: 'invalid_request_error', message: 'messages required' } },
      400,
    );
  }
  // 2026-05-18 Bug 2 defensive sanitization (run BEFORE userText extraction
  // so classifier + local-dispatch both see clean text). If upstream
  // (TUI/LiteLLM/adapter) leaks '[object Object]' the local model would
  // hallucinate JS-serialization explanations rather than answer the
  // actual prompt; strip + warn so the upstream bug stays visible.
  const sanitizedHits = sanitizeObjectObjectMessages(body.messages);
  logSanitization(client, 'messages', sanitizedHits);

  const userText = joinMessagesAsPrompt(body.messages);
  if (userText.trim() === '') {
    return c.json(
      { type: 'error', error: { type: 'invalid_request_error', message: 'no-user-text' } },
      400,
    );
  }
  // Classifier sees just the user text (no system) so it doesn't get confused
  // by long system prompts. Cap at 4000 chars to keep latency reasonable.
  const classifierInput = userText.slice(0, 4000);
  let intent: IntentResult;
  try {
    intent = await classify(classifierInput, {
      model: opts.classifierModel,
      ollamaBaseUrl: opts.ollamaBaseUrl,
    });
  } catch (e) {
    return c.json(
      {
        type: 'error',
        error: { type: 'api_error', message: `classifier-failed: ${(e as Error).message}` },
      },
      500,
    );
  }
  const decision = decidePolicy(client, intent);
  logDecision(client, 'messages', intent, decision, userText.length);
  if (decision.kind === 'local-only-block') {
    return localOnlyBlockMessages(c, decision, intent);
  }
  if (decision.kind === 'cloud') {
    return forwardToHeadroom(c, rawBody, '/v1/messages');
  }
  return serveLocalMessages(c, body, decision);
}

async function handleChatPath(
  c: Context,
  client: SpsClient,
  opts: MountOpts,
): Promise<Response> {
  const rawBody = await c.req.text();
  let body: OpenAIChatRequest;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'invalid-json' }, 400);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ error: 'messages-required' }, 400);
  }
  // Strip caller-supplied `model` (same defense-in-depth as /v1/chat/completions
  // r-2 guard: callers must not pin a model on the gateway path).
  delete body.model;

  // 2026-05-18 Bug 2 defensive sanitization (see handleMessagesPath above).
  const sanitizedHits = sanitizeObjectObjectChat(body.messages);
  logSanitization(client, 'chat', sanitizedHits);

  const userText = body.messages
    .filter((m) => m.role !== 'system')
    .map((m) => (typeof m.content === 'string' ? m.content : flattenContent(m.content)))
    .join('\n\n');
  if (userText.trim() === '') {
    return c.json({ error: 'no-user-text' }, 400);
  }
  const classifierInput = userText.slice(0, 4000);
  let intent: IntentResult;
  try {
    intent = await classify(classifierInput, {
      model: opts.classifierModel,
      ollamaBaseUrl: opts.ollamaBaseUrl,
    });
  } catch (e) {
    return c.json({ error: 'classifier-failed', message: (e as Error).message }, 500);
  }
  const decision = decidePolicy(client, intent);
  logDecision(client, 'chat', intent, decision, userText.length);
  if (decision.kind === 'local-only-block') {
    return localOnlyBlockChat(c, decision, intent);
  }
  if (decision.kind === 'cloud') {
    // Cloud path on the OpenAI-shape: forward to Headroom too. Headroom's
    // proxy is Anthropic-Messages-native; LiteLLM-style cross-shape isn't
    // wired in this MVP. So for cowork cloud OpenAI-shape callers, we
    // return a 503 directing them to use the Messages shape.
    return c.json(
      {
        error: 'cloud-path-requires-messages-shape',
        message:
          'cowork cloud routing is wired through Headroom which is Anthropic-Messages-native. ' +
          'Use POST /cowork/v1/messages for cloud-bound traffic, or set a routing rule that pins this ' +
          'request to local via caia_task_type.',
        caia: { gateway: 'sps', client: 'cowork', decision: 'cloud-shape-mismatch', tier: decision.tier },
      },
      503,
    );
  }
  return serveLocalChat(c, body, decision);
}
