# `@chiefaia/apprentice-retrainer` — DESIGN

**Status**: Phase 4 of the Apprentice campaign — continuous retraining cron.
**Date**: 2026-05-06.
**Phase**: 4 of 4 (after Phase 0 corpus, Phase 1 eval, Phase 2 training, Phase 3 serving).
**Shape**: Option E — private workspace package, parameterised constructor with CAIA defaults, fixture-tested with mocked dependencies, never published.

---

## 1. Mandate

`@chiefaia/apprentice-retrainer` is the orchestrator that closes the Apprentice loop. It runs on a weekly cron (Saturday 02:00 local) plus on threshold trigger (≥500 new corpus pairs OR ≥7 days since last successful train), runs the corpus → train → eval → register → promote pipeline end-to-end, and either auto-promotes-to-canary on `winRate > 0.6` or surfaces to the operator for full promotion after a 3-day canary hold.

It is the only Phase that operator-prompts (per the directive's "operator-prompt for full promotion if canary holds 3 days" line). All earlier phases decide-and-execute autonomously.

---

## 2. Phase 4's contract with the rest of the campaign

| Boundary | Read | Write |
|---|---|---|
| **Phase 0** (`@chiefaia/apprentice-corpus`) | calls `ApprenticeCorpus.aggregate()` to produce a fresh `manifest.json` + `samples.jsonl` | — |
| **Phase 2** (`@chiefaia/apprentice-training`) | calls `ApprenticeTrainer.train(corpusManifestPath)` to produce an adapter directory | — |
| **Phase 1** (`@chiefaia/apprentice-eval`) | calls `ApprenticeEvalHarness.evaluate(adapter)` to produce an eval report (when the package has shipped its impl; otherwise tolerates injection of `evalHarness === undefined`) | — |
| **Phase 3** (`@chiefaia/apprentice-serving`) | calls `register / promoteToCanary / promoteToProduction / reject` to drive lifecycle | — |
| **Run-state file** | reads on every invocation | atomic write-and-rename per cron tick |
| **Operator** | — | digest summary written to a path the operator's daily review reads |
| **LaunchAgent** | invokes the CLI on a weekly schedule | — |

Phase 4 is **stateful** — the run-state file at `<runStatePath>` (default `~/Documents/projects/apprentice/retrainer-state.json`) tracks the last successful train, last canary promotion, last operator interaction, etc. The state file is the cron's memory across invocations.

---

## 3. Public API

```ts
export class ApprenticeRetrainer {
  constructor(config?: ApprenticeRetrainerConfig);

  /** One end-to-end retraining tick. The cron driver script invokes this. */
  run(opts?: { force?: boolean }): Promise<RetrainerRunResult>;

  /** Read-only view of run-state. */
  readState(): RetrainerState;

  /** Operator-prompted: promote the current canary to production. */
  promoteCanaryToProduction(): Promise<RegistryEntry>;

  /** Operator-prompted: reject the current canary. */
  rejectCanary(reason: string): Promise<RegistryEntry>;
}
```

`RetrainerRunResult` is a discriminated union: `{ kind: 'skipped-no-delta' | 'skipped-canary-active' | 'trained-and-rejected' | 'trained-and-canary-promoted' | 'canary-held-prompting-operator' | 'failed', ...details }`.

---

## 4. Decision logic (single-tick state machine)

Each `run()` tick walks this decision tree:

```
1. Read run-state file.
2. If a canary is currently active in the registry:
   2a. If canary is < 3 days old → return 'skipped-canary-active'
   2b. If canary is ≥ 3 days old → return 'canary-held-prompting-operator'
       (writes a digest entry; operator runs `promoteCanaryToProduction()`
        or `rejectCanary()` manually.)
3. Else (no active canary):
   3a. Aggregate corpus delta since last successful train.
   3b. If delta < retrainThreshold AND last-train < retrainMaxAgeMs → return 'skipped-no-delta'
   3c. Run apprentice-training on the fresh corpus.
   3d. Run apprentice-eval on the produced adapter (if evalHarness injected).
   3e. Register the adapter via apprentice-serving.
   3f. If evalReport.winRate > evalWinRateGate AND no regressions:
       → promoteToCanary(adapterPath, defaultCanaryPercent)
       → return 'trained-and-canary-promoted'
   3g. Else:
       → reject(adapterPath, reason)
       → return 'trained-and-rejected'
4. On any exception:
   4a. Mark run-state.lastError = { at, message, kind }.
   4b. Re-throw (cron driver script catches and exits non-zero).
   4c. Cron retries on next scheduled tick.
```

`force: true` skips the `skipped-*` short-circuits — useful for operator-driven manual triggers.

---

## 5. Run-state file

```json
{
  "version": 1,
  "generatedAt": "2026-05-06T02:00:00.000Z",
  "lastSuccessfulTrain": {
    "at": "2026-04-29T02:00:00.000Z",
    "adapterPath": "/Users/.../adapters/2026-04-29-qwen-rank8",
    "corpusManifestSha256": "abc123",
    "outcome": "trained-and-canary-promoted"
  },
  "lastCanaryPromotedAt": "2026-04-29T02:15:00.000Z",
  "lastProductionPromotedAt": "2026-04-22T14:30:00.000Z",
  "lastError": null,
  "history": [
    { "at": "2026-04-29T02:00:00.000Z", "outcome": "trained-and-canary-promoted", "adapterName": "..." },
    { "at": "2026-04-22T02:00:00.000Z", "outcome": "trained-and-canary-promoted", "adapterName": "..." }
  ]
}
```

`history` is append-only; trimmed to the last 52 entries (1 year of weekly runs).

---

## 6. Configuration surface (Option E)

```ts
export interface ApprenticeRetrainerConfig {
  // — paths —
  runStatePath?: string;
  // default: ~/Documents/projects/apprentice/retrainer-state.json

  digestPath?: string;
  // default: ~/Documents/projects/reports/apprentice-retrainer-digest.md

  lockfilePath?: string;
  // default: ~/Documents/projects/apprentice/retrainer.lock

  // — thresholds —
  retrainThreshold?: number;        // default: 500 new pairs
  retrainMaxAgeMs?: number;         // default: 7 * 24 * 60 * 60 * 1000
  evalWinRateGate?: number;         // default: 0.60
  defaultCanaryPercent?: number;    // default: 10
  canaryHoldDays?: number;          // default: 3

  // — injected pipelines (Option E) —
  corpusAggregator?: CorpusAggregator;     // default: real @chiefaia/apprentice-corpus
  trainer?: Trainer;                       // default: real @chiefaia/apprentice-training
  evalHarness?: EvalHarness;               // default: undefined (skips eval gate)
  serving?: ApprenticeServing;             // default: new ApprenticeServing()

  // — test seams —
  fs?: FsAccess;
  clock?: () => Date;
  randomBytes?: (n: number) => Buffer;
}
```

Test-time injection: the test passes a fake `corpusAggregator` that returns a synthetic manifest, a fake `trainer` that returns a synthetic adapter directory, a fake `evalHarness` that returns a configurable verdict, and a fake `ApprenticeServing` (implementing the same interface) that records calls. End-to-end decision logic exercised without touching real subprocess invocations.

The `corpusAggregator` / `trainer` / `evalHarness` interfaces are minimal duck-types defined in this package's `types.ts`; the real adapters wrap the actual `@chiefaia/apprentice-corpus` and `@chiefaia/apprentice-training` packages. This keeps the build-time deps clean (Phase 4 doesn't import the heavy training stack at typecheck time; it imports it at runtime via dynamic `import()` from the wrapper modules).

