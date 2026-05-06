/**
 * Read + validate the corpus manifest + samples.jsonl.
 *
 * The manifest is the input contract from `@chiefaia/apprentice-corpus`.
 * Phase 0 manifests pre-PR-#367 do not have a `holdout: string[]` field —
 * the splitter falls back to id-hash test bucketing in that case.
 */

import * as path from 'node:path';
import { createHash } from 'node:crypto';
import type {
  CorpusManifestRead,
  CorpusSample,
  FsAccess
} from './types.js';
import { TrainingError } from './types.js';

export class ManifestReader {
  constructor(private readonly fs: FsAccess) {}

  /**
   * Load and validate the manifest.json. Throws on schema mismatch.
   * Returns both the parsed manifest and a sha256 of the raw manifest text
   * (for traceability into training-metadata.json).
   */
  loadManifest(manifestPath: string): { manifest: CorpusManifestRead; sha256: string } {
    if (!this.fs.exists(manifestPath)) {
      throw new TrainingError(
        'ManifestNotFoundError',
        `Corpus manifest not found at ${manifestPath}. Has Phase 0 (apprentice-corpus) run yet?`
      );
    }
    const raw = this.fs.readFile(manifestPath);
    const sha256 = createHash('sha256').update(raw).digest('hex');

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new TrainingError(
        'ManifestParseError',
        `Failed to parse corpus manifest at ${manifestPath}: ${(e as Error).message}`
      );
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new TrainingError(
        'ManifestSchemaError',
        `Corpus manifest is not a JSON object: ${manifestPath}`
      );
    }
    const m = parsed as Record<string, unknown>;
    if (typeof m.outputDir !== 'string') {
      throw new TrainingError(
        'ManifestSchemaError',
        `Corpus manifest missing required field 'outputDir': ${manifestPath}`
      );
    }
    if (!m.totals || typeof m.totals !== 'object') {
      throw new TrainingError(
        'ManifestSchemaError',
        `Corpus manifest missing required field 'totals': ${manifestPath}`
      );
    }
    if (m.holdout !== undefined && !Array.isArray(m.holdout)) {
      throw new TrainingError(
        'ManifestSchemaError',
        `Corpus manifest 'holdout' must be string[] when present: ${manifestPath}`
      );
    }

    return { manifest: parsed as CorpusManifestRead, sha256 };
  }

  /**
   * Resolve the absolute path of `samples.jsonl` from a manifest. The
   * manifest's `outputDir` may be either absolute or relative to the
   * manifest's own location; we canonicalise to absolute.
   */
  resolveSamplesPath(manifestPath: string, manifest: CorpusManifestRead): string {
    const outputDir = path.isAbsolute(manifest.outputDir)
      ? manifest.outputDir
      : path.resolve(path.dirname(manifestPath), manifest.outputDir);
    return path.join(outputDir, 'samples.jsonl');
  }

  /**
   * Load `samples.jsonl` — one JSON object per line. Tolerates trailing
   * newlines and blank lines (produced by some writers). Validates each
   * record has `id: string` + `messages: ChatMessage[]`.
   */
  loadSamples(samplesPath: string): CorpusSample[] {
    if (!this.fs.exists(samplesPath)) {
      throw new TrainingError(
        'SamplesNotFoundError',
        `Corpus samples.jsonl not found at ${samplesPath}`
      );
    }
    const raw = this.fs.readFile(samplesPath);
    const lines = raw.split('\n');
    const out: CorpusSample[] = [];
    for (let i = 0; i < lines.length; i++) {
      const lineRaw = lines[i]; if (lineRaw === undefined) continue; const line = lineRaw.trim();
      if (line === '') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (e) {
        throw new TrainingError(
          'SamplesParseError',
          `Line ${i + 1} of ${samplesPath} is not valid JSON: ${(e as Error).message}`
        );
      }
      if (!isValidSample(parsed)) {
        throw new TrainingError(
          'SamplesSchemaError',
          `Line ${i + 1} of ${samplesPath} doesn't match the expected sample shape (id + messages[])`
        );
      }
      out.push(parsed);
    }
    return out;
  }
}

function isValidSample(x: unknown): x is CorpusSample {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0) return false;
  if (!Array.isArray(o.messages) || o.messages.length === 0) return false;
  for (const m of o.messages) {
    if (!m || typeof m !== 'object') return false;
    const mm = m as Record<string, unknown>;
    if (mm.role !== 'system' && mm.role !== 'user' && mm.role !== 'assistant') return false;
    if (typeof mm.content !== 'string') return false;
  }
  return true;
}
