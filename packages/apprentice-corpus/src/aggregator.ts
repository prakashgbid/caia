/**
 * Top-level aggregator. Wires together the 5 source readers, the
 * normaliser, dedupe, PII masker, quality scorer, optional
 * claude-distillation step, and the manifest writer.
 *
 * Construction is fully parameterised — every CAIA-specific path,
 * URL, topic, and external-tool is a constructor parameter with a
 * CAIA default. This is the Option E pre-send check made executable.
 */

import type { ApprenticeCorpusConfig, ResolvedApprenticeCorpusConfig } from './config.js';
import { resolveConfig, snapshotConfigForHash } from './config.js';
import { dedupePairs } from './dedupe.js';
import { defaultEventBusClient, createEventBusReader } from './event-bus-reader.js';
import { defaultFsReader } from './fs-reader.js';
import { createGithubReader, defaultGithubClient } from './github-reader.js';
import { createLangfuseReader, defaultLangfuseClient } from './langfuse-reader.js';
import { hashConfig, writeCorpus } from './manifest.js';
import { createMemoryWalker } from './memory-walker.js';
import { normaliseAll, normaliseOne, sha256OfMessages } from './normaliser.js';
import { applyPiiMask, DEFAULT_REDACT_PATTERNS } from './pii-mask.js';
import { scoreAll, scoreOne } from './quality.js';
import { createReportsWalker } from './reports-walker.js';
import { createDefaultDistiller, noopDistiller } from './distiller.js';
import type {
  ClaudeDistiller,
  CorpusManifest,
  DroppedRecord,
  EventBusClient,
  GithubClient,
  InstructionPair,
  LangfuseClient,
  RawArtifact,
  ReaderContext,
  SourceReader
} from './types.js';

export class ApprenticeCorpusAggregator {
  private readonly cfg: ResolvedApprenticeCorpusConfig;
  private readonly clock: () => Date;
  private readonly eventBusFactory: () => Promise<EventBusClient>;
  private readonly githubClient: GithubClient;
  private readonly langfuseClient: LangfuseClient;
  private readonly claudeDistiller: ClaudeDistiller;
  private readonly fs: typeof defaultFsReader;

  constructor(input: ApprenticeCorpusConfig = {}) {
    this.cfg = resolveConfig(input);
    this.clock = input.clock ?? (() => new Date());
    this.fs = input.fs ?? defaultFsReader;
    this.eventBusFactory = input.eventBus !== undefined
      ? () => Promise.resolve(input.eventBus as EventBusClient)
      : () => defaultEventBusClient(this.cfg.eventsDbPath);
    this.githubClient = input.github ?? defaultGithubClient;
    this.langfuseClient = input.langfuse ?? defaultLangfuseClient;
    this.claudeDistiller =
      input.claudeDistiller
      ?? (this.cfg.distillEnabled
        ? createDefaultDistiller({ binaryPath: this.cfg.claudeBinaryPath })
        : noopDistiller);
  }

