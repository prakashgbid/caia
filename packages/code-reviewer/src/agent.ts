/**
 * CodeReviewerAgent — public entrypoint.
 *
 * Composes diff parsing → LLM-reasoned tier → merger → verdict synthesis →
 * CodeReview. Construction takes a fully-parameterised config; defaults
 * resolve to CAIA paths via `resolveConfig` (Option E shape).
 *
 * Distinct from CriticAgent (BLOCKING for security/regression/cost), and
 * from ReviewerAgent (ADVISORY-only for craftsmanship). This agent BLOCKS
 * for correctness/bugs/style/types/tests/naming/comments and emits a
 * binary `verdict`.
 *
 * Phase 1 (this PR) ships LLM-only — deterministic detectors are reserved
 * for Phase 2 once the operator validates the LLM-tier signal quality.
 */

import type { CodeReviewerAgentConfig, ResolvedCodeReviewerAgentConfig } from './config.js';
import { resolveConfig } from './config.js';
import { defaultFsReader } from './fs-reader.js';
import { parseDiff, chunkHunk } from './diff-parser.js';
import { loadConventions } from './conventions-loader.js';
import { createDefaultLlmReviewer, noopLlmReviewer } from './llm-reasoner.js';
import { mergeFindings } from './merger.js';
import type {
  CodeReview,
  CodeReviewFinding,
  DiffHunk,
  FsReader,
  LlmReviewer,
  ScanContext
} from './types.js';

/**
 * Public API surface — operator-named in
 * `reviewer_agent_phase1_stop_condition_2026-05-08.md` and
 * `operator_decisions_2026-05-08.md`.
 *
 *   runCodeReview({ prRef, repoPath }) -> { verdict, findings }
 *
 * `prRef` is a PR number or branch ref understood by the calling context.
 * `repoPath` is the absolute path to the repo on disk.
 *
 * The function is a thin convenience wrapper around `CodeReviewerAgent`;
 * tests can either call this entrypoint directly (with a `diff` injection)
 * or instantiate the class with full DI.
 */
export interface RunCodeReviewArgs {
  /** PR number (preferred) or branch ref. */
  prRef: number | string;
  /** Absolute path to the repo on disk — used to resolve AGENTS.md. */
  repoPath: string;
  /** Pre-fetched diff. If omitted, the caller is expected to provide one
   * via the CLI / Action layer (this function does NOT shell out to gh
   * here so the public surface stays pure-and-injectable). */
  diff: string;
  /** Branch metadata for the LLM prompt. */
  context: {
    branch: string;
    baseBranch: string;
    title: string;
    body?: string;
    commitSubjects?: readonly string[];
  };
  /** Optional config override — same shape as the agent's constructor. */
  config?: CodeReviewerAgentConfig;
}

export async function runCodeReview(args: RunCodeReviewArgs): Promise<CodeReview> {
  const cfg: CodeReviewerAgentConfig = {
    ...args.config,
    conventionsPath: args.config?.conventionsPath ?? `${args.repoPath}/AGENTS.md`
  };
  const agent = new CodeReviewerAgent(cfg);
  const prNumber = typeof args.prRef === 'number' ? args.prRef : 0;
  return agent.reviewPR({
    prNumber,
    diff: args.diff,
    context: args.context
  });
}

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

export class CodeReviewerAgent {
  readonly config: ResolvedCodeReviewerAgentConfig;
  private readonly fs: FsReader;
  private readonly llm: LlmReviewer;
  private readonly clock: () => Date;

  constructor(input: CodeReviewerAgentConfig = {}) {
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

  async reviewPR(args: ReviewPRArgs): Promise<CodeReview> {
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
      reviewedAtIso
    };

    // Phase 1 ships LLM-only. Deterministic tier is reserved for Phase 2.
    const detFindings: CodeReviewFinding[] = [];

    let llmOutput = await (async () => {
      if (!this.config.enableLlmReasoning || chunkedHunks.length === 0) {
        return { findings: [], ok: true } as Awaited<ReturnType<LlmReviewer['review']>>;
      }
      try {
        return await this.llm.review({
          hunks: chunkedHunks,
          conventionExcerpts: ctx.conventionExcerpts,
          pr: ctx.pr
        });
      } catch (e) {
        return { findings: [], ok: false, diagnostic: (e as Error).message } as Awaited<ReturnType<LlmReviewer['review']>>;
      }
    })();

    // Hallucination guard — drop LLM findings whose excerpt isn't actually
    // in the diff. Same lesson as Critic / Reviewer: prevents the model
    // from inventing line numbers.
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
      blockingSeverityThreshold: this.config.blockingSeverityThreshold,
      maxFindings: this.config.maxFindingsPerPr,
      llmEnabled: this.config.enableLlmReasoning,
      chunksReviewed: chunkedHunks.length,
      durationMs: t1 - t0
    });

    return {
      prNumber: args.prNumber,
      reviewedAtIso,
      verdict: merged.verdict,
      findings: merged.findings,
      blockingFindings: merged.blockingFindings,
      totalFindings: merged.findings.length,
      summary: merged.summary
    };
  }
}
