/**
 * Postflight checks — DESIGN.md §4. Run after a successful (exit 0)
 * subprocess. Verifies the canonical mlx-lm artifacts were produced:
 *
 *   <adapterPath>/adapters.safetensors
 *   <adapterPath>/adapter_config.json
 *
 * If either is missing, throws AdapterNotProducedError with the log
 * tail for triage. This catches mlx-lm crashes that exited zero but
 * never wrote output (rare but seen in the wild).
 */

import * as path from 'node:path';
import type { FsAccess } from './types.js';
import { AdapterNotProducedError } from './types.js';

export interface PostflightInput {
  adapterPath: string;
  logTail: string;
}

export interface PostflightResult {
  adapterFile: string;
  adapterConfigFile: string;
  /** Parsed `adapter_config.json` for cross-referencing in metadata-writer. */
  adapterConfig: unknown;
  /** File size of the safetensors weights — sanity check; should be > 0. */
  adapterFileBytes: number;
}

export class Postflight {
  constructor(private readonly fs: FsAccess) {}

  run(input: PostflightInput): PostflightResult {
    const { adapterPath, logTail } = input;

    const adapterFile = path.join(adapterPath, 'adapters.safetensors');
    const adapterConfigFile = path.join(adapterPath, 'adapter_config.json');

    if (!this.fs.exists(adapterFile)) {
      throw new AdapterNotProducedError(
        `Subprocess exited 0 but '${adapterFile}' was not written. Last subprocess log lines:\n${logTail}`,
        { adapterPath, logTail }
      );
    }
    if (!this.fs.exists(adapterConfigFile)) {
      throw new AdapterNotProducedError(
        `Subprocess exited 0 but '${adapterConfigFile}' was not written. Last subprocess log lines:\n${logTail}`,
        { adapterPath, logTail }
      );
    }

    const adapterFileStat = this.fs.stat(adapterFile);
    if (adapterFileStat.size === 0) {
      throw new AdapterNotProducedError(
        `'${adapterFile}' exists but is empty (0 bytes). Last subprocess log lines:\n${logTail}`,
        { adapterPath, logTail }
      );
    }

    let adapterConfig: unknown;
    try {
      adapterConfig = JSON.parse(this.fs.readFile(adapterConfigFile));
    } catch (e) {
      throw new AdapterNotProducedError(
        `'${adapterConfigFile}' exists but isn't valid JSON: ${(e as Error).message}`,
        { adapterPath, logTail }
      );
    }

    return {
      adapterFile,
      adapterConfigFile,
      adapterConfig,
      adapterFileBytes: adapterFileStat.size
    };
  }
}
