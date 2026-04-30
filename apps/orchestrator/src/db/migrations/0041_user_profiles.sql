CREATE TABLE IF NOT EXISTS `user_profiles` (
  `id` text PRIMARY KEY NOT NULL,
  `display_name` text NOT NULL DEFAULT '',
  `avatar_url` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
