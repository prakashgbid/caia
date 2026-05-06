#!/usr/bin/env node
/**
 * caia-apprentice-training — CLI wrapper.
 *
 * Subcommands:
 *   train [opts]   — run the full training pipeline
 *   --help         — print usage
 *
 * Every config field has a kebab-case CLI flag; values fall through to
 * the constructor's CAIA defaults when omitted. See DESIGN.md §3.
 */

import { ApprenticeTrainer } from './trainer.js';
import type { ApprenticeTrainingConfig, LoraConfig } from './types.js';
import type { TrainOptions } from './trainer.js';
import { TrainingError } from './types.js';

interface ParsedArgs {
  subcommand: string;
  flags: Map<string, string | true>;
  positional: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { subcommand: '', flags: new Map(), positional: [] };
  let i = 0;
  const first = argv[0];
  if (first !== undefined && !first.startsWith('-')) {
    out.subcommand = first;
    i++;
  }
  while (i < argv.length) {
    const tok = argv[i];
    if (tok === undefined) break;
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      if (eq > 0) {
        out.flags.set(tok.slice(2, eq), tok.slice(eq + 1));
        i++;
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          out.flags.set(tok.slice(2), next);
          i += 2;
        } else {
          out.flags.set(tok.slice(2), true);
          i++;
        }
      }
    } else {
      out.positional.push(tok);
      i++;
    }
  }
  return out;
}

function printHelp(): void {
  const help = `caia-apprentice-training — LoRA training pipeline for the Apprentice Agent

Usage:
  caia-apprentice-training train [options]
  caia-apprentice-training --help

Options:
  --corpus-manifest <path>         Path to corpus manifest.json (default: latest in APPRENTICE_CORPUS_ROOT)
  --output-adapter-root <path>     Where to write the adapter dir (default: ~/Documents/projects/apprentice/adapters)
  --work-dir-root <path>           Working dir root for intermediate JSONL (default: ~/Documents/projects/apprentice/work)
  --base-model <name>              MLX-canonical HF repo (default: mlx-community/Qwen2.5-Coder-7B-Instruct-4bit)
  --base-model-ollama-tag <tag>    Ollama tag for Modelfile scaffold (default: qwen2.5-coder:7b)
  --python <path>                  Python binary (default: python3)
  --num-layers <N>                 LoRA layers (default: 16)
  --rank <N>                       LoRA rank (default: 8)
  --alpha <N>                      LoRA alpha (default: 16)
  --learning-rate <F>              Optimiser LR (default: 1e-5)
  --iters <N>                      Total iterations (default: 500)
  --batch-size <N>                 Batch size (default: 1)
  --max-seq-length <N>             Max tokens per sample (default: 2048)
  --grad-accumulation-steps <N>    Effective-batch multiplier (default: 4)
  --no-grad-checkpoint             Disable gradient checkpointing
  --no-mask-prompt                 Disable loss-on-assistant-only
  --train-fraction <F>             Train split fraction (default: 0.85)
  --valid-fraction <F>             Valid split fraction (default: 0.10)
  --test-fraction <F>              Test split fraction (default: 0.05)
  --split-seed <N>                 Deterministic split seed (default: 42)
  --min-samples <N>                Minimum train samples to proceed (default: 5)
  --training-timeout-ms <N>        Subprocess hard timeout (default: 14400000 = 4h)
  --no-eval                        Skip eval-after-train
  --skip-mlx-lm-check              Skip mlx-lm preflight check (Stage 6 integration test)
  --dry-run                        Print plan, don't spawn subprocess
  --help                           This help

Env-var overrides:
  APPRENTICE_CORPUS_MANIFEST   APPRENTICE_ADAPTER_ROOT   APPRENTICE_WORK_ROOT
  APPRENTICE_BASE_MODEL        APPRENTICE_BASE_OLLAMA_TAG   PYTHON_BINARY
`;
  process.stdout.write(help);
}

