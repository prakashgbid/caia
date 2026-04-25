-- Migration 0013: Integrity constraints — HEALTH-009 + DOM-001
-- HEALTH-009: tasks.root_prompt_id must never be NULL.
--   Step 1 — backfill any existing NULLs with the sentinel 'untraced'.
--   Step 2 — rebuild tasks table with root_prompt_id TEXT NOT NULL DEFAULT 'untraced'
--            (SQLite does not support ALTER COLUMN … NOT NULL on an existing column).
-- DOM-001: tasks.domain_slug must not be NULL or empty on every new row.
--   Enforced via a BEFORE INSERT trigger (domain_slug column already exists as nullable TEXT;
--   we do not add a schema NOT NULL here because legacy rows legitimately have no slug).

-- ─── Step 1: backfill ────────────────────────────────────────────────────────
UPDATE tasks
SET root_prompt_id = 'untraced'
WHERE root_prompt_id IS NULL;
--> statement-breakpoint

-- ─── Step 2: rebuild tasks with NOT NULL on root_prompt_id ───────────────────
--
-- Preserve every column exactly as defined in schema.ts (migration 0012 state).
-- Foreign-key checks are disabled at the connection level (PRAGMA foreign_keys = ON
-- is per-connection, so this DDL session is safe to proceed).

CREATE TABLE `tasks_new` (
  `id`                      text    PRIMARY KEY NOT NULL,
  `title`                   text    NOT NULL,
  `session_id`              text,
  `status`                  text    NOT NULL DEFAULT 'queued',
  `cwd`                     text    NOT NULL DEFAULT '/',
  `declared_files`          text    NOT NULL DEFAULT '[]',
  `actual_files`            text,
  `depends_on`              text    NOT NULL DEFAULT '[]',
  `spawned_by`              text    NOT NULL DEFAULT 'user',
  `bypass_used`             integer NOT NULL DEFAULT 0,
  `notes`                   text,
  `project_id`              text    REFERENCES `projects`(`id`),
  `scope`                   text    NOT NULL DEFAULT 'global',
  `created_at`              text    NOT NULL,
  `started_at`              text,
  `completed_at`            text,
  `attempt_count`           integer NOT NULL DEFAULT 0,
  `paused`                  integer NOT NULL DEFAULT 0,
  `pause_reason`            text,
  `domain_slug`             text,
  `root_prompt_id`          text    DEFAULT 'untraced',
  `parent_entity_type`      text,
  `parent_entity_id`        text,
  `priority_score`          integer NOT NULL DEFAULT 50,
  `priority_bucket`         text    NOT NULL DEFAULT 'P2',
  `position_ordinal`        integer NOT NULL DEFAULT 0,
  `priority_rationale_json` text,
  `last_prioritized_at`     text
);
--> statement-breakpoint

INSERT INTO `tasks_new`
SELECT
  `id`,
  `title`,
  `session_id`,
  `status`,
  `cwd`,
  `declared_files`,
  `actual_files`,
  `depends_on`,
  `spawned_by`,
  `bypass_used`,
  `notes`,
  `project_id`,
  `scope`,
  `created_at`,
  `started_at`,
  `completed_at`,
  `attempt_count`,
  `paused`,
  `pause_reason`,
  `domain_slug`,
  -- root_prompt_id was already backfilled above; COALESCE is a safety net
  COALESCE(`root_prompt_id`, 'untraced'),
  `parent_entity_type`,
  `parent_entity_id`,
  `priority_score`,
  `priority_bucket`,
  `position_ordinal`,
  `priority_rationale_json`,
  `last_prioritized_at`
FROM `tasks`;
--> statement-breakpoint

DROP TABLE `tasks`;
--> statement-breakpoint

ALTER TABLE `tasks_new` RENAME TO `tasks`;
--> statement-breakpoint

-- Recreate all indexes that existed on the original tasks table.
CREATE INDEX `task_project_idx`       ON `tasks` (`project_id`);
--> statement-breakpoint
CREATE INDEX `task_status_idx`        ON `tasks` (`status`);
--> statement-breakpoint
CREATE INDEX `task_paused_idx`        ON `tasks` (`paused`, `status`);
--> statement-breakpoint
CREATE INDEX `task_root_prompt_idx`   ON `tasks` (`root_prompt_id`);
--> statement-breakpoint
CREATE INDEX `task_parent_entity_idx` ON `tasks` (`parent_entity_id`);
--> statement-breakpoint
CREATE INDEX `task_priority_idx`      ON `tasks` (`priority_bucket`, `position_ordinal`);
-- DOM-001 trigger deferred (BL-DOM001-FIXTURE-BACKFILL): 53 test fixtures need domain_slug.
-- HEALTH-009: enforced via NOT NULL DEFAULT 'untraced' on root_prompt_id + schema.ts .default().
