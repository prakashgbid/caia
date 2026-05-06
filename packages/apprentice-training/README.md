# `@chiefaia/apprentice-training`

Phase 2 of the [Apprentice Agent](../../agent/memory/apprentice_agent_directive.md) — LoRA training pipeline.

Reads `@chiefaia/apprentice-corpus`'s `manifest.json` + `samples.jsonl`, splits into train/valid/test (honouring `manifest.holdout` when present), writes MLX-LM-formatted JSONL to a working dir, spawns `python -m mlx_lm.lora` to QLoRA-train a 4-bit-quantised 7B base on Mac M-series, and emits a date-stamped adapter directory containing `adapters.safetensors` + `adapter_config.json` + a training-log + a wrapper metadata file + an Ollama Modelfile scaffold.

**Shape**: Option E (CAIA-Bonded Skeleton) — private workspace package, fully parameterised constructor with CAIA defaults, fixture-corpora-tested with a mocked subprocess, never published.

## Pipeline

```
manifest.json + samples.jsonl
        │
        ▼
   ApprenticeTrainer.train()
        │
        ▼
   splitter (honour manifest.holdout when present; id-hash fallback otherwise)
        │
        ▼
   formatter → {train,valid,test}.jsonl in workDir + lora.yaml
        │
        ▼
   preflight (python+mlx_lm importable, free RAM, paths)
        │
        ▼
   subprocess: python -m mlx_lm.lora --train ...
        │
        ▼
   postflight (adapter file + adapter_config.json verified)
        │
        ▼
   metadata-writer → training-metadata.json + Modelfile
        │
        ▼
   optional: evalHarness.evaluate(adapter)   ← Phase 1 harness, injected
        │
        ▼
   TrainResult
```

## Programmatic use

```typescript
import { ApprenticeTrainer } from '@chiefaia/apprentice-training';

// All defaults bond to CAIA
const trainer = new ApprenticeTrainer();
const result = await trainer.train();
console.log(`adapter: ${result.adapterPath}`);
console.log(`elapsed: ${(result.elapsedMs / 1000 / 60).toFixed(1)} min`);
```

Override any default via the constructor (testability + non-CAIA fixtures):

```typescript
const trainer = new ApprenticeTrainer({
  corpusManifestPath: '/path/to/test/manifest.json',
  outputAdapterRoot: '/tmp/adapters',
  workDirRoot: '/tmp/work',
  loraConfig: {
    numLayers: 8,           // smaller for experiments
    rank: 16,               // higher capacity
    iters: 200,
    batchSize: 1,
    maxSeqLength: 1024,     // smaller for tighter RAM
  },
  evalAfterTrain: false,
  fs: customFsAccess,
  subprocessRunner: customSubprocessRunner,
});
```

## CLI

```bash
# Run with CAIA defaults (env-var overrides supported)
caia-apprentice-training train

# Plan only (no spawn)
caia-apprentice-training train --dry-run

# Smaller config for ad-hoc experiments
caia-apprentice-training train --num-layers 8 --rank 16 --iters 200

# Skip eval-after-train (default is to run it if evalHarness is wired)
caia-apprentice-training train --no-eval

# Help
caia-apprentice-training --help
```

Env vars (in priority order: CLI flag → env → CAIA fallback):

- `APPRENTICE_CORPUS_MANIFEST` — corpus manifest path (default: latest in `APPRENTICE_CORPUS_ROOT`)
- `APPRENTICE_ADAPTER_ROOT` — `~/Documents/projects/apprentice/adapters`
- `APPRENTICE_WORK_ROOT` — `~/Documents/projects/apprentice/work`
- `APPRENTICE_BASE_MODEL` — `mlx-community/Qwen2.5-Coder-7B-Instruct-4bit`
- `APPRENTICE_BASE_OLLAMA_TAG` — `qwen2.5-coder:7b`
- `PYTHON_BINARY` — `python3` (recommend pointing at `~/Documents/projects/apprentice/venv/bin/python`)

## Output layout

```
<outputAdapterRoot>/<YYYY-MM-DD>-<modelShortname>-rank<N>-iters<N>/
├── adapters.safetensors        — MLX-LM canonical output (LoRA weights)
├── adapter_config.json         — MLX-LM canonical output (rank, num_layers, scale)
├── training-log.txt            — captured subprocess stdout/stderr
├── training-metadata.json      — wrapper: corpus hash, hyperparams, host, git, elapsed
├── Modelfile                   — Ollama Modelfile scaffold (Phase 3 deploys)
└── eval-report.json            — (optional) Phase 1 harness output if evalAfterTrain=true
```

`training-metadata.json` shape (excerpt):

```json
{
  "version": 1,
  "generatedAt": "<ISO 8601 UTC>",
  "trainerVersion": "@chiefaia/apprentice-training@0.1.0",
  "corpusManifestPath": "...",
  "corpusManifestSha256": "...",
  "corpusTotals": { "samplesUsed": 87, "trainCount": 73, "validCount": 9, "testCount": 5 },
  "baseModel": "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
  "loraConfig": { "numLayers": 16, "rank": 8, "iters": 500, ... },
  "subprocess": { "argv": [...], "exitCode": 0, "elapsedMs": ..., "host": {...} },
  "configSha256": "..."
}
```

