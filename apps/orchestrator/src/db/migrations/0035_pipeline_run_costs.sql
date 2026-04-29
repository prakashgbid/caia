-- Migration 0035: HARDEN-002 — per-pipeline-run cost tracking.
--
-- One row per pipeline-run (keyed by the prompt's correlation_id). Every
-- LLM call routed through @chiefaia/local-llm-router updates the row in
-- place: total_calls / local_calls / claude_calls / total_cost_usd /
-- baseline_cost_usd / per_agent_breakdown_json. The dashboard reads
-- these rows for the /metrics/cost panel.
--
-- alert_triggered_at is set the first time a single run exceeds the
-- env-configurable threshold (CAIA_PIPELINE_COST_ALERT_USD, default $5).
-- Once set, no further alerts fire for that run — the operator has been
-- notified.

CREATE TABLE IF NOT EXISTS `pipeline_run_costs` (
  `correlation_id`        text PRIMARY KEY NOT NULL,
  `total_calls`           integer NOT NULL DEFAULT 0,
  `local_calls`           integer NOT NULL DEFAULT 0,
  `claude_calls`          integer NOT NULL DEFAULT 0,
  `total_cost_usd`        real    NOT NULL DEFAULT 0,
  `baseline_cost_usd`     real    NOT NULL DEFAULT 0,
  `per_agent_breakdown_json` text NOT NULL DEFAULT '{}',
  `started_at`            integer NOT NULL,
  `last_updated_at`       integer NOT NULL,
  `alert_triggered_at`    integer
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `pipeline_run_costs_updated_idx`
  ON `pipeline_run_costs` (`last_updated_at`);
