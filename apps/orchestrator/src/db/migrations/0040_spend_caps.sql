-- Migration 0040: SAFETY-004 — spend_caps + spend_records tables.
--
-- Wires `@chiefaia/spend-guard` into the orchestrator. Every Claude API
-- call (and every Ollama call routed through local-llm-router) records
-- into spend_records; before each call, the router checks active caps
-- via getActiveCapsFor().
--
-- Defaults per v2 §6.2:
--   - global-day:  $25
--   - global-week: $100
--   - project:     $30  (per project, weekly)
--   - task:        $1.50 (per task, daily reset)
--
-- Reference: caia/docs/spend-guard.md, v2 §6.

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

CREATE INDEX IF NOT EXISTS `spend_records_task_id_idx` ON `spend_records` (`task_id`);
CREATE INDEX IF NOT EXISTS `spend_records_project_id_idx` ON `spend_records` (`project_id`);
CREATE INDEX IF NOT EXISTS `spend_records_ts_idx` ON `spend_records` (`ts_ms_epoch`);
