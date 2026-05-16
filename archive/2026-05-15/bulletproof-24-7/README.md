# Archived: bulletproof-24-7-artifacts

**Archived:** 2026-05-15 (phase B5, integration-remediation-b)
**Original location:** `~/Documents/projects/reports-from-m1/bulletproof-24-7-artifacts/`
**Status when archived:** Superseded by the chain-runner + claude-spawner-agent stack. None of the artifacts are loaded — the lone plist (`com.caia.orchestrator-poller`) references `/Users/MAC/...` (wrong username) and points at `caia/scripts/orchestrator/` which does not exist in the current monorepo.

## Contents (14 files, ~76 KB)

Shell + markdown + YAML for the M1 "bulletproof 24/7" experiment:

- `local-poller.sh`, `idle-detector.sh`, `heartbeat-auditor.sh`, `pick-next-backlog-item.sh`, `pre-send-classifier.sh`, `ollama-semantic-classifier.sh`, `audit-spawn-prefix.sh` — 60-second cron-style poller pipeline.
- `com.caia.orchestrator-poller.plist`, `stolution-orchestrator-poller.cron` — launch glue.
- `decision_defaults.yaml` — early autonomy-rule defaults (now codified in `~/Documents/projects/agent-memory/OPERATING_RULES.md`).
- `backlog-driver-task.md`, `thin-spawner-task.md`, `thin-alerter-task.md`, `standing-rule-sentinel-prefix.md` — prompt-templates for the now-replaced thin-spawner model.

## Why archived (not migrated)

The "bulletproof 24/7" experiment has been **replaced**, not iterated on, by:

- `caia/packages/chain-runner/` — the canonical chain dispatcher + heartbeat/retry/budget engine.
- `caia/services/claude-spawner-agent/` — the canonical spawner (b2 migration).
- `caia/packages/local-llm-router/` — the canonical classifier (replaces `ollama-semantic-classifier.sh`).
- `~/Documents/projects/agent-memory/OPERATING_RULES.md` + standing-rule auto-injection — replaces the `standing-rule-sentinel-prefix.md` template.

Per integration_remediation_plan_2026-05-14.md §B Phase B5, the plan reads: *"7 scripts: superseded by chain-runner. Delete with note."* Archived instead of deleted under AR-5 (every disposition is recoverable from git history within `caia/`).

## Resurrection note

Don't. The prompt templates contain hand-engineered instructions that have been superseded by the chain-runner's worker-prompt-preamble + standing-rule auto-injection. Lifting any of these as-is would conflict with the current operator instructions.
