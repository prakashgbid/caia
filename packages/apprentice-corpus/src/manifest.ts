/**
 * Manifest + JSONL writer.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type {
  CorpusManifest,
  DroppedRecord,
  InstructionPair,
  RawArtifact,
  SourceTag
} from './types.js';
import { ALL_SOURCE_TAGS } from './types.js';

export interface WriteCorpusInputs {
  outputDir: string;
  rawArtifacts: ReadonlyArray<RawArtifact>;
  finalPairs: ReadonlyArray<InstructionPair>;
  dropped: ReadonlyArray<DroppedRecord>;
  totals: CorpusManifest['totals'];
  warnings: ReadonlyArray<string>;
  configHash: string;
  generatedAt: string;
  elapsedMs: number;
  /** Stable ids of pairs held out from training (excluded from samples.jsonl). */
  holdoutIds: ReadonlyArray<string>;
}

export function buildManifest(inputs: WriteCorpusInputs): CorpusManifest {
  const perSource = emptyPerSource();
  for (const a of inputs.rawArtifacts) {
    perSource[a.source].artifacts += 1;
  }
  for (const p of inputs.finalPairs) {
    perSource[p.meta.source].samples += 1;
  }

  const redactedSpansHistogram: Record<string, number> = {};
  for (const p of inputs.finalPairs) {
    for (const tag of p.meta.redactedSpans) {
      redactedSpansHistogram[tag] = (redactedSpansHistogram[tag] ?? 0) + 1;
    }
  }

  const qualityHistogram: Record<string, number> = {
    '0.0-0.2': 0,
    '0.2-0.4': 0,
    '0.4-0.6': 0,
    '0.6-0.8': 0,
    '0.8-1.0': 0
  };
  for (const p of inputs.finalPairs) {
    const q = p.meta.qualityScore;
    if (q < 0.2) qualityHistogram['0.0-0.2']! += 1;
    else if (q < 0.4) qualityHistogram['0.2-0.4']! += 1;
    else if (q < 0.6) qualityHistogram['0.4-0.6']! += 1;
    else if (q < 0.8) qualityHistogram['0.6-0.8']! += 1;
    else qualityHistogram['0.8-1.0']! += 1;
  }

  return {
    version: 1,
    generatedAt: inputs.generatedAt,
    outputDir: inputs.outputDir,
    elapsedMs: inputs.elapsedMs,
    totals: { ...inputs.totals },
    perSource,
    redactedSpansHistogram,
    qualityHistogram,
    configSha256: inputs.configHash,
    warnings: [...inputs.warnings],
    holdout: [...inputs.holdoutIds]
  };
}

function emptyPerSource(): Record<SourceTag, { artifacts: number; samples: number }> {
  const out = {} as Record<SourceTag, { artifacts: number; samples: number }>;
  for (const tag of ALL_SOURCE_TAGS) {
    out[tag] = { artifacts: 0, samples: 0 };
  }
  return out;
}

/**
 * Write all corpus artifacts to disk:
 *   <outputDir>/manifest.json
 *   <outputDir>/samples.jsonl     — one JSON object per line, the trainable set
 *   <outputDir>/sources.json      — index of source artifacts considered
 *   <outputDir>/dropped.jsonl     — one record per dropped artifact, with reason
 *   <outputDir>/config.json       — serialized config snapshot
 */
export function writeCorpus(inputs: WriteCorpusInputs, configSnapshot: string): void {
  mkdirSync(inputs.outputDir, { recursive: true });

  // samples.jsonl — the trainable payload
  const samplesPath = join(inputs.outputDir, 'samples.jsonl');
  const samplesLines = inputs.finalPairs.map((p) => JSON.stringify(p));
  writeFileSync(samplesPath, samplesLines.join('\n') + (samplesLines.length > 0 ? '\n' : ''), 'utf-8');

  // sources.json — index of all considered raw artifacts
  const sourcesPath = join(inputs.outputDir, 'sources.json');
  const sourcesProjection = inputs.rawArtifacts.map((a) => ({
    source: a.source,
    sourceId: a.sourceId,
    kind: a.kind ?? null,
    correlationId: a.correlationId ?? null,
    createdAtMs: a.createdAtMs,
    sizeChars: a.text.length
  }));
  writeFileSync(sourcesPath, JSON.stringify(sourcesProjection, null, 2), 'utf-8');

  // dropped.jsonl — one record per drop
  const droppedPath = join(inputs.outputDir, 'dropped.jsonl');
  const droppedLines = inputs.dropped.map((d) => JSON.stringify(d));
  writeFileSync(
    droppedPath,
    droppedLines.join('\n') + (droppedLines.length > 0 ? '\n' : ''),
    'utf-8'
  );

  // config.json — config snapshot (already sanitized by caller)
  const configPath = join(inputs.outputDir, 'config.json');
  writeFileSync(configPath, configSnapshot, 'utf-8');

  // manifest.json — top-level summary
  const manifestPath = join(inputs.outputDir, 'manifest.json');
  const manifest = buildManifest(inputs);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

/** Hash a config snapshot for the manifest. */
export function hashConfig(snapshot: string): string {
  return createHash('sha256').update(snapshot, 'utf-8').digest('hex');
}
