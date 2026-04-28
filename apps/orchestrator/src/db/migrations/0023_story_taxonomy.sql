-- Migration 0023: BUCKET-001 — Story-level 9-axis taxonomy + resource claims.
--
-- Adds the new taxonomy columns mandated by the PO Taxonomy directive
-- (2026-04-28). All columns nullable on this migration so existing stories
-- continue to load; BUCKET-007 backfill populates them and migration 0025
-- flips them to NOT NULL. See ~/Documents/projects/reports/po-taxonomy-proposal-2026-04-28.md.
--
-- Mirrors the Zod taxonomy block in @chiefaia/ticket-template:
--   business_sub_domains_json   → string[]  (per-project enum)
--   tech_sub_domains_json       → string[]  (subset of TECH_SUB_DOMAINS)
--   tech_sub_domain_primary     → enum      (one of TECH_SUB_DOMAINS) — bucket key
--   lifecycle                   → enum      (LIFECYCLE_VALUES)
--   quality_tags_json           → string[]  (subset of QUALITY_TAGS)
--   risk                        → enum      (RISK_VALUES)
--   effort                      → enum      (EFFORT_VALUES)
--   priority_bucket             → enum      (PRIORITY_VALUES)
--   blocked_by_json             → string[]  (story IDs, hard ordering)
--   soft_depends_on_json        → string[]  (story IDs, soft preference)
--   conflicts_with_json         → string[]  (story IDs, mutual exclusion)
--   claims_json                 → object    (BUCKET-009: files/schemas/apiRoutes/domains)

ALTER TABLE `stories` ADD COLUMN `business_sub_domains_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `tech_sub_domains_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `tech_sub_domain_primary` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `lifecycle` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `quality_tags_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `risk` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `effort` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `priority_bucket` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `blocked_by_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `soft_depends_on_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `conflicts_with_json` text NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `claims_json` text NOT NULL DEFAULT '{}';
--> statement-breakpoint

-- Indexes — bucket-placer reads (project_slug, tech_sub_domain_primary)
-- as the bucket key on every placement; we want it covered.
CREATE INDEX IF NOT EXISTS `story_project_tech_idx` ON `stories` (`project_slug`, `tech_sub_domain_primary`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `story_lifecycle_idx` ON `stories` (`lifecycle`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `story_risk_idx` ON `stories` (`risk`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `story_priority_bucket_idx` ON `stories` (`priority_bucket`);
