# Archived: m1-final-snapshot-2026-05-11

**Archived:** 2026-05-15 (phase B5, integration-remediation-b)
**Original location:** `~/Documents/projects/agent-memory/m1-final-snapshot-2026-05-11/`
**Tarball:** `m1-final-snapshot-2026-05-11.tar.gz` (~64 KB compressed, 556 KB uncompressed)

## Contents

Forensic snapshot of the M1 mac captured just before that machine was retired (2026-05-11):

- `forensic-state/` — process snapshots, open files, lsof output
- `launchagents/` — every plist loaded on M1 at retirement (~39 plists; cross-reference for "what did M1 actually run?")
- `local-bin/`, `user-bin/` — `/usr/local/bin` and `~/bin` listings
- `m1.bashrc`, `m1.zshrc`, `m1.zprofile`, `m1.gitconfig`, `m1.crontab` — shell + git + cron config
- `m1.brew-formulae`, `m1.brew-casks`, `m1.bin-listing`, `m1.local-bin-listing` — installed software inventories
- `sys-info.txt` — system_profiler dump

## Why archived as tarball

Per integration_remediation_plan_2026-05-14.md §B Phase B5: *"agent-memory/m1-final-snapshot-2026-05-11/: historical. Tarball + delete."*

M1 is retired. The snapshot is the authoritative record of what was running there — useful for forensics if a stolution/this-mac issue is later traced back to an M1-era assumption (e.g., a plist path, a brew formula dep). Compressing + parking under `caia/archive/` brings it under version control without bloating the agent-memory directory listing.

## Extract

```bash
tar -xzf m1-final-snapshot-2026-05-11.tar.gz
```
