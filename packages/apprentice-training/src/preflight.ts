/**
 * Preflight checks — DESIGN.md §4. Run before any subprocess spawn.
 *
 * Catches the common failure modes early:
 *   R1: mlx-lm not installed (verifies `python -m mlx_lm.lora --help` succeeds)
 *   - python binary resolvable
 *   - adapter-path doesn't already exist (idempotency safeguard)
 *   - work-dir parent writable
 *
 * Heavy checks (HF model download, free RAM measurement) are deferred to
 * the subprocess itself — preflight is fast (≤ 5s).
 */

import * as os from 'node:os';
import type {
  FsAccess,
  ResolvedTrainingConfig,
  SubprocessRunner
} from './types.js';
import { PreflightError, MlxLmVersionIncompatibleError } from './types.js';

export interface PreflightInput {
  cfg: ResolvedTrainingConfig;
  adapterPath: string;
  /** Optional override — Stage 6 integration tests skip the helper-spawn check. */
  skipMlxLmCheck?: boolean;
}

export interface PreflightResult {
  warnings: string[];
  /** Bytes of total RAM on the host — informational. */
  totalRamBytes: number;
  /** Free RAM bytes at preflight time — informational. */
  freeRamBytes: number;
}

/**
 * The set of mlx-lm flags we depend on (DESIGN.md §5). If
 * `python -m mlx_lm.lora --help` doesn't list one of these, mlx-lm has
 * drifted from our integration target and we throw
 * MlxLmVersionIncompatibleError early rather than mid-training.
 */
export const REQUIRED_MLX_FLAGS: readonly string[] = Object.freeze([
  '--train',
  '--model',
  '--data',
  '--adapter-path',
  '--num-layers',
  '--iters',
  '--batch-size',
  '--learning-rate',
  '--max-seq-length'
]);

export class Preflight {
  constructor(
    private readonly fs: FsAccess,
    private readonly subprocess: SubprocessRunner
  ) {}

  async run(input: PreflightInput): Promise<PreflightResult> {
    const { cfg, adapterPath, skipMlxLmCheck = false } = input;
    const warnings: string[] = [];

    // 1. Adapter path must not already exist (collision guard).
    if (this.fs.exists(adapterPath)) {
      throw new PreflightError(
        `Adapter directory already exists: ${adapterPath}. Remove it or choose a different output path.`
      );
    }

    // 2. Work-dir root must be reachable (parent dir exists or creatable).
    if (!this.fs.exists(cfg.workDirRoot)) {
      try {
        this.fs.mkdir(cfg.workDirRoot);
      } catch (e) {
        throw new PreflightError(
          `Work-dir root not creatable at ${cfg.workDirRoot}: ${(e as Error).message}`
        );
      }
    }

    // 3. Output adapter root must be writable (parent dir).
    if (!this.fs.exists(cfg.outputAdapterRoot)) {
      try {
        this.fs.mkdir(cfg.outputAdapterRoot);
      } catch (e) {
        throw new PreflightError(
          `Output adapter root not creatable at ${cfg.outputAdapterRoot}: ${(e as Error).message}`
        );
      }
    }

    // 4. mlx-lm import + flag-set check.
    if (!skipMlxLmCheck) {
      await this.checkMlxLm(cfg, warnings);
    }

    // 5. Cloud-GPU stub guard.
    if (cfg.cloudGpuEnabled) {
      throw new PreflightError(
        'cloudGpuEnabled is true but Phase 2 ships only the Mac-MLX path. ' +
          'Cloud GPU is Phase 2-cloud-extension; set cloudGpuEnabled=false until that ships.'
      );
    }

    // 6. RAM heuristic — informational only.
    const totalRamBytes = os.totalmem();
    const freeRamBytes = os.freemem();
    if (freeRamBytes < 4 * 1024 * 1024 * 1024) {
      warnings.push(
        `Free RAM is ${(freeRamBytes / (1024 ** 3)).toFixed(1)} GB; ` +
          `7B QLoRA training peaks ~8-12 GB. Consider freeing memory before starting.`
      );
    }

    return { warnings, totalRamBytes, freeRamBytes };
  }

  private async checkMlxLm(cfg: ResolvedTrainingConfig, warnings: string[]): Promise<void> {
    let result;
    try {
      result = await this.subprocess.run({
        command: cfg.pythonBinaryPath,
        args: ['-m', cfg.mlxLmModule, '--help'],
        cwd: cfg.workDirRoot,
        env: process.env,
        logFilePath: '/dev/null',
        timeoutMs: 30_000
      });
    } catch (e) {
      throw new PreflightError(
        `Failed to invoke '${cfg.pythonBinaryPath} -m ${cfg.mlxLmModule} --help': ${(e as Error).message}. ` +
          `Install mlx-lm via 'pip install mlx-lm' and ensure ${cfg.pythonBinaryPath} is on PATH.`
      );
    }

    if (result.exitCode !== 0) {
      throw new PreflightError(
        `'${cfg.pythonBinaryPath} -m ${cfg.mlxLmModule} --help' exited with ${result.exitCode}. ` +
          `Last log lines:\n${result.logTail}`
      );
    }

    const helpOutput = result.logTail;
    const missing = REQUIRED_MLX_FLAGS.filter(flag => !helpOutput.includes(flag));
    if (missing.length > 0) {
      throw new MlxLmVersionIncompatibleError(
        `Installed mlx-lm doesn't expose required flags: ${missing.join(', ')}. ` +
          `This package was built against the mid-2026 mlx-lm flag set. ` +
          `Upgrade with 'pip install -U mlx-lm' or pin the supported version.`
      );
    }

    if (helpOutput.includes('--lora-layers')) {
      warnings.push(
        `Installed mlx-lm uses '--lora-layers' instead of '--num-layers'; you may be on an older mlx-examples build. ` +
          `Recommend 'pip install -U mlx-lm'.`
      );
    }
  }
}
