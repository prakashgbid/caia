# `@chiefaia/apprentice-training` — Phase 2 Design

**Status**: Phase 2 of the Apprentice Agent (per `agent/memory/apprentice_agent_directive.md`). Sibling to Phase 0 (`@chiefaia/apprentice-corpus`, shipped) and Phase 1 (`@chiefaia/apprentice-eval`, in PR #366). Phase 3 (serving) and Phase 4 (retrainer) are downstream packages that consume this one's adapter output.
**Shape**: Option E — CAIA-Bonded Skeleton (per `agent_architecture_shape_2026-05-06.md`).
**Author**: Apprentice Phase 2 leg 1 (2026-05-06). Stages 1-3 deliverable; Stages 4-10 land in leg 2.
**Scope**: LoRA training pipeline only — read corpus, format for MLX, spawn `mlx_lm.lora` subprocess, capture output, return adapter file. NOT serving. NOT scheduled retraining. NOT eval scoring (Phase 1's territory).

## 1. Mandate

Take the `@chiefaia/apprentice-corpus` manifest + `samples.jsonl` and produce a `.safetensors` LoRA adapter that fine-tunes a 4-bit-quantised 7B base model on Mac M-series via MLX-LM's `lora` entry point.

End-to-end:

```
manifest.json + samples.jsonl
        │
        ▼
  ApprenticeTrainer.train()
        │
        ▼
  train.jsonl + valid.jsonl + test.jsonl    ←  honour manifest.holdout (R6 from Phase 1)
        │                                      train = 85% / valid = 10% / test = 5% by deterministic id-hash split
        ▼
  python -m mlx_lm.lora --train --model <quantised base> --data <work-dir> ...
        │
        ▼
  ~/Documents/projects/apprentice/adapters/<YYYY-MM-DD>-rank<N>/
        ├── adapters.safetensors            ← MLX-LM canonical output
        ├── adapter_config.json             ← MLX-LM canonical output (rank, num_layers, scale)
        ├── training-log.txt                ← captured subprocess stdout/stderr
        ├── training-metadata.json          ← our wrapper: corpus hash, hyperparams, elapsed, host, git sha
        └── Modelfile                       ← Ollama integration scaffold (Phase 3 will deploy this)
```

Phase 2 ships a single `class ApprenticeTrainer { async train(): Promise<TrainResult> }` plus a small CLI wrapper. The first real adapter produced from the Phase 0 corpus (87 samples, see Phase 0 §Stage 8 sentinel) is the Stage 8 live-verify deliverable.

**Out of scope (downstream packages will own these)**:
- Phase 3 (`apprentice-serving`) — Ollama adapter loading, canary rollout, registry tracking.
- Phase 4 (`apprentice-retrainer`) — weekly cron that orchestrates Phase 0 → Phase 1 → Phase 2 in a loop.
- Phase 1's `ApprenticeEvalHarness` does the post-training scoring; we invoke it but don't reimplement scoring logic here.

## 2. Package shape (Option E checklist)

- ✅ `packages/apprentice-training/` (NOT `apps/apprentice/training/` — apps consume packages).
- ✅ `package.json`: `"private": true`, scope `@chiefaia/apprentice-training`, never published.
- ✅ Public API parameterised via `ApprenticeTrainingConfig` constructor — every CAIA path / model name / MLX binary path / hyperparameter is a parameter with a CAIA default.
- ✅ Tests inject fixture corpus manifests + a fake `subprocessRunner` — never live MLX subprocess. The integration test (Stage 6) is the only place a real subprocess fires, and only against a tiny corpus + 2-iter run.
- ✅ Pre-spawn injection: this package does NOT call any LLM directly (training is a subprocess; no `claude` calls). The corpus has already passed through `caia-mentor-prepend | caia-librarian-prepend` upstream — we don't bypass.
- ✅ AGENTS.md (already filed at repo root) is consulted for build / test / lint / typecheck commands; this package has no special override.

## 3. Public API

```typescript
import { ApprenticeTrainer } from '@chiefaia/apprentice-training';

const trainer = new ApprenticeTrainer({
  // All optional — CAIA defaults filled in by constructor.
  corpusManifestPath: '~/Documents/projects/apprentice/corpora/2026-05-06/manifest.json',
  outputAdapterRoot: '~/Documents/projects/apprentice/adapters',
  workDirRoot:       '~/Documents/projects/apprentice/work',
  // Model selection (MLX-canonical HF repo identifiers):
  baseModel:         'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit',
  baseModelOllamaTag: 'qwen2.5-coder:7b',           // for Modelfile scaffold (Phase 3 consumes)
  // LoRA hyperparameters (Mac M1 Pro 16GB-tuned defaults; see §6):
  loraConfig: {
    numLayers:        16,                            // canonical mlx-lm flag (NOT --lora-layers; see §5)
    rank:             8,                             // mlx-lm default
    alpha:            16,
    dropout:          0.0,
    learningRate:     1e-5,
    iters:            500,                           // ~5 epochs over 87 samples ≈ 500 iters at batch 1
    batchSize:        1,                             // 16GB M1 Pro safe default; 2 also viable
    maxSeqLength:     2048,                          // can drop to 1024 if OOM
    gradAccumulationSteps: 4,                        // effective batch 4 without RAM cost
    gradCheckpoint:   true,                          // additional memory-savings pass
    maskPrompt:       true,                          // chat-format only loss on assistant turn
    saveEvery:        100,
    stepsPerEval:     50,
    valBatches:       8,
  },
  // Subprocess + binary controls:
  pythonBinaryPath:  'python3',                      // mlx_lm is a python module
  mlxLmModule:       'mlx_lm.lora',                  // override for cloud-GPU paths if needed
  // Behaviour knobs:
  trainSplitFraction:       0.85,                    // train = 85%
  validSplitFraction:       0.10,                    // valid = 10%
  testSplitFraction:        0.05,                    // test  = 5% (overridden by manifest.holdout when present)
  splitSeed:                42,                      // deterministic id-hash split when manifest.holdout absent
  minSamplesToTrain:        5,                       // refuse if corpus too small
  trainingTimeoutMs:        14_400_000,              // 4 hours hard cap (M1 Pro overnight assumption)
  cloudGpuEnabled:          false,                   // Phase 2-cloud-extension; off by default
  evalAfterTrain:           true,                    // invoke @chiefaia/apprentice-eval after success
  // Dependency injection (test seams):
  subprocessRunner:         defaultSubprocessRunner,
  fs:                       defaultFsAccess,
  clock:                    () => new Date(),
  evalHarness:              undefined,               // injected by Phase 4 retrainer; default undefined skips eval-on-success
});

const result = await trainer.train();
// result.adapterPath = '~/Documents/projects/apprentice/adapters/2026-05-06-rank8/'
// result.adapterFile = '<adapterPath>/adapters.safetensors'
// result.trainingMetadataPath = '<adapterPath>/training-metadata.json'
// result.elapsedMs = 14523456
// result.evalReport = { winRate: 0.62, decision: 'promote-canary' } | undefined
```

CLI:

```bash
# Train with CAIA defaults (latest manifest, 16GB-Mac defaults)
caia-apprentice-training train

# Override single field
caia-apprentice-training train --corpus-manifest /path --num-layers 8 --iters 200

# Tiny training run — Stage 6 integration test invocation
caia-apprentice-training train --iters 2 --num-layers 2 --batch-size 1 --no-eval

# Plan only — print resolved config + planned subprocess command, no spawn
caia-apprentice-training train --dry-run

# Help
caia-apprentice-training --help
```

## 4. Pipeline / data flow

```
                  manifest.json
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
   read holdout ids        read totals + outputDir
                       │
                       ▼
                samples.jsonl
                       │
                       ▼
     ┌─────────────────────────────────┐
     │  splitter:                       │
     │   • test  = ids ∈ manifest.holdout (Phase 0 R6) │
     │   • valid = next ~10% via id-hash mod 10 < 1   │
     │   • train = remainder              │
     └─────────────────────────────────┘
                       │
                       ▼
     ┌─────────────────────────────────┐
     │  formatter:                      │
     │   strip `meta` field             │
     │   keep `messages[]` only         │
     │   write {train,valid,test}.jsonl │
     │   into <workDirRoot>/<run-id>/   │
     └─────────────────────────────────┘
                       │
                       ▼
     ┌─────────────────────────────────┐
     │  preflight checks:               │
     │   • base model resolvable        │
     │   • mlx_lm module importable     │
     │   • adapter dir not yet exists   │
     │   • free RAM ≥ 8 GB              │
     └─────────────────────────────────┘
                       │
                       ▼
     ┌─────────────────────────────────┐
     │  spawn subprocess:               │
     │   python -m mlx_lm.lora --train  │
     │     --model <baseModel>          │
     │     --data <workDir>             │
     │     --num-layers N --iters N ... │
     │     --adapter-path <adapterPath> │
     │   stream stdout/stderr to file   │
     └─────────────────────────────────┘
                       │
                       ▼
     ┌─────────────────────────────────┐
     │  postflight:                     │
     │   • adapters.safetensors exists  │
     │   • adapter_config.json valid    │
     │   • write training-metadata.json │
     │   • write Modelfile scaffold     │
     │   • optionally: harness.evaluate │
     └─────────────────────────────────┘
                       │
                       ▼
                TrainResult
```

The pipeline is **idempotent over (manifest hash, hyperparams)** — same inputs + same hyperparams → same `<adapter-path>` directory name + comparable training loss curve. The `<run-id>` for the work directory is `<corpusSha8>-<configSha8>-<timestamp>` so concurrent runs never collide.

## 5. MLX-LM subprocess invocation contract

The subprocess command we construct (verified against ml-explore/mlx-lm `LORA.md` mid-2026):

```
python3 -m mlx_lm.lora \
  --train \
  --model mlx-community/Qwen2.5-Coder-7B-Instruct-4bit \
  --data <workDir> \
  --adapter-path <adapterPath> \
  --num-layers 16 \
  --iters 500 \
  --batch-size 1 \
  --learning-rate 1e-5 \
  --max-seq-length 2048 \
  --grad-accumulation-steps 4 \
  --grad-checkpoint \
  --mask-prompt \
  --save-every 100 \
  --steps-per-eval 50 \
  --val-batches 8 \
  --seed 42
```

**Flag-naming canonical decisions** (where MLX-LM's history has split usage):

| Decision | Value | Why |
|---|---|---|
| Layers flag | `--num-layers` | Canonical in current `mlx-lm` (the `mlx_lm.lora` entry point). The older `mlx-examples/lora/` repo used `--lora-layers`; we target `mlx-lm`. |
| Quantisation | implicit via `--model <pre-quantised>` | A 4-bit base auto-triggers QLoRA in `mlx-lm`. We use `mlx-community/Qwen2.5-Coder-7B-Instruct-4bit` to make this explicit. |
| Loss masking | `--mask-prompt` | Chat-format only computes loss on the final (assistant) message. Matches our corpus shape (system + user + assistant). |
| Adapter file naming | `<adapterPath>/adapters.safetensors` | MLX-LM writes this filename. We assert its presence in postflight. |
| Adapter config | `<adapterPath>/adapter_config.json` | MLX-LM writes this. Our postflight reads it back and re-emits a wrapper `training-metadata.json` that adds CAIA-side context (corpus hash, git sha, host info). |

**Subprocess lifecycle**:

- Spawn with `child_process.spawn(python, args, { cwd: workDir, env: cleanedEnv })`.
- `cleanedEnv` removes `ANTHROPIC_API_KEY` (defence-in-depth — MLX doesn't call LLMs, but the standing rule applies everywhere).
- Streams stdout + stderr concurrently to `<adapterPath>/training-log.txt`.
- `trainingTimeoutMs` (default 4h) sends SIGTERM → wait 30s → SIGKILL; partial logs preserved.
- Exit code != 0 → throw `MlxLoraSubprocessError` with last 100 lines of training-log.txt for triage.
- Successful exit → run postflight checks (§4).

**Working directory layout** (cleared after success when `keepWorkDir: false`, default):

```
<workDirRoot>/<run-id>/
├── train.jsonl
├── valid.jsonl
├── test.jsonl
└── config-snapshot.json
```

The work directory survives subprocess crashes (debugging aid). A retention sweep keeps the 3 most recent.

## 6. Hyperparameter defaults — Mac M1 Pro 16GB

Mac M1 Pro 16GB unified memory, 8 cores. `qwen2.5-coder:7b` (4-bit) inference uses ~5 GB. QLoRA training of the same with the defaults below uses ~8-12 GB peak per the Apprentice directive's hardware-reality call-out (verified empirically in Stage 6 / Stage 8).

| Param | Default | Why |
|---|---|---|
| `numLayers` | 16 | mlx-lm default. Half of Qwen2.5-Coder-7B's 28 layers; LoRA applied to the last 16. Tradeoff: more layers = better quality + more RAM. 16 is safe at 16 GB unified; 8 is the experiment-fast option. |
| `rank` | 8 | mlx-lm default. Bigger rank = more capacity + more params. r=8 is a strong baseline; r=16 if quality is short. |
| `alpha` | 16 | Rule of thumb 2× rank. |
| `dropout` | 0.0 | Standard for SFT on small instruction corpora. |
| `learningRate` | 1e-5 | mlx-lm default for QLoRA. |
| `iters` | 500 | For 87 samples + batch 1 + grad-accum 4 → effective batch 4 → ~5 epochs. Tunable per corpus size. |
| `batchSize` | 1 | 16 GB safe baseline. 2 also fits at the cost of less headroom; 4+ will OOM. |
| `maxSeqLength` | 2048 | CAIA samples cap at 16 K chars (≈4 K tokens), but the median sample is short. 2048 fits ~95% of samples; longer samples truncate. Drop to 1024 if RAM-tight. |
| `gradAccumulationSteps` | 4 | Effective batch = `batchSize × gradAccum` = 4. Memory-cost-neutral. |
| `gradCheckpoint` | true | Trades compute for memory; ~30% slower training, ~30% less peak RAM. Worth it on 16 GB. |
| `maskPrompt` | true | Loss only on assistant message. Chat-format-mandatory for correct behaviour. |
| `saveEvery` | 100 | Checkpoint every 100 iters → 5 checkpoints over a 500-iter run. Recoverable mid-run. |
| `stepsPerEval` | 50 | Validation loss every 50 iters → curve over 10 datapoints. |
| `valBatches` | 8 | 8 batches × batchSize 1 = 8 valid samples per eval pass. Cheap. |

These are not magic numbers — they're conservative starting points. Phase 4's retrainer cron will hyperparameter-sweep over `numLayers ∈ {8, 16}` and `rank ∈ {8, 16}` once the eval harness can compare adapter variants.

## 7. Train / valid / test split

Phase 0's `samples.jsonl` is a flat list. We need three pieces:

- `test.jsonl` — held-out from training, evaluated after training as a generalisation probe. **Honours `manifest.holdout: string[]` if present** (Phase 0 R6 / PR #367 ships this; merged when this DESIGN.md ships).
- `valid.jsonl` — used by `mlx_lm.lora` for `--steps-per-eval` validation loss. Should NOT overlap with test.jsonl (no contamination).
- `train.jsonl` — everything else.

**Algorithm** (deterministic, seed-pinned):

```python
holdout_ids = set(manifest.get('holdout', []))
all_samples = list(read_samples_jsonl(...))
test = [s for s in all_samples if s.id in holdout_ids]
remainder = [s for s in all_samples if s.id not in holdout_ids]

# id-hash split; mulberry32-style for cross-language reproducibility
def bucket(s, mod, seed):
  h = sha256(seed + s.id).hexdigest()[:8]
  return int(h, 16) % mod

valid_target = round(len(remainder) * (validSplitFraction / (1 - testSplitFraction)))
# bucket each remainder sample into [0..mod); take first valid_target as valid
sorted_by_bucket = sorted(remainder, key=lambda s: bucket(s, 1_000_000, splitSeed))
valid = sorted_by_bucket[:valid_target]
train = sorted_by_bucket[valid_target:]
```

- When `manifest.holdout` is empty (older Phase 0 corpora pre-PR #367), the splitter falls back to id-hash for test too: `bucket % 20 < 1` ≈ 5%.
- The split is **deterministic given (manifest, splitSeed)**. Same inputs → same triplet. Re-runs are reproducible.
- Verifies non-overlap as a postflight assertion: `train ∩ valid = train ∩ test = valid ∩ test = ∅`.

**JSONL emission** — strip everything except `messages[]` (mlx-lm's chat-format reader ignores extra keys, but we keep the file lean):

```jsonl
{"messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}, {"role": "assistant", "content": "..."}]}
```

Sample `meta.id` and `meta.contentSha256` are NOT written into the training JSONL — they live in the corpus manifest.

## 8. Output adapter directory

Naming pattern: `<outputAdapterRoot>/<YYYY-MM-DD>-<modelShortname>-rank<N>-iters<N>/`.

- `<modelShortname>` is a slug derived from `baseModel` (e.g. `qwen2.5-coder-7b`).
- The combination of model + rank + iters in the directory name makes inspection-by-`ls` self-documenting.
- The directory is the **canonical artifact** that Phase 3 (serving) reads. Phase 3 doesn't care about our work-dir; just the adapter directory.

Layout:

```
<outputAdapterRoot>/2026-05-06-qwen2.5-coder-7b-rank8-iters500/
├── adapters.safetensors         ← MLX-LM canonical output
├── adapter_config.json          ← MLX-LM canonical output  
├── training-log.txt             ← captured stdout/stderr
├── training-metadata.json       ← OUR wrapper (next §)
├── Modelfile                    ← Ollama Modelfile scaffold
└── eval-report.json             ← (optional) Phase 1 harness output if evalAfterTrain=true
```

`training-metadata.json` shape:

```json
{
  "version": 1,
  "generatedAt": "<ISO 8601 UTC>",
  "trainerVersion": "@chiefaia/apprentice-training@0.1.0",
  "corpusManifestPath": "<absolute>",
  "corpusManifestSha256": "<hex>",
  "corpusTotals": {
    "samplesUsed": 87,
    "trainCount": 73,
    "validCount": 9,
    "testCount": 5
  },
  "baseModel": "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit",
  "baseModelOllamaTag": "qwen2.5-coder:7b",
  "loraConfig": { "numLayers": 16, "rank": 8, "alpha": 16, "iters": 500, "batchSize": 1, ... },
  "subprocess": {
    "argv": ["python3", "-m", "mlx_lm.lora", "--train", ...],
    "exitCode": 0,
    "elapsedMs": 14523456,
    "host": { "model": "MacBookPro18,3", "memBytes": 17179869184, "arch": "arm64" }
  },
  "git": { "branch": "feat/...", "sha": "<full sha>", "dirty": false },
  "configSha256": "<hex>"
}
```

Phase 3's adapter registry uses `configSha256 + corpusManifestSha256` as the (model, corpus) compound key. Phase 4's retrainer cron compares it across runs to decide whether retraining is even necessary.

`Modelfile` scaffold (Phase 3 will deploy; emitted disabled-by-default in Phase 2):

```
# Apprentice adapter — generated <date>
FROM qwen2.5-coder:7b
ADAPTER ./adapters.safetensors
SYSTEM """<the same CAIA primer system message used by the corpus aggregator>"""
PARAMETER temperature 0.2
PARAMETER top_p 0.9
```

Operator (or Phase 3) loads this as `ollama create apprentice-v1 -f Modelfile` from the adapter directory.

## 9. Eval integration

When `evalAfterTrain: true` (default) AND `evalHarness` is injected (default undefined — only Phase 4 retrainer wires it), the trainer invokes the Phase 1 harness after successful training:

```typescript
const evalReport = await this.evalHarness.evaluate({
  adapters: [{
    name: adapterShortname,
    kind: this.config.baseModelOllamaTag,
    path: result.adapterPath,
  }],
});
result.evalReport = evalReport.adapters[0];
// writes <adapterPath>/eval-report.json
```

Phase 2 itself does NOT depend on `@chiefaia/apprentice-eval` — that would create a build-order coupling. Instead, the `evalHarness` is an injected interface (`evaluate(args): Promise<EvalReport>`); the consumer (Phase 4's retrainer) imports both packages and wires them together. This keeps the dependency graph clean: `apprentice-training` depends only on `apprentice-corpus` for the manifest schema.

**Why eval-after-train is a Phase 2 concern at all**: pure separation-of-concerns says the retrainer should orchestrate. But operator-facing UX is improved if a single `caia-apprentice-training train` command produces both the adapter AND a verdict — without that, the operator has to remember a second command. We make eval optional + opt-out so manual `train --no-eval` works; the test path uses `--no-eval` exclusively.

## 10. Cloud GPU support (deferred — `cloudGpuEnabled: false` by default in Phase 2)

Per `feedback_minimal_cloud_gpu_allowed.md`, RunPod / Vast.ai / Lambda spot GPUs are allowed at minimal level for training that exceeds Mac capacity. The directive caps single runs at $50, monthly at $200, escalates to operator above.

For Phase 2 we ship a STUB: `cloudGpuEnabled: false` is the only supported value. The adapter directory + subprocess invocation pattern is identical regardless, so the cloud path is a small follow-on (Phase 2-cloud-extension) that:

1. Reads cloud credentials from Vault at `secret/stolution/prod/cloud-gpu-api-key` (Vault path established in `feedback_minimal_cloud_gpu_allowed.md` §Setup).
2. Spins up a spot instance via the provider's API.
3. rsyncs corpus + work dir to the instance.
4. Runs the same `mlx_lm.lora` (or `transformers`-backed equivalent on CUDA) command remotely.
5. rsyncs the adapter directory back.
6. Tears down the instance.
7. Logs spend to `@chiefaia/spend-guard`.

If `cloudGpuEnabled: true` and the resolved estimate exceeds $50, the trainer THROWS rather than spending — operator must explicitly raise the cap. This is the decision-classifier line: tech-mechanics decide; product/architecture asks.

## 11. Risks + failure modes

| ID | Risk | Mitigation |
|---|---|---|
| **R1** | MLX-LM not installed at training time | Preflight check (§4): `python3 -c "import mlx_lm.lora"` on dry-run AND at start. Fail with clear install instructions: `pip install mlx-lm`. |
| **R2** | Mac OOM mid-training | Subprocess captures OOM signal; trainer parses log tail for "RuntimeError" / "OutOfMemory" patterns; suggests `numLayers` reduction or `maxSeqLength` reduction. Documented in README. |
| **R3** | Base model HF download fails / partially fails | mlx-lm caches under `~/.cache/huggingface/hub/`. Preflight verifies the model path is readable; first-time download is allowed but logged with size estimate. Cap downloads at 60 min. |
| **R4** | Corpus too small to train (≤ 5 samples after split) | Hard-fail at split time with `InsufficientCorpusError`; configurable via `minSamplesToTrain`. The 87-sample Stage-0 corpus is well above this floor. |
| **R5** | Adapter file not produced despite exit 0 | Postflight assertion: `adapters.safetensors` AND `adapter_config.json` MUST exist + parse. Missing → throw `AdapterNotProducedError` with last 100 lines of log. |
| **R6** | Catastrophic forgetting (Apprentice directive failure mode #1) | NOT this package's concern (Phase 1 eval harness flags this in its `regressionFlags`). Phase 4 retrainer rejects adapters with regression flags pre-canary. |
| **R7** | Operator-style overfitting (failure mode #2) | Mitigated upstream by Phase 0's quality scorer + Phase 1's eval suite including prompts where the right answer disagrees with operator's first instinct. Phase 2 just trains; doesn't filter. |
| **R8** | Subprocess hangs (training stuck without progress) | `trainingTimeoutMs` (default 4h) hard kill. Steps-per-report (every 25 iters by mlx-lm default) gives stdout heartbeat; trainer can additionally enforce a "no stdout for 10 min" watchdog. |
| **R9** | `manifest.holdout` field absent (older Phase 0 corpora) | Splitter falls back to id-hash test bucket (§7). Not ideal for cross-run reproducibility but better than crashing. Logged with a `WARNING` in training-metadata.json. |
| **R10** | Concurrent training runs collide on adapter dir | Adapter dir name embeds `corpusSha + configSha + iters` in its slug; collisions throw with a clear "another run with same params exists" error. Operator may force re-run with `--overwrite`. |
| **R11** | mlx-lm version drift breaks flag set | Pin a tested mlx-lm version in DESIGN appendix; preflight calls `python3 -m mlx_lm.lora --help` and greps for the exact flag set we depend on; if mismatch → throw `MlxLmVersionIncompatibleError`. Documented in README + standing-rule lesson if it ever fires. |
| **R12** | Subscription-only constraint accidentally violated | This package makes ZERO LLM calls. The cleanedEnv removes `ANTHROPIC_API_KEY` from the subprocess defensively. Any future eval-harness invocation goes through Phase 1's harness, which has its own `ANTHROPIC_API_KEY`-clear discipline. |

## 12. Hard constraints (Apprentice directive non-negotiables this package respects)

- 🚨 **Subscription-only LLM cost**. Training does NOT call any LLM. The `ANTHROPIC_API_KEY` is explicitly cleared from the subprocess env as defence-in-depth. MLX uses local quantised weights; no remote LLM calls anywhere in the training pipeline.
- 🚨 **Mac MLX is primary**. Cloud GPU is opt-in (off by default), bounded at $50/run by `feedback_minimal_cloud_gpu_allowed.md`, escalates to operator above. Phase 2 ships a stub; full cloud path is Phase 2-cloud-extension.
- 🚨 **No silent model swaps**. This package produces an adapter file; serving (Phase 3) wires it. The two are explicitly separated. Phase 2 alone CANNOT cause a production model change.
- 🚨 **Decision-classifier**: trainer **decides**: hyperparameters, split, work-dir layout, postflight verdicts. **Asks operator only** for cloud-spend > $50 or other product-architecture-level choices. Tech mechanics never ask.
- 🚨 **No noise**. CLI surface is one command (`train`) plus standard flags. Output to stdout is the resolved config (one line) + a single progress heartbeat (every 25 iters per mlx-lm default) + a final result line. Full machine-readable artifacts go to disk.

## 13. Package layout (for Stages 4-10, next leg)

```
packages/apprentice-training/
├── DESIGN.md                   ← this file
├── README.md                   ← Stage 10
├── package.json                ← private @chiefaia/apprentice-training
├── tsconfig.json + tsconfig.build.json
├── eslint.config.cjs
├── vitest.config.ts
├── src/
│   ├── types.ts                ← TrainingConfig, LoRAConfig, TrainResult, MlxLoraSubprocessError, …
│   ├── config.ts               ← resolveConfig() with CAIA defaults + env-var overrides
│   ├── manifest-reader.ts      ← reads & validates corpus manifest.json + samples.jsonl
│   ├── splitter.ts             ← train/valid/test deterministic split (§7)
│   ├── jsonl-formatter.ts      ← samples → mlx-lm chat-format JSONL
│   ├── preflight.ts            ← preflight checks (§4): python+mlx_lm importable, free RAM, paths
│   ├── subprocess-runner.ts    ← spawn + stdio capture + timeout + cleanedEnv
│   ├── mlx-args-builder.ts     ← constructs the mlx_lm.lora argv from LoRAConfig (§5)
│   ├── postflight.ts           ← verifies adapter file, parses adapter_config.json
│   ├── metadata-writer.ts      ← writes training-metadata.json + Modelfile scaffold
│   ├── trainer.ts              ← top-level ApprenticeTrainer orchestration
│   ├── cli.ts                  ← caia-apprentice-training entry point
│   └── index.ts                ← public API barrel
├── tests/
│   ├── __fixtures__/
│   │   ├── mini-corpus/
│   │   │   ├── manifest.json
│   │   │   ├── samples.jsonl   ← 12 samples with 1 in holdout
│   │   │   └── ...
│   │   └── mlx-log-fixtures/
│   │       ├── successful-run.txt
│   │       └── oom-failure.txt
│   ├── helpers/
│   │   └── fakes.ts            ← fake subprocessRunner / fs / clock
│   ├── splitter.test.ts
│   ├── jsonl-formatter.test.ts
│   ├── mlx-args-builder.test.ts
│   ├── manifest-reader.test.ts
│   ├── preflight.test.ts
│   ├── postflight.test.ts
│   ├── metadata-writer.test.ts
│   ├── trainer.unit.test.ts    ← orchestration with mocked subprocess
│   └── trainer.integration.test.ts ← Stage 6: real `mlx_lm.lora` 2-iter run on tiny fixture
└── plists/
    └── com.chiefaia.apprentice-training.plist  ← weekly retraining schedule (Phase 4 activates; Phase 2 ships disabled)
```

## 14. What this package depends on

Workspace deps:

- `@chiefaia/apprentice-corpus` (workspace:*) — for the `manifest.json` shape; we read but don't write.

NO dep on `@chiefaia/apprentice-eval` — eval is wired via constructor injection in Phase 4. This keeps the Phase 2 → Phase 1 build coupling at zero.

External deps:

- (None new — Node 20 standard library covers child_process, fs, crypto, path. Vitest + TypeScript already in the monorepo.)

Runtime deps OUTSIDE the npm tree (operator's machine):

- `python3` (≥ 3.11; 3.14 not yet validated for MLX as of 2026-05-06; preflight will warn on 3.14)
- `mlx-lm` python package (`pip install mlx-lm`)
- HuggingFace CLI optional (mlx_lm pulls from HF directly via huggingface_hub)
- ~10 GB free disk for first-time model download + adapter dir + work dir

`scripts/install-mlx-lm.sh` will be a leg-2 helper that creates a venv at `~/Documents/projects/apprentice/venv/` and pip-installs mlx-lm. Idempotent; safe to re-run.

## 15. Stages 4-10 outline (next leg)

**Stage 4 (Implement)**:
- Build the 11 modules under `src/` per the layout in §13.
- Wire `trainer.ts` orchestration end-to-end through every step in §4.
- Implement `cli.ts` with kebab-case flag aliases for every config field.

**Stage 5 (Unit test)**:
- Per-module fakes; ~60-80 tests.
- `splitter` + `mlx-args-builder` get the most coverage (they're pure-data transforms; their correctness is the trainer's correctness).
- `subprocess-runner` is mocked via `defaultSubprocessRunner` injection — tests exercise success, non-zero exit, timeout, and stdio-capture invariants.

**Stage 6 (Integration test)**:
- `trainer.integration.test.ts`: runs `caia-apprentice-training train` with `iters=2`, `numLayers=2`, `batchSize=1`, `--no-eval` against the mini-corpus fixture (12 samples → 10 train / 1 valid / 1 test). Verifies an `adapters.safetensors` file is produced, parsed by `mlx_lm`, and the run completes in < 10 min wall-clock on Mac M1 Pro.
- Skipped automatically (`describe.skipIf(!process.env.MLX_INSTALLED)`) when mlx-lm isn't installed in CI; the operator's local Mac is the ground-truth runner.

**Stage 7 (Deploy)**:
- LaunchAgent plist `com.chiefaia.apprentice-training.plist` registered DISABLED; Phase 4 will activate it. Plist follows the placeholder pattern from Phase 0 leg 3 (`feedback_monorepo_regression_gate_ergonomics.md` rule 2).
- `scripts/install-apprentice-training.sh` mirrors `install-apprentice-corpus.sh` shape; renders placeholders, lints, bootstraps via `launchctl bootstrap`. Phase 2 doesn't activate it — operator runs it separately when Phase 4 ships.

**Stage 8 (E2E live verify)**:
- Run a real training run on the Phase 0 87-sample corpus.
- `iters=500`, `numLayers=16`, `rank=8`, `batchSize=1`. Expect ~2-4h wall-clock on Mac M1 Pro overnight.
- Verify `adapters.safetensors` exists; `mlx_lm.generate` can load it; `ollama create apprentice-v1 -f Modelfile` succeeds; one sample prompt response doesn't crash.
- Captures the resulting adapter at `~/Documents/projects/apprentice/adapters/2026-05-06-qwen2.5-coder-7b-rank8-iters500/` for Phase 1 eval harness consumption.

**Stage 9 (Regression)**:
- Apply the leg-3 standing rule: package-internal vitest + lint + typecheck + build, then monorepo-wide `pnpm -r typecheck` + `pnpm -r lint`. NOT `pnpm -r build`.

**Stage 10 (Document)**:
- README + this DESIGN.md final pass.
- Completion doc at `~/Documents/projects/reports/apprentice-phase-2-complete-2026-05-06.md`.
- Structural-lesson capture if any surfaced.
- (If budget remaining) seed `packages/apprentice-eval/suites/seed-canonical-eval-suite.yaml` with 50 representative CAIA prompts.

## 16. CAIA defaults (constructor)

```typescript
const CAIA_DEFAULTS: Required<ApprenticeTrainingConfig> = {
  corpusManifestPath:
    process.env.APPRENTICE_CORPUS_MANIFEST
    ?? expandHome('~/Documents/projects/apprentice/corpora/<latest>/manifest.json'),
  outputAdapterRoot:
    process.env.APPRENTICE_ADAPTER_ROOT
    ?? expandHome('~/Documents/projects/apprentice/adapters'),
  workDirRoot:
    process.env.APPRENTICE_WORK_ROOT
    ?? expandHome('~/Documents/projects/apprentice/work'),
  baseModel:           process.env.APPRENTICE_BASE_MODEL ?? 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit',
  baseModelOllamaTag:  process.env.APPRENTICE_BASE_OLLAMA_TAG ?? 'qwen2.5-coder:7b',
  pythonBinaryPath:    process.env.PYTHON_BINARY ?? 'python3',
  mlxLmModule:         'mlx_lm.lora',
  loraConfig:          DEFAULT_LORA_CONFIG,    // see §6
  trainSplitFraction:  0.85,
  validSplitFraction:  0.10,
  testSplitFraction:   0.05,
  splitSeed:           42,
  minSamplesToTrain:   5,
  trainingTimeoutMs:   14_400_000,
  cloudGpuEnabled:     false,
  evalAfterTrain:      true,
  evalHarness:         undefined,
  subprocessRunner:    defaultSubprocessRunner,
  fs:                  defaultFsAccess,
  clock:               () => new Date(),
};
```

Defaults are env-var-overridable for cron / launchd contexts (where the orchestrator session id rotates, but this package doesn't depend on it directly). The "latest" manifest resolution is a small helper that lists `outputAdapterRoot/../corpora/*/manifest.json` and picks the lexicographically-largest dated directory (matches Phase 0's daily `<YYYY-MM-DD>/` layout).

## 17. Testability checklist (Option E pre-send check)

- ✅ Package private (`package.json` has `"private": true`).
- ✅ Public API parameterised — every CAIA path/model/binary/hyperparam is a constructor parameter with a default.
- ✅ Tests use fixture corpora at `tests/__fixtures__/mini-corpus/`; subprocess is mocked via `defaultSubprocessRunner` injection.
- ✅ Mentor + Librarian pre-spawn injection respected (this package makes ZERO LLM calls; orchestrator's pre-spawn pipelines apply upstream to the corpus aggregator's distillation; this package consumes their output).
- ✅ No abstraction for a second consumer (configs are CAIA-shape; cloud-GPU is a future extension, not a productisation hook).

## 18. Deployment

LaunchAgent `plists/com.chiefaia.apprentice-training.plist` runs the trainer on a schedule (Phase 4 activates this; Phase 2 ships it disabled).

Default schedule (Phase 4 will set): Saturday 02:00 local. Off-hours per the directive's "schedule retraining off-hours" constraint.

Install (Phase 4 will run; Phase 2 documents only):

```bash
# Operator runs after PR merges + Phase 4 ships
scripts/install-apprentice-training.sh
# loads with launchctl bootstrap; off-by-default until Phase 4 activates
```

Logs at `~/Library/Logs/chiefaia/apprentice-training.log`.

## See also

- `agent/memory/apprentice_agent_directive.md` — full Apprentice campaign spec.
- `agent/memory/agent_architecture_shape_2026-05-06.md` — Option E standing rule.
- `agent/memory/feedback_minimal_cloud_gpu_allowed.md` — cloud GPU $50/run cap.
- `agent/memory/feedback_monorepo_regression_gate_ergonomics.md` — leg-3 standing rule (typecheck+lint, not build; LaunchAgent placeholder pattern).
- `agent/memory/feedback_secret_scanner_history_squash.md` — apply if any commit accidentally introduces a credential shape.
- `packages/apprentice-corpus/DESIGN.md` — sibling Phase 0 package; manifest.json shape is the input contract.
- `packages/apprentice-eval/DESIGN.md` (PR #366) — sibling Phase 1 package; harness.evaluate signature is the eval-after-train injection point.
- `~/Documents/projects/reports/apprentice-phase-1-complete-2026-05-06.md` — Phase 1 sentinel + Phase 2 pickup guidance.
- `~/Documents/projects/reports/apprentice-phase-0-stage-10-complete-2026-05-06.md` — Phase 0 sentinel; the 87-sample E2E corpus that Stage 8 trains on.
- ml-explore/mlx-lm `LORA.md` (mid-2026; verifies our flag-name canonical decisions in §5).
