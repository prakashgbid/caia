/**
 * Stream + consumer configuration.
 *
 * V1 ships ONE stream — `chiefaia-events` — that captures the
 * entire `chiefaia.>` subject space. This gives us a working
 * round-trip immediately and defers the per-namespace fanout
 * to v0.2 (where each of the 15 namespaces from
 * @chiefaia/events-taxonomy-internal gets its own stream with
 * tuned retention/limits).
 *
 * The 15 namespaces are sketched below as a follow-up reference.
 */

export interface StreamSpec {
  name: string;
  subjects: string[];
  retention: 'limits' | 'workqueue' | 'interest';
  maxAgeMs: number;
  maxBytes: number;
  replicas: number;
  storage: 'file' | 'memory';
}

export interface ConsumerSpec {
  stream: string;
  durable: string;
  filterSubject: string;
  ackPolicy: 'explicit' | 'none' | 'all';
  ackWaitMs: number;
  maxDeliver: number;
  maxAckPending: number;
}

/** V1: a single catch-all stream. */
export const DEFAULT_STREAM: StreamSpec = {
  name: 'chiefaia-events',
  subjects: ['chiefaia.>'],
  retention: 'limits',
  maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  maxBytes: 4 * 1024 * 1024 * 1024,  // 4 GiB
  replicas: 3,
  storage: 'file',
};

/** Helper to derive a default consumer spec. */
export function defaultConsumer(
  durable: string,
  filterSubject = 'chiefaia.>',
  overrides: Partial<ConsumerSpec> = {},
): ConsumerSpec {
  return {
    stream: DEFAULT_STREAM.name,
    durable,
    filterSubject,
    ackPolicy: 'explicit',
    ackWaitMs: 30_000,
    maxDeliver: 5,
    maxAckPending: 1024,
    ...overrides,
  };
}

// ─── v0.2 sketch (NOT WIRED) ───────────────────────────────────
// Each namespace from registry.yaml gets its own stream with
// tuned retention. Implementer must reconcile against
// @chiefaia/events-taxonomy-internal at build time and emit a
// `streams.config.json` for kubectl-applied JetStream CR.

export const NAMESPACE_HINTS: ReadonlyArray<{
  namespace: string;
  retentionDays: number;
  approxEventTypes: number;
}> = [
  { namespace: 'pipeline',  retentionDays: 30, approxEventTypes: 6 },
  { namespace: 'story',     retentionDays: 30, approxEventTypes: 8 },
  { namespace: 'feature',   retentionDays: 30, approxEventTypes: 4 },
  { namespace: 'build',     retentionDays: 14, approxEventTypes: 6 },
  { namespace: 'test',      retentionDays: 14, approxEventTypes: 5 },
  { namespace: 'deploy',    retentionDays: 30, approxEventTypes: 5 },
  { namespace: 'review',    retentionDays: 30, approxEventTypes: 4 },
  { namespace: 'agent',     retentionDays: 7,  approxEventTypes: 4 },
  { namespace: 'mentor',    retentionDays: 14, approxEventTypes: 3 },
  { namespace: 'capability',retentionDays: 14, approxEventTypes: 2 },
  { namespace: 'steward',   retentionDays: 30, approxEventTypes: 3 },
  { namespace: 'policy',    retentionDays: 30, approxEventTypes: 2 },
  { namespace: 'audit',     retentionDays: 90, approxEventTypes: 2 },
  { namespace: 'observe',   retentionDays: 7,  approxEventTypes: 2 },
  { namespace: 'system',    retentionDays: 30, approxEventTypes: 1 },
];
