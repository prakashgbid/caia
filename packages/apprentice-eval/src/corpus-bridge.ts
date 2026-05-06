/**
 * corpus-bridge — reads holdout sample ids from `apprentice-corpus`'s
 * `manifest.json`. The eval harness uses these as the auto-generated
 * "test set" prompts (DESIGN.md §5b).
 *
 * Per DESIGN.md §11 R6 (and risk #6): the corpus aggregator's manifest
 * SHOULD have a `holdout: string[]` field. This bridge tolerates its
 * absence (returns []) so the harness still ships when only hand-curated
 * suites are present.
 */

import type { CorpusManifestProjection, FsReader } from './types.js';

export interface ReadCorpusManifestOpts {
  readonly manifestPath: string;
  readonly fs: FsReader;
}

export async function readCorpusManifest(
  opts: ReadCorpusManifestOpts
): Promise<CorpusManifestProjection | null> {
  if (!(await opts.fs.exists(opts.manifestPath))) {
    return null;
  }
  const text = await opts.fs.readFile(opts.manifestPath);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `[apprentice-eval] corpus manifest at ${opts.manifestPath} is not valid JSON: ${
        e instanceof Error ? e.message : String(e)
      }`,
      { cause: e }
    );
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error(`[apprentice-eval] corpus manifest at ${opts.manifestPath}: not an object`);
  }
  const obj = raw as Record<string, unknown>;
  const outputDir = typeof obj['outputDir'] === 'string' ? (obj['outputDir'] as string) : '';
  const generatedAt =
    typeof obj['generatedAt'] === 'string' ? (obj['generatedAt'] as string) : '';
  const configSha256 =
    typeof obj['configSha256'] === 'string' ? (obj['configSha256'] as string) : '';
  const holdout: ReadonlyArray<string> = Array.isArray(obj['holdout'])
    ? (obj['holdout'] as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  return { outputDir, generatedAt, configSha256, holdout };
}
