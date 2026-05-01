import type { ConductorEvent } from '@chiefaia/event-bus-internal';

export interface ProjectionHandler {
  (event: ConductorEvent): void | Promise<void>;
}

export interface ProjectionDefinition {
  /** Unique stable name — used as the primary key in projection_checkpoints. */
  name: string;
  /** picomatch glob(s) that select which event types this projection handles. */
  eventTypes: string | string[];
  /** Called for each matching event in chronological order. */
  handler: ProjectionHandler;
  /**
   * Max events to replay per catchup pass. Default 1000.
   * Large values are fine for small event stores; tune down if the DB is large.
   */
  catchupBatchSize?: number;
}

export interface ProjectionCheckpoint {
  projectionName: string;
  lastEventId: string | null;
  lastEventOccurredAt: string | null;
  processedCount: number;
  errorCount: number;
  lastError: string | null;
  lastErrorAt: number | null;
  updatedAt: number;
}

export interface ProjectionStatus {
  name: string;
  checkpoint: ProjectionCheckpoint | null;
  /** Whether the runner is currently subscribed to the live event bus. */
  live: boolean;
}
