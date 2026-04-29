/**
 * Shared in-memory test DB + event-bus wiring for the Phase 2
 * regression suite.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../../src/db/schema';
import { events } from '../../../src/db/schema';
import { eventBus } from '@chiefaia/event-bus-internal';

const MIGRATIONS_DIR = path.join(__dirname, '../../../src/db/migrations');

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

export function createTestDb(): { db: TestDb; sqlite: Database.Database } {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, sqlite };
}

/**
 * Wire the singleton event bus to a test SQLite database. Rewires on
 * every call — multiple tests in one file should each rebuild via
 * createTestDb + wireBusToTestDb so events from the previous test
 * don't leak.
 */
export function wireBusToTestDb(db: TestDb): void {
  eventBus.wireDb({
    insertEvent: (row) => {
      db.insert(events)
        .values({
          id: row.id,
          type: row.type,
          occurredAt: row.occurred_at,
          actor: row.actor,
          correlationId: row.correlation_id ?? undefined,
          causationId: row.causation_id ?? undefined,
          traceId: row.trace_id ?? undefined,
          spanId: row.span_id ?? undefined,
          entityType: row.entity_type ?? undefined,
          entityId: row.entity_id ?? undefined,
          projectSlug: row.project_slug ?? undefined,
          domainSlugsJson: row.domain_slugs_json,
          payloadJson: row.payload_json,
          metadataJson: row.metadata_json,
          severity: row.severity,
        })
        .run();
    },
    queryEvents: () => [],
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}