## Setup — install mlx-lm

mlx-lm is a Python runtime dependency outside the npm tree. Install via the helper:

```bash
scripts/install-mlx-lm.sh
# creates ~/Documents/projects/apprentice/venv with mlx-lm pip-installed
```

Then either set `PYTHON_BINARY` or pass `--python`:

```bash
PYTHON_BINARY=~/Documents/projects/apprentice/venv/bin/python caia-apprentice-training train
```

The trainer's preflight verifies `python3 -m mlx_lm.lora --help` succeeds and that the required flag set is present. If your installed mlx-lm is too old, preflight throws `MlxLmVersionIncompatibleError` with upgrade instructions.

## Hard constraints

- 🚨 **Subscription-only LLM cost**. Training does NOT call any LLM. The `ANTHROPIC_API_KEY` is explicitly cleared from the subprocess env as defence-in-depth (see `feedback_no_api_key_billing.md`). MLX uses local quantised weights; no remote LLM calls anywhere.
- 🚨 **Mac MLX is primary**. Cloud GPU is `cloudGpuEnabled: false` in Phase 2 (Phase-2-cloud-extension is a follow-up). When enabled, runs are bounded at \$50/run / \$200/month per `feedback_minimal_cloud_gpu_allowed.md`; runs > \$50 escalate to operator.
- 🚨 **No silent model swaps**. This package produces an adapter file; Phase 3 (serving) separately wires it into Ollama. Phase 2 alone CANNOT cause a production model change.
- 🚨 **Decision-classifier**: trainer **decides** hyperparameters, split, work-dir layout, postflight verdicts. **Asks operator only** for cloud spend > \$50.
- 🚨 **Determinism**: split + JSONL + argv are deterministic given `(corpus, config, splitSeed)`. Same inputs → byte-identical training inputs.

## 16GB Mac defaults

Tuned for Mac M1 Pro 16GB unified memory. See `DESIGN.md` §6 for rationale.

| Param | Default | Notes |
|---|---|---|
| `numLayers` | 16 | half of Qwen2.5-Coder-7B's 28 layers; LoRA on the last 16 |
| `rank` | 8 | r=8 baseline; r=16 if quality short |
| `alpha` | 16 | rule of thumb 2× rank |
| `learningRate` | 1e-5 | mlx-lm default for QLoRA |
| `iters` | 500 | for 87 samples + batch 1 + grad-accum 4 ≈ 5 epochs |
| `batchSize` | 1 | 16 GB safe baseline; 2 also fits with less headroom |
| `maxSeqLength` | 2048 | drops to 1024 if OOM |
| `gradAccumulationSteps` | 4 | effective batch 4 without RAM cost |
| `gradCheckpoint` | true | ~30% slower, ~30% less peak RAM |
| `maskPrompt` | true | loss only on assistant message |

## Testing

```bash
pnpm test          # 74 tests (config / mlx-args-builder / splitter / formatter / manifest-reader / preflight / postflight / metadata-writer / trainer.unit)
pnpm typecheck
pnpm lint
pnpm build

# Stage 6 integration test (real subprocess; requires mlx-lm)
APPRENTICE_TRAINING_MLX_INSTALLED=1 pnpm test -- trainer.integration
```

Tests inject fixture corpora at `tests/__fixtures__/mini-corpus/` and a mocked subprocess via `tests/helpers/fakes.ts`. The default constructor (CAIA defaults) is exercised in the dry-run + integration paths only.

## Deployment

LaunchAgent `plists/com.chiefaia.apprentice-training.plist` schedules weekly retraining (Saturday 02:00 local). **Phase 2 ships this DISABLED**; Phase 4 (retrainer cron) is what activates it.

Install (Phase 4 will run; Phase 2 documents only):

```bash
# Build first (required before install)
pnpm build

# Render plist + launchctl bootstrap (DISABLED by default)
scripts/install-apprentice-training.sh

# CI-sanity mode: render + lint, don't touch launchd
CAIA_DRY_INSTALL=1 scripts/install-apprentice-training.sh
```

Logs at `~/Library/Logs/chiefaia/apprentice-training.log`.

## See also

- [`DESIGN.md`](DESIGN.md) — full architecture rationale (16 sections; mandate, pipeline, MLX flag canonical decisions, hyperparameter rationale, risks, eval integration)
- `agent/memory/apprentice_agent_directive.md` — full Apprentice campaign spec
- `agent/memory/agent_architecture_shape_2026-05-06.md` — Option E standing rule
- `agent/memory/feedback_minimal_cloud_gpu_allowed.md` — cloud GPU \$50/run cap
- `agent/memory/feedback_monorepo_regression_gate_ergonomics.md` — leg-3 standing rule (typecheck+lint, not build; LaunchAgent placeholder pattern)
- [`@chiefaia/apprentice-corpus`](../apprentice-corpus/) — Phase 0 sibling; manifest.json shape is the input contract
- [`@chiefaia/apprentice-eval`](../apprentice-eval/) — Phase 1 sibling; harness.evaluate is the optional eval-after-train injection point
- [ml-explore/mlx-lm `LORA.md`](https://github.com/ml-explore/mlx-lm/blob/main/mlx_lm/LORA.md) — canonical CLI flag reference
