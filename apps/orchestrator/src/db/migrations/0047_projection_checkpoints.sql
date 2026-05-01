-- Migration 0047: PROJ-001 — projection_checkpoints table.
--
-- Each named projection stores its last-processed event position here so
-- it can catch up after a restart without reprocessing the entire event log.
--
-- last_event_id      — event.id of the last successfully processed event.
--                      NULL means the projection has never run (full replay
--                      needed from the beginning of the event log).
-- last_event_occurred_at — ISO 8601 of that event; used as the replay cursor
--                      (query: occurred_at > last_event_occurred_at).
-- processed_count    — running total of events processed; useful for lag
--                      monitoring and sanity-checks.
-- error_count        — events that threw an unhandled error; the runner
--                      skips them after logging so the cursor still advances.
-- last_error         — last error message (trimmed to 500 chars).
-- last_error_at      — epoch ms of the last error.
-- updated_at         — epoch ms of the last checkpoint flush.

CREATE TABLE IF NOT EXISTS `projection_checkpoints` (
  `projection_name` text PRIMARY KEY NOT NULL,
  `last_event_id` text,
  `last_event_occurred_at` text,
  `processed_count` integer NOT NULL DEFAULT 0,
  `error_count` integer NOT NULL DEFAULT 0,
  `last_error` text,
  `last_error_at` integer,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `pc_updated_idx` ON `projection_checkpoints` (`updated_at`);
