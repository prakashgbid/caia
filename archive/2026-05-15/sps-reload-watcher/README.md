# Archived: sps-reload-watcher

**Archived:** 2026-05-15 (phase B5, integration-remediation-b)
**Original location:** `~/Documents/projects/reports-from-m1/sps-reload-watcher/`
**Status when archived:** Not loaded into launchd; no running process. No cron/plist references found via `launchctl list` or `~/Library/LaunchAgents/`.

## What it did

`watcher.py` polled `~/Documents/projects/agent-memory/*.md` (the master backlog + brief files), sha256'd each, and pushed deltas via `ssh stolution -> curl` to the SPS K3s ClusterIP at `/reload?purge=false`. M1-era helper used to keep the deployed SPS DAG in sync with locally-edited backlog markdown.

## Why archived (not migrated)

1. **Not running** — no LaunchAgent loaded it; the operator was invoking manually when needed.
2. **Authoritative path moved** — SPS source now lives in `caia/services/sps/` (b1). The reload flow has been folded into the SPS service's own startup / ConfigMap-redeploy story per B1's K3s ConfigMap-mount design.
3. **Transport assumption stale** — script depends on `ssh stolution` from M1; M1 is retired. Re-targeting would mean a rewrite, not a relocation.

Preserved for reference (the sha256-state-file + JSON-line-log pattern is reusable). If the auto-reload flow is ever resurrected, lift the pattern, not the file.

## Resurrection note

If you want this back as a live service: rebuild as a stolution-local pod (no ssh hop) reading from a shared volume or a webhook from caia-monorepo's `push` event. Do not just restart `watcher.py` as-is.