function flagsToConfig(flags: Map<string, string | true>): ApprenticeTrainingConfig {
  const cfg: ApprenticeTrainingConfig = {};
  const lora: Partial<LoraConfig> = {};

  if (flags.has('corpus-manifest')) cfg.corpusManifestPath = String(flags.get('corpus-manifest'));
  if (flags.has('output-adapter-root')) cfg.outputAdapterRoot = String(flags.get('output-adapter-root'));
  if (flags.has('work-dir-root')) cfg.workDirRoot = String(flags.get('work-dir-root'));
  if (flags.has('base-model')) cfg.baseModel = String(flags.get('base-model'));
  if (flags.has('base-model-ollama-tag')) cfg.baseModelOllamaTag = String(flags.get('base-model-ollama-tag'));
  if (flags.has('python')) cfg.pythonBinaryPath = String(flags.get('python'));

  if (flags.has('num-layers')) lora.numLayers = parseIntStrict(flags.get('num-layers'));
  if (flags.has('rank')) lora.rank = parseIntStrict(flags.get('rank'));
  if (flags.has('alpha')) lora.alpha = parseIntStrict(flags.get('alpha'));
  if (flags.has('learning-rate')) lora.learningRate = parseFloatStrict(flags.get('learning-rate'));
  if (flags.has('iters')) lora.iters = parseIntStrict(flags.get('iters'));
  if (flags.has('batch-size')) lora.batchSize = parseIntStrict(flags.get('batch-size'));
  if (flags.has('max-seq-length')) lora.maxSeqLength = parseIntStrict(flags.get('max-seq-length'));
  if (flags.has('grad-accumulation-steps')) lora.gradAccumulationSteps = parseIntStrict(flags.get('grad-accumulation-steps'));
  if (flags.has('no-grad-checkpoint')) lora.gradCheckpoint = false;
  if (flags.has('no-mask-prompt')) lora.maskPrompt = false;

  if (Object.keys(lora).length > 0) cfg.loraConfig = lora;

  if (flags.has('train-fraction')) cfg.trainSplitFraction = parseFloatStrict(flags.get('train-fraction'));
  if (flags.has('valid-fraction')) cfg.validSplitFraction = parseFloatStrict(flags.get('valid-fraction'));
  if (flags.has('test-fraction')) cfg.testSplitFraction = parseFloatStrict(flags.get('test-fraction'));
  if (flags.has('split-seed')) cfg.splitSeed = parseIntStrict(flags.get('split-seed'));
  if (flags.has('min-samples')) cfg.minSamplesToTrain = parseIntStrict(flags.get('min-samples'));
  if (flags.has('training-timeout-ms')) cfg.trainingTimeoutMs = parseIntStrict(flags.get('training-timeout-ms'));
  if (flags.has('no-eval')) cfg.evalAfterTrain = false;

  return cfg;
}

function parseIntStrict(v: string | true | undefined): number {
  if (typeof v !== 'string') throw new Error(`flag value must be a number; got ${typeof v}`);
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`flag value must be a number; got ${v}`);
  return n;
}
function parseFloatStrict(v: string | true | undefined): number {
  if (typeof v !== 'string') throw new Error(`flag value must be a number; got ${typeof v}`);
  const n = parseFloat(v);
  if (!Number.isFinite(n)) throw new Error(`flag value must be a number; got ${v}`);
  return n;
}

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.flags.has('help') || (parsed.subcommand === '' && parsed.flags.size === 0)) {
    printHelp();
    return 0;
  }

  if (parsed.subcommand !== 'train') {
    process.stderr.write(`Unknown subcommand: '${parsed.subcommand}'. Use --help.\n`);
    return 2;
  }

  const cfg = flagsToConfig(parsed.flags);
  const trainer = new ApprenticeTrainer(cfg);

  const opts: TrainOptions = {};
  if (parsed.flags.has('skip-mlx-lm-check')) opts.skipMlxLmCheck = true;
  if (parsed.flags.has('dry-run')) opts.dryRun = true;

  try {
    const result = await trainer.train(opts);
    process.stdout.write(`adapter: ${result.adapterPath}\n`);
    process.stdout.write(`elapsedMs: ${result.elapsedMs}\n`);
    if (result.evalReport) {
      process.stdout.write(`evalDecision: ${result.evalReport.decision} (winRate=${result.evalReport.winRate})\n`);
    }
    return 0;
  } catch (e) {
    if (e instanceof TrainingError) {
      process.stderr.write(`[${e.name}] ${e.message}\n`);
      if (e.details) process.stderr.write(JSON.stringify(e.details, null, 2) + '\n');
      return 1;
    }
    throw e;
  }
}

main(process.argv.slice(2)).then(
  code => process.exit(code),
  err => {
    process.stderr.write(`Unhandled error: ${err.stack || err.message || String(err)}\n`);
    process.exit(2);
  }
);
