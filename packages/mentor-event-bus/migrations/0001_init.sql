-- Mentor event-bus initial schema.
-- See packages/mentor-event-bus/src/sqlite.ts for migration runner + WAL setup.

CREATE TABLE events (
  id              TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  schema_version  INTEGER NOT NULL DEFAULT 1,
  correlation_id  TEXT,
  parent_event_id TEXT,
  emitted_at      TEXT NOT NULL,
  hostname        TEXT NOT NULL,
  process_name    TEXT,
  payload_json    TEXT NOT NULL,
  validation_failed INTEGER NOT NULL DEFAULT 0,
  ingest_offset   INTEGER NOT NULL
);

CREATE INDEX idx_events_type_emitted ON events(event_type, emitted_at);
CREATE INDEX idx_events_correlation  ON events(correlation_id);
CREATE INDEX idx_events_emitted      ON events(emitted_at);
CREATE INDEX idx_events_offset       ON events(ingest_offset);

-- Per-row monotonic ingest offset; populated by AUTOINCREMENT-equivalent below.
CREATE TABLE _ingest_counter (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  next_offset INTEGER NOT NULL DEFAULT 1
);
INSERT INTO _ingest_counter (id, next_offset) VALUES (1, 1);

-- Schema definitions (Zod schemas serialized for cross-language consumers).
CREATE TABLE schema_definitions (
  event_type     TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  zod_schema     TEXT NOT NULL,
  registered_at  TEXT NOT NULL,
  PRIMARY KEY (event_type, schema_version)
);
