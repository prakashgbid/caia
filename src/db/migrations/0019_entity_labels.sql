-- Migration 0019: Entity Labels + Dedup Results
-- entity_labels: domain taxonomy labels applied to any entity
-- dedup_results: deduplication check outcomes

CREATE TABLE IF NOT EXISTS `entity_labels` (
  `id` text PRIMARY KEY NOT NULL,
  `entity_kind` text NOT NULL,
  `entity_id` text NOT NULL,
  `label_slug` text NOT NULL,
  `label_type` text NOT NULL,
  `confidence` real NOT NULL DEFAULT 1.0,
  `source` text NOT NULL DEFAULT 'classifier',
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_el_entity` ON `entity_labels` (`entity_kind`, `entity_id`);
--> statement-breakpoint
CREATE INDEX `idx_el_label` ON `entity_labels` (`label_slug`);
--> statement-breakpoint
CREATE INDEX `idx_el_type` ON `entity_labels` (`label_type`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `dedup_results` (
  `id` text PRIMARY KEY NOT NULL,
  `entity_kind` text NOT NULL,
  `entity_id` text NOT NULL,
  `checked_at` integer NOT NULL,
  `decision` text NOT NULL,
  `similarity_score` real NOT NULL DEFAULT 0,
  `similar_entities` text NOT NULL DEFAULT '[]',
  `recommendations` text NOT NULL DEFAULT '[]',
  `resolved_action` text,
  `resolved_at` integer,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_dr_entity` ON `dedup_results` (`entity_kind`, `entity_id`);
--> statement-breakpoint
CREATE INDEX `idx_dr_decision` ON `dedup_results` (`decision`);
