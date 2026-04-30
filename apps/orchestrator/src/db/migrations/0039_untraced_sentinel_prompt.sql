-- Migration 0039: KPI2-001 — sentinel 'untraced' prompt row.
--
-- Why: the tasks/stories/requirements/blockers/questions tables all default
-- `root_prompt_id` to the literal string 'untraced' (introduced in 0014 and
-- 0016). The intent was for 'untraced' to be a real, referenceable prompt
-- row so KPI2 lineage queries (`SELECT … FROM tasks JOIN prompts ON
-- tasks.root_prompt_id = prompts.id`) never produce dangling references.
--
-- The blocker `blk_kpi2_lineage_fix_proposal_1777193485` documented that no
-- such row was ever inserted, so 197 rows in `tasks` had a dangling
-- root_prompt_id. The audit at
-- `Documents/projects/reports/outstanding-tasks-audit-2026-04-30.md`
-- picked up the hot-patch (option B); this migration is the canonical fix
-- so any new DB (test, prod, or local) starts with the sentinel in place.
--
-- The row is intentionally minimal: id='untraced', empty body, sentinel
-- correlation/hash, status='completed' (so it's never picked up by any
-- pipeline-stage scan that filters status='received'). receivedAt is a
-- fixed timestamp predating all real data so the row sorts to the end of
-- any received_at-ordered list.
--
-- INSERT is idempotent via OR IGNORE — safe even if a future code path
-- creates the sentinel before this migration runs.

INSERT OR IGNORE INTO `prompts` (
  `id`,
  `body`,
  `received_at`,
  `received_via`,
  `correlation_id`,
  `hash`,
  `metadata_json`,
  `status`,
  `run_mode`
) VALUES (
  'untraced',
  '',
  '1970-01-01T00:00:00.000Z',
  'system',
  'sentinel-untraced',
  'sentinel-untraced',
  '{"sentinel":true,"reason":"target row for tasks.root_prompt_id default; kpi2-001 fix"}',
  'completed',
  'full'
);
