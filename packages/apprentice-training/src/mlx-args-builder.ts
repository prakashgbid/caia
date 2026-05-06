/**
 * Construct the `python -m mlx_lm.lora ...` argv. See DESIGN.md §5.
 *
 * Canonical flag-naming decisions (from ml-explore/mlx-lm `LORA.md` mid-2026):
 *   - `--num-layers` (NOT `--lora-layers`; the latter is the older
 *     mlx-examples repo's name)
 *   - `--mask-prompt` for chat-format loss-on-assistant-only
 *   - QLoRA implicit via 4-bit pre-quantised base
 *   - `--grad-checkpoint` for additional 16GB headroom
 *
 * The argv is constructed from the resolved config; the trainer passes
 * the work-dir + adapter-dir as runtime arguments. Pure function over
 * `(cfg, workDir, adapterPath)` — testable without subprocess.
 */

import type { LoraConfig, ResolvedTrainingConfig } from './types.js';

export interface BuildArgsInput {
  cfg: ResolvedTrainingConfig;
  workDir: string;
  adapterPath: string;
}

export interface MlxLoraInvocation {
  /** The Python interpreter binary (cfg.pythonBinaryPath). */
  command: string;
  /** Full argv excluding the command itself. */
  args: string[];
}

export function buildMlxLoraArgs(input: BuildArgsInput): MlxLoraInvocation {
  const { cfg, workDir, adapterPath } = input;
  const lora = cfg.loraConfig;

  const args: string[] = ['-m', cfg.mlxLmModule, '--train'];

  args.push('--model', cfg.baseModel);
  args.push('--data', workDir);
  args.push('--adapter-path', adapterPath);

  pushNumber(args, '--num-layers', lora.numLayers);
  pushNumber(args, '--iters', lora.iters);
  pushNumber(args, '--batch-size', lora.batchSize);
  pushNumber(args, '--learning-rate', lora.learningRate);
  pushNumber(args, '--max-seq-length', lora.maxSeqLength);
  pushNumber(args, '--grad-accumulation-steps', lora.gradAccumulationSteps);
  pushNumber(args, '--save-every', lora.saveEvery);
  pushNumber(args, '--steps-per-eval', lora.stepsPerEval);
  pushNumber(args, '--val-batches', lora.valBatches);
  pushNumber(args, '--seed', lora.seed);

  // LoRA-specific hyperparameters that mlx-lm reads via the `--config`
  // YAML file (rank, alpha, dropout). Phase 2 emits these into a small
  // YAML file at <workDir>/lora.yaml — see the trainer's orchestration.
  // The flag exists in mlx-lm 0.18+; older versions use a different shape.
  args.push('--config', `${workDir}/lora.yaml`);

  if (lora.gradCheckpoint) args.push('--grad-checkpoint');
  if (lora.maskPrompt) args.push('--mask-prompt');

  return { command: cfg.pythonBinaryPath, args };
}

function pushNumber(args: string[], flag: string, value: number): void {
  args.push(flag, String(value));
}

/**
 * Render the small YAML config file mlx-lm reads via `--config` for
 * LoRA-specific knobs. This is the documented surface for `rank`,
 * `alpha`, `dropout` (which don't have CLI flags in current mlx-lm).
 *
 * Format follows ml-explore/mlx-lm's example `lora_config.yaml`.
 */
export function renderLoraConfigYaml(lora: LoraConfig): string {
  // No external YAML lib — these values are simple primitives so we
  // hand-write to avoid a dep. Format is identical to mlx-lm's own
  // `lora_config.yaml` example.
  return [
    '# mlx-lm LoRA configuration — emitted by @chiefaia/apprentice-training',
    'lora_parameters:',
    `  rank: ${lora.rank}`,
    `  scale: ${lora.alpha / lora.rank}`,
    `  dropout: ${lora.dropout}`
  ].join('\n') + '\n';
}