  /** Run the full pipeline. Returns the manifest; outputs are on disk. */
  async aggregate(opts: { dryRun?: boolean } = {}): Promise<CorpusManifest> {
    const startedAtMs = Date.now();
    const generatedAt = this.clock().toISOString();
    const dropped: DroppedRecord[] = [];
    const warnings: string[] = [];

    // ── Step 1: read all sources in parallel ──────────────────────────
    const ctx: ReaderContext = {
      maxAgeDays: this.cfg.maxAgeDays,
      nowMs: this.clock().getTime()
    };
    const readers = await this.buildReaders();
    const rawArrays = await Promise.all(readers.map((r) => safeRead(r, ctx, warnings)));
    const rawArtifacts: RawArtifact[] = rawArrays.flat();

    // ── Step 2: normalise ────────────────────────────────────────────
    const normaliseRes = normaliseAll(rawArtifacts, {
      minSampleLengthChars: this.cfg.minSampleLengthChars,
      maxSampleLengthChars: this.cfg.maxSampleLengthChars,
      clock: this.clock
    });
    let pairs = normaliseRes.kept;
    for (const d of normaliseRes.droppedSourceIds) {
      dropped.push({ source: d.source, sourceId: d.id, reason: d.reason });
    }

    // ── Step 3: dedupe ───────────────────────────────────────────────
    const dedupRes = dedupePairs(pairs);
    pairs = dedupRes.kept;
    for (const d of dedupRes.duplicates) {
      dropped.push({ source: d.meta.source, sourceId: d.meta.sourceId, reason: 'duplicate' });
    }

    // ── Step 4: PII mask ─────────────────────────────────────────────
    if (this.cfg.redactPII) {
      const patterns = [...DEFAULT_REDACT_PATTERNS, ...this.cfg.extraRedactPatterns];
      pairs = pairs.map((p) => maskPair(p, patterns));
    }

    // ── Step 5: quality score ────────────────────────────────────────
    pairs = scoreAll(pairs, {
      minSampleLengthChars: this.cfg.minSampleLengthChars,
      maxSampleLengthChars: this.cfg.maxSampleLengthChars
    });

    // ── Step 6: split & distill ──────────────────────────────────────
    let highQuality = pairs.filter((p) => p.meta.qualityScore >= this.cfg.qualityThreshold);
    const lowQuality = pairs.filter((p) => p.meta.qualityScore < this.cfg.qualityThreshold);
    let distilled = 0;
    if (this.cfg.distillEnabled && lowQuality.length > 0) {
      const budget = this.cfg.maxDistillCalls;
      for (let i = 0; i < lowQuality.length; i += 1) {
        const p = lowQuality[i]!;
        if (i >= budget) {
          dropped.push({
            source: p.meta.source,
            sourceId: p.meta.sourceId,
            reason: 'low-quality-no-distill-budget',
            qualityScore: p.meta.qualityScore
          });
          continue;
        }
        const refined = await this.tryDistill(p);
        if (refined === null) {
          dropped.push({
            source: p.meta.source,
            sourceId: p.meta.sourceId,
            reason: 'distill-failed',
            qualityScore: p.meta.qualityScore
          });
          continue;
        }
        distilled += 1;
        const rescored = scoreOne(refined, {
          minSampleLengthChars: this.cfg.minSampleLengthChars,
          maxSampleLengthChars: this.cfg.maxSampleLengthChars
        });
        if (rescored < this.cfg.qualityThreshold) {
          dropped.push({
            source: p.meta.source,
            sourceId: p.meta.sourceId,
            reason: 'distill-still-low-quality',
            qualityScore: rescored
          });
          continue;
        }
        const updated: InstructionPair = {
          ...refined,
          meta: { ...refined.meta, qualityScore: rescored }
        };
        highQuality.push(updated);
      }
    } else {
      for (const p of lowQuality) {
        dropped.push({
          source: p.meta.source,
          sourceId: p.meta.sourceId,
          reason: 'low-quality-no-distill-budget',
          qualityScore: p.meta.qualityScore
        });
      }
    }

    // ── Step 7: cap at maxSamples ────────────────────────────────────
    highQuality.sort((a, b) => {
      if (b.meta.qualityScore !== a.meta.qualityScore) {
        return b.meta.qualityScore - a.meta.qualityScore;
      }
      return b.meta.createdAt.localeCompare(a.meta.createdAt);
    });
    if (highQuality.length > this.cfg.maxSamples) {
      highQuality = highQuality.slice(0, this.cfg.maxSamples);
    }

    // ── Step 8: write outputs ────────────────────────────────────────
    const elapsedMs = Date.now() - startedAtMs;
    const datedDir = generatedAt.slice(0, 10);
    const outputDir = `${this.cfg.outputRoot}/${datedDir}`;
    const totals: CorpusManifest['totals'] = {
      rawArtifacts: rawArtifacts.length,
      afterDedup: dedupRes.kept.length,
      afterPII: dedupRes.kept.length, // PII pass doesn't drop, just redacts
      afterQuality: pairs.length,
      distilled,
      dropped: dropped.length,
      final: highQuality.length
    };
    const configSnapshotJson = snapshotConfigForHash(this.cfg);
    const configHash = hashConfig(configSnapshotJson);

    const inputs = {
      outputDir,
      rawArtifacts,
      finalPairs: highQuality,
      dropped,
      totals,
      warnings,
      configHash,
      generatedAt,
      elapsedMs
    };

    if (opts.dryRun !== true) {
      writeCorpus(inputs, configSnapshotJson);
    }

    return {
      version: 1,
      generatedAt,
      outputDir,
      elapsedMs,
      totals,
      perSource: emptyPerSourceFromArtifacts(rawArtifacts, highQuality),
      redactedSpansHistogram: histogramFromPairs(highQuality, (p) => p.meta.redactedSpans),
      qualityHistogram: qualityHistogram(highQuality),
      configSha256: configHash,
      warnings
    };
  }

