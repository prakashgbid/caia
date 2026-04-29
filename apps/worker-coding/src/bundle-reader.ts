/**
 * Bundle reader — CODING-001 (Phase 2C).
 *
 * Fetches the self-contained ticket bundle from the orchestrator's
 * `GET /stories/:id/bundle` endpoint and validates the response with
 * Zod so downstream code can rely on a typed, well-formed structure.
 *
 * The bundle is the only input the Coding Agent needs to implement a
 * story — it includes the ticket template (with EA's
 * architecturalInstructions, BA's agentSections, Test-Design's
 * testCases), the resource claims, the labels, and the dependency
 * graph slice. No follow-up DB queries should be required.
 *
 * On a malformed bundle this raises `BundleReaderError` with `kind`
 * tagged so the worker can decide whether to retry (transient error)
 * or escalate (invalid contract).
 *
 * @owner coding-agent (Phase 2C worker track)
 */

import { z } from 'zod';

// ─── Zod schemas ────────────────────────────────────────────────────────────

const StorySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  rootPromptId: z.string().nullable(),
  parentEntityId: z.string().nullable(),
  parentEntityType: z.string().nullable(),
  bucketId: z.string().nullable(),
  templateVersion: z.string(),
  templateValidationStatus: z.string(),
  templateValidationErrors: z.unknown().nullable(),
  enrichedAt: z.number().nullable(),
  updatedAt: z.number().nullable(),
});

const PromptSchema = z.object({
  id: z.string(),
  body: z.string(),
  receivedAt: z.string(),
  correlationId: z.string(),
  status: z.string(),
});

const RequirementSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  state: z.string(),
});

const BucketSchema = z.object({
  id: z.string(),
  kind: z.enum(['sequential', 'parallel']),
  domainSlug: z.string().nullable(),
  sequenceIndex: z.number().nullable(),
  status: z.string(),
});

const LabelSchema = z.object({
  labelSlug: z.string(),
  labelType: z.string(),
  confidence: z.number(),
  source: z.string(),
});

const DependenciesSchema = z.object({
  upstream: z.array(z.string()),
  downstream: z.array(z.string()),
});

const InputDependencySchema = z.object({
  kind: z.string(),
  name: z.string(),
}).passthrough();

/**
 * Bundle envelope — mirrors the orchestrator's TicketBundle but loosely
 * typed for the `ticket` field (the embedded TicketTemplateV1 has its own
 * Zod schema in @chiefaia/ticket-template; we don't re-validate it here
 * since the orchestrator already did so before returning the bundle).
 */
export const BundleSchema = z.object({
  story: StorySchema,
  ticket: z.unknown().nullable(),
  ticketParseError: z.string().nullable(),
  prompt: PromptSchema.nullable(),
  requirement: RequirementSchema.nullable(),
  bucket: BucketSchema.nullable(),
  labels: z.array(LabelSchema),
  dependencies: DependenciesSchema,
  inputDependencies: z.array(InputDependencySchema),
});

export type Bundle = z.infer<typeof BundleSchema>;

// ─── Errors ─────────────────────────────────────────────────────────────────

export type BundleReaderErrorKind =
  | 'http-error'        // non-2xx response from orchestrator
  | 'not-found'         // 404 — story doesn't exist
  | 'parse-error'       // body wasn't JSON
  | 'schema-error'      // body parsed but failed Zod validation
  | 'network-error';    // fetch threw (DNS / connect)

export class BundleReaderError extends Error {
  constructor(
    public readonly kind: BundleReaderErrorKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'BundleReaderError';
  }

  /** True if the worker should retry; false if it should escalate. */
  get retryable(): boolean {
    return this.kind === 'http-error' || this.kind === 'network-error';
  }
}

// ─── Reader ─────────────────────────────────────────────────────────────────

export interface BundleReaderOptions {
  /** Base URL of the orchestrator (no trailing slash). */
  baseUrl: string;
  /** Override fetch — mostly for tests. */
  fetchImpl?: typeof globalThis.fetch;
  /** Per-request timeout in ms. Default 30000. */
  timeoutMs?: number;
}

export class BundleReader {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(opts: BundleReaderOptions) {
    if (!opts.baseUrl) throw new Error('BundleReader: baseUrl is required');
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /**
   * Fetches and validates the bundle for a story id. Throws
   * `BundleReaderError` (with `kind`) on any failure.
   */
  async read(storyId: string): Promise<Bundle> {
    if (!storyId) throw new BundleReaderError('schema-error', 'storyId is empty');
    const url = `${this.baseUrl}/stories/${encodeURIComponent(storyId)}/bundle`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { signal: ctrl.signal });
    } catch (e) {
      throw new BundleReaderError('network-error', `fetch failed for ${url}: ${(e as Error).message}`, e);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 404) {
      throw new BundleReaderError('not-found', `story ${storyId} not found at ${url}`);
    }
    if (!res.ok) {
      throw new BundleReaderError('http-error', `${res.status} from ${url}`);
    }
    let raw: unknown;
    try {
      raw = await res.json();
    } catch (e) {
      throw new BundleReaderError('parse-error', `bundle response was not JSON`, e);
    }
    const parsed = BundleSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BundleReaderError(
        'schema-error',
        `bundle failed schema validation: ${parsed.error.message}`,
        parsed.error,
      );
    }
    return parsed.data;
  }

  /**
   * Convenience: returns null on not-found, throws on other errors.
   * Useful when the worker wants to gracefully skip a story that was
   * deleted between assignment and bundle fetch.
   */
  async readOrNull(storyId: string): Promise<Bundle | null> {
    try {
      return await this.read(storyId);
    } catch (e) {
      if (e instanceof BundleReaderError && e.kind === 'not-found') return null;
      throw e;
    }
  }
}
