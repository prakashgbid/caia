-- Migration 0008: Canonical event store
-- Every event emitted through the event bus is persisted here.
-- Schema version: 1

CREATE TABLE `events` (
  `id` text PRIMARY KEY NOT NULL,
  `type` text NOT NULL,
  `occurred_at` text NOT NULL,
  `actor` text NOT NULL,
  `correlation_id` text,
  `causation_id` text,
  `trace_id` text,
  `span_id` text,
  `entity_type` text,
  `entity_id` text,
  `project_slug` text,
  `domain_slugs_json` text NOT NULL DEFAULT '[]',
  `payload_json` text NOT NULL DEFAULT '{}',
  `metadata_json` text NOT NULL DEFAULT '{}',
  `severity` text NOT NULL DEFAULT 'info'
);
--> statement-breakpoint
CREATE INDEX `ev_type_idx` ON `events` (`type`);
--> statement-breakpoint
CREATE INDEX `ev_correlation_idx` ON `events` (`correlation_id`);
--> statement-breakpoint
CREATE INDEX `ev_entity_idx` ON `events` (`entity_id`);
--> statement-breakpoint
CREATE INDEX `ev_occurred_idx` ON `events` (`occurred_at` DESC);
--> statement-breakpoint
CREATE INDEX `ev_actor_idx` ON `events` (`actor`);
--> statement-breakpoint
CREATE INDEX `ev_project_idx` ON `events` (`project_slug`);