  /** Build the SourceReader array, instantiating clients. */
  private async buildReaders(): Promise<SourceReader[]> {
    const eventBus = await this.eventBusFactory();
    return [
      createMemoryWalker({ memoryRoot: this.cfg.memoryRoot, fs: this.fs }),
      createReportsWalker({ reportsRoot: this.cfg.reportsRoot, fs: this.fs }),
      createEventBusReader({ client: eventBus }),
      createGithubReader({ client: this.githubClient, repo: this.cfg.githubRepo }),
      createLangfuseReader({
        client: this.langfuseClient,
        projectId: this.cfg.langfuseProjectId,
        enabled: this.cfg.langfuseEnabled
      })
    ];
  }

  private async tryDistill(p: InstructionPair): Promise<InstructionPair | null> {
    const userTurn = p.messages.find((m) => m.role === 'user')?.content ?? '';
    const assistantTurn = p.messages.find((m) => m.role === 'assistant')?.content ?? '';
    try {
      const out = await this.claudeDistiller.distill({
        source: p.meta.source,
        ...(p.meta.kind !== undefined ? { kind: p.meta.kind } : {}),
        text: `${userTurn}\n\n${assistantTurn}`
      });
      const newMessages = [
        p.messages[0]!, // system stays
        { role: 'user' as const, content: out.instruction },
        { role: 'assistant' as const, content: out.response }
      ];
      const newId = sha256OfMessages(newMessages);
      return {
        id: newId,
        messages: newMessages,
        meta: {
          ...p.meta,
          distilled: true,
          contentSha256: newId
        }
      };
    } catch {
      return null;
    }
  }
}

async function safeRead(
  reader: SourceReader,
  ctx: ReaderContext,
  warnings: string[]
): Promise<RawArtifact[]> {
  try {
    return await reader.read(ctx);
  } catch (e) {
    warnings.push(`reader[${reader.source}] failed: ${(e as Error).message}`);
    return [];
  }
}

function maskPair(
  p: InstructionPair,
  patterns: ReadonlyArray<{ tag: string; pattern: RegExp; replacement: string }>
): InstructionPair {
  const seenTags = new Set<string>(p.meta.redactedSpans);
  const newMessages = p.messages.map((m) => {
    const r = applyPiiMask(m.content, patterns);
    for (const t of r.redactedSpans) seenTags.add(t);
    return { ...m, content: r.masked };
  });
  // Re-hash because content changed
  const newSha = sha256OfMessages(newMessages);
  return {
    id: newSha,
    messages: newMessages,
    meta: {
      ...p.meta,
      contentSha256: newSha,
      redactedSpans: Array.from(seenTags).sort()
    }
  };
}

// ── helpers for the manifest projection in the return value ────────────

function emptyPerSourceFromArtifacts(
  rawArtifacts: ReadonlyArray<RawArtifact>,
  finalPairs: ReadonlyArray<InstructionPair>
): CorpusManifest['perSource'] {
  const out: CorpusManifest['perSource'] = {
    events: { artifacts: 0, samples: 0 },
    memory: { artifacts: 0, samples: 0 },
    reports: { artifacts: 0, samples: 0 },
    langfuse: { artifacts: 0, samples: 0 },
    github: { artifacts: 0, samples: 0 }
  };
  for (const a of rawArtifacts) out[a.source].artifacts += 1;
  for (const p of finalPairs) out[p.meta.source].samples += 1;
  return out;
}

function histogramFromPairs(
  pairs: ReadonlyArray<InstructionPair>,
  pick: (p: InstructionPair) => string[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of pairs) {
    for (const tag of pick(p)) {
      out[tag] = (out[tag] ?? 0) + 1;
    }
  }
  return out;
}

function qualityHistogram(pairs: ReadonlyArray<InstructionPair>): Record<string, number> {
  const out: Record<string, number> = {
    '0.0-0.2': 0,
    '0.2-0.4': 0,
    '0.4-0.6': 0,
    '0.6-0.8': 0,
    '0.8-1.0': 0
  };
  for (const p of pairs) {
    const q = p.meta.qualityScore;
    if (q < 0.2) out['0.0-0.2']! += 1;
    else if (q < 0.4) out['0.2-0.4']! += 1;
    else if (q < 0.6) out['0.4-0.6']! += 1;
    else if (q < 0.8) out['0.6-0.8']! += 1;
    else out['0.8-1.0']! += 1;
  }
  return out;
}

// re-export so the index.ts barrel can reach the lazy unused symbol
export { normaliseOne };
