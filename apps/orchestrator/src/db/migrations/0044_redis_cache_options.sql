-- 0044_cache_config — per-project Redis cache configuration options.
-- Stores connection params and cache settings so agents can discover and use
-- Redis-backed caching without hard-coding connection strings in code.
CREATE TABLE IF NOT EXISTS `redis_cache_options` (
  `id` text PRIMARY KEY,
  `name` text NOT NULL,
  `project_id` text REFERENCES `projects`(`id`),
  `host` text NOT NULL DEFAULT 'localhost',
  `port` integer NOT NULL DEFAULT 6379,
  `db_index` integer NOT NULL DEFAULT 0,
  `password` text,
  `key_prefix` text NOT NULL DEFAULT '',
  `ttl_seconds` integer NOT NULL DEFAULT 3600,
  `max_entries` integer,
  `enabled` integer NOT NULL DEFAULT 1,
  `status` text NOT NULL DEFAULT 'active',
  `scope` text NOT NULL DEFAULT 'global',
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `rco_project_idx` ON `redis_cache_options` (`project_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `rco_enabled_status_idx` ON `redis_cache_options` (`enabled`, `status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `rco_scope_idx` ON `redis_cache_options` (`scope`);
