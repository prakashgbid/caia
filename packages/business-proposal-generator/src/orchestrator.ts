/**
 * runStep5 — the per-revision orchestrator.
 *
 * Mirrors spec §3.4 + EA-PLAN §5 exactly.
 */

import { ProposalGeneratorError } from './errors.js';
import { DefaultLlmCaller, type LlmCaller } from './llm.js';
import { renderExecSummary } from './proposal/render-exec-summary.js';
import { renderFullProposal } from './proposal/render-full.js';
import { renderOnePager } from './proposal/render-one-pager.js';
import { diffBusinessPlans, hashBusinessPlan } from './revisions.js';
import { reviewPrompt } from './reviewer/prompt-reviewer.js';
import { REVIEWER_SHIP_THRESHOLD } from './types/reviewer.js';
import {
  generateProposalInputSchema,
  type FormatsManifest,
  type GenerateProposalInput,
  type GenerationResult,
  type TargetName,
} from './types/proposal.js';
import { convertMarkdownToPdf } from './conversion/markdown-to-pdf.js';
import { convertMarkdownToDocx } from './conversion/markdown-to-docx.js';
import { NodePandocRunner, type PandocRunner } from './conversion/pandoc.js';
import type { IBlobStorage } from './storage/blob.js';
import type { IProposalPersistence } from './storage/postgres.js';
import { buildDefaultRegistry } from './design-app/index.js';
import type { TargetRegistry } from './design-app/registry.js';
import type { DesignAppPromptOutput } from './types/design-app.js';

export interface ProposalGeneratorOptions {
  llmCaller?: LlmCaller;
  blobStorage: IBlobStorage;
  persistence: IProposalPersistence;
  /** Target registry. Default = all 7 V1 generators (CD + 6 stubs). */
  registry?: TargetRegistry;
  skillsRoot: string;
  templatesRoot?: string;
  pandocRunner?: PandocRunner;
  pandocBinary?: string;
  clock?: () => Date;
  /** Skip the pandoc conversion step (e.g. when pandoc is unavailable in tests). */
  skipFormatConversion?: boolean;
  /** Inject a state-machine advancer — optional; if absent, FSM advance is skipped. */
  fsmAdvance?: (input: { tenantProjectId: string }) => Promise<void>;
}

export class ProposalGenerator {
  private readonly opts: Required<
    Pick<ProposalGeneratorOptions, 'blobStorage' | 'persistence' | 'skillsRoot' | 'clock'>
  > &
    Omit<ProposalGeneratorOptions, 'blobStorage' | 'persistence' | 'skillsRoot' | 'clock'>;
  private readonly llmCaller: LlmCaller;
  private readonly registry: TargetRegistry;
  private readonly pandocRunner: PandocRunner;
  private readonly pandocBinary: string;

  public constructor(opts: ProposalGeneratorOptions) {
    this.opts = {
      blobStorage: opts.blobStorage,
      persistence: opts.persistence,
      skillsRoot: opts.skillsRoot,
      clock: opts.clock ?? ((): Date => new Date()),
      templatesRoot: opts.templatesRoot ?? '',
      skipFormatConversion: opts.skipFormatConversion ?? false,
      fsmAdvance: opts.fsmAdvance,
      llmCaller: opts.llmCaller,
      registry: opts.registry,
      pandocRunner: opts.pandocRunner,
      pandocBinary: opts.pandocBinary,
    };
    this.llmCaller = opts.llmCaller ?? new DefaultLlmCaller();
    this.registry =
      opts.registry ?? buildDefaultRegistry({ llmCaller: this.llmCaller, skillsRoot: opts.skillsRoot });
    this.pandocRunner = opts.pandocRunner ?? new NodePandocRunner();
    this.pandocBinary = opts.pandocBinary ?? 'pandoc';
  }

