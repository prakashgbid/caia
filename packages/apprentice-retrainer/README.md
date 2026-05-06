# `@chiefaia/apprentice-retrainer`

Apprentice Phase 4 — continuous retraining cron. The orchestrator that closes the Apprentice loop.

## What it does

Runs on a weekly cron (Saturday 02:00 local) plus on threshold trigger (≥500 new corpus pairs OR ≥7 days since last successful train). Per tick:

1. Acquires a single-instance flock at `~/Documents/projects/apprentice/retrainer.lock`.
2. Reads run-state from `~/Documents/projects/apprentice/retrainer-state.json`.
3. If a canary is currently active and < 3 days old → skip with `skipped-canary-active` outcome.
4. If a canary is currently active and ≥ 3 days old → emit `canary-held-prompting-operator` outcome to the digest; operator decides via `promote-canary` or `reject-canary` CLI subcommand.
5. Else aggregate corpus delta via `@chiefaia/apprentice-corpus`.
6. If delta ≥ retrain threshold OR last-train ≥ retrainMaxAgeMs OR `--force`:
   - Run `@chiefaia/apprentice-training` against the new corpus.
   - Run `@chiefaia/apprentice-eval` against the produced adapter (if harness injected).
   - Register the adapter via `@chiefaia/apprentice-serving`.
   - If `evalReport.winRate ≥ evalWinRateGate` AND no regressions → `promoteToCanary(adapterPath, defaultCanaryPercent)`.
   - Else → `reject(adapterPath, reason)`.
7. Append a digest entry to `~/Documents/projects/reports/apprentice-retrainer-digest.md`.
8. Release the lock.

## CLI

```
caia-apprentice-retrainer run [--force]
caia-apprentice-retrainer state
caia-apprentice-retrainer promote-canary
caia-apprentice-retrainer reject-canary --reason "..."
caia-apprentice-retrainer digest
```

The cron driver invokes `run`. Operator runs `promote-canary` / `reject-canary` to decide on a held canary. `state` and `digest` are read-only inspection commands.

## API

```ts
import { ApprenticeRetrainer } from '@chiefaia/apprentice-retrainer';

const retrainer = new ApprenticeRetrainer({
  // Inject upstream pipelines — required for run() to do real work.
  corpusAggregator,
  trainer,
  evalHarness,
  serving
});

const result = await retrainer.run();          // one cron tick
const state = retrainer.readState();             // read state file
await retrainer.promoteCanaryToProduction();     // operator-driven
await retrainer.rejectCanary('reason');          // operator-driven
```

`RetrainerRunResult` is a discriminated union with kinds:
- `'skipped-no-delta'`
- `'skipped-canary-active'`
- `'trained-and-rejected'`
- `'trained-and-canary-promoted'`
- `'canary-held-prompting-operator'`
- `'failed'`

## Configuration (Option E)

```ts
new ApprenticeRetrainer({
  // — paths —
  runStatePath: '~/Documents/projects/apprentice/retrainer-state.json',
  digestPath: '~/Documents/projects/reports/apprentice-retrainer-digest.md',
  lockfilePath: '~/Documents/projects/apprentice/retrainer.lock',

  // — thresholds —
  retrainThreshold: 500,
  retrainMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  evalWinRateGate: 0.6,
  defaultCanaryPercent: 10,
  canaryHoldDays: 3,

  // — injected pipelines (Option E) —
  corpusAggregator,                 // @chiefaia/apprentice-corpus instance
  trainer,                          // @chiefaia/apprentice-training instance
  evalHarness,                      // @chiefaia/apprentice-eval instance (optional)
  serving,                          // @chiefaia/apprentice-serving instance

  // — test seams —
  fs,
  clock
});
```

The pipeline injections use lightweight duck-typing (`CorpusAggregator`, `Trainer`, `EvalHarness` in `types.ts`). The real consumers wrap the actual `@chiefaia/*` packages; tests inject fakes from `tests/helpers/fakes.ts`.

## Decision tree (state machine)

```
run()
  │
  ├── canary active && age < hold → skipped-canary-active
  ├── canary active && age ≥ hold → canary-held-prompting-operator (operator decision required)
  │
  ├── force OR (lastTrain == null OR last train ≥ maxAge):
  │     aggregate corpus
  │       ├── delta < threshold && !force && !aged → skipped-no-delta
  │       └── otherwise:
  │             train → eval → register
  │             ├── eval gate passes → promoteToCanary → trained-and-canary-promoted
  │             └── eval gate fails  → reject          → trained-and-rejected
  │
  └── else → skipped-no-delta
```

## Setup

```bash
pnpm --filter @chiefaia/apprentice-retrainer build
packages/apprentice-retrainer/scripts/install-apprentice-retrainer.sh
```

Phase 4 ships **enabled** — installing the LaunchAgent activates the weekly Saturday 02:00 cron. Use `CAIA_DRY_INSTALL=1` for sanity-only rendering.

## Testing

```bash
pnpm --filter @chiefaia/apprentice-retrainer test
```

41 tests across 5 files:

- `state-store.test.ts` — read/write atomicity, .bak preservation, history trimming, error recording (9 tests)
- `decision.test.ts` — pure decision tree, every transition path (14 tests)
- `digest.test.ts` — markdown rendering for every outcome class (8 tests)
- `retrainer.test.ts` — orchestration unit tests with fake pipelines (9 tests)
- `retrainer.integration.test.ts` — full 5-cycle weekly cadence integration test (1 test)

## Environment

- macOS — Apple Silicon Mac
- Node ≥ 20
- TypeScript ≥ 5.9 (workspace toolchain)
- `@chiefaia/apprentice-serving` workspace dep (peer pipelines injected at construction)

## See also

- `DESIGN.md` — full architecture spec.
- `~/Documents/projects/reports/apprentice-phase-4-complete-2026-05-06.md` — Phase 4 completion sentinel.
- `~/Documents/projects/reports/apprentice-campaign-complete-2026-05-06.md` — campaign-completion sentinel.
- `agent/memory/apprentice_agent_directive.md` — full campaign spec.
- `agent/memory/agent_architecture_shape_2026-05-06.md` — Option E.
- `packages/apprentice-corpus/` — Phase 0 (corpus aggregator).
- `packages/apprentice-training/` — Phase 2 (LoRA trainer).
- `packages/apprentice-serving/` — Phase 3 (adapter serving).
