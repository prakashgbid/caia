/**
 * ReviewerAgent — public entrypoint.
 *
 * Composes diff parsing → deterministic detectors → LLM-reasoned tier →
 * merger → CraftsmanshipReview. Construction takes a fully-parameterised
 * config; defaults resolve to CAIA paths via `resolveConfig`.
 *
 * Distinct from CriticAgent — Reviewer never produces blocking findings;
 * its output is purely advisory. See DESIGN.md §1, §11 for the boundary.
 */

import type { ResolvedReviewerAgentConfig, ReviewerAgentConfig } from './config.js';
import { resolveConfig } from './config.js';
import { defaultFsReader } from './fs-reader.js';
import { parseDiff, chunkHunk } from './diff-parser.js';
import { ALL_DETECTORS } from './detectors/index.js';
import { loadConventions } from './conventions-loader.js';
import { createDefaultLlmReviewer, noopLlmReviewer } from './llm-reasoner.js';
import { mergeFindings } from './merger.js';
import type {
  CraftsmanshipFinding,
  CraftsmanshipReview,
  DiffHunk,
  FsReader,
  LlmReviewer,
  ScanContext
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

export class ReviewerAgent {
  readonly config: ResolvedReviewerAgentConfig;
  private readonly fs: FsReader;
  private readonly llm: LlmReviewer;
  private readonly clock: () => Date;

  constructor(input: ReviewerAgentConfig = {}) {
    this.config = resolveConfig(input);
    this.fs = input.fs ?? defaultFsReader;
    this.clock = input.clock ?? ((): Date => new Date());
    if (input.llm !== undefined) {
      this.llm = input.llm;
    } else if (this.config.enableLlmReasoning) {
      this.llm = createDefaultLlmReviewer({
        binaryPath: this.config.claudeBinaryPath,
        modelTag: this.config.modelTag,
        timeoutMs: this.config.perVectorTimeoutMs
      });
    } else {
      this.llm = noopLlmReviewer;
    }
  }

  async reviewPR(args: ReviewPRArgs): Promise<CraftsmanshipReview> {
    const t0 = this.clock().getTime();
    const reviewedAtIso = this.clock().toISOString();

    const parsed = parseDiff(args.diff);
    const chunkedHunks: DiffHunk[] = parsed.hunks.flatMap(h => chunkHunk(h, this.config.chunkBytes));

    const conventionExcerpts = loadConventions(this.fs, this.config.conventionsPath);
    const ctx: ScanContext = {
      conventionExcerpts,
      pr: {
        prNumber: args.prNumber,
        branch: args.context.branch,
        baseBranch: args.context.baseBranch,
        title: args.context.title,
        ...(args.context.body !== undefined ? { body: args.context.body } : {}),
        commitSubjects: args.context.commitSubjects ?? []
      },
      reviewedAtIso,
      thresholds: {
        maxFunctionLines: this.config.maxFunctionLines,
        maxFileLines: this.config.maxFileLines,
        maxNestingDepth: this.config.maxNestingDepth
      }
    };

    // Deterministic tier.
    const detFindings: CraftsmanshipFinding[] = [];
    if (this.config.enableDeterministic) {
      for (const hunk of chunkedHunks) {
        for (const detector of ALL_DETECTORS) {
          try {
            detFindings.push(...detector.scan(hunk, ctx));
          } catch (e) {
            // Defensive — detector errors must not crash the agent.
            console.error('detector %s threw on %s: %s', detector.id, hunk.file, (e as Error).message);
          }
        }
      }
    }

    // LLM-reasoned tier.
    let llmOutput = await (async () => {
      if (!this.config.enableLlmReasoning || chunkedHunks.length === 0) {
        return { findings: [], ok: true } as Awaited<ReturnType<LlmReviewer['review']>>;
      }
      try {
        return await this.llm.review({
          hunks: chunkedHunks,
          conventionExcerpts,
          pr: ctx.pr
        });
      } catch (e) {
        return { findings: [], ok: false, diagnostic: (e as Error).message } as Awaited<ReturnType<LlmReviewer['review']>>;
      }
    })();

    // Hallucination guard — drop LLM findings whose excerpt isn't in the
    // actual diff. Prevents the LLM from inventing line numbers.
    const diffText = chunkedHunks.map(h => h.body).join('\n');
    llmOutput = {
      ...llmOutput,
      findings: llmOutput.findings.filter(f => {
        if (f.excerpt === '' || f.excerpt === undefined) return true;
        return diffText.includes(f.excerpt.slice(0, Math.min(40, f.excerpt.length)));
      })
    };

    const t1 = this.clock().getTime();
    const merged = mergeFindings({
      deterministic: detFindings,
      llmReasoned: llmOutput,
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
      summary: merged.summary
    };
  }
}
