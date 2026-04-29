-- Migration 0034: TASKMGR-005 — bucket_health_history ring buffer.
--
-- The HealthMetricsEmitter writes one row per bucket per emission cycle
-- (default 60s). The /workers dashboard renders the last 60 entries per
-- bucket as a sparkline so operators can see trends.
--
-- Rows are append-only; a periodic prune (or just a SELECT ... LIMIT 60
-- ORDER BY ts DESC at read time) keeps the surface manageable.
--
-- Companion shape (per the architecture report §3.5):
--   queue_depth         — count of stories where bucket_id=X AND status='pending'
--                         AND assigned_worker_id IS NULL.
--   throughput_per_hour — count of `task.tested_and_done` events for stories in
--                         this bucket over the last hour, projected to /hr rate.
--   oldest_ready_age_s  — age in seconds of the oldest unassigned ready story
--                         in this bucket (NULL if no ready stories).
--   workers_assigned    — count of workers whose currentStoryId points at a
--                         story in this bucket.

CREATE TABLE IF NOT EXISTS `bucket_health_history` (
  `id` text PRIMARY KEY NOT NULL,
  `bucket_id` text NOT NULL,
  `ts` integer NOT NULL,
  `queue_depth` integer NOT NULL,
  `throughput_per_hour` real NOT NULL,
  `oldest_ready_age_s` integer,
  `workers_assigned` integer NOT NULL,
  `engaged` integer NOT NULL DEFAULT 0
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `bhh_bucket_ts_idx` ON `bucket_health_history` (`bucket_id`, `ts`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `bhh_ts_idx` ON `bucket_health_history` (`ts`);
