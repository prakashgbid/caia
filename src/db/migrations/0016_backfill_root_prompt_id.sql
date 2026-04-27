-- Migration 0016: Best-effort backfill of root_prompt_id
-- Only updates records where the link is deterministically derivable
-- via parent_entity_type / parent_entity_id foreign-key pattern.
--
-- Note: requirements.root_prompt_id has no deterministic source to derive from
-- (no direct prompt FK exists on the requirements table), so requirements rows
-- are left for the application to populate when creating new records.

-- ─── 1. Propagate from requirements to tasks ─────────────────────────────────
-- Tasks whose parent entity is a requirement inherit its root_prompt_id.
-- Tasks default root_prompt_id to 'untraced'; treat both NULL and 'untraced'
-- as candidates for backfill.
--> statement-breakpoint
UPDATE tasks
SET root_prompt_id = (
  SELECT r.root_prompt_id
  FROM requirements r
  WHERE r.id = tasks.parent_entity_id
)
WHERE (tasks.root_prompt_id IS NULL OR tasks.root_prompt_id = 'untraced')
  AND tasks.parent_entity_type = 'requirement'
  AND tasks.parent_entity_id IS NOT NULL
  AND (
    SELECT r.root_prompt_id
    FROM requirements r
    WHERE r.id = tasks.parent_entity_id
  ) IS NOT NULL;

-- ─── 2. Propagate from tasks to task_runs ────────────────────────────────────
-- task_runs whose parent entity is a task inherit its root_prompt_id.
--> statement-breakpoint
UPDATE task_runs
SET root_prompt_id = (
  SELECT t.root_prompt_id
  FROM tasks t
  WHERE t.id = task_runs.parent_entity_id
)
WHERE task_runs.root_prompt_id IS NULL
  AND task_runs.parent_entity_type = 'task'
  AND task_runs.parent_entity_id IS NOT NULL
  AND (
    SELECT t.root_prompt_id
    FROM tasks t
    WHERE t.id = task_runs.parent_entity_id
  ) IS NOT NULL
  AND (
    SELECT t.root_prompt_id
    FROM tasks t
    WHERE t.id = task_runs.parent_entity_id
  ) != 'untraced';

-- ─── 3. Propagate from requirements to task_runs (direct parent link) ────────
-- task_runs whose parent entity is directly a requirement.
--> statement-breakpoint
UPDATE task_runs
SET root_prompt_id = (
  SELECT r.root_prompt_id
  FROM requirements r
  WHERE r.id = task_runs.parent_entity_id
)
WHERE task_runs.root_prompt_id IS NULL
  AND task_runs.parent_entity_type = 'requirement'
  AND task_runs.parent_entity_id IS NOT NULL
  AND (
    SELECT r.root_prompt_id
    FROM requirements r
    WHERE r.id = task_runs.parent_entity_id
  ) IS NOT NULL;
