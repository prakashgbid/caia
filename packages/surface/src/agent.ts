/**
 * SurfaceAgent — public entrypoint.
 *
 * Composes connectors → scorer → filter → digest into a single
 * deterministic pipeline. Construction takes a fully-parameterised config;
 * defaults resolve to CAIA paths via `resolveConfig`.
 *
 * Phase 0: heuristic-only, no LLM. Sub-tier connectors and the scorer are
 * injectable for tests. The digest size cap is enforced at the digest layer
 * — if exceeded, the agent surfaces a tightened-floor error to the caller.
 */

import type { SurfaceAgentConfig, ResolvedSurfaceAgentConfig } from './config.js';
import { resolveConfig } from './config.js';
import { defaultFsReader } from './fs-reader.js';
import { defaultGhRunner, defaultGitRunner } from './gh-runner.js';
import { createPrConnector } from './connectors/pr.js';
import { createMemoryConnector } from './connectors/memory.js';
import { createTranscriptConnector } from './connectors/transcript.js';
import { applyScores, defaultScorer } from './scorer.js';
import { applyFilter } from './filter.js';
import { generateDigest } from './digest.js';
import type {
  Connector,
  ConnectorResult,
  Digest,
  Finding,
  FindingSource,
  FsReader,
  GhRunner,
  GitRunner,
  ImportanceScorer
} from './types.js';

export interface GenerateDigestRequest {
  /** Relative time window like '1 day ago', or absolute ISO8601. */
  since: string;
  /** Optional override for upper bound (defaults to now). */
  until?: string;
}

/** Convert a relative time string ("N day(s) ago", "N hour(s) ago", "N week(s) ago")
 *  or an ISO8601 string into a Date. Returns null on parse failure. */
export function parseSince(s: string, now: Date): Date | null {
  const trimmed = s.trim();
  // Absolute ISO8601 first.
  const iso = Date.parse(trimmed);
  if (!Number.isNaN(iso)) return new Date(iso);

  const m = /^(\d+)\s+(second|minute|hour|day|week|month)s?\s+ago$/i.exec(trimmed);
  if (m === null) return null;
  const qty = Number(m[1]);
  const unit = (m[2] ?? '').toLowerCase();
  if (Number.isNaN(qty) || qty < 0) return null;
  const ms = unitToMs(unit);
  if (ms === null) return null;
  return new Date(now.getTime() - qty * ms);
}

function unitToMs(unit: string): number | null {
  switch (unit) {
    case 'second': return 1000;
    case 'minute': return 60 * 1000;
    case 'hour': return 60 * 60 * 1000;
    case 'day': return 24 * 60 * 60 * 1000;
    case 'week': return 7 * 24 * 60 * 60 * 1000;
    case 'month': return 30 * 24 * 60 * 60 * 1000;
    default: return null;
  }
}

export class SurfaceAgent {
  readonly config: ResolvedSurfaceAgentConfig;
  private readonly fs: FsReader;
  private readonly gh: GhRunner;
  private readonly git: GitRunner;
  private readonly clock: () => Date;
  private readonly scorer: ImportanceScorer;
  private readonly connectorOverrides: ReadonlyArray<Connector> | null;

  constructor(input: SurfaceAgentConfig & { connectors?: readonly Connector[]; scorer?: ImportanceScorer } = {}) {
    this.config = resolveConfig(input);
    this.fs = input.fs ?? defaultFsReader;
    this.gh = input.gh ?? defaultGhRunner;
    this.git = input.git ?? defaultGitRunner;
    this.clock = input.clock ?? ((): Date => new Date());
    this.scorer = input.scorer ?? defaultScorer;
    this.connectorOverrides = input.connectors ?? null;
  }

  /** Build connectors. Tests can pass `connectors:` to bypass entirely. */
  private buildConnectors(): readonly Connector[] {
    if (this.connectorOverrides !== null) return this.connectorOverrides;
    return [
      createPrConnector({ ghRepo: this.config.ghRepo, gh: this.gh }),
      createMemoryConnector({
        corpusRoot: this.config.corpusRoot,
        memoryGitRepo: this.config.memoryGitRepo,
        fs: this.fs,
        git: this.git
      }),
      createTranscriptConnector({
        transcriptRoot: this.config.transcriptRoot,
        fs: this.fs
      })
    ];
  }

  async generateDigest(req: GenerateDigestRequest): Promise<Digest> {
    const now = this.clock();
    const untilDate = req.until !== undefined
      ? (parseSince(req.until, now) ?? now)
      : now;
    const sinceDate = parseSince(req.since, untilDate);
    if (sinceDate === null) {
      throw new Error(`could not parse --since "${req.since}"`);
    }
    const sinceIso = sinceDate.toISOString();
    const untilIso = untilDate.toISOString();

    const connectors = this.buildConnectors();
    const collectArgs = { sinceIso, untilIso };

    const results: ConnectorResult[] = [];
    for (const c of connectors) {
      try {
        results.push(await c.collect(collectArgs));
      } catch (e) {
        // Defensive — every connector should already swallow errors
        // internally and surface them as `warnings`. If something escapes,
        // record a connector-error annotation.
        results.push({
          source: c.source,
          findings: [],
          collectedAtIso: untilIso,
          warnings: [`uncaught: ${(e as Error).message.slice(0, 200)}`]
        });
      }
    }

    // Build connector-degraded annotation findings for digest visibility.
    const degraded: Finding[] = [];
    for (const r of results) {
      if (r.warnings.length === 0) continue;
      degraded.push({
        id: `connector-${r.source}-${untilIso}`,
        source: 'connector-error',
        kind: 'connector-degraded',
        key: r.source,
        title: `Connector ${r.source} degraded: ${r.warnings.length} warning(s)`,
        bodyExcerpt: r.warnings.join('; ').slice(0, 1000),
        tsIso: untilIso,
        importance: 0.5,
        tags: ['connector-degraded'],
        meta: { warningCount: r.warnings.length }
      });
    }

    const allRaw: Finding[] = [];
    for (const r of results) allRaw.push(...r.findings);
    allRaw.push(...degraded);

    const scored = applyScores(
      allRaw.map(({ importance: _i, ...rest }) => rest),
      { sinceIso, untilIso },
      this.scorer
    );

    const filtered = applyFilter(scored, {
      minImportance: this.config.minImportance,
      maxFindings: this.config.maxFindings
    });

    const sourceSummary: Record<FindingSource, { collected: number; warnings: readonly string[] }> = {
      pr: { collected: 0, warnings: [] },
      memory: { collected: 0, warnings: [] },
      transcript: { collected: 0, warnings: [] },
      'connector-error': { collected: 0, warnings: [] }
    };
    for (const r of results) {
      const cur = sourceSummary[r.source];
      sourceSummary[r.source] = {
        collected: cur.collected + r.findings.length,
        warnings: [...cur.warnings, ...r.warnings]
      };
    }

    const generatedAtIso = this.clock().toISOString();
    return generateDigest({
      findings: filtered.kept,
      dropped: filtered.dropped,
      generatedAtIso,
      sinceIso,
      untilIso,
      maxBytes: this.config.maxBytes,
      sourceSummary
    });
  }
}