---

## 7. Module layout

```
packages/apprentice-retrainer/
  DESIGN.md                            ← this file
  README.md
  package.json
  tsconfig.json + tsconfig.build.json
  eslint.config.cjs
  vitest.config.ts
  src/
    types.ts                           — RetrainerState, decision shapes, errors
    config.ts                          — resolveConfig with CAIA defaults
    fs-access.ts                       — default FsAccess wrapping node:fs
    state-store.ts                     — read/write retrainer-state.json (atomic rename)
    lockfile.ts                        — single-instance lock via flock
    corpus-aggregator-adapter.ts       — wrapper around @chiefaia/apprentice-corpus (dynamic import)
    trainer-adapter.ts                 — wrapper around @chiefaia/apprentice-training (dynamic import)
    decision.ts                        — pure decision logic (input: state + delta + canary; output: action)
    digest.ts                          — operator-facing markdown digest writer
    retrainer.ts                       — top-level ApprenticeRetrainer orchestrator
    cli.ts                             — caia-apprentice-retrainer entry point
    index.ts                           — public API barrel
  tests/
    helpers/
      fakes.ts                         — createInMemoryFs, createFakeServing, etc.
    state-store.test.ts
    decision.test.ts
    digest.test.ts
    retrainer.test.ts                  — orchestration unit tests
    retrainer.integration.test.ts      — full pipeline end-to-end with fakes
  plists/
    com.chiefaia.apprentice-retrainer.plist  (placeholder; activated by install)
  scripts/
    install-apprentice-retrainer.sh    — placeholder substitution + launchctl bootstrap
```

