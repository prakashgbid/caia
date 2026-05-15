// MCP server core for @chiefaia/local-llm-router-mcp.
//
// Tool surface (consumed by Cowork via MCP stdio):
//   local_classify(task_spec)         → IntentResult JSON
//   local_summarize(text, max_tokens) → summary string
//   local_draft(brief, max_tokens)    → drafted prose
//   local_format(text, instruction)   → reformatted text
//   local_search_memory(query, k)     → top-k memory results (embedding lookup)
//   local_optimize_prompt(...)        → 3-stage prompt optimizer (LAI phase 8)
//
// All RPC the local daemon at ROUTER_BASE_URL (default http://127.0.0.1:7411).
// The bin/ entrypoint imports `buildMcpServer` from here and wires it to stdio.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

export const DEFAULT_ROUTER_BASE_URL = 'http://127.0.0.1:7411';

interface ToolInput {
  task_spec?: string;
  text?: string;
  brief?: string;
  query?: string;
  instruction?: string;
  max_tokens?: number;
  k?: number;
  // local_optimize_prompt args
  user_question?: string;
  system_prompt?: string;
  tool_outputs?: Array<{ id: string; content: string; source?: 'file' | 'json' | 'shell' | 'opaque' }>;
  recent_reasoning?: string[];
  budget?: {
    stage2_ratio?: number;
    stage3_ratio?: number;
    skip_stages_under_tokens?: number;
    model?: string;
  };
}

export interface BuildOptions {
  routerBaseUrl?: string;
}

