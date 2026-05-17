/**
 * Helpers for hosting an A2A-compliant JSON-RPC endpoint with Hono.
 *
 * Per p4_agent_mesh_implementation_plan_2026_05_16.md §3 M0:
 *   "JSON-RPC method `tasks/send`; SSE streaming on `tasks/sendSubscribe`."
 *
 * For M0/M1 we ship `tasks/send` only; SSE streaming lands in M1.5 once
 * the supervisor needs incremental token streaming for the coder agents.
 */
import type { A2AArtifact, A2ATaskRequest, A2ATaskResponse } from './types.js';
import type { AgentCard } from './agent-card.js';

export type A2AHandler = (req: A2ATaskRequest) => Promise<A2AArtifact>;

export interface A2AServerHandlers {
  agentCard: AgentCard;
  onTask: A2AHandler;
}

/** Bare JSON-RPC request shape we expect over POST /a2a */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params: { taskId: string; contextId: string; input: Record<string, unknown> };
}

/** Generic adapter that converts a JSON body into the right A2A method call. */
export async function handleJsonRpc(
  body: JsonRpcRequest,
  handlers: A2AServerHandlers,
): Promise<{
  jsonrpc: '2.0';
  id: string | number;
  result?: { status: 'done' | 'streaming'; artifact: A2AArtifact };
  error?: { code: number; message: string };
}> {
  if (body.method !== 'tasks/send') {
    return {
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32601, message: `method not found: ${body.method}` },
    };
  }
  try {
    const artifact = await handlers.onTask({
      taskId: body.params.taskId,
      contextId: body.params.contextId,
      input: body.params.input,
    });
    return {
      jsonrpc: '2.0',
      id: body.id,
      result: { status: 'done', artifact },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32000, message: msg },
    };
  }
}

/**
 * Bind A2A handlers to a Hono app. Caller is expected to import Hono and call
 * `bindHonoA2A(app, handlers)`.
 *
 * We don't depend on Hono types here to keep this package usable from any
 * Hono version; the caller's Hono is the source of truth.
 */
export interface HonoLike {
  get(path: string, handler: (c: HonoCtxLike) => unknown): unknown;
  post(path: string, handler: (c: HonoCtxLike) => unknown): unknown;
}
export interface HonoCtxLike {
  req: { json(): Promise<unknown> };
  json(body: unknown, status?: number): unknown;
}

export function bindHonoA2A(app: HonoLike, h: A2AServerHandlers): void {
  app.get('/a2a/agent-card.json', (c) => c.json(h.agentCard));
  app.post('/a2a', async (c) => {
    const body = (await c.req.json()) as JsonRpcRequest;
    const result = await handleJsonRpc(body, h);
    return c.json(result);
  });
}

/** Re-exported for type-only consumers. */
export type { A2ATaskRequest, A2ATaskResponse, A2AArtifact };
