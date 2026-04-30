CREATE TABLE IF NOT EXISTS `spend_caps` (
  `scope` text NOT NULL,
  `resource_id` text NOT NULL,
  `period_sec` integer NOT NULL,
  `limit_usd` real NOT NULL,
  `current_usd` real NOT NULL DEFAULT 0,
  `last_reset_ms_epoch` integer NOT NULL,
  `locked_until_ms_epoch` integer,
  PRIMARY KEY (`scope`, `resource_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `spend_records` (
  `id` text PRIMARY KEY NOT NULL,
  `task_id` text NOT NULL,
  `project_id` text,
  `agent_role` text NOT NULL,
  `model` text NOT NULL,
  `via` text NOT NULL,
  `account_id` text,
  `input_tokens` integer NOT NULL,
  `output_tokens` integer NOT NULL,
  `cost_usd` real NOT NULL,
  `ts_ms_epoch` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `spend_records_task_id_idx` ON `spend_records` (`task_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `spend_records_project_id_idx` ON `spend_records` (`project_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `spend_records_ts_idx` ON `spend_records` (`ts_ms_epoch`);
