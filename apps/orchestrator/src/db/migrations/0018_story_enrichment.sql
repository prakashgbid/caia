-- Migration 0018: Story Enrichment columns for BA Agent
-- Adds implementation_notes, updated_at, enriched_at to the stories table

ALTER TABLE `stories` ADD COLUMN `implementation_notes` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `updated_at` integer;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `enriched_at` integer;
