-- Migration 0021: Phase 1 ticket-template & scheduling-bucket tables.
--
-- Two concerns shipped together because they form one contract:
--   1. task_buckets — the scheduling-bucket entity (sequential-per-domain
--      and one parallel bucket per prompt) into which the Task Manager
--      places enriched tickets.
--   2. stories.* additions — columns that hold the ticket-template payload,
--      bucket assignment, template version + validation status, so the
--      executor can read a self-contained ticket.

-- ─── task_buckets ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `task_buckets` (
  `id` text PRIMARY KEY NOT NULL,                 -- e.g. 'bkt_seq_auth_001', 'bkt_par_<prompt>'
  `kind` text NOT NULL,                           -- 'sequential' | 'parallel'
  `domain_slug` text,                             -- non-null for sequential, null for parallel
  `prompt_id` text NOT NULL REFERENCES `prompts`(`id`),
  `created_at` integer NOT NULL,                  -- epoch ms
  `sequence_index` integer,                       -- 0,1,2... for sequential buckets; null for parallel
  `status` text NOT NULL DEFAULT 'open',          -- 'open' | 'in_progress' | 'drained'
  `metadata` text                                 -- JSON: bucket_label, predicted_concurrency, etc.
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tb_prompt` ON `task_buckets` (`prompt_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tb_kind_domain` ON `task_buckets` (`kind`, `domain_slug`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tb_status` ON `task_buckets` (`status`);
--> statement-breakpoint

-- ─── stories: ticket-template + bucket linkage ─────────────────────────────
ALTER TABLE `stories` ADD COLUMN `agent_contributions_json` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `bucket_id` text REFERENCES `task_buckets`(`id`);
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `template_version` text NOT NULL DEFAULT 'v1';
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `template_validation_status` text NOT NULL DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `template_validation_errors` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `story_bucket_idx` ON `stories` (`bucket_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `story_template_status_idx` ON `stories` (`template_validation_status`);
