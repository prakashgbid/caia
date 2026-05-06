# Mac-native dev utilities

> **Source**: distilled from `caia-enterprise-architecture-comprehensive-2026-05-06.md` §9.3.

This document tracks the Mac-native CLI utilities CAIA installs as part of the quick-wins Batch C cluster. Each is `$0`, all run on Mac directly.

## Installed

### `direnv`

- **Purpose**: per-project shell environment isolation. When a shell `cd`s into a directory containing an `.envrc`, direnv applies it; on exit, undoes it.
- **Installed via**: `brew install direnv`
- **Shell hook**: `eval "$(/opt/homebrew/bin/direnv hook zsh)"` appended to `~/.zshrc`.
- **Per-project config**: [`.envrc`](../.envrc) at repo root.
- **First-use step (interactive, operator-side)**: `cd <repo>; direnv allow` — required once per `.envrc` (security against arbitrary directory-execution).

### `restic`

- **Purpose**: encrypted, deduplicated, snapshot-based backup tool. Compliments existing Vault snapshot + DB hourly backup pipeline (per `caia/docs/information-classification.md`) by adding an option for memory + reports + worktree backup at the same maturity level.
- **Installed via**: `brew install restic`
- **Verified**: `restic version` returns `restic 0.18.1`.
- **First-use plan**: future runbook (e.g., DR drill, backup expansion) will codify a restic repository at `~/Library/Application Support/Stolution/restic-repo` with weekly snapshots of memory + reports.

## Skipped (already adequate)

### Docker alternative (`colima` / `orbstack`)

- **Skipped**. Docker Desktop is already installed (`brew list --cask` shows `docker-desktop`).
- The audit recommended colima/orbstack as alternatives only if Docker was missing. Re-evaluate only if Docker Desktop becomes problematic (license change, resource overhead).

## Operator-side TODO

These are operations only the operator can do (Claude can install but cannot run interactive shell hooks):

1. Open a fresh terminal session so `direnv hook zsh` activates.
2. From the caia repo root, run `direnv allow` once to authorise `.envrc`.
3. Validate by checking `direnv status` from inside the caia directory.

## See also

- [`information-classification.md`](information-classification.md) — backup pipeline classification + retention
- `~/Documents/projects/reports/caia-enterprise-architecture-comprehensive-2026-05-06.md` §9.3 + §10.2.1 — full audit
