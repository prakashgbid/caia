/**
 * `AtlasApiClient` — pluggable transport for the four Atlas endpoints
 * from spec §5.
 *
 * The shell never imports `fetch` directly; it always goes through
 * an `AtlasApiClient`. Two concrete implementations ship:
 *
 *   - `createHttpClient(baseUrl, fetchImpl?)` — the production
 *     transport. Calls the real Next.js API.
 *   - `createMockClient(fixtures)` — a deterministic in-memory
 *     transport for Storybook, Playwright, and unit tests.
 *
 * Mock and HTTP share the exact same `AtlasApiClient` type so
 * components don't know (and can't care) which they got.
 */

import type {
  AtlasLatestDesignResponse,
  AtlasSseEvent,
  AtlasSubmitPromptRequest,
  AtlasSubmitPromptResponse,
  AtlasTicketTree,
  AtlasTicketVersionsResponse,
} from '../types/index.js';

/** SSE subscription handle. Call to unsubscribe. */
export type AtlasSseUnsubscribe = () => void;

/** The full Atlas API surface. */
export interface AtlasApiClient {
  /** `GET /api/atlas/project/:id/designs/latest`. */
  getLatestDesign: (projectId: string) => Promise<AtlasLatestDesignResponse>;

  /** `GET /api/atlas/project/:id/tickets/tree`. */
  getTicketsTree: (projectId: string) => Promise<AtlasTicketTree>;

  /** `POST /api/atlas/tickets/:id/prompt`. */
  submitPrompt: (
    ticketId: string,
    body: AtlasSubmitPromptRequest,
  ) => Promise<AtlasSubmitPromptResponse>;

  /** `GET /api/atlas/tickets/:id/versions`. */
  getTicketVersions: (
    ticketId: string,
    opts?: { cursor?: string; limit?: number },
  ) => Promise<AtlasTicketVersionsResponse>;

  /**
   * `GET /api/atlas/project/:id/events` (SSE). Returns an unsubscribe
   * function. The client may reconnect transparently — callers do not
   * have to redo `subscribeEvents`.
   */
  subscribeEvents: (
    projectId: string,
    onEvent: (e: AtlasSseEvent) => void,
    onError?: (err: Error) => void,
  ) => AtlasSseUnsubscribe;
}

/* ─── HTTP client ───────────────────────────────────────────────── */

interface HttpClientOptions {
  /** Base URL of the Atlas Next.js app. Defaults to `''` (same origin). */
  baseUrl?: string;
  /** Override `fetch` (tests). Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Override `EventSource`. Defaults to the global one. */
  EventSourceCtor?: typeof EventSource;
  /** Extra headers (e.g. tenant override in dev). */
  headers?: Record<string, string>;
}

/**
 * Concrete HTTP client. Pure transport — no state, no caching. The
 * shell caches above this via React state / SWR.
 */
