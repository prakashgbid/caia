/**
 * @caia/grand-idea — public type surface.
 */

import { z } from 'zod';

/** Word-count floor + ceiling. DB CHECK constraints match. */
export const GRAND_IDEA_WORD_FLOOR = 5;
export const GRAND_IDEA_WORD_CEILING = 5000;

/** A single immutable grand-idea row. */
export interface GrandIdeaRow {
  id: string;
  tenantSlug: string;
  projectId: string;
  revisionNumber: number;
  prompt: string;
  promptWordCount: number;
  capturedBy: string;
  capturedAtIso: string;
  metadata: Readonly<Record<string, unknown>>;
}

/** Result of a successful capture call. */
export interface CaptureResult {
  row: GrandIdeaRow;
  /**
   * `true` when this call created a new row, `false` when the call hit
   * the idempotent same-prompt path (returns the prior row unchanged).
   */
  newRowCreated: boolean;
  /**
   * `true` when the FSM was advanced as part of this call, `false` when
   * the project was already in `idea-captured` at call time.
   */
  fsmAdvanced: boolean;
}

/** Tenant lookup record (subset returned by readTenant). */
export interface TenantRecord {
  id: string;
  slug: string;
  schemaName: string;
  onboardingComplete: boolean;
}

/** Wraps a Postgres connection pool just enough for in-memory testing. */
export interface PgQueryRunner {
  query<R = unknown>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount: number }>;
}

/** Transactional API. The persistence layer wraps writes in BEGIN/COMMIT. */
export interface PgPoolLike {
  query<R = unknown>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount: number }>;
  connect(): Promise<PgClient>;
}

export interface PgClient extends PgQueryRunner {
  release(err?: Error | boolean): void;
}

/** Zod schema for the inbound capture request. */
export const captureRequestSchema = z.object({
  tenantSlug: z
    .string()
    .min(1, 'tenantSlug is required')
    .max(255, 'tenantSlug too long')
    .regex(/^[a-z0-9][a-z0-9_-]*$/i, 'tenantSlug must be slug-safe'),
  projectId: z.string().uuid('projectId must be a UUID'),
  prompt: z
    .string()
    .min(1, 'prompt is required')
    .transform((s) => s.trim())
    .refine((s) => s.length > 0, 'prompt is required'),
  metadata: z.record(z.unknown()).optional(),
});

export type CaptureRequest = z.infer<typeof captureRequestSchema>;

/** Successful response from the POST handler. */
export interface CaptureResponseOk {
  ok: true;
  grandIdeaId: string;
  revisionNumber: number;
  capturedAtIso: string;
  newState: 'idea-captured';
  newRowCreated: boolean;
  fsmAdvanced: boolean;
}

/** Failure response from the POST handler. */
export interface CaptureResponseError {
  ok: false;
  error:
    | 'validation_failed'
    | 'tenant_not_found'
    | 'tenant_not_onboarded'
    | 'project_state_invalid'
    | 'fsm_transition_failed'
    | 'auth_missing'
    | 'auth_invalid'
    | 'persistence_failed'
    | 'internal';
  message: string;
  details?: Readonly<Record<string, unknown>>;
}

export type CaptureResponse = CaptureResponseOk | CaptureResponseError;

/** Compute word count the same way the DB CHECK does. Whitespace-split. */
export function computeWordCount(prompt: string): number {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/u).length;
}