11 source modules. Slightly larger than `apprentice-serving` because the retrainer has more orchestration logic (decision tree + cron lifecycle + operator-prompt flow + locking) and writes the operator-facing digest.

---

## 8. CLI surface

```
caia-apprentice-retrainer run [--force]
caia-apprentice-retrainer state
caia-apprentice-retrainer promote-canary       # operator-driven canary → production
caia-apprentice-retrainer reject-canary --reason "..."
caia-apprentice-retrainer digest               # print latest digest
```

The `run` subcommand is what the LaunchAgent invokes. The `promote-canary` / `reject-canary` subcommands are operator-only (no auto-trigger).

Exit codes:
- `0` success
- `1` validation error
- `2` upstream pipeline failure (corpus / train / eval / serving)
- `3` filesystem failure
- `4` no-op (skipped due to canary-active or no-delta — informational only)

---

## 9. Errors

| Error | When |
|---|---|
| `LockfileError` | another retrainer instance holds the lock |
| `CorpusFailedError` | `corpusAggregator.aggregate()` threw |
| `TrainingFailedError` | `trainer.train()` threw |
| `EvalFailedError` | `evalHarness.evaluate()` threw |
| `RegisterFailedError` | `serving.register()` threw |
| `PromotionFailedError` | `serving.promoteToCanary()` or `promoteToProduction()` threw |
| `OperatorPromptError` | a canary has been holding > `canaryHoldDays` and operator hasn't decided |
| `StateCorruptError` | `retrainer-state.json` is malformed |

---

## 10. Persistence + concurrency

Single-writer locking via filesystem-level flock at `<lockfilePath>`. The lock is acquired at the start of `run()`, released on completion (or on uncaught exception). If another instance is running (cron + operator-CLI race), the second instance throws `LockfileError` and the cron driver script exits with code `1` so the LaunchAgent retries on the next tick.

State file persistence: `<path>.tmp` → `rename(<path>.tmp, <path>)` (atomic on POSIX). Same model as `apprentice-serving`'s registry persistence.

---

## 11. LaunchAgent

`com.chiefaia.apprentice-retrainer.plist` runs Saturday 02:00 local. Same placeholder pattern as `apprentice-training`'s plist. Phase 4 ships **enabled** — this is the activation point for the full Apprentice loop. The install script verifies the upstream packages are built before activating.

```xml
<key>StartCalendarInterval</key>
<dict>
  <key>Weekday</key>
  <integer>6</integer>
  <key>Hour</key>
  <integer>2</integer>
  <key>Minute</key>
  <integer>0</integer>
</dict>
```

---

## 12. Test strategy

### Unit tests

- `state-store.test.ts` — read empty state; round-trip persistence; atomic rename; `.bak` preservation; corruption detection.
- `decision.test.ts` — pure decision logic (no I/O); exhaustively covers the §4 state machine: every input combination → expected outcome.
- `digest.test.ts` — markdown rendering for each outcome class; truncation; pre-existing-digest preservation.
- `retrainer.test.ts` — orchestration with fake corpus / trainer / eval / serving; verifies the right pipeline calls happen for each decision.

### Integration test

- `retrainer.integration.test.ts` — end-to-end with all fakes wired: simulates a 3-cycle weekly cadence (cycle 1: corpus-delta-too-small → skip; cycle 2: train + canary-promoted; cycle 3: canary-still-active → operator-prompt). Asserts state file contents + digest contents at every cycle.

