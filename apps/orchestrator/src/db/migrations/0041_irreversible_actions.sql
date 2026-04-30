-- HARDEN-009 — capability-broker irreversible-action ledger.
--
-- Mirrors packages/capability-broker/migrations/0001_irreversible_actions.sql.
-- Reference: caia/docs/capability-broker.md, third-party-paper §C.1.
--
-- Renumbered 0037 → 0041 in fix/orchestrator-migration-0037-journal-add
-- because 0037_story_capsule.sql already occupied that slot in
-- meta/_journal.json. drizzle's runner uses the journal `tag` field for
-- ordering, not the on-disk filename, so the renumber preserves apply
-- order while resolving the duplicate-prefix collision.

CREATE TABLE IF NOT EXISTS `irreversible_actions` (
  `id`                  text PRIMARY KEY NOT NULL,
  `ts`                  integer NOT NULL,
  `agent_role`          text NOT NULL,
  `task_id`             text NOT NULL,
  `capability_name`     text NOT NULL,
  `scope`               text NOT NULL,
  `reason`              text NOT NULL,
  `action_payload_json` text NOT NULL,
  `result_json`         text NOT NULL,
  `undo_token`          text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `irreversible_actions_task_idx`
  ON `irreversible_actions` (`task_id`, `ts`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `irreversible_actions_capability_idx`
  ON `irreversible_actions` (`capability_name`, `ts`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `irreversible_actions_ts_idx`
  ON `irreversible_actions` (`ts`);