export function buildMcpServer(opts: BuildOptions = {}): Server {
  const routerBaseUrl = opts.routerBaseUrl ?? process.env['ROUTER_BASE_URL'] ?? DEFAULT_ROUTER_BASE_URL;

  const server = new Server(
    { name: 'caia-local-llm-router-mcp', version: '0.2.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'local_classify',
          description: 'Classify a task spec into a CAIA intent + recommended tier (local-7b/14b/32b/claude). Routes via the local-llm-router daemon at ' + routerBaseUrl + '. Use BEFORE invoking heavy reasoning to decide if the task can be served locally.',
          inputSchema: {
            type: 'object',
            properties: {
              task_spec: { type: 'string', description: 'The task description to classify.' },
            },
            required: ['task_spec'],
          },
        },
        {
          name: 'local_summarize',
          description: 'Summarize text via local 7B model. Use for tool outputs, log dumps, file contents that need to be compressed before reasoning. Returns ≤max_tokens of summary.',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Text to summarize.' },
              max_tokens: { type: 'integer', description: 'Hard cap on response tokens (default 800).', default: 800 },
            },
            required: ['text'],
          },
        },
        {
          name: 'local_draft',
          description: 'Draft a prose response (memo, status update, brief reply) via local 7B model.',
          inputSchema: {
            type: 'object',
            properties: {
              brief: { type: 'string', description: 'What to draft (prompt + context).' },
              max_tokens: { type: 'integer', description: 'Hard cap on response tokens (default 1200).', default: 1200 },
            },
            required: ['brief'],
          },
        },
        {
          name: 'local_format',
          description: 'Reformat / restructure text via local 7B model (e.g., bullets→prose, JSON→YAML, casing). Deterministic, low temperature.',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'Text to reformat.' },
              instruction: { type: 'string', description: 'How to reformat it.' },
            },
            required: ['text', 'instruction'],
          },
        },
        {
          name: 'local_search_memory',
          description: 'Embed the query (nomic-embed-text via Ollama) and run cosine retrieval against the librarian + mentor-retrieval SQLite indexes. Returns top-k semantically similar memory entries (kind, slug, path, similarity, snippet, origin=librarian|mentor). Use BEFORE grep-style memory lookups; replaces the per-call caia-librarian-prepend / caia-mentor-prepend CLI subprocess (A.9.12).',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Natural-language query.' },
              k: { type: 'integer', description: 'Number of results to return (default 5).', default: 5 },
            },
            required: ['query'],
          },
        },
        {
          name: 'local_optimize_prompt',
          description: 'Run a prompt through the 3-stage @chiefaia/prompt-optimizer (rule-based prepass + tool-output summarize + token-importance prune). POSTs to router /v1/optimize. Returns the optimized prompt plus per-stage metrics (pre/post token counts, compression ratio, wall time). Use BEFORE escalating a heavy prompt to Claude to reduce tokens — prompts under ~500 tokens skip Stage 2/3 automatically.',
          inputSchema: {
            type: 'object',
            properties: {
              user_question: {
                type: 'string',
                description: 'The user-facing question/instruction. REQUIRED. Preserved verbatim through all stages.',
              },
              system_prompt: {
                type: 'string',
                description: 'Optional system prompt to compress alongside the user question.',
              },
              tool_outputs: {
                type: 'array',
                description: 'Optional tool-output blobs to compress (Stage 2 summarizes each).',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', description: 'Stable id for the blob.' },
                    content: { type: 'string', description: 'Blob content.' },
                    source: { type: 'string', enum: ['file', 'json', 'shell', 'opaque'], description: 'Source hint for Stage 1 heuristics.' },
                  },
                  required: ['id', 'content'],
                },
              },
              recent_reasoning: {
                type: 'array',
                description: 'Optional recent-reasoning strings (preserved more aggressively than older tool outputs).',
                items: { type: 'string' },
              },
              budget: {
                type: 'object',
                description: 'Optional optimizer budget overrides.',
                properties: {
                  stage2_ratio: { type: 'number', description: 'Stage 2 target keep-ratio (default 0.4).' },
                  stage3_ratio: { type: 'number', description: 'Stage 3 target keep-ratio (default 0.5).' },
                  skip_stages_under_tokens: { type: 'integer', description: 'Bail out of Stage 2/3 if raw prompt is below this (default 500).' },
                  model: { type: 'string', description: 'Local model for Stage 2/3 calls (default qwen2.5-coder:7b).' },
                },
              },
            },
            required: ['user_question'],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as ToolInput;

    try {
      if (name === 'local_classify') {
        const r = await fetch(`${routerBaseUrl}/v1/intent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task_spec: args.task_spec }),
        });
        const body = await r.json();
        return { content: [{ type: 'text', text: JSON.stringify(body, null, 2) }] };
      }

      if (name === 'local_summarize' || name === 'local_draft' || name === 'local_format') {
        const userText = name === 'local_summarize' ? args.text
          : name === 'local_draft' ? args.brief
          : `${args.instruction}\n\nTEXT:\n${args.text}`;
        const sysPrompt = name === 'local_summarize'
          ? `Summarize the following text. Be concise. Plain prose, no preamble.`
          : name === 'local_draft'
          ? `Draft a response per the user's brief. Plain prose, no preamble.`
          : `Reformat the text per the instruction. Output only the reformatted text, no commentary.`;
        const maxTokens = args.max_tokens ?? (name === 'local_summarize' ? 800 : name === 'local_draft' ? 1200 : 600);
        const r = await fetch(`${routerBaseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'qwen2.5-coder:7b',
            messages: [
              { role: 'system', content: sysPrompt },
              { role: 'user', content: userText },
            ],
            max_tokens: maxTokens,
            temperature: 0.2,
            caia_task_type: name === 'local_summarize' ? 'summarize-tool-output'
                           : name === 'local_draft' ? 'draft-prose'
                           : 'format-text',
          }),
        });
        const body = await r.json() as { choices?: Array<{ message?: { content?: string } }>; error?: string };
        const out = body.choices?.[0]?.message?.content ?? `(error: ${body.error ?? 'no-content'})`;
        return { content: [{ type: 'text', text: out }] };
      }

      if (name === 'local_search_memory') {
        // A.9.12 — call the router /v1/search-memory endpoint which
        // serves librarian + mentor retrieval in-process (no per-call
        // CLI subprocess). The librarian + mentor SQLite indexes must
        // be built (`caia-librarian-index` + `caia-mentor-index`) — if
        // they aren't yet, the response includes warnings and hits=[].
        const query = (args.query ?? '').trim();
        if (query === '') {
          return {
            content: [{ type: 'text', text: 'error: query is required' }],
            isError: true,
          };
        }
        const k = typeof args.k === 'number' && Number.isFinite(args.k) && args.k > 0
          ? args.k
          : 5;
        const r = await fetch(`${routerBaseUrl}/v1/search-memory`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, k, source: 'both' }),
        });
        const body = await r.json() as {
          query?: string;
          k?: number;
          hits?: Array<{ kind?: string; slug?: string; path?: string; similarity?: number; snippet?: string; origin?: string }>;
          warnings?: string[];
          error?: string;
          message?: string;
        };
        if (!r.ok || body.error !== undefined) {
          return {
            content: [{
              type: 'text',
              text: `error: /v1/search-memory ${r.status} ${body.error ?? ''}${body.message ? ': ' + body.message : ''}`,
            }],
            isError: true,
          };
        }
        const hits = body.hits ?? [];
        if (hits.length === 0) {
          const note = body.warnings && body.warnings.length > 0
            ? ` (warnings: ${body.warnings.join('; ')})`
            : '';
          return {
            content: [{
              type: 'text',
              text: `local_search_memory: no matches for query "${query}"${note}`,
            }],
          };
        }
        const lines: string[] = [];
        lines.push(`local_search_memory: top-${hits.length} for "${query}"`);
        for (let i = 0; i < hits.length; i++) {
          const h = hits[i];
          if (!h) continue;
          const sim = typeof h.similarity === 'number' ? h.similarity.toFixed(3) : '?';
          lines.push(`\n[${i + 1}] ${h.origin ?? '?'} · ${h.kind ?? '?'} · sim=${sim}`);
          lines.push(`    ${h.path ?? '(no path)'}`);
          if (h.snippet) {
            const sn = h.snippet.length > 400 ? h.snippet.slice(0, 400) + '…' : h.snippet;
            lines.push(`    ${sn.split('\n').join('\n    ')}`);
          }
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      }

      if (name === 'local_optimize_prompt') {
        const userQuestion = (args.user_question ?? '').trim();
        if (userQuestion === '') {
          return {
            content: [{ type: 'text', text: 'error: user_question is required' }],
            isError: true,
          };
        }
        const payload: Record<string, unknown> = { userQuestion };
        if (args.system_prompt !== undefined) payload['systemPrompt'] = args.system_prompt;
        if (args.tool_outputs !== undefined) payload['toolOutputs'] = args.tool_outputs;
        if (args.recent_reasoning !== undefined) payload['recentReasoning'] = args.recent_reasoning;
        if (args.budget !== undefined) {
          const b: Record<string, unknown> = {};
          if (args.budget.stage2_ratio !== undefined) b['stage2Ratio'] = args.budget.stage2_ratio;
          if (args.budget.stage3_ratio !== undefined) b['stage3Ratio'] = args.budget.stage3_ratio;
          if (args.budget.skip_stages_under_tokens !== undefined) b['skipStagesUnderTokens'] = args.budget.skip_stages_under_tokens;
          if (args.budget.model !== undefined) b['model'] = args.budget.model;
          payload['budget'] = b;
        }

        const r = await fetch(`${routerBaseUrl}/v1/optimize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await r.json() as {
          optimized_prompt?: string;
          protected_span_count?: number;
          metrics?: unknown;
          wall_ms?: number;
          error?: string;
          message?: string;
        };
        if (!r.ok || body.error !== undefined) {
          return {
            content: [{
              type: 'text',
              text: `error: /v1/optimize ${r.status} ${body.error ?? ''}${body.message ? ': ' + body.message : ''}`,
            }],
            isError: true,
          };
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              optimized_prompt: body.optimized_prompt,
              protected_span_count: body.protected_span_count,
              metrics: body.metrics,
              wall_ms: body.wall_ms,
            }, null, 2),
          }],
        };
      }

      return { content: [{ type: 'text', text: `unknown-tool: ${name}` }], isError: true };
    } catch (e) {
      return {
        content: [{ type: 'text', text: `error: ${(e as Error).message}` }],
        isError: true,
      };
    }
  });

  return server;
}
