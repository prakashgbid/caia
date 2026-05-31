/**
 * @caia/wizard-tenant-bootstrap — public types.
 *
 * The orchestrator's contract with `apps/dashboard/lib/tenants/provision.ts`.
 * Keep this surface small: provisionTenant() only sees `bootstrapTenant`
 * and the result envelope.
 */

/**
 * Minimal `pg.Pool` surface the orchestrator needs. Avoids hard-coupling to
 * the `pg` package at compile time and lets tests pass a mock.
 *
 * Mirrors the `PgPoolLike` shape already used by `@caia/grand-idea`,
 * `@caia/info-architect`, and `@caia/interviewer`. Centralising it here
 * means the per-package versions can be replaced with `import type` from
 * this file in a follow-up — but we don't do that now to minimise blast
 * radius.
 */
export interface PgPoolLike {
  query<R = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

/** A single migration in the orchestrator's per-tenant manifest. */
export interface MigrationEntry {
  /** Owning workspace package — used for reporting + idempotency key. */
  readonly packageName: string;
  /** Migration filename (NOT full path) — second half of the idempotency key. */
  readonly filename: string;
  /** Absolute path to the SQL template file containing `{{SCHEMA}}` placeholders. */
  readonly sqlPath: string;
}

/** Outcome of applying a single migration. */
export type MigrationOutcome =
  | { kind: 'applied'; packageName: string; filename: string; durationMs: number; checksum: string }
  | { kind: 'skipped'; packageName: string; filename: string; reason: 'already-applied'; existingChecksum: string }
  | { kind: 'reapplied'; packageName: string; filename: string; durationMs: number; oldChecksum: string; newChecksum: string }
  | { kind: 'failed'; packageName: string; filename: string; error: string };

/** Envelope returned by `bootstrapTenant`. */
export interface TenantBootstrapResult {
  /** The per-tenant Postgres schema the orchestrator targeted. */
  readonly schemaName: string;
  /** Per-migration outcome, in manifest order. */
  readonly outcomes: ReadonlyArray<MigrationOutcome>;
  /** Tables present in the schema after bootstrap (verified via information_schema). */
  readonly tablesCreated: ReadonlyArray<string>;
  /** True iff every outcome is either `applied`, `skipped`, or `reapplied`. */
  readonly success: boolean;
  /** Convenience pre-aggregation for the caller. */
  readonly failures: ReadonlyArray<Extract<MigrationOutcome, { kind: 'failed' }>>;
}

/**
 * Subset of `@chiefaia/event-bus-nats`'s EventBus the orchestrator uses.
 * Mirrors `apps/dashboard/lib/tenants/provision.ts::EventPublisher`.
 */
export interface BootstrapEventPublisher {
  publish(input: {
    type: string;
    severity?: 'debug' | 'info' | 'warning' | 'error';
    actor?: string;
    payload: Record<string, unknown>;
  }): Promise<unknown>;
}

/** Constructor options for `bootstrapTenant`. */
export interface BootstrapOptions {
  readonly pool: PgPoolLike;
  /** Per-tenant schema to populate. Must match `^tenant_[a-z0-9_]+$`. */
  readonly schemaName: string;
  /** Defaults to `DEFAULT_MANIFEST`. Tests use this to inject smaller manifests. */
  readonly manifest?: ReadonlyArray<MigrationEntry>;
  /** Defaults to a no-op publisher. */
  readonly publisher?: BootstrapEventPublisher;
  /** Defaults to `Date.now`. Tests use this for deterministic `applied_at`. */
  readonly clock?: () => Date;
  /** Optional logger; defaults to no-op. */
  readonly log?: (line: string) => void;
}
