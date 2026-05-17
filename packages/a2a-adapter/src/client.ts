/**
 * A2AClient — dispatches a `tasks/send` JSON-RPC call to a specialist agent's
 * A2A endpoint and parses the result.
 *
 * Per p4_agent_mesh_implementation_plan_2026_05_16.md §4.2. We don't bind to
 * @a2a-js/sdk internals here (its 0.3.x types are unstable); instead we speak
 * JSON-RPC 2.0 directly. That keeps the dependency surface small while we wait
 * for the official 1.0+ TS SDK to stabilise.
 */
import type { A2AArtifact, A2ATaskRequest, A2ATaskResponse } from './types.js';

export interface A2AClientOptions {
  /** Base URL of the A2A agent, e.g. http://127.0.0.1:8410 */
  url: string;
  /** Path of the JSON-RPC endpoint; default `/a2a` */
  path?: string;
  /** Per-call timeout in ms; default 60_000 */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export class A2AClient {
  private readonly url: string;
  private readonly path: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: A2AClientOptions) {
    this.url = opts.url.replace(/\/$/, '');
    this.path = opts.path ?? '/a2a';
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  async send(req: A2ATaskRequest): Promise<A2ATaskResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const body = {
        jsonrpc: '2.0',
        id: req.taskId,
        method: 'tasks/send',
        params: {
          taskId: req.taskId,
          contextId: req.contextId,
          input: req.input,
        },
      };
      const res = await this.fetchImpl(`${this.url}${this.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        return {
          taskId: req.taskId,
          contextId: req.contextId,
          status: 'error',
          error: { code: res.status, message: `HTTP ${res.status}` },
        };
      }
      const json = (await res.json()) as {
        result?: { status: 'done' | 'streaming'; artifact?: A2AArtifact };
        error?: { code: number; message: string };
      };
      if (json.error) {
        return {
          taskId: req.taskId,
          contextId: req.contextId,
          status: 'error',
          error: json.error,
        };
      }
      return {
        taskId: req.taskId,
        contextId: req.contextId,
        status: json.result?.status ?? 'done',
        artifact: json.result?.artifact,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Fetch the agent_card.json — useful for health checks + capability discovery. */
  async agentCard(): Promise<unknown> {
    const res = await this.fetchImpl(`${this.url}/a2a/agent-card.json`);
    if (!res.ok) throw new Error(`agent_card fetch failed: HTTP ${res.status}`);
    return res.json();
  }
}
