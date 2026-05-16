# Archived: sps-phase3-artifacts

**Archived:** 2026-05-15 (phase B5, integration-remediation-b)
**Original location:** `~/Documents/projects/reports-from-m1/sps-phase3-artifacts/`
**Tarball:** `sps-phase3-artifacts.tar.gz` (~7 KB compressed, 32 KB uncompressed)

## Contents

Historical artifacts from SPS Phase 3 development on M1 (2026-05-09):

- `claude_spawner.py` — early spawner draft (superseded by `caia/services/claude-spawner-agent/claude_spawner_agent.py` in b2)
- `first_spawn_orchestrator.sh` — bootstrap script for Phase 3 first-spawn smoke
- `transcripts/spawn-20260509T202454Z.log`, `transcripts/spec-20260509T202454Z.json`, `transcripts/spawner.pid` — one execution's session record

## Why archived as tarball

Per integration_remediation_plan_2026-05-14.md §B Phase B5: *"sps-phase3-artifacts/: historical. Tarball + delete."*

These were Phase 3 work-in-progress artifacts; current SPS lives in `caia/services/sps/` (b1) and current spawner lives in `caia/services/claude-spawner-agent/` (b2). The PID file and log are session-scoped and have no current value, but bundling them keeps the historical record intact in case we need to audit the Phase 3 timeline.

## Extract

```bash
tar -xzf sps-phase3-artifacts.tar.gz
```
