-- Migration 0041: GRAPHRAG-001 — AKG community detection tables.
--
-- Wraps arch_artifacts + arch_edges (migration 0030) with Microsoft
-- GraphRAG-style community structure. Leiden over the AKG edge graph
-- groups artifacts into hierarchical communities; each community gets an
-- LLM-generated summary (GRAPHRAG-002, migration 0042) the EA mesh's
-- specialists query for "global" architectural questions.
--
-- Three tables:
--   arch_communities             — one row per detected community.
--                                   Hierarchical (level=0 leaves up to
--                                   level=N super-clusters).
--   arch_artifact_communities    — many-to-many membership keyed on
--                                   (artifact_id, level, run_id).
--   arch_community_runs          — one row per Leiden invocation,
--                                   timing + modularity for the dashboard.
--
-- Identifiers: community ids are deterministic — `comm_<runId>_l<level>_<idx>`
-- — so callers can correlate runs without persisting a second mapping.
--
-- See packages/architecture-registry/src/community-detection.ts for the
-- Leiden implementation, and caia/docs/graphrag.md for the GraphRAG
-- architecture rationale.

CREATE TABLE `arch_communities` (
  `id` text PRIMARY KEY NOT NULL,
  `run_id` text NOT NULL,
  `level` integer NOT NULL,
  `parent_community_id` text,
  `member_count` integer NOT NULL DEFAULT 0,
  `internal_edge_count` integer NOT NULL DEFAULT 0,
  `external_edge_count` integer NOT NULL DEFAULT 0,
  `modularity_contribution` real NOT NULL DEFAULT 0,
  `algorithm` text NOT NULL DEFAULT 'leiden',
  `seed_artifact_id` text,
  `tags_json` text NOT NULL DEFAULT '[]',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `arch_communities_run_idx` ON `arch_communities` (`run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_communities_level_idx` ON `arch_communities` (`level`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_communities_run_level_idx` ON `arch_communities` (`run_id`, `level`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_communities_parent_idx` ON `arch_communities` (`parent_community_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_communities_updated_idx` ON `arch_communities` (`updated_at`);
--> statement-breakpoint

CREATE TABLE `arch_artifact_communities` (
  `artifact_id` text NOT NULL,
  `community_id` text NOT NULL,
  `run_id` text NOT NULL,
  `level` integer NOT NULL,
  `is_primary` integer NOT NULL DEFAULT 1,
  `degree_in_community` integer NOT NULL DEFAULT 0,
  `degree_total` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  PRIMARY KEY (`artifact_id`, `level`, `run_id`)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `arch_artifact_communities_artifact_idx` ON `arch_artifact_communities` (`artifact_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_artifact_communities_community_idx` ON `arch_artifact_communities` (`community_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_artifact_communities_run_idx` ON `arch_artifact_communities` (`run_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_artifact_communities_run_level_idx` ON `arch_artifact_communities` (`run_id`, `level`);
--> statement-breakpoint

CREATE TABLE `arch_community_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `started_at` integer NOT NULL,
  `finished_at` integer,
  `duration_ms` integer,
  `algorithm` text NOT NULL DEFAULT 'leiden',
  `total_artifacts` integer NOT NULL DEFAULT 0,
  `total_edges` integer NOT NULL DEFAULT 0,
  `total_communities` integer NOT NULL DEFAULT 0,
  `max_level` integer NOT NULL DEFAULT 0,
  `modularity` real NOT NULL DEFAULT 0,
  `iterations` integer NOT NULL DEFAULT 0,
  `seed` integer,
  `commit_sha` text,
  `is_active` integer NOT NULL DEFAULT 0,
  `error` text,
  `metadata_json` text NOT NULL DEFAULT '{}'
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `arch_community_runs_started_idx` ON `arch_community_runs` (`started_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_community_runs_active_idx` ON `arch_community_runs` (`is_active`);
