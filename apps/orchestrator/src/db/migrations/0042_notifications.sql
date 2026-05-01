CREATE TABLE IF NOT EXISTS `notifications` (
  `id` text PRIMARY KEY NOT NULL,
  `requirement_id` text,
  `task_id` text,
  `kind` text NOT NULL,
  `message` text NOT NULL,
  `channel` text NOT NULL DEFAULT 'both',
  `is_read` integer NOT NULL DEFAULT 0,
  `read_at` text,
  `metadata` text,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notifications_requirement_id_idx` ON `notifications` (`requirement_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notifications_task_id_idx` ON `notifications` (`task_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notifications_kind_idx` ON `notifications` (`kind`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notifications_is_read_idx` ON `notifications` (`is_read`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `notifications_created_at_idx` ON `notifications` (`created_at`);
