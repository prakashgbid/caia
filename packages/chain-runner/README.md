# @chiefaia/chain-runner

Multi-phase **chain runner** for long-running, autonomous Claude work.

A "chain" is a YAML-defined sequence of phases. Each phase has dependencies, a max-runtime cap, and a prompt template. A scheduled task wakes every N minutes, asks the runner "what's next?", and (if eligible) spawns a phase in the background. The runner persists per-chain state, holds an exclusive lock with heartbeat, recovers stale locks, retries failed phases up to a cap, and writes an audit log.

This package is the TypeScript replacement for the original `_local_ai_first_helpers.py` script that ran the Local-AI-First overnight build. The standing rule (2026-05-12) is that **all multi-phase work uses this runner**.

## Install

It's a workspace package — already wired up by `pnpm install` at the monorepo root.

To use the CLI binary directly:

```bash
pnpm --filter @chiefaia/chain-runner build
node ~/Documents/projects/caia/packages/chain-runner/bin/caia-chain.js --help
```

## Storage layout

Each chain gets its own directory under `~/.caia/chain/<chain-id>/`:

```
~/.caia/chain/
└── <chain-id>/
    ├── state.json     — phase state machine (atomic write)
    ├── lock.json      — exclusive lock + heartbeat
    └── audit.jsonl    — append-only event log
```

Override the root with `CAIA_CHAIN_HOME=/some/path` (handy for tests).

## Phases YAML

A chain spec is a YAML file with optional defaults and a list of phases:

```yaml
defaults:
  max_retries: 2
  max_minutes: 45
  heartbeat_interval_sec: 120

phases:
  - id: 1
    name: install_deps
    deps: []
    max_minutes: 30
    prompt_template: |
      Install all production dependencies. When done:
      caia-chain mark-done 1 --chain-id <chain> --phases <yaml>

  - id: 2
    name: run_tests
    deps: [1]
    prompt_template: |
      Run the full test suite...
```

The format is **backwards-compatible** with the original `local_ai_first_phases.yaml`.

## CLI

Every command takes `--chain-id <id>` and `--phases <path>`:

```bash
caia-chain init             --chain-id myrun --phases ./phases.yaml
caia-chain status           --chain-id myrun --phases ./phases.yaml
caia-chain next-phase       --chain-id myrun --phases ./phases.yaml
caia-chain mark-in-progress 1 sess-abc --chain-id myrun --phases ./phases.yaml
caia-chain mark-done        1          --chain-id myrun --phases ./phases.yaml
caia-chain mark-failed      1 "out of memory" --chain-id myrun --phases ./phases.yaml
caia-chain heartbeat        sess-abc   --chain-id myrun --phases ./phases.yaml
caia-chain check-lock-staleness        --chain-id myrun --phases ./phases.yaml
caia-chain pause                       --chain-id myrun --phases ./phases.yaml
caia-chain resume                      --chain-id myrun --phases ./phases.yaml
caia-chain budget 25                   --chain-id myrun --phases ./phases.yaml
caia-chain wake-observed               --chain-id myrun --phases ./phases.yaml
caia-chain dispatch 1 --spawn ./run-phase.sh --chain-id myrun --phases ./phases.yaml
caia-chain audit-tail -n 30            --chain-id myrun --phases ./phases.yaml
```

### `next-phase` output contract

| Output                | Meaning                                                  |
|-----------------------|----------------------------------------------------------|
| `<n>` (integer)       | Phase `<n>` is ready to dispatch.                        |
| `IN_PROGRESS <n>`     | Phase `<n>` already has a live lock; do not re-dispatch. |
| `PAUSED`              | Chain is paused; no dispatch.                            |
| `BUDGET_EXHAUSTED`    | `budget_consumed_pct >= budget_cap_pct`.                 |
| `ALL_DONE`            | All phases done.                                         |
| `NONE_ELIGIBLE`       | No phase is dispatchable (deps not met / all blocked).   |

A scheduled-task SKILL parses this into a switch and either dispatches or no-ops.

### Lock + heartbeat semantics

* `mark-in-progress` increments `attempts`, records the session, sets status, and acquires the lock.
* The phase runner is expected to call `heartbeat <session-id>` periodically (every 60-120s).
* `check-lock-staleness` is called at the top of every wake. It clears the lock + marks the phase failed if **either** of these is true:
  * heartbeat older than `HEARTBEAT_GRACE_SEC` (60 minutes), OR
  * runtime exceeds the phase's `max_minutes` cap.
* A phase that exceeds `max_retries` is permanently `blocked`.

### Atomic writes

State + lock writes go through `atomicWriteJson()`: write to a sibling temp file, `fsync`, then `rename`. The rename is atomic on POSIX so readers always observe a consistent file even if the writer crashes mid-update. This is critical because the orchestrator and phase runner both touch state concurrently.

## Programmatic API

```ts
import {
  loadContext,
  initState,
  computeNextPhase,
  markInProgress,
  markDone,
  acquireLock,
  heartbeat,
  checkLockStaleness,
} from '@chiefaia/chain-runner';

const ctx = loadContext('myrun', './phases.yaml');
initState(ctx);

const next = computeNextPhase(ctx, /* state */);
if (next.kind === 'phase_id') {
  markInProgress(ctx, String(next.id), 'session-1');
  acquireLock(ctx, next.id, 'session-1');
  // ... do work, heartbeat, then mark-done
}
```

All exports are tree-shakeable from `dist/`.

## Scheduled task

The generic Claude Code scheduled task lives at `~/Documents/Claude/Scheduled/caia-chain-orchestrator-15min/SKILL.md`. It accepts `chain-id` and `phases` paths via SKILL frontmatter and dispatches one phase per wake. See that SKILL.md for the full bash recipe.

## Migration from `_local_ai_first_helpers.py`

The original Python script remains in place at `~/Documents/projects/agent-memory/_local_ai_first_helpers.py` and continues to drive the in-flight `local-ai-first` chain (state at `~/Documents/projects/agent-memory/local_ai_first_state.json`). New chains start with this package; existing chains can be migrated by:

1. Pointing `CAIA_CHAIN_HOME` at the legacy directory, or
2. Copying the `local_ai_first_state.json` and `local_ai_first.lock` into `~/.caia/chain/local-ai-first/state.json` + `lock.json`.

The state file format is byte-compatible (same keys, same atomic-write contract, same schema version 1).

## Tests

```bash
pnpm --filter @chiefaia/chain-runner test
```

The vitest suite ports the original 75-case Python regression: 15 paths × 5 cases each, covering fresh init, advancement, lock staleness (heartbeat + runtime), retry exhaustion, pause/resume, budget cap, all-done detection, dependency gating, atomic-write recovery, owner authentication, mark-failed, audit log, and idempotent init.
