# `@chiefaia/apprentice-serving`

Apprentice Phase 3 — adapter swapping and serving for the CAIA training loop.

This package consumes adapter directories produced by `@chiefaia/apprentice-training` (Phase 2) and turns them into Ollama-loaded models with full lifecycle tracking: `registered → shadow → canary → production`, with `archived` and `rejected` terminals. It also writes a canary-routing config that downstream agents read at inference time to do percent-based traffic splitting between the current production model and a candidate canary.

## What it does

- Reads `<adapterPath>/Modelfile`, `<adapterPath>/training-metadata.json`, and (optional) `<adapterPath>/eval-report.json`.
- Loads the adapter into Ollama via `ollama create <name> -f Modelfile` subprocess.
- Tracks the adapter's lifecycle in a persisted JSON registry at `~/Documents/projects/apprentice/registry.json`.
- Writes a canary-routing config at `~/Documents/projects/apprentice/canary-routing.json` that consumers read to decide which model to invoke per request.
- Provides deterministic request-id-hashed routing so the same request always lands on the same model (no flapping under retries).

Phase 3 is invoked on demand by Phase 4's retrainer cron. There is no LaunchAgent in Phase 3 itself.

## CLI

```
caia-apprentice-serving register <adapter-path>
caia-apprentice-serving promote-canary <adapter-path> --percent <0..100>
caia-apprentice-serving promote-production <adapter-path>
caia-apprentice-serving rollback <adapter-path>
caia-apprentice-serving reject <adapter-path> --reason "<reason>"
caia-apprentice-serving list [--status <status>]
caia-apprentice-serving show <adapter-path>
caia-apprentice-serving canary-config
```

Common flags: `--registry-path`, `--canary-routing-path`, `--ollama-binary`.

Exit codes: `0` success, `1` validation error, `2` Ollama subprocess failure, `3` filesystem failure, `4` adapter-not-found / metadata-malformed.

## API

```ts
import { ApprenticeServing } from '@chiefaia/apprentice-serving';

const serving = new ApprenticeServing();

// Idempotent — reads training-metadata.json, derives registry key, upserts entry.
const entry = await serving.register('/path/to/adapter-dir');

// Loads <base>-canary-<sha7> into Ollama, transitions to canary, updates routing.
await serving.promoteToCanary('/path/to/adapter-dir', 10);

// Loads <base>-production into Ollama, archives previous production.
await serving.promoteToProduction('/path/to/adapter-dir');

// Re-promotes an archived adapter to production; archives the current.
await serving.rollback('/path/to/older-adapter-dir');

// Marks rejected; removes from Ollama if loaded.
await serving.reject('/path/to/adapter-dir', 'eval winRate=0.45 below gate');

// Read-only views.
serving.list();              // RegistryEntry[]
serving.currentProduction(); // RegistryEntry | undefined
serving.currentCanary();     // RegistryEntry | undefined

// Routing-side reader (cheap to call hot-path; cached per-instance with mtime check).
const router = serving.canaryRouter;
router.routeRequest('request-id-42'); // 'qwen2-5-coder-7b-production' | 'qwen2-5-coder-7b-canary-abc' | null
```

## State machine

```
registered ──promoteToCanary──► canary ──promoteToProduction──► production
     │                                                               │
     └──reject──► rejected                  another adapter promoted │
                                                                     ▼
                                            production ──► archived ──┐
                                                                       │
                                                            rollback ──┘
                                                            (re-promotes archived → production)
```

Invariants enforced at every mutation:

1. At most one entry has `status === 'production'`.
2. At most one entry has `status === 'canary'`.
3. `adapterName` (= adapter directory basename) is unique.
4. `archivedAt` set iff `status === 'archived'`.
5. `canaryPercent` set iff `status === 'canary'`.
6. `rejectionReason` set iff `status === 'rejected'`.

Violations throw `RegistryInvariantError`. Invalid transitions (e.g., `promoteToProduction` on an entry still in `registered`) throw `RegistryStateMismatchError`.

## Ollama model naming

```
shadow:      <baseShortName>-shadow-<sha7>
canary:      <baseShortName>-canary-<sha7>
production:  <baseShortName>-production
```