  /** Run Stage 5. */
  public async runStep5(rawInput: GenerateProposalInput): Promise<GenerationResult> {
    const input = generateProposalInputSchema.parse(rawInput);
    if (input.plan.rubricScores.aggregateScore < 80) {
      throw new ProposalGeneratorError(
        'plan_score_below_threshold',
        `aggregate score ${input.plan.rubricScores.aggregateScore} < 80; refusing to generate proposal`,
        undefined,
        { aggregateScore: input.plan.rubricScores.aggregateScore },
      );
    }

    const target: TargetName = input.designAppTarget ?? 'claude_design';
    const planHash = hashBusinessPlan(input.plan);

    // 3. Cache check.
    const latest = await this.opts.persistence.readLatestProposal(input.tenantProjectId);
    if (latest && latest.businessPlanHash === planHash) {
      // Cache hit: return a synthesized GenerationResult.
      return {
        revision: latest,
        prompt: {
          id: 'cache-hit',
          businessProposalId: latest.id,
          target,
          promptText: '',
          promptMetadata: {},
          reviewerScore: REVIEWER_SHIP_THRESHOLD,
          reviewerFindings: null,
          reviewerBadge: 'ship',
          generatedAtIso: latest.generatedAtIso,
          generatorRunId: null,
          supersededBy: null,
        },
        proposalRevision: {
          id: 'cache-hit',
          tenantProjectId: input.tenantProjectId,
          revisionNumber: latest.revisionNumber,
          businessProposalId: latest.id,
          parentRevisionId: null,
          reason: 'cache-hit',
          diffSummary: null,
          createdAtIso: latest.generatedAtIso,
        },
        cacheHit: true,
        reviewerBadge: 'ship',
        reviewerScore: REVIEWER_SHIP_THRESHOLD,
      };
    }

    // 4. Three Markdown renderers, sequential.
    const execSummaryMd = await renderExecSummary({
      llmCaller: this.llmCaller,
      plan: input.plan,
      ia: input.ia,
    });
    const fullProposalMd = await renderFullProposal({
      llmCaller: this.llmCaller,
      plan: input.plan,
      ia: input.ia,
      execSummaryMd,
    });
    const onePagerMd = await renderOnePager({
      llmCaller: this.llmCaller,
      plan: input.plan,
      ia: input.ia,
    });

    // 5. Pandoc conversion + blob upload.
    const formatsManifest: FormatsManifest = {};
    if (!this.opts.skipFormatConversion) {
      formatsManifest.exec_summary = await this.convertAndUploadTriplet(
        execSummaryMd,
        `${input.tenantProjectId}/exec_summary`,
      );
      formatsManifest.full_proposal = await this.convertAndUploadTriplet(
        fullProposalMd,
        `${input.tenantProjectId}/full_proposal`,
      );
      formatsManifest.one_pager = await this.convertAndUploadTriplet(
        onePagerMd,
        `${input.tenantProjectId}/one_pager`,
      );
    }

    // 6-7. Design-app prompt generation (with reviewer + one-retry).
    const generator = this.registry.get(target);
    let envelope: DesignAppPromptOutput = await generator.render({ plan: input.plan, ia: input.ia });
    let review = await reviewPrompt({
      llmCaller: this.llmCaller,
      plan: input.plan,
      ia: input.ia,
      envelope,
      target,
    });
    let badge: 'ship' | 'caution' = review.composite_score >= REVIEWER_SHIP_THRESHOLD ? 'ship' : 'caution';
    let attempt = 1;
    if (review.composite_score < REVIEWER_SHIP_THRESHOLD) {
      envelope = await generator.render({
        plan: input.plan,
        ia: input.ia,
        previousFindings: { findings: review.findings, composite_score: review.composite_score },
      });
      review = await reviewPrompt({
        llmCaller: this.llmCaller,
        plan: input.plan,
        ia: input.ia,
        envelope,
        target,
      });
      attempt = 2;
      // Per spec §4.2: second-failure ships with `caution`, non-blocking.
      badge = review.composite_score >= REVIEWER_SHIP_THRESHOLD ? 'ship' : 'caution';
    }

    // 10. Persistence.
    const parentRevisionId = latest ? latest.id : null;
    const diffSummary = latest
      ? diffBusinessPlans(
          { ...input.plan, sections: {} },
          { ...input.plan, sections: input.plan.sections ?? {} },
        )
      : null;
    const writeResult = await this.opts.persistence.writeRevision({
      tenantProjectId: input.tenantProjectId,
      businessPlanHash: planHash,
      execSummaryMd,
      fullProposalMd,
      onePagerMd,
      formatsManifest,
      docHost: null,
      docHostUrls: null,
      designAppPrompt: {
        target,
        promptText: envelope.prompt_text,
        promptMetadata: { ...envelope.prompt_metadata, attempt },
        reviewerScore: review.composite_score,
        reviewerFindings: review,
        reviewerBadge: badge,
      },
      parentRevisionId,
      reason: input.revisionReason ?? null,
      diffSummary: diffSummary ? (diffSummary as unknown as Readonly<Record<string, unknown>>) : null,
    });

    // 11. FSM advance (optional).
    if (this.opts.fsmAdvance) {
      try {
        await this.opts.fsmAdvance({ tenantProjectId: input.tenantProjectId });
      } catch (err) {
        throw new ProposalGeneratorError(
          'fsm_transition_failed',
          'fsmAdvance hook threw',
          err,
          { tenantProjectId: input.tenantProjectId },
        );
      }
    }

    return {
      revision: writeResult.proposal,
      prompt: writeResult.prompt,
      proposalRevision: writeResult.revision,
      cacheHit: false,
      reviewerBadge: badge,
      reviewerScore: review.composite_score,
    };
  }

  private async convertAndUploadTriplet(
    markdown: string,
    pathPrefix: string,
  ): Promise<NonNullable<FormatsManifest['exec_summary']>> {
    const mdBytes = Buffer.from(markdown, 'utf8');
    const mdPut = await this.opts.blobStorage.put({
      path: `${pathPrefix}.md`,
      body: mdBytes,
      contentType: 'text/markdown',
    });
    const pdfBytes = await convertMarkdownToPdf(markdown, {
      runner: this.pandocRunner,
      binary: this.pandocBinary,
    });
    const pdfPut = await this.opts.blobStorage.put({
      path: `${pathPrefix}.pdf`,
      body: pdfBytes,
      contentType: 'application/pdf',
    });
    const docxBytes = await convertMarkdownToDocx(markdown, {
      runner: this.pandocRunner,
      binary: this.pandocBinary,
    });
    const docxPut = await this.opts.blobStorage.put({
      path: `${pathPrefix}.docx`,
      body: docxBytes,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    return {
      md: { url: mdPut.url, hash: mdPut.hash, bytes: mdPut.bytes, contentType: 'text/markdown' },
      pdf: { url: pdfPut.url, hash: pdfPut.hash, bytes: pdfPut.bytes, contentType: 'application/pdf' },
      docx: { url: docxPut.url, hash: docxPut.hash, bytes: docxPut.bytes, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    };
  }
}

/** Convenience one-shot for callers that don't need the class. */
export async function runStep5(
  opts: ProposalGeneratorOptions,
  input: GenerateProposalInput,
): Promise<GenerationResult> {
  return new ProposalGenerator(opts).runStep5(input);
}
