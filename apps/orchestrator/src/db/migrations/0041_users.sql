CREATE TABLE IF NOT EXISTS `users` (
  `id` text PRIMARY KEY NOT NULL,
  `external_id` text,
  `handle` text,
  `display_name` text,
  `email` text,
  `avatar_url` text,
  `metadata_json` text NOT NULL DEFAULT '{}',
  `first_seen_at` text NOT NULL,
  `last_seen_at` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_external_id_idx` ON `users` (`external_id`) WHERE `external_id` IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_idx` ON `users` (`email`) WHERE `email` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `users_last_seen_idx` ON `users` (`last_seen_at` DESC);