export function createHttpClient(opts: HttpClientOptions = {}): AtlasApiClient {
  const baseUrl = (opts.baseUrl ?? '').replace(/\/$/, '');
  const f = opts.fetchImpl ?? (globalThis.fetch as typeof fetch);
  const EvtSource = opts.EventSourceCtor ?? (globalThis.EventSource as typeof EventSource);
  const baseHeaders = opts.headers ?? {};

  async function req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await f(`${baseUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...baseHeaders,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`AtlasApiClient: ${init?.method ?? 'GET'} ${path} → ${res.status} ${txt}`);
    }
    return (await res.json()) as T;
  }

  return {
    getLatestDesign: (projectId) =>
      req<AtlasLatestDesignResponse>(
        `/api/atlas/project/${encodeURIComponent(projectId)}/designs/latest`,
      ),

    getTicketsTree: (projectId) =>
      req<AtlasTicketTree>(
        `/api/atlas/project/${encodeURIComponent(projectId)}/tickets/tree`,
      ),

    submitPrompt: (ticketId, body) =>
      req<AtlasSubmitPromptResponse>(
        `/api/atlas/tickets/${encodeURIComponent(ticketId)}/prompt`,
        { method: 'POST', body: JSON.stringify(body) },
      ),

    getTicketVersions: (ticketId, qopts) => {
      const params = new URLSearchParams();
      if (qopts?.cursor) params.set('cursor', qopts.cursor);
      if (qopts?.limit) params.set('limit', String(qopts.limit));
      const q = params.toString();
      return req<AtlasTicketVersionsResponse>(
        `/api/atlas/tickets/${encodeURIComponent(ticketId)}/versions${q ? `?${q}` : ''}`,
      );
    },

    subscribeEvents: (projectId, onEvent, onError) => {
      const url = `${baseUrl}/api/atlas/project/${encodeURIComponent(projectId)}/events`;
      if (typeof EvtSource !== 'function') {
        // No EventSource (e.g. older Node SSR) — fail open, never throw.
        if (onError) onError(new Error('EventSource is not available'));
        return () => {};
      }
      const es = new EvtSource(url, { withCredentials: true });
      const handler = (e: MessageEvent): void => {
        try {
          const parsed = JSON.parse(e.data) as AtlasSseEvent;
          onEvent(parsed);
        } catch (err) {
          if (onError) onError(err instanceof Error ? err : new Error(String(err)));
        }
      };
      es.addEventListener('message', handler);
      es.addEventListener('error', () => {
        if (onError) onError(new Error('SSE connection error'));
      });
      return () => {
        es.removeEventListener('message', handler);
        es.close();
      };
    },
  };
}

/* ─── Mock client ───────────────────────────────────────────────── */

/** Shape of the in-memory fixture state. */
export interface AtlasMockFixtures {
  latestDesign: AtlasLatestDesignResponse;
  ticketsTree: AtlasTicketTree;
  versionsByTicketId?: Record<string, AtlasTicketVersionsResponse>;
  /** Optional pre-canned event stream. Each event fires once on subscribe. */
  events?: AtlasSseEvent[];
  /**
   * Default response for `submitPrompt`. Generated synthetically if
   * not provided — `versionId` is `tv_mock_${ticketId}_${n}`, state
   * flips to `change-requested`.
   */
  submitPromptResponse?: (
    ticketId: string,
    body: AtlasSubmitPromptRequest,
  ) => AtlasSubmitPromptResponse;
}

interface MockClientControls extends AtlasApiClient {
  /** Test-side hook to push a new SSE event. */
  emitEvent: (e: AtlasSseEvent) => void;
}

/**
 * In-memory mock client. Used by Storybook stories and Playwright
 * fixtures. Calls are synchronous (resolve on next microtask) so
 * tests don't have to await timers.
 */
export function createMockClient(fixtures: AtlasMockFixtures): MockClientControls {
  const subscribers = new Set<(e: AtlasSseEvent) => void>();
  let submitCounter = 0;

  const defaultSubmit = (
    _ticketId: string,
    _body: AtlasSubmitPromptRequest,
  ): AtlasSubmitPromptResponse => {
    submitCounter++;
    return {
      versionId: `tv_mock_${submitCounter}`,
      ticketState: 'change-requested',
      expectedChangeDescription:
        'Mock client — expected change description placeholder.',
      dispatchedTo: ['caia-frontend-architect'],
      enqueuedAt: new Date().toISOString(),
    };
  };

  return {
    getLatestDesign: async () => structuredCloneSafe(fixtures.latestDesign),

    getTicketsTree: async () => structuredCloneSafe(fixtures.ticketsTree),

    submitPrompt: async (ticketId, body) => {
      const make = fixtures.submitPromptResponse ?? defaultSubmit;
      return make(ticketId, body);
    },

    getTicketVersions: async (ticketId) => {
      const found = fixtures.versionsByTicketId?.[ticketId];
      if (found) return structuredCloneSafe(found);
      return { ticketId, versions: [], nextCursor: null };
    },

    subscribeEvents: (_projectId, onEvent) => {
      subscribers.add(onEvent);
      if (Array.isArray(fixtures.events)) {
        for (const e of fixtures.events) {
          // Fire on next microtask so the subscriber's React effect
          // has a chance to attach.
          queueMicrotask(() => onEvent(e));
        }
      }
      return () => {
        subscribers.delete(onEvent);
      };
    },

    emitEvent: (e) => {
      for (const sub of subscribers) sub(e);
    },
  };
}

/** Defensive clone — falls back to JSON when structuredClone is unavailable. */
function structuredCloneSafe<T>(value: T): T {
  if (typeof (globalThis as { structuredClone?: typeof structuredClone }).structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Convenience export — most callers want this as the namespace. */
export const createAtlasApiClient = createHttpClient;
