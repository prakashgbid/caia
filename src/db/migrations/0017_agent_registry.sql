-- Migration 0017: Agent Registry, System Prompts, Artifacts, Inter-agent Messages
-- Part of the CAIA (Conductor AI Agent) architecture

CREATE TABLE IF NOT EXISTS `agent_registry` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL UNIQUE,
  `display_name` text NOT NULL,
  `tier` text NOT NULL,
  `description` text NOT NULL,
  `version` text NOT NULL DEFAULT '0.1.0',
  `status` text NOT NULL DEFAULT 'registered',
  `endpoint_url` text,
  `model_recommendation` text NOT NULL,
  `capabilities` text NOT NULL DEFAULT '[]',
  `tool_manifest` text NOT NULL DEFAULT '[]',
  `trigger_events` text NOT NULL DEFAULT '[]',
  `input_schema` text,
  `output_schema` text,
  `system_prompt_id` text,
  `last_heartbeat` integer,
  `metadata` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ar_tier_idx` ON `agent_registry` (`tier`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ar_status_idx` ON `agent_registry` (`status`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `agent_system_prompts` (
  `id` text PRIMARY KEY NOT NULL,
  `agent_name` text NOT NULL,
  `version` text NOT NULL,
  `prompt_text` text NOT NULL,
  `is_active` integer NOT NULL DEFAULT 1,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `asp_agent_idx` ON `agent_system_prompts` (`agent_name`, `is_active`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `agent_artifacts` (
  `id` text PRIMARY KEY NOT NULL,
  `agent_name` text NOT NULL,
  `artifact_type` text NOT NULL,
  `prompt_id` text REFERENCES `prompts`(`id`),
  `requirement_id` text,
  `content` text NOT NULL,
  `content_type` text NOT NULL DEFAULT 'application/json',
  `status` text NOT NULL DEFAULT 'draft',
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `aa_agent_idx` ON `agent_artifacts` (`agent_name`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `aa_prompt_idx` ON `agent_artifacts` (`prompt_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `aa_type_idx` ON `agent_artifacts` (`artifact_type`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `agent_messages` (
  `id` text PRIMARY KEY NOT NULL,
  `from_agent` text NOT NULL,
  `to_agent` text NOT NULL,
  `message_type` text NOT NULL,
  `correlation_id` text NOT NULL,
  `payload` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `created_at` integer NOT NULL,
  `processed_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `am_from_idx` ON `agent_messages` (`from_agent`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `am_to_idx` ON `agent_messages` (`to_agent`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `am_correlation_idx` ON `agent_messages` (`correlation_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `am_status_idx` ON `agent_messages` (`status`);