Where `baseShortName` is `baseModelOllamaTag` lowercased, with `:` and other non-`[a-z0-9-]` characters mapped to `-`. The `production` slot deliberately drops the sha so consumers can hard-code `<baseShortName>-production` and get atomic cutover.

`canaryModelName`, `productionModelName`, and `shadowModelName` are constructor parameters with these defaults — operators / Phase 4 can override.

## Canary-routing config

Format at `<canaryRoutingConfigPath>`:

```json
{
  "version": 1,
  "generatedAt": "2026-05-06T14:32:11.123Z",
  "production": {
    "ollamaModelName": "qwen2-5-coder-7b-production",
    "adapterName": "2026-05-06-qwen2.5-coder-7b-rank8-iters1500"
  },
  "canary": {
    "ollamaModelName": "qwen2-5-coder-7b-canary-abc1234",
    "adapterName": "2026-05-13-qwen2.5-coder-7b-rank8-iters1500",
    "percent": 10
  }
}
```

`production` is `null` when no production has been promoted; `canary` is `null` when no canary is active. Consumers should tolerate ENOENT on the file (initial state).

## Setup

```bash
pnpm --filter @chiefaia/apprentice-serving build
packages/apprentice-serving/scripts/install-apprentice-serving.sh
```

The install script ensures the data root exists, seeds an empty canary-routing.json if missing, and verifies that `ollama` is on PATH.

## Configuration (Option E)

```ts
new ApprenticeServing({
  // — paths —
  registryPath: '~/Documents/projects/apprentice/registry.json',
  canaryRoutingConfigPath: '~/Documents/projects/apprentice/canary-routing.json',

  // — Ollama —
  ollamaBinaryPath: 'ollama',
  ollamaHost: undefined, // respects OLLAMA_HOST env var

  // — naming overrides —
  productionModelName: (b) => `${b}-production`,
  canaryModelName: (b, sha7) => `${b}-canary-${sha7}`,
  shadowModelName: (b, sha7) => `${b}-shadow-${sha7}`,

  // — guard rails —
  maxArchivedToKeep: 10,

  // — test seams —
  ollamaClient: undefined, // injection point for fake client
  fs: undefined,           // injection point for fake fs
  clock: undefined         // injection point for deterministic clock
});
```

## Testing

```bash
pnpm --filter @chiefaia/apprentice-serving test
```

87 tests across 7 files (85 unit + 2 e2e gated):

- `metadata-reader.test.ts` — schema validation, sha determinism, eval-report extraction (13 tests).
- `adapter-registry.test.ts` — every state transition, every invariant, persistence, GC (24 tests).
- `canary-router.test.ts` — deterministic routing, percent boundaries, mtime cache (11 tests).
- `ollama-client.test.ts` — argv shape, error classification, env hygiene (16 tests).
- `serving.test.ts` — top-level orchestration, failure-mode handling (19 tests).
- `serving.integration.test.ts` — full lifecycle integration with fake Ollama (2 tests).
- `serving.e2e.test.ts` — gated by `APPRENTICE_SERVING_OLLAMA_INSTALLED=1`; runs against live Ollama.

E2E test live-validated 2026-05-06 against `ollama 0.23.1` on the operator's Mac with `qwen2.5-coder:7b` as the base — full lifecycle (register → canary → production → list-confirms) passed cleanly.

## Environment

- macOS — Apple Silicon Mac
- Node ≥ 20
- TypeScript ≥ 5.9 (workspace toolchain)
- Ollama ≥ 0.1.x (CLI subprocess; tested against 0.23.1)

## See also

- `DESIGN.md` — full architecture spec (17 sections, ~660 lines).
- `~/Documents/projects/reports/apprentice-phase-3-complete-2026-05-06.md` — Phase 3 completion sentinel.
- `agent/memory/apprentice_agent_directive.md` — full campaign spec.
- `agent/memory/agent_architecture_shape_2026-05-06.md` — Option E.
- `packages/apprentice-training/README.md` — Phase 2 (upstream).
- `packages/apprentice-corpus/README.md` — Phase 0 (corpus).
