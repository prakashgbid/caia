-- Migration 0033: TASKMGR-001 — worker_pool registry table.
--
-- The Task Manager Agent maintains an in-process WorkerPoolRegistry that
-- mirrors this table. Workers (Coding Agents + Fix-It Test Agents) self-
-- register on startup, heartbeat every 15s, and emit `worker.released`
-- when they finish a story. Task Manager's stale-detector sweeps every 30s
-- and marks workers `crashed` when their last heartbeat is older than 60s.
--
-- A separate row exists per worker process. The registry is durable so
-- that an orchestrator restart can rebuild the in-memory pool (workers
-- self-re-register on reconnect, but the durable record lets the dashboard
-- show "last known state" between bounces).
--
-- Companion taxonomy:
--   kind:
--     'coding'    — Coding Agent worker (apps/worker-coding/)
--     'fix-it'    — Fix-It Test Agent worker (apps/worker-fix-it/)
--   status:
--     'idle'      — registered, no current assignment.
--     'busy'      — currently working `current_story_id`.
--     'crashed'   — heartbeat is stale (> 60s); story was requeued.
--     'released'  — worker explicitly shut down (set on `worker.released`
--                   for terminal-state workers; useful for debugging).
--
--   capabilities is a JSON array of bucket ids the worker is willing to
--   accept; an empty array means "any bucket" (default).

CREATE TABLE IF NOT EXISTS `worker_pool` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `capabilities_json` text NOT NULL DEFAULT '[]',
  `status` text NOT NULL,
  `current_story_id` text,
  `last_heartbeat_at` integer NOT NULL,
  `registered_at` integer NOT NULL,
  `released_at` integer,
  `metadata_json` text NOT NULL DEFAULT '{}'
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `worker_pool_status_idx` ON `worker_pool` (`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `worker_pool_kind_idx` ON `worker_pool` (`kind`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `worker_pool_current_story_idx` ON `worker_pool` (`current_story_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `worker_pool_heartbeat_idx` ON `worker_pool` (`last_heartbeat_at`);
