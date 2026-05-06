/**
 * CriticAgent — public entrypoint.
 *
 * Composes diff parsing → deterministic detectors → LLM-reasoned tier →
 * merger → AdversarialReview. Construction takes a fully-parameterised
 * config; defaults resolve to CAIA paths via `resolveConfig`.
 */

import type { CriticAgentConfig, ResolvedCriticAgentConfig } from './config.js';
import { resolveConfig } from './config.js';
import { defaultFsReader } from './fs-reader.js';
import { parseDiff, chunkHunk } from './diff-parser.js';
import { ALL_DETECTORS } from './detectors/index.js';
import { loadMemoryFiles } from './memory-loader.js';
import { loadTaxonomy } from './taxonomy.js';
import { createDefaultLlmReasoner, noopLlmReasoner } from './llm-reasoner.js';
import { mergeFindings } from './merger.js';
import type {
  AdversarialFinding,
  AdversarialReview,
  DiffHunk,
  FsReader,
  LlmReasoner,
  ScanContext,
  TaxonomyEntry
} from './types.js';

export interface ReviewPRArgs {
  prNumber: number;
  diff: string;
  context: {
    branch: string;
    baseBranch: string;
    title: string;
    body?: string;
    commitSubjects?: readonly string[];
  };
}

export class CriticAgent {
  readonly config: ResolvedCriticAgentConfig;
  private readonly fs: FsReader;
  private readonly llm: LlmReasoner;
  private readonly clock: () => Date;
  private cachedTaxonomy: readonly TaxonomyEntry[] | null = null;

  constructor(input: CriticAgentConfig = {}) {
    this.config = resolveConfig(input);
    this.fs = input.fs ?? defaultFsReader;
    this.clock = input.clock ?? ((): Date => new Date());
    if (input.llm !== undefined) {
      this.llm = input.llm;
    } else if (this.config.enableLlmReasoning) {
      this.llm = createDefaultLlmReasoner({
        binaryPath: this.config.claudeBinaryPath,
        modelTag: this.config.modelTag,
        timeoutMs: this.config.perVectorTimeoutMs
      });
    } else {
      this.llm = noopLlmReasoner;
    }
  }

  /** Lazy taxonomy load — cached across reviews. */
  private getTaxonomy(): readonly TaxonomyEntry[] {
    if (this.cachedTaxonomy === null) {
      this.cachedTaxonomy = loadTaxonomy(this.fs, this.config.taxonomyPath);
    }
    return this.cachedTaxonomy;
  }

  async reviewPR(args: ReviewPRArgs): Promise<AdversarialReview> {
    const t0 = this.clock().getTime();
    const reviewedAtIso = this.clock().toISOString();

    const parsed = parseDiff(args.diff);

    // Pre-chunk hunks so detectors and LLM see bite-sized inputs.
    const chunkedHunks: DiffHunk[] = parsed.hunks.flatMap(h => chunkHunk(h, this.config.chunkBytes));

    const memoryFiles = loadMemoryFiles(this.fs, this.config.memoryRoot);
    const ctx: ScanContext = {
      memoryFiles,
      pr: {
        prNumber: args.prNumber,
        branch: args.context.branch,
        baseBranch: args.context.baseBranch,
        title: args.context.title,
        ...(args.context.body !== undefined ? { body: args.context.body } : {}),
        commitSubjects: args.context.commitSubjects ?? []
      },
      reviewedAtIso
    };

    // Deterministic tier.
    const detFindings: AdversarialFinding[] = [];
    if (this.config.enableDeterministic) {
      for (const hunk of chunkedHunks) {
        for (const detector of ALL_DETECTORS) {
          try {
            detFindings.push(...detector.scan(hunk, ctx));
          } catch (e) {
            // Defensive: detector errors must not crash the agent. Log to
            // stderr so the orchestrator can pick it up.
            console.error(`detector ${detector.id} threw on ${hunk.file}:`, (e as Error).message);
          }
        }
      }
    }

    // Suppress incompleteness findings if the PR touches any tests/ path.
    const touchesTests = chunkedHunks.some(h => /(?:^|\/)(tests|__tests__)\//.test(h.file));
    const detFiltered = touchesTests
      ? detFindings.filter(f => f.category !== 'incompleteness')
      : detFindings;

    // LLM-reasoned tier.
    let llmOutput: { findings: ReadonlyArray<Omit<AdversarialFinding, 'id' | 'source' | 'detectorId'>>; ok: boolean; diagnostic?: string } = { findings: [], ok: true };
    if (this.config.enableLlmReasoning && chunkedHunks.length > 0) {
      try {
        llmOutput = await this.llm.reason({
          hunks: chunkedHunks,
          taxonomy: this.getTaxonomy(),
          pr: ctx.pr
        });
      } catch (e) {
        llmOutput = { findings: [], ok: false, diagnostic: (e as Error).message };
      }
    }

    // Hallucination guard — drop LLM findings whose excerpt isn't in the
    // actual diff. Prevents the LLM from inventing line numbers.
    const diffText = chunkedHunks.map(h => h.body).join('\n');
    const llmFiltered = {
      ...llmOutput,
      findings: llmOutput.findings.filter(f => {
        if (f.excerpt === '' || f.excerpt === undefined) return true;
        return diffText.includes(f.excerpt.slice(0, Math.min(40, f.excerpt.length)));
      })
    };

    const t1 = this.clock().getTime();
    const merged = mergeFindings({
      deterministic: detFiltered,
      llmReasoned: llmFiltered,
      severityFloor: this.config.severityFloor,
      maxFindings: this.config.maxFindingsPerPr,
      llmEnabled: this.config.enableLlmReasoning,
      chunksReviewed: chunkedHunks.length,
      durationMs: t1 - t0
    });

    return {
      prNumber: args.prNumber,
      reviewedAtIso,
      totalFindings: merged.findings.length,
      findings: merged.findings,
      blockingFindings: merged.blockingFindings,
      summary: merged.summary
    };
  }
}
