-- Migration 0028: FREG-001 — feature registry tables.
--
-- The Feature Registry catalogs every shipped feature/route/component/
-- agent so the PO Agent can classify a new task as `enhance` (matches
-- an existing feature) vs `new`. Two ordinary tables are declared here:
--
--   feature_registry             — one row per shipped feature.
--   feature_registry_search_log  — observability ring buffer.
--
-- Two virtual tables — `feature_registry_vec` (sqlite-vec vec0) and
-- `feature_registry_fts` (FTS5) — are wired by FREG-002 once the
-- sqlite-vec extension is loaded into the connection. They are NOT
-- created here because:
--   1. drizzle-kit doesn't model virtual tables; introspection breaks.
--   2. The vec0 module isn't loaded at migration time; the CREATE
--      VIRTUAL TABLE call would fail with "no such module: vec0".
-- FREG-002 calls a small idempotent bootstrap that runs CREATE VIRTUAL
-- TABLE IF NOT EXISTS for both, after `sqliteVec.load(db)`.
--
-- See ~/Documents/projects/reports/feature-registry-architecture-2026-04-28.md
-- for the architecture rationale, latency budget, and threshold tuning.

CREATE TABLE `feature_registry` (
  `id` text PRIMARY KEY NOT NULL,
  `project` text NOT NULL,
  `name` text NOT NULL,
  `description` text NOT NULL,
  `route_path` text,
  `file_paths_json` text NOT NULL DEFAULT '[]',
  `component_name` text,
  `api_endpoint` text,
  `db_tables_json` text NOT NULL DEFAULT '[]',
  `agent_name` text,
  `shipped_at` integer NOT NULL,
  `story_id` text,
  `tags_json` text NOT NULL DEFAULT '[]',
  `embedding_model` text NOT NULL DEFAULT 'nomic-embed-text',
  `embedding_dim` integer NOT NULL DEFAULT 768,
  `embedding_version` text NOT NULL DEFAULT 'v1.5',
  `source` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `dedup_key` text NOT NULL UNIQUE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `freg_project_idx` ON `feature_registry` (`project`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `freg_shipped_idx` ON `feature_registry` (`shipped_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `freg_story_idx` ON `feature_registry` (`story_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `freg_source_idx` ON `feature_registry` (`source`);
--> statement-breakpoint

CREATE TABLE `feature_registry_search_log` (
  `id` text PRIMARY KEY NOT NULL,
  `query` text NOT NULL,
  `project` text,
  `classification` text NOT NULL,
  `top_match_id` text,
  `top_score` real,
  `threshold_used` real NOT NULL,
  `latency_ms` integer NOT NULL,
  `embedder_tokens` integer NOT NULL DEFAULT 0,
  `hit_count` integer NOT NULL DEFAULT 0,
  `caller` text NOT NULL DEFAULT 'po-agent',
  `created_at` integer NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `freg_log_created_idx` ON `feature_registry_search_log` (`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `freg_log_classification_idx` ON `feature_registry_search_log` (`classification`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `freg_log_caller_idx` ON `feature_registry_search_log` (`caller`);
