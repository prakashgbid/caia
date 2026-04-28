ALTER TABLE `timeline_events` ADD `actor` text NOT NULL DEFAULT 'system';--> statement-breakpoint
ALTER TABLE `timeline_events` ADD `summary` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `timeline_events` ADD `subject_id_copy` text;--> statement-breakpoint
ALTER TABLE `timeline_events` ADD `kind_prefix` text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tl_actor_idx` ON `timeline_events` (`actor`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tl_subject_idx` ON `timeline_events` (`subject_kind`,`subject_id`,`created_at`);
