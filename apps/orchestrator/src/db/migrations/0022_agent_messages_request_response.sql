-- Migration 0022: Request/response protocol on agent_messages.
--
-- The BA agent now collaborates with domain consultants (architecture, db,
-- api, ui, security, testing, release, observability) via correlated
-- request/response messages. Three new columns make this possible:
--   - expected_reply_by — epoch ms deadline for the responder
--   - replied_at        — epoch ms stamped when the reply lands
--   - parent_message_id — links a reply back to its request
--
-- Pre-existing rows (one-way `context-broadcast` messages from the
-- scaffolder) are unaffected — all three columns are nullable.

ALTER TABLE `agent_messages` ADD COLUMN `expected_reply_by` integer;
--> statement-breakpoint
ALTER TABLE `agent_messages` ADD COLUMN `replied_at` integer;
--> statement-breakpoint
ALTER TABLE `agent_messages` ADD COLUMN `parent_message_id` text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `am_parent_idx` ON `agent_messages` (`parent_message_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `am_deadline_idx` ON `agent_messages` (`expected_reply_by`);