### E2E test (gated)

- Phase 4 doesn't ship a real-pipeline E2E (the upstream pipeline is multi-hour). Stage 8 verification runs `caia-apprentice-retrainer run --force` against fakes injected via env vars, then `launchctl print` to verify the LaunchAgent is loaded.

---

## 13. Risks + mitigations

| Risk | Mitigation |
|---|---|
| **Upstream package not yet shipped (apprentice-eval impl)** | `evalHarness` is optional; when undefined, decision tree short-circuits at "no eval gate → reject-conservative" with operator-prompt instead of auto-promote. |
| **Cron + operator-CLI race** | `LockfileError`. Cron retries next tick; operator surfaces error and tries again. |
| **Long-running training kills cron** | `apprentice-training` has its own timeout. Retrainer treats timeout as `TrainingFailedError` and writes to digest. |
| **State file corruption** | Atomic rename + .bak file + `StateCorruptError` with restore instructions. |
| **Operator never decides on a held canary** | Digest re-emits the prompt every weekly tick. After ~30 days, log a warning. Never auto-decides; preserves operator authority. |
| **Disk pressure from accumulated adapter directories** | Phase 3 GCs the registry; Phase 2's adapter directories on disk persist. Operator can manually `rm` old dated directories; the registry's `.bak` files self-heal. |
| **Canary holds for very long without traffic** | The directive's "canary holds 3 days" is wall-clock. Phase 4 doesn't validate that any traffic actually hit the canary; that's a future hardening (would require subscribing to Langfuse traces). |

---

## 14. Stages 4-10 outline

- **Stage 4 (Implement)** — 11 source modules per §7 layout. ESM TypeScript. Fully parameterised.
- **Stage 5 (Unit test)** — ~50 vitest cases covering decision logic + state store + digest + orchestration.
- **Stage 6 (Integration test)** — full 3-cycle integration test with fakes.
- **Stage 7 (Deploy)** — install script with placeholder substitution; LaunchAgent ships **enabled** (Phase 4 is the activation point).
- **Stage 8 (E2E live verify)** — `caia-apprentice-retrainer run --force` against fakes + `launchctl print` verification.
- **Stage 9 (Regression)** — package tests pass; full monorepo `pnpm -r typecheck && pnpm -r lint`.
- **Stage 10 (Document + capture learnings)** — README + completion doc + campaign-completion sentinel.

---

## 15. Constraints honoured

- ✅ **Option E shape** — private `@chiefaia/apprentice-retrainer`; parameterised constructor with CAIA defaults; tests inject fakes for every upstream pipeline + filesystem; never published.
- ✅ **Subscription-only LLM** — retrainer makes ZERO LLM calls itself; upstream packages are local Mac MLX + Ollama only.
- ✅ **Mac MLX local** — cron runs on operator's Mac; uses Phase 2's MLX subprocess + Phase 3's local Ollama.
- ✅ **Operator does NOT code** — operator interacts via the CLI's `promote-canary` / `reject-canary` subcommands, plus reads the digest. No code edits required.
- ✅ **Git Flow** — `feat/apprentice-retrainer-001-phase4` (branched off `feat/apprentice-serving-001-phase3`) → `develop`. PR with auto-merge armed.
- ✅ **No silent model swaps** — the retrainer writes a digest entry for every outcome; canary holds are explicit operator-prompted decisions.
- ✅ **Decision-classifier** — retrainer decides everything except final canary-to-production promotion (operator-decision per directive). Asks operator only for that one decision.

---

## See also

- `~/Documents/projects/reports/apprentice-phase-3-complete-2026-05-06.md` — Phase 3 sentinel.
- `agent/memory/apprentice_agent_directive.md` — full campaign spec.
- `agent/memory/agent_architecture_shape_2026-05-06.md` — Option E.
- `packages/apprentice-corpus/DESIGN.md` — Phase 0 spec (corpus contract).
- `packages/apprentice-training/DESIGN.md` — Phase 2 spec (trainer contract).
- `packages/apprentice-serving/DESIGN.md` — Phase 3 spec (serving contract).
