# `@chiefaia/apprentice-serving` — DESIGN

**Status**: Phase 3 of the Apprentice campaign — adapter swapping + serving.
**Date**: 2026-05-06.
**Phase**: 3 of 4 (after Phase 0 corpus, Phase 1 eval, Phase 2 training).
**Shape**: Option E — private workspace package, parameterised constructor with CAIA defaults, fixture-tested with mocked Ollama, never published.

---

## 1. Mandate

`@chiefaia/apprentice-serving` is the registry + serving substrate for adapters produced by `@chiefaia/apprentice-training`. It loads adapter directories into Ollama, tracks each adapter's lifecycle state (`registered → shadow → canary → production`, with `archived` and `rejected` terminals), and writes a canary-routing config that downstream agents (Mentor, Curator, future Apprentice consumers) read at inference time.

It is the bridge between the **batch artifact** (the date-stamped adapter directory Phase 2 emits) and the **online serving substrate** (Ollama running locally on the operator's Mac). Phase 4 (retrainer cron) drives this package from above; this package drives Ollama from below.

---

## 2. Phase 3's contract with the rest of the campaign

| Boundary | Read | Write |
|---|---|---|
| **Phase 2** (`apprentice-training`) | `<adapterPath>/Modelfile`, `<adapterPath>/adapters.safetensors`, `<adapterPath>/adapter_config.json`, `<adapterPath>/training-metadata.json`, optional `<adapterPath>/eval-report.json` | — |
| **Ollama** | `ollama show <name>` | `ollama create <name> -f <Modelfile>`, `ollama rm <name>` |
| **Registry file** | reads on every operation | atomic write-and-rename on every state change |
| **Canary-routing config** | — | atomic write-and-rename on every state change |
| **Phase 4** (`apprentice-retrainer`) | calls `register()` + `promoteToCanary()` + `promoteToProduction()` | — |

The package is **idempotent over (adapter directory, target state)**: re-asking for an already-applied transition is a no-op (the registry records it once). Re-asking for the SAME adapter at the SAME registry status is a no-op even after a process restart.

---

## 3. Public API

```ts
export class ApprenticeServing {
  constructor(config?: ApprenticeServingConfig);

  /** Idempotent: reads `<adapterPath>/training-metadata.json`, derives
   *  the registry key, writes a `registered` entry. */
  register(adapterPath: string): Promise<RegistryEntry>;

  /** Loads the adapter into Ollama as `<canaryModelName>`, transitions
   *  the entry to `canary`, sets `canaryPercent`, atomically updates
   *  the canary-routing config. */
  promoteToCanary(adapterPath: string, percent: number): Promise<RegistryEntry>;

  /** Loads the adapter into Ollama as `<productionModelName>`, transitions
   *  to `production`, archives the previous production entry. */
  promoteToProduction(adapterPath: string): Promise<RegistryEntry>;

  /** Fast path. `toAdapterPath` MUST be a previously-promoted
   *  production adapter (status === 'archived'). Re-promotes it. */
  rollback(toAdapterPath: string): Promise<RegistryEntry>;

  /** Marks an adapter `rejected`. If it was loaded into Ollama, removes
   *  it. Used for failed eval gate. */
  reject(adapterPath: string, reason: string): Promise<RegistryEntry>;

  /** Read-only view of registry. */
  readonly registry: AdapterRegistry;
}
```

`AdapterRegistry` is a separate exported class — the operator may inspect / list / filter adapters without going through `ApprenticeServing`. It owns the persisted JSON file.

```ts
export class AdapterRegistry {
  constructor(config?: AdapterRegistryConfig);

  list(): RegistryEntry[];
  getByPath(adapterPath: string): RegistryEntry | undefined;
  getByName(adapterName: string): RegistryEntry | undefined;
  /** All entries with status === 'production'. Should be 0 or 1. */
  currentProduction(): RegistryEntry | undefined;
  /** All entries with status === 'canary'. May be 0 or 1; multi-canary disallowed. */
  currentCanary(): RegistryEntry | undefined;
}
```

### `RegistryEntry`

```ts
export interface RegistryEntry {
  /** Stable identity = adapter directory basename, e.g.
   *  `2026-05-06-qwen2.5-coder-7b-rank8-iters1500`. */
  adapterName: string;
  /** Absolute path to adapter dir on disk. */
  adapterPath: string;
  /** sha256 of training-metadata.json (cross-run identity). */
  metadataSha256: string;
  /** From training-metadata.json — what the trainer recorded. */
  configSha256: string;
  baseModel: string;
  baseModelOllamaTag: string;
  /** Ollama model name THIS adapter is loaded as.
   *  Per-status: shadow → `<base>-shadow-<sha7>`,
   *              canary → `<base>-canary-<sha7>`,
   *              production → `<base>-production`. */
  ollamaModelName?: string;
  /** Optional eval verdict (from eval-report.json — Phase 1 output). */
  evalReport?: {
    winRate: number;
    decision: string;
    regressionFlags: string[];
  };
  /** Lifecycle state. */
  status: 'registered' | 'shadow' | 'canary' | 'production' | 'archived' | 'rejected';
  /** Append-only history. */
  history: RegistryHistoryEntry[];
  /** Set when status === 'canary'. 0..100. */
  canaryPercent?: number;
  /** Set when status === 'rejected'. */
  rejectionReason?: string;
  registeredAt: string; // ISO-8601
  promotedAt?: string;
  archivedAt?: string;
}

export interface RegistryHistoryEntry {
  at: string; // ISO-8601
  fromStatus: RegistryEntry['status'] | null;
  toStatus: RegistryEntry['status'];
  /** Free-form note. */
  note?: string;
}
```

---

## 4. Adapter lifecycle state machine

```
                            register()
                ┌──────────────────────────┐
                ↓                          │
       ┌────────────┐                      │
       │ registered │ ────────────────►  reject()
       └────────────┘                      │
                │                          ↓
   promoteToCanary()                  ┌──────────┐
                │                     │ rejected │
                ↓                     └──────────┘
        ┌──────────┐                       ▲
        │  canary  │ ──── reject() ────────┤
        └──────────┘                       │
                │                          │
   promoteToProduction()                   │
                │                          │
                ↓                          │
       ┌────────────┐                      │
       │ production │ ◄─── rollback()      │
       └────────────┘                      │
                │                          │
   another adapter promoted                │
                │                          │
                ↓                          │
        ┌──────────┐                       │
        │ archived │                       │
        └──────────┘                       │
                │                          │
                └──── rollback() ──────────┘
                       (re-promotes archived → production)
```

Notes on transitions:

- `register()` is the only entry into the system. It reads `training-metadata.json` and creates a `registered` entry. Idempotent on the same `adapterPath`.
- `promoteToCanary(adapterPath, percent)` requires `status ∈ {'registered', 'archived'}` (rolling forward, or re-canary-ing a previously-archived adapter for testing).
- `promoteToProduction(adapterPath)` requires `status ∈ {'canary'}`. The previous production (if any) transitions to `archived`. Multiple `archived` entries are kept (history). At most one `production` ever.
- `rollback(toAdapterPath)` requires the target's `status === 'archived'`. The current production (if any) transitions to `archived`. The target transitions to `production`. Skips canary — rollback is a fast-path.
- `reject(adapterPath, reason)` is allowed from any non-terminal state. Removes the adapter from Ollama if loaded. Used for eval-gate failure.
- All transitions append a `RegistryHistoryEntry` with `from`/`to`/`at`/`note`.

**Invariants** (asserted at registry mutation time, throw `RegistryInvariantError` if violated):

1. At most one entry has `status === 'production'`.
2. At most one entry has `status === 'canary'`.
3. `adapterName` is unique across the registry.
4. `archivedAt` is set iff `status === 'archived'`.
5. `canaryPercent` is set iff `status === 'canary'`.
6. `rejectionReason` is set iff `status === 'rejected'`.

---

## 5. Pipeline data-flow

```
adapterPath (from Phase 2)
        │
        ▼
   register()
        │
        ├── readMetadata() ────────► training-metadata.json
        ├── readEvalReport() ──────► eval-report.json (optional)
        ├── deriveAdapterName() ───► <baseShortName>-<sha7>
        ├── registry.upsert()
        └── persistRegistry() ─────► registry.json (atomic rename)

   promoteToCanary(path, pct)
        │
        ├── registry.assertCanPromote()
        ├── ollamaCreate(<canaryName>) ─► subprocess: ollama create
        ├── registry.transition(canary, pct)
        ├── persistRegistry()
        └── persistCanaryRoutingConfig() ► canary-routing.json (atomic rename)

   promoteToProduction(path)
        │
        ├── registry.assertCanPromote()
        ├── ollamaCreate(<productionName>) ─► subprocess: ollama create
        ├── ollamaRemove(prevProduction) ──► subprocess: ollama rm  (best-effort)
        ├── registry.transition(production); registry.archive(prev)
        ├── persistRegistry()
        └── persistCanaryRoutingConfig() ► clears canary section

   rollback(toPath)
        │
        ├── registry.assertCanRollback(toPath)
        ├── ollamaCreate(<productionName>) ─► subprocess: ollama create on archived adapter
        ├── ollamaRemove(prevProduction) ──► subprocess: ollama rm
        ├── registry.transition(target → production); archive(prev)
        ├── persistRegistry()
        └── persistCanaryRoutingConfig()
```

---

## 6. Ollama integration contract

We invoke the `ollama` CLI as a subprocess (no SDK). The CLI is stable across versions for the commands we use; we pin behaviour by parsing `ollama --version` at preflight time.

| Operation | Command | Idempotent? | Failure mode |
|---|---|---|---|
| **Create** | `ollama create <name> -f <Modelfile>` | yes (re-creating same model just rebuilds; we no-op when registry says it already exists) | exit non-zero → `OllamaCreateError` |
| **Remove** | `ollama rm <name>` | yes when `--force`-equivalent (it's `ollama rm` directly; if model doesn't exist the CLI returns non-zero — we treat ENOENT as success) | exit non-zero AND not "not found" → `OllamaRemoveError` |
| **Inspect** | `ollama show <name> --modelfile` | yes (read-only) | exit non-zero → `OllamaInspectError` |
| **List** | `ollama list` | yes (read-only) | exit non-zero → `OllamaListError` |
| **Preflight** | `ollama --version` | yes (read-only) | non-zero → `OllamaNotInstalledError` with install instructions |

The Modelfile we feed to `ollama create` is the one Phase 2 emitted. It contains:

```
FROM <baseModelOllamaTag>
ADAPTER ./adapters.safetensors
PARAMETER temperature 0.2
PARAMETER top_p 0.9
```

The cwd of the subprocess is set to `<adapterPath>` so the relative `./adapters.safetensors` resolves. The `Modelfile` itself is referenced absolute via `-f`.

### Ollama model naming convention

```
shadow:        <baseShortName>-shadow-<sha7>
canary:        <baseShortName>-canary-<sha7>
production:    <baseShortName>-production
```

Where:
- `baseShortName = baseModel.replace(':', '-').replace(/[^a-z0-9-]/g, '-')` (e.g., `qwen2.5-coder-7b`)
- `sha7` is the first 7 chars of `metadataSha256`

The `production` slot deliberately drops the sha so downstream consumers can hard-code `<baseShortName>-production` as the model to call. Cutover is atomic from the consumer's perspective.

---

## 7. Canary-routing config

A separate JSON file at `<canaryRoutingConfigPath>` (default `~/Documents/projects/apprentice/canary-routing.json`). Format:

```json
{
  "version": 1,
  "generatedAt": "2026-05-06T14:32:11.123Z",
  "production": {
    "ollamaModelName": "qwen2.5-coder-7b-production",
    "adapterName": "2026-05-06-qwen2.5-coder-7b-rank8-iters1500"
  },
  "canary": {
    "ollamaModelName": "qwen2.5-coder-7b-canary-a1b2c3d",
    "adapterName": "2026-05-13-qwen2.5-coder-7b-rank8-iters1500",
    "percent": 10
  }
}
```

When no production is set, the `production` field is `null`. When no canary is set, the `canary` field is `null`.

Consumers read this file at agent invocation time. The reader lib lives at `src/canary-router.ts` exported from this package — agents call `routeRequest(canaryRouter)` which hashes the request id, compares to `canary.percent`, and returns the model name to invoke. Phase 3 ships the writer + reader; agents wire the reader in a future leg.

The reader is deterministic over `(requestId, percent)` so the same request always routes the same way (no flapping under retries).

```ts
export class CanaryRouter {
  constructor(config?: CanaryRouterConfig);
  /** Read the latest canary-routing.json. Cached per-instance with a
   *  stat-mtime check; cheap to call hot-path. */
  resolve(): RoutingDecision;
  /** Hash the requestId; return the chosen model. */
  routeRequest(requestId: string): string | null;
}

export type RoutingDecision =
  | { kind: 'no-production'; canary: null }
  | { kind: 'production-only'; productionModel: string; canary: null }
  | { kind: 'production-with-canary'; productionModel: string; canaryModel: string; canaryPercent: number };
```

---

## 8. Configuration surface (Option E)

```ts
export interface ApprenticeServingConfig {
  // — paths —
  registryPath?: string;
  // default: `~/Documents/projects/apprentice/registry.json`

  canaryRoutingConfigPath?: string;
  // default: `~/Documents/projects/apprentice/canary-routing.json`

  // — Ollama —
  ollamaBinaryPath?: string;
  // default: `ollama` (resolved via PATH)

  ollamaHost?: string;
  // default: undefined → respects user's OLLAMA_HOST env var

  productionModelName?: (baseShortName: string) => string;
  // default: (b) => `${b}-production`

  canaryModelName?: (baseShortName: string, sha7: string) => string;
  // default: (b, s) => `${b}-canary-${s}`

  shadowModelName?: (baseShortName: string, sha7: string) => string;
  // default: (b, s) => `${b}-shadow-${s}`

  // — guard rails —
  maxArchivedToKeep?: number;
  // default: 10 — older archived entries are GC'd from registry (their Ollama
  // models are also `ollama rm`'d).

  // — test seams —
  ollamaClient?: OllamaClient;
  // default: real subprocess-spawning client.

  fs?: FsAccess;
  clock?: () => Date;
}
```

CAIA defaults are the operator's stable Mac-side paths. Tests override `registryPath` to a temp file, `canaryRoutingConfigPath` to a temp file, and inject a fake `OllamaClient` that records invocations.

---

## 9. Module layout

```
packages/apprentice-serving/
  DESIGN.md                            ← this file
  README.md
  package.json
  tsconfig.json + tsconfig.build.json
  eslint.config.cjs
  vitest.config.ts
  src/
    types.ts                           — RegistryEntry, all interfaces, error classes
    config.ts                          — resolveConfig with CAIA defaults
    fs-access.ts                       — default FsAccess wrapping node:fs
    ollama-client.ts                   — subprocess-backed implementation of OllamaClient
    metadata-reader.ts                 — read training-metadata.json + eval-report.json
    adapter-registry.ts                — AdapterRegistry class; persistence; invariants
    canary-router.ts                   — CanaryRouter + writer
    serving.ts                         — top-level ApprenticeServing orchestrator
    cli.ts                             — caia-apprentice-serving entry point
    index.ts                           — public API barrel
  tests/
    helpers/
      fakes.ts                         — createInMemoryFs, createFakeOllamaClient, fixtures
    metadata-reader.test.ts
    adapter-registry.test.ts
    canary-router.test.ts
    ollama-client.test.ts
    serving.test.ts                    — orchestration unit tests
    serving.integration.test.ts        — full lifecycle integration test (mocked ollama)
    serving.e2e.test.ts                — gated by APPRENTICE_SERVING_OLLAMA_INSTALLED=1
  plists/
    com.chiefaia.apprentice-serving-canary-router.plist (placeholder; activated by Phase 4)
  scripts/
    install-apprentice-serving.sh      — placeholder-substitution per leg-3 standing rule
```

13 source files, plus tests + scripts + plists. Tighter surface than `apprentice-training` (14 src files) — serving has less internal logic; most of the work is registry book-keeping + subprocess invocation.

---

## 10. CLI surface

```
caia-apprentice-serving register <adapter-path>
caia-apprentice-serving promote-canary <adapter-path> --percent <0..100>
caia-apprentice-serving promote-production <adapter-path>
caia-apprentice-serving rollback <adapter-path>
caia-apprentice-serving reject <adapter-path> --reason "<reason>"
caia-apprentice-serving list [--status <status>]
caia-apprentice-serving show <adapter-path>
caia-apprentice-serving canary-config              # print canary-routing.json
```

All commands respect `--registry-path`, `--canary-routing-path`, `--ollama-binary` overrides for testability.

Exit codes:
- `0` success
- `1` validation error (bad args, registry invariant violated)
- `2` Ollama subprocess failure
- `3` filesystem failure
- `4` adapter-not-found / metadata-malformed

---

## 11. Errors

All extend a `ServingError` base class with `name` + `details`. Surface set:

| Error | When |
|---|---|
| `AdapterNotFoundError` | `adapterPath` doesn't exist or is missing required artifacts |
| `MetadataMalformedError` | `training-metadata.json` doesn't parse / fails schema |
| `RegistryInvariantError` | mutation would violate a §4 invariant |
| `RegistryStateMismatchError` | requested transition is invalid for current state (e.g., promoteToProduction on a `registered`-only adapter) |
| `OllamaNotInstalledError` | preflight `ollama --version` fails |
| `OllamaCreateError` | `ollama create` exit non-zero |
| `OllamaRemoveError` | `ollama rm` exit non-zero AND model exists |
| `OllamaInspectError` | `ollama show` exit non-zero |
| `RollbackTargetInvalidError` | `rollback(path)` target's status isn't `archived` |
| `CanaryPercentOutOfRangeError` | `percent < 0 || percent > 100` |

The CLI catches each and pretty-prints; the API throws.

---

## 12. Persistence + concurrency

The registry file is the system of record. We assume single-writer (one `ApprenticeServing` instance at a time on the operator's Mac) — Phase 4 cron is a single LaunchAgent. We do NOT take cross-process file locks; instead we:

1. Read the file fresh on every mutation.
2. Mutate in-memory.
3. Write to `<path>.tmp` then `rename(<path>.tmp, <path>)` — atomic on POSIX.

If a future user creates a second instance, they'll race; the last writer wins. This is acceptable for the single-Mac operator model. Phase 4's retrainer holds a separate file-lock on `~/Documents/projects/apprentice/retrainer.lock` for its retraining cron — that's its own concurrency concern, not ours.

The canary-routing config is written the same way: `<path>.tmp` → rename. Readers (`CanaryRouter.resolve()`) tolerate ENOENT (initial state, pre-first-promotion).

---

## 13. Hyperparameter / threshold defaults

Values are CAIA-tuned but parameterised:

| Parameter | Default | Rationale |
|---|---|---|
| `maxArchivedToKeep` | `10` | Keep history for ~10 weeks of weekly retraining cycles; trim older to bound disk + Ollama storage. |
| `defaultCanaryPercent` (Phase 4 retrainer reads this) | `10` | Conservative initial canary; scales up as confidence grows. |
| `evalWinRateGate` (Phase 4) | `0.60` | Auto-promote-to-canary threshold per directive. |
| `canaryHoldDays` (Phase 4) | `3` | Operator-prompt threshold per directive. |

`maxArchivedToKeep` is enforced by `ApprenticeServing.gcArchived()` (called from every `promoteToProduction` and `rollback`). When the count exceeds the cap, we `ollama rm` the oldest archived adapters first (FIFO), then drop them from the registry entries. Their on-disk files (the adapter directory itself) are NOT deleted — Phase 2 owns those, and the operator may want to inspect them later.

---

## 14. Test strategy

### Unit tests (mocked subprocess + in-memory fs)

- `metadata-reader.test.ts` — schema validation; missing required fields; sha computation determinism.
- `adapter-registry.test.ts` — every state transition; every invariant violation; persistence round-trip; idempotent `register()`; GC behaviour.
- `canary-router.test.ts` — deterministic hashing; percent boundaries (0%, 100%, 50%); ENOENT tolerance; mtime-based cache invalidation.
- `ollama-client.test.ts` — argv construction; treat-not-found-as-success on remove; error path classification.
- `serving.test.ts` — top-level orchestration; failure-mode rollback (ollama-create-fails-after-registry-update is reverted); cross-cutting calls into registry + ollama + canary-config.

### Integration test (fake Ollama, real fs)

- `serving.integration.test.ts` — materialises a fake adapter directory on disk (Modelfile + adapters.safetensors stub + adapter_config.json + training-metadata.json); runs the full lifecycle: register → promoteToCanary(10%) → promoteToProduction → register-newer → promoteToCanary(10%) → promoteToProduction → rollback. Verifies registry JSON + canary-routing JSON contents at every step. Asserts the FakeOllamaClient saw the right invocation sequence.

### E2E test (real Ollama, gated)

- `serving.e2e.test.ts`, gated by `APPRENTICE_SERVING_OLLAMA_INSTALLED=1`. Runs `ollama --version`, then runs the full lifecycle against the real Ollama daemon using a tiny fixture adapter directory. Exercises the actual subprocess invocation. Cleans up created models on teardown.

`tests/helpers/fakes.ts` provides:
- `createInMemoryFs()` — in-memory `FsAccess`
- `createFakeOllamaClient()` — scriptable `OllamaClient`; records every invocation; configurable per-call result
- `fixtureAdapterDir()` — emits a fake adapter directory on disk (in-memory or real) with all required files
- `fixtureMetadata()` — minimal `TrainingMetadataRead`-shape fixture

---

## 15. Risks + mitigations

| Risk | Mitigation |
|---|---|
| **Ollama version drift breaks CLI parsing** | Preflight `ollama --version`; tolerant parsing; CLI args we use are stable across 0.1.x → 0.11.x. |
| **Ollama daemon not running** | `ollama create` errors with a helpful message; we surface it as `OllamaCreateError` with `details.dameonNotRunning` hint. |
| **Adapter directory deleted while registered** | `register()` re-validates the directory exists at every state transition. If missing, throws `AdapterNotFoundError` and registry entry is marked `archived` automatically (with a `note: 'on-disk adapter missing'`). |
| **Registry file corruption** | We read+parse on every mutation; bad JSON → `RegistryCorruptError` with the operator instructed to restore from `<path>.bak` (we keep one backup per write). |
| **Race between cron and CLI** | Documented single-writer model. Phase 4 retrainer holds its own lock; CLI usage is discouraged during cron windows. |
| **Modelfile relative path resolution** | We always set subprocess cwd to `adapterPath`. |
| **Ollama disk pressure from accumulated archived adapters** | `maxArchivedToKeep = 10` GC. Operator may bump higher on disk-rich systems. |
| **Canary holding indefinitely without operator action** | Out of Phase 3's scope. Phase 4 owns the time-based promotion/rejection cron. |
| **Eval-report.json absent (Phase 1 not yet shipped at register time)** | `register()` tolerates ENOENT; `evalReport` field is optional in `RegistryEntry`. Phase 4 retrainer is the eval gatekeeper, not Phase 3. |

---

## 16. Stages 4-10 outline

- **Stage 4 (Implement)** — 13 source modules per §9 layout. ESM TypeScript. Fully parameterised constructor.
- **Stage 5 (Unit test)** — ~50-70 vitest cases across the 9 test files in §14.
- **Stage 6 (Integration test)** — full lifecycle integration test with fake Ollama; verifies state machine end-to-end.
- **Stage 7 (Deploy)** — install script with placeholder substitution per leg-3 standing rule. Initial canary-routing.json shipped at `null/null` state. No LaunchAgent activation in Phase 3 (Phase 4 owns the cron).
- **Stage 8 (E2E live verify)** — gated by `APPRENTICE_SERVING_OLLAMA_INSTALLED=1`. Runs against real Ollama. Deferred to operator if no Phase 2 adapter has been trained yet (we ship a tiny synthetic adapter for the e2e to exercise the subprocess path).
- **Stage 9 (Regression)** — package tests pass; full monorepo `pnpm -r typecheck && pnpm -r lint`.
- **Stage 10 (Document + capture learnings)** — README + completion doc.

---

## 17. Constraints honoured

- ✅ **Option E shape** — private `@chiefaia/apprentice-serving`; parameterised constructor with CAIA defaults; tests inject in-memory fs + fake Ollama client; never published.
- ✅ **Subscription-only LLM** — Ollama is local-only; zero API-key billing.
- ✅ **Mac MLX local** — adapters loaded into local Ollama daemon.
- ✅ **Operator does NOT code** — operator validates visual outputs (registry contents, canary-routing JSON, `ollama list` after promotion).
- ✅ **Git Flow** — `feat/apprentice-serving-001-phase3` → `develop`. PR with auto-merge armed. No force-push, no `--admin` merge.
- ✅ **No silent model swaps** — every state transition is logged in `history`; canary-routing.json change is visible to operator.
- ✅ **Decision-classifier** — package decides (state transitions, GC); operator informed via registry contents. No operator-prompts in this package; Phase 4 retrainer owns operator interaction.

---

## See also

- `~/Documents/projects/reports/apprentice-phase-2-complete-2026-05-06.md` — Phase 2 sentinel; defines the adapter-directory contract this package consumes.
- `agent/memory/apprentice_agent_directive.md` — full campaign spec.
- `agent/memory/agent_architecture_shape_2026-05-06.md` — Option E.
- `packages/apprentice-training/DESIGN.md` — sibling spec; same shape pattern.
- `packages/apprentice-corpus/DESIGN.md` — sibling spec; manifest read-side reference.
- ml-explore/mlx-lm `LORA.md` — adapter file format.
- Ollama docs — Modelfile + `ollama create` semantics.
