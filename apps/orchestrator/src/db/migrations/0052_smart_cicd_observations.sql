-- migration 0052: smart_cicd_observations
--
-- Worked-example agent table (caia-ai-tech-modernization-proposal §6A.5).
-- Records every Smart CI/CD Agent daily observation + proposed action.
-- The agent is propose-only — it never auto-merges PRs, never deletes
-- branches, never force-pushes. Operators preserve veto via the
-- proposed_action_payload_json + acted_outcome columns.
--
-- proposed_action_kind ∈ {auto-fix-pr, rec-issue, prompt-update, skill-bump, silent}
-- acted_outcome        ∈ {merged, rejected, still-open, silent}
-- feedback_label       ∈ {accepted, rejected, pending}

CREATE TABLE IF NOT EXISTS smart_cicd_observations (
  id TEXT PRIMARY KEY,
  observation_date INTEGER NOT NULL,
  bucket_name TEXT NOT NULL,
  root_cause TEXT NOT NULL,
  root_cause_confidence REAL NOT NULL,
  proposed_action_kind TEXT NOT NULL,
  proposed_action_payload_json TEXT NOT NULL,
  acted_at INTEGER,
  acted_outcome TEXT,
  feedback_label TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS smart_cicd_obs_date ON smart_cicd_observations(observation_date);
CREATE INDEX IF NOT EXISTS smart_cicd_obs_action_kind ON smart_cicd_observations(proposed_action_kind);
CREATE INDEX IF NOT EXISTS smart_cicd_obs_feedback ON smart_cicd_observations(feedback_label);
