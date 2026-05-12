#!/usr/bin/env node
// MCP stdio server for the local-llm-router daemon.
//
// Exposes 5 Cowork tools:
//   local_classify(task_spec)         → IntentResult JSON
//   local_summarize(text, max_tokens) → summary string
//   local_draft(brief, max_tokens)    → drafted prose
//   local_format(text, instruction)   → reformatted text
//   local_search_memory(query, k)     → top-k memory results (embedding lookup)
//
// All RPC the local daemon at ROUTER_BASE_URL (default http://127.0.0.1:7411).

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const ROUTER_BASE_URL = process.env.ROUTER_BASE_URL ?? 'http://127.0.0.1:7411';

interface ToolInput {
  task_spec?: string;
  text?: string;
  brief?: string;
  query?: string;
  instruction?: string;
  max_tokens?: number;
  k?: number;
}

const server = new Server(
  { name: 'caia-local-llm-router-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'local_classify',
        description: 'Classify a task spec into a CAIA intent + recommended tier (local-7b/14b/32b/claude). Routes via the local-llm-router daemon at ' + ROUTER_BASE_URL + '. Use BEFORE invoking heavy reasoning to decide if the task can be served locally.',
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
        description: 'Embed the query and search the agent-memory index (sqlite-vec + nomic-embed-text). Returns top-k semantically similar memory entries. Use for "is there a memory file about X" lookups before deep-reading the index.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Natural-language query.' },
            k: { type: 'integer', description: 'Number of results to return (default 5).', default: 5 },
          },
          required: ['query'],
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
      const r = await fetch(`${ROUTER_BASE_URL}/v1/intent`, {
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
      const r = await fetch(`${ROUTER_BASE_URL}/v1/chat/completions`, {
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
      // Stub: hits /v1/embeddings to embed the query, then would look up against
      // a sqlite-vec index. The index doesn't exist yet (L6 deferred), so for
      // now we return the embedding shape only.
      const r = await fetch(`${ROUTER_BASE_URL}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: args.query, model: 'nomic-embed-text' }),
      });
      const body = await r.json() as { data?: Array<{ embedding?: number[] }> };
      const dims = body.data?.[0]?.embedding?.length ?? 0;
      return {
        content: [{
          type: 'text',
          text: `local_search_memory: query embedded (${dims} dims). Memory index not yet built (L6 of router build plan deferred). Falling back to: grep on ~/Documents/projects/agent-memory/ recommended.`,
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

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('caia-local-llm-router-mcp ready (stdio); routing to', ROUTER_BASE_URL);
