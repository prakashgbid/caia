-- Migration 0030: ARCH-001 — Architecture Knowledge Graph (AKG) tables.
--
-- The Architecture Registry catalogs every architectural artifact in CAIA
-- + sites (services, APIs, components, themes, plugins, packages,
-- schemas, migrations, integrations, domain modules, observability
-- signals, ADRs) plus the directed dependency edges between them.
-- The EA Agent (ARCH-006) queries this graph by `tech_sub_domain` to
-- produce per-domain technical implementation instructions on every
-- story.
--
-- Two ordinary tables are declared here:
--
--   arch_artifacts             — one row per architectural artifact.
--   arch_edges                 — directed relationship rows.
--
-- One observability table:
--
--   arch_extract_runs          — each AST/introspect/scan invocation,
--                                 with timing + counts for the dashboard.
--
-- Two virtual tables — `arch_artifacts_vec` (sqlite-vec vec0) and
-- `arch_artifacts_fts` (FTS5) — are wired by ARCH-004 once the sqlite-vec
-- extension is loaded into the connection. They are NOT created here for
-- the same reasons as feature_registry's virtual tables (drizzle-kit
-- doesn't model virtual tables; the vec0 module isn't loaded at migration
-- time).
--
-- See ~/Documents/projects/reports/architecture-registry-architecture-2026-04-28.md
-- for the full architecture rationale, schema design, extraction strategy,
-- and EA Agent integration design.

CREATE TABLE `arch_artifacts` (
  `id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `project` text NOT NULL,
  `name` text NOT NULL,
  `description` text NOT NULL,
  `key_signature` text,
  `file_paths_json` text NOT NULL DEFAULT '[]',
  `entry_path` text,
  `route_signature` text,
  `table_name` text,
  `owning_service` text,
  `package_name` text,
  `design_system_tier` text,
  `tech_sub_domains_json` text NOT NULL DEFAULT '[]',
  `tags_json` text NOT NULL DEFAULT '[]',
  `metadata_json` text NOT NULL DEFAULT '{}',
  `source` text NOT NULL,
  `content_hash` text,
  `extracted_at_commit` text,
  `embedding_model` text NOT NULL DEFAULT 'nomic-embed-text',
  `embedding_dim` integer NOT NULL DEFAULT 768,
  `embedding_version` text NOT NULL DEFAULT 'v1.5',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  `dedup_key` text NOT NULL UNIQUE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `arch_artifacts_kind_idx` ON `arch_artifacts` (`kind`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_artifacts_project_idx` ON `arch_artifacts` (`project`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_artifacts_kind_project_idx` ON `arch_artifacts` (`kind`, `project`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_artifacts_owning_service_idx` ON `arch_artifacts` (`owning_service`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_artifacts_package_idx` ON `arch_artifacts` (`package_name`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_artifacts_route_idx` ON `arch_artifacts` (`route_signature`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_artifacts_table_idx` ON `arch_artifacts` (`table_name`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_artifacts_source_idx` ON `arch_artifacts` (`source`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_artifacts_updated_idx` ON `arch_artifacts` (`updated_at`);
--> statement-breakpoint

CREATE TABLE `arch_edges` (
  `id` text PRIMARY KEY NOT NULL,
  `from_id` text NOT NULL,
  `to_id` text NOT NULL,
  `relation` text NOT NULL,
  `weight` real NOT NULL DEFAULT 1.0,
  `metadata_json` text NOT NULL DEFAULT '{}',
  `source` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  UNIQUE (`from_id`, `to_id`, `relation`)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `arch_edges_from_idx` ON `arch_edges` (`from_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_edges_to_idx` ON `arch_edges` (`to_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_edges_relation_idx` ON `arch_edges` (`relation`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_edges_from_relation_idx` ON `arch_edges` (`from_id`, `relation`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_edges_to_relation_idx` ON `arch_edges` (`to_id`, `relation`);
--> statement-breakpoint

-- arch_extract_runs — one row per extractor invocation. Powers the
-- dashboard /architecture page (ARCH-007) "last extracted" panel and lets
-- ops see which extractors are slow / produce large deltas.
CREATE TABLE `arch_extract_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `extractor` text NOT NULL,
  `started_at` integer NOT NULL,
  `finished_at` integer,
  `duration_ms` integer,
  `commit_sha` text,
  `artifacts_inserted` integer NOT NULL DEFAULT 0,
  `artifacts_updated` integer NOT NULL DEFAULT 0,
  `artifacts_unchanged` integer NOT NULL DEFAULT 0,
  `edges_inserted` integer NOT NULL DEFAULT 0,
  `edges_updated` integer NOT NULL DEFAULT 0,
  `error` text,
  `metadata_json` text NOT NULL DEFAULT '{}'
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `arch_extract_runs_extractor_idx` ON `arch_extract_runs` (`extractor`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `arch_extract_runs_started_idx` ON `arch_extract_runs` (`started_at`);
