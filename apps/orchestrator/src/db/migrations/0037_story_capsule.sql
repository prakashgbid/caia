-- Migration 0037: CAPSULE-FORMALIZE — Context Capsule formalization (third-party paper §C.5).
--
-- Adds three columns to `stories` so the orchestrator can freeze and
-- the Coding Agent can verify the Context Capsule for every ticket
-- handed off for execution:
--
--   capsule_hash       — 64-char lowercase hex SHA-256 over the
--                        canonicalised six-slice capsule projection
--                        (spec_slice + contracts + acceptance_tests +
--                        file_allowlist + tool_allowlist + budget).
--                        Computed by `freezeCapsule()` from
--                        `@chiefaia/ticket-template`.
--   capsule_frozen_at  — Epoch ms when the hash was frozen. Companion
--                        to capsule_hash; both are set together.
--   capsule_version    — Capsule slice-set version. 'v1' today (six
--                        slices). Bumped when the slice list changes
--                        in a future track.
--
-- Wired in:
--   - producer:  apps/orchestrator/src/agents/task-scheduler.ts (or
--                pipeline-stages.ts) at the
--                bucket_placed -> ready_for_pickup transition.
--   - consumer:  apps/worker-coding/src/main.ts — first action on a
--                claimed story is `verifyCapsule(ticket)`; on drift
--                the worker raises a `capsule-drift` blocker rather
--                than acting on stale context.
--
-- All three columns are nullable: legacy stories that pre-date this
-- migration carry NULL for all three until they next round-trip
-- through the orchestrator, and the schema's superRefine treats
-- "all three NULL" as the legitimate pre-capsule state.
--
-- Idempotency: ALTER TABLE add column is non-idempotent in SQLite.
-- We do not guard against re-application here because Drizzle's
-- migration runner records the journal entry and never re-applies a
-- migration with the same tag.
--
-- Multi-statement: this file uses Drizzle's standard breakpoint
-- markers between statements because better-sqlite3's prepare()
-- rejects multi-statement SQL strings, and Drizzle's migrator
-- splits on the marker before handing each statement to prepare().

ALTER TABLE `stories` ADD COLUMN `capsule_hash` text;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `capsule_frozen_at` integer;
--> statement-breakpoint
ALTER TABLE `stories` ADD COLUMN `capsule_version` text;
--> statement-breakpoint
CREATE INDEX `story_capsule_hash_idx` ON `stories` (`capsule_hash`);
--> statement-breakpoint
CREATE INDEX `story_capsule_frozen_at_idx` ON `stories` (`capsule_frozen_at`);
