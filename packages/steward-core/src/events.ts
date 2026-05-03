/**
 * Steward event types — the normalized representation of every observed event
 * (GitHub, orchestrator-db, filesystem, self) that the watcher emits and the
 * compliance checker consumes.
 *
 * Reference: devops-steward-agent-design-2026-05-03.md §3.3.
 */

import { z } from 'zod';

/**
 * Source of the observation.
 *  - 'github'           — fetched from gh API or webhook (P0 uses polling)
 *  - 'orchestrator-db'  — read from ~/.caia/orchestrator.db
 *  - 'fs'               — local filesystem state (worktree list, traces, …)
 *  - 'self'             — emitted by the Steward itself (drifts, meta-drifts)
 */
export const EventSourceSchema = z.enum([
  'github',
  'orchestrator-db',
  'fs',
  'self',
]);
export type EventSource = z.infer<typeof EventSourceSchema>;

/**
 * Canonical event-type strings. The list will grow as processes are added;
 * P0 covers what the back-merge watcher needs.
 *
 * Naming: `<source>.<entity>.<action>` for primitives; bare snake_case for
 * Steward-derived events (release_landed, back_merge_opened, process_drift, …).
 */
export const EventTypeSchema = z.string().min(1);
export type EventType = z.infer<typeof EventTypeSchema>;

/**
 * Repo identifier. '*' means cross-repo / mac-host-level.
 */
export const RepoIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9._-]+|\*$/);
export type RepoId = z.infer<typeof RepoIdSchema>;

/**
 * The normalized event shape. Every poll cycle produces a list of these.
 */
export const StewardEventSchema = z.object({
  /** Stable hash so duplicate polls don't create duplicate rows. */
  id: z.string().min(1),
  source: EventSourceSchema,
  type: EventTypeSchema,
  repo: RepoIdSchema,
  /** Free-form opaque payload; predicates inspect this. */
  payload: z.record(z.unknown()),
  /** Unix epoch milliseconds. */
  observedAt: z.number().int().nonnegative(),
  /** Optional correlation ID for chaining (e.g., release_pr_281). */
  correlationId: z.string().optional(),
});
export type StewardEvent = z.infer<typeof StewardEventSchema>;

/**
 * Helper: deterministic event id from the (source, type, repo, key, ts) tuple.
 */
export function makeEventId(parts: {
  source: EventSource;
  type: EventType;
  repo: RepoId;
  key: string;
  observedAt: number;
}): string {
  // Simple, deterministic, no crypto: keys are short and we don't need
  // collision resistance for what's basically a dedup hash.
  const { source, type, repo, key, observedAt } = parts;
  return `${source}::${type}::${repo}::${key}::${observedAt}`;
}
