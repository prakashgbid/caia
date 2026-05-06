/**
 * baseline-store — read / write per-adapter baselines.
 *
 * Per DESIGN.md §10. A run reads `baselines/<adapter>.json` to compute
 * regressions; the operator-explicit `baseline --update` command writes
 * the current run's per-prompt scores back as the new floor.
 *
 * Layout:
 *   baselines/
 *     base.json
 *     <blessed-adapter>.json
 */

import { join } from 'node:path';

import type {
  BaselineEntry,
  BaselineSnapshot,
  FsReader,
  FsWriter,
  RubricResult
} from './types.js';

export interface ReadBaselineOpts {
  readonly baselineRoot: string;
  readonly adapter: string;
  readonly fs: FsReader;
}

export async function readBaseline(opts: ReadBaselineOpts): Promise<BaselineSnapshot | null> {
  const path = join(opts.baselineRoot, `${opts.adapter}.json`);
  if (!(await opts.fs.exists(path))) return null;
  const text = await opts.fs.readFile(path);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `[apprentice-eval] baseline ${path} is not valid JSON: ${
        e instanceof Error ? e.message : String(e)
      }`,
      { cause: e }
    );
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error(`[apprentice-eval] baseline ${path} is not a JSON object`);
  }
  const obj = raw as Record<string, unknown>;
  if (obj['version'] !== 1) {
    throw new Error(`[apprentice-eval] baseline ${path}: unknown version ${String(obj['version'])}`);
  }
  if (typeof obj['adapter'] !== 'string' || typeof obj['recordedAt'] !== 'string') {
    throw new Error(`[apprentice-eval] baseline ${path}: malformed envelope`);
  }
  if (!Array.isArray(obj['entries'])) {
    throw new Error(`[apprentice-eval] baseline ${path}: entries must be an array`);
  }
  const entries: BaselineEntry[] = (obj['entries'] as unknown[]).map((e, i) => {
    if (!e || typeof e !== 'object') {
      throw new Error(`[apprentice-eval] baseline ${path}: entry[${i}] must be an object`);
    }
    const eo = e as Record<string, unknown>;
    if (
      typeof eo['promptId'] !== 'string' ||
      typeof eo['suiteId'] !== 'string' ||
      typeof eo['weightedScore'] !== 'number' ||
      typeof eo['recordedAt'] !== 'string'
    ) {
      throw new Error(`[apprentice-eval] baseline ${path}: entry[${i}] malformed`);
    }
    return {
      promptId: eo['promptId'] as string,
      suiteId: eo['suiteId'] as string,
      weightedScore: eo['weightedScore'] as number,
      recordedAt: eo['recordedAt'] as string
    };
  });
  return {
    version: 1,
    adapter: obj['adapter'] as string,
    recordedAt: obj['recordedAt'] as string,
    entries
  };
}

export interface WriteBaselineOpts {
  readonly baselineRoot: string;
  readonly adapter: string;
  readonly results: ReadonlyArray<RubricResult>;
  readonly recordedAt: string;
  readonly fs: FsWriter;
}

export async function writeBaseline(opts: WriteBaselineOpts): Promise<string> {
  await opts.fs.mkdir(opts.baselineRoot);
  const path = join(opts.baselineRoot, `${opts.adapter}.json`);
  const snapshot: BaselineSnapshot = {
    version: 1,
    adapter: opts.adapter,
    recordedAt: opts.recordedAt,
    entries: opts.results.map((r) => ({
      promptId: r.promptId,
      suiteId: r.suiteId,
      weightedScore: r.weightedScore,
      recordedAt: opts.recordedAt
    }))
  };
  await opts.fs.writeFile(path, JSON.stringify(snapshot, null, 2) + '\n');
  return path;
}
