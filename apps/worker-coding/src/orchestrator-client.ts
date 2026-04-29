/**
 * Orchestrator HTTP client — CODING-007 (Phase 2C).
 *
 * Workers are external processes; the orchestrator's WorkerPoolRegistry
 * lives in-process behind the HTTP server. This module is the client
 * side of the four lifecycle endpoints added by CODING-007:
 *
 *   POST /api/workers/register          → returns { workerId }
 *   POST /api/workers/:id/heartbeat     → returns { ok, status, currentStoryId }
 *   POST /api/workers/:id/release       → returns { ok }
 *   GET  /api/workers/:id/assignment    → returns { assignment: {...} | null }
 *
 * The client deliberately keeps no in-memory state beyond `workerId` so
 * tests can drive each call individually.
 *
 * @owner coding-agent (Phase 2C worker track)
 */

export interface RegisterRequest {
  kind: 'coding';
  capabilities?: string[];
  socketPath: string;
  metadata?: Record<string, unknown>;
}

export interface RegisterResponse {
  workerId: string;
}

export interface HeartbeatResponse {
  ok: boolean;
  status: 'idle' | 'busy' | 'crashed' | 'released';
  currentStoryId: string | null;
}

export interface AssignmentResponse {
  assignment: {
    storyId: string;
    bucketId: string | null;
    assignedAt: number;
  } | null;
}

export interface ReleaseRequest {
  reason?: 'task-completed' | 'manual-shutdown' | 'orchestrator-shutdown' | 'evicted-after-stuck';
}

export interface OrchestratorClientOptions {
  baseUrl: string;
  /** Optional fetch impl (tests + node 18 polyfill). */
  fetchImpl?: typeof fetch;
  /** Bail individual calls after this many ms. Default 10_000. */
  timeoutMs?: number;
}

export class OrchestratorClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: OrchestratorClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('OrchestratorClient: global fetch unavailable; pass fetchImpl');
    }
    this.timeoutMs = opts.timeoutMs ?? 10_000;
  }

  async register(req: RegisterRequest): Promise<RegisterResponse> {
    const res = await this.json<RegisterResponse>('POST', '/api/workers/register', req);
    return res;
  }

  async heartbeat(workerId: string): Promise<HeartbeatResponse> {
    return await this.json<HeartbeatResponse>('POST', `/api/workers/${encodeURIComponent(workerId)}/heartbeat`, {});
  }

  async getAssignment(workerId: string): Promise<AssignmentResponse> {
    return await this.json<AssignmentResponse>('GET', `/api/workers/${encodeURIComponent(workerId)}/assignment`);
  }

  async release(workerId: string, req: ReleaseRequest = {}): Promise<{ ok: boolean }> {
    return await this.json<{ ok: boolean }>('POST', `/api/workers/${encodeURIComponent(workerId)}/release`, req);
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async json<T>(method: 'GET' | 'POST', pathStr: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${pathStr}`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`OrchestratorClient ${method} ${pathStr} → ${res.status}: ${txt.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(t);
    }
  }
}
