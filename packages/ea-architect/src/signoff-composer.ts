/**
 * Sign-off document composer.
 *
 * Reference: spec §6. The sign-off is what the operator reads — a single
 * markdown file per submission compressing the entire review into one
 * artifact (TL;DR + verdict + sub-agent verdicts + Defender dialogue +
 * filed ADRs + recommended modifications + escalation + dissent + citations).
 *
 * Path: caia-ea/sign-offs/<submission-id>.md
 */

import { join } from 'node:path';

import { defaultFsAdapter } from './fs-adapter.js';
import type { FsAdapter } from './types.js';
import type { CoordinatorReviewOutcome, SubAgentVerdict } from './coordinator-types.js';

const DEFAULT_SIGNOFF_DIR_REL = ['sign-offs'];

export interface SignoffComposerConfig {
  /** Root of the caia-ea repository. */
  repositoryPath: string;
  fs?: FsAdapter;
  clock?: () => Date;
}

export interface SignoffComposeInput {
  outcome: CoordinatorReviewOutcome;
  /** Plan slug — derived from the original plan path/filename. */
  planSlug: string;
  /** Path to the original plan markdown. */
  planPath: string;
  /** Path to the producer's context dump (if known). */
  contextDumpPath?: string;
  /** ISO timestamp. */
  generatedAtIso: string;
}

/** Composer instance — owns the directory and the fs. */
export class SignoffComposer {
  private readonly repoRoot: string;
  private readonly fs: FsAdapter;
  private readonly clock: () => Date;

  constructor(cfg: SignoffComposerConfig) {
    this.repoRoot = cfg.repositoryPath;
    this.fs = cfg.fs ?? defaultFsAdapter;
    this.clock = cfg.clock ?? ((): Date => new Date());
  }

  signoffPath(submissionId: string): string {
    return join(this.repoRoot, ...DEFAULT_SIGNOFF_DIR_REL, `${submissionId}.md`);
  }

  /** Compose the markdown body + write it to disk. Returns the path. */
  write(input: SignoffComposeInput): string {
    const body = this.render(input);
    const path = this.signoffPath(input.outcome.submissionId);
    this.fs.writeFile(path, body);
    return path;
  }

  /** Compose-only — return the markdown string without writing. */
  render(input: SignoffComposeInput): string {
    const { outcome } = input;
    const wordCount = approxWordCount(outcome);
    const readTime = computeReadTimeMinutes({
      wordCount,
      subAgentsInvoked: outcome.subAgentsInvoked.length,
      defenderRounds: outcome.defenderRoundsUsed,
      newAdrs: outcome.new_adrs_to_file.length
    });
    const verdictForFrontmatter = outcome.escalation_to_operator !== undefined
      ? 'escalated-to-operator'
      : outcome.status;
    const frontmatter = [
      '---',
      `submission-id: ${outcome.submissionId}`,
      `plan-path: ${input.planPath}`,
      `plan-slug: ${input.planSlug}`,
      `verdict: ${verdictForFrontmatter}`,
      `verdict-issued-at: ${outcome.reviewedAtIso}`,
      `read-time-estimate: ${readTime}`,
      `defender-rounds-used: ${outcome.defenderRoundsUsed}`,
      `sub-agents-invoked: [${outcome.subAgentsInvoked.join(', ')}]`,
      `new-adrs-filed: [${outcome.new_adrs_to_file.map((a) => a.title).join(', ')}]`,
      `escalation-reason: ${outcome.escalation_to_operator?.reason ?? 'null'}`,
      '---',
      ''
    ].join('\n');

    const title = `# EA Sign-Off — ${input.planSlug}`;
    const tldr = renderTldr(outcome, readTime);
    const verdictSection = renderVerdict(outcome);
    const operatorActions = renderOperatorActions(outcome, readTime);
    const subAgentVerdicts = renderSubAgentVerdicts(outcome.subAgentVerdicts);
    const dialogueLog = renderDialogueLog(outcome.subAgentVerdicts);
    const newAdrs = renderNewAdrs(outcome);
    const modifications = renderModifications(outcome);
    const escalation = renderEscalation(outcome);
    const dissent = renderDissent(outcome.dissenting);
    const citations = renderCitations(outcome);
    const footer = renderFooter(outcome, input);

    return [
      frontmatter,
      title,
      '',
      tldr,
      verdictSection,
      operatorActions,
      subAgentVerdicts,
      dialogueLog,
      newAdrs,
      modifications,
      escalation,
      dissent,
      citations,
      footer
    ].filter((s) => s.length > 0).join('\n\n');
  }
}

/** Public helper — for callers that already have a fs + want compose only. */
export function renderSignoffMarkdown(input: SignoffComposeInput): string {
  const stub = new SignoffComposer({ repositoryPath: '/tmp', fs: defaultFsAdapter });
  return stub.render(input);
}

/** Read-time heuristic per spec §6.4. */
export function computeReadTimeMinutes(args: {
  wordCount: number;
  subAgentsInvoked: number;
  defenderRounds: number;
  newAdrs: number;
}): number {
  const base = args.wordCount / 200;
  const adj = args.subAgentsInvoked * 0.5 + args.defenderRounds * 0.3 + args.newAdrs * 0.4;
  return Math.min(30, Math.max(1, Math.ceil(base + adj)));
}

function approxWordCount(o: CoordinatorReviewOutcome): number {
  let n = 0;
  n += o.reasoning.split(/\s+/).filter(Boolean).length;
  for (const v of o.subAgentVerdicts) {
    n += v.reasoning.split(/\s+/).filter(Boolean).length;
    if (v.dialogue !== undefined) {
      for (const turn of v.dialogue) {
        n += turn.q.question.split(/\s+/).filter(Boolean).length;
        n += turn.a.answer.split(/\s+/).filter(Boolean).length;
      }
    }
  }
  return n;
}

function renderTldr(outcome: CoordinatorReviewOutcome, readTime: number): string {
  const dominant = outcome.subAgentVerdicts[0];
  if (dominant === undefined) {
    return `## TL;DR (≤200 words)\nVerdict: ${outcome.status}. ${outcome.reasoning}`;
  }
  const headline = outcome.escalation_to_operator !== undefined
    ? `**ESCALATED TO OPERATOR.** ${outcome.escalation_to_operator.decisionPoint}`
    : `**${outcome.status.toUpperCase()}.** ${oneLine(outcome.reasoning, 280)}`;
  return `## TL;DR (≤200 words)\n${headline} (Read time ≈ ${readTime} min.)`;
}

function renderVerdict(outcome: CoordinatorReviewOutcome): string {
  return `## Verdict\n**Status:** ${outcome.status}\n\n${outcome.reasoning}`;
}

function renderOperatorActions(outcome: CoordinatorReviewOutcome, readTime: number): string {
  const lines = [`- [ ] Read this document (estimated ${readTime} minutes)`];
  if (outcome.escalation_to_operator !== undefined) {
    lines.push(`- [ ] **Answer the question in §Escalation below**: ${outcome.escalation_to_operator.decisionPoint}`);
  } else if (outcome.status === 'approved') {
    lines.push('- [ ] Nothing required — approved, proceed');
  } else if (outcome.status === 'approved-with-modifications') {
    lines.push('- [ ] Review the §Recommended Modifications and approve them or not');
  } else if (outcome.status === 'rejected') {
    lines.push('- [ ] Read §Verdict reasoning; either accept the rejection or push back');
  } else {
    lines.push('- [ ] Triage: see §Verdict and §Recommended Modifications');
  }
  return `## What the operator must do (if anything)\n${lines.join('\n')}`;
}

function renderSubAgentVerdicts(verdicts: SubAgentVerdict[]): string {
  if (verdicts.length === 0) return '';
  const parts = ['## Sub-agent verdicts'];
  for (const v of verdicts) {
    parts.push(`\n### ${v.subAgent} — ${v.status}`);
    parts.push(`**Reasoning:** ${v.reasoning}`);
    if (v.cited_principles?.length) parts.push(`**Cited principles:** ${v.cited_principles.join(', ')}`);
    if (v.cited_adrs?.length) parts.push(`**Cited ADRs:** ${v.cited_adrs.join(', ')}`);
    if (v.cited_lessons?.length) parts.push(`**Cited lessons:** ${v.cited_lessons.join(', ')}`);
    if (v.ticketAudit !== undefined) {
      parts.push(`**Ticket audit:** ${v.ticketAudit.ticketId} — completeness ${(v.ticketAudit.completenessScore * 100).toFixed(0)}%`);
      if (v.ticketAudit.missingNonFunctional.length > 0) {
        parts.push(`  - Missing NF: ${v.ticketAudit.missingNonFunctional.join(', ')}`);
      }
    }
    if (v.stewardOutput !== undefined) {
      parts.push(`**ADRs filed:** ${v.stewardOutput.filedAdrs.map((a) => a.adrId).join(', ') || '(none)'}`);
      parts.push(`**Supersession graph:** ${v.stewardOutput.supersessionGraphOk ? 'OK' : 'PROBLEMS DETECTED'}`);
    }
    if (v.researchDispatch !== undefined) {
      parts.push(`**Research dispatched:** ${v.researchDispatch.dispatched ? 'yes' : 'skipped'} (topic: ${v.researchDispatch.topicSlug})`);
    }
    if (v.driftEntries !== undefined && v.driftEntries.length > 0) {
      parts.push(`**Drift detected:** ${v.driftEntries.map((d) => `${d.principleId} (${d.severity})`).join(', ')}`);
    }
  }
  return parts.join('\n');
}

function renderDialogueLog(verdicts: SubAgentVerdict[]): string {
  const reviewer = verdicts.find((v) => v.subAgent === 'ea-plan-reviewer');
  if (reviewer === undefined || reviewer.dialogue === undefined || reviewer.dialogue.length === 0) {
    return '';
  }
  const intro = `## Plan Defender dialogue log\n\n> The Plan Defender is the AI proxy for the original plan's author, seeded with their reasoning trace + sources. The Reviewer's questions and the Defender's answers are reproduced below in chronological order. This is the audit trail.`;
  const rounds = reviewer.dialogue
    .map(
      (turn) =>
        `**Round ${turn.q.round}**\n**Reviewer asks:** ${turn.q.question}${turn.q.scope ? ` _(scope: ${turn.q.scope})_` : ''}\n**Defender answers:** ${turn.a.answer}\n_(cited: ${turn.a.cited_sources.join(', ') || 'none'}; confidence: ${turn.a.confidence}; action: ${turn.a.recommended_action})_`
    )
    .join('\n\n');
  return `${intro}\n\n${rounds}`;
}

function renderNewAdrs(outcome: CoordinatorReviewOutcome): string {
  const steward = outcome.subAgentVerdicts.find((v) => v.subAgent === 'ea-doc-steward');
  if (steward === undefined || steward.stewardOutput === undefined) {
    if (outcome.new_adrs_to_file.length === 0) return '';
    return `## New ADRs filed\n${outcome.new_adrs_to_file
      .map((a) => `- ${a.title} — Status: ${a.status}`)
      .join('\n')}`;
  }
  const filed = steward.stewardOutput.filedAdrs;
  if (filed.length === 0) return '';
  return `## New ADRs filed\n${filed
    .map((a) => `- [${a.adrId}: ${a.title}](${a.filePath}) — Status: Accepted`)
    .join('\n')}`;
}

function renderModifications(outcome: CoordinatorReviewOutcome): string {
  if (outcome.requested_modifications.length === 0) return '';
  return `## Recommended modifications\n${outcome.requested_modifications
    .map((m, i) => `${i + 1}. ${m}`)
    .join('\n')}`;
}

function renderEscalation(outcome: CoordinatorReviewOutcome): string {
  if (outcome.escalation_to_operator === undefined) return '';
  const e = outcome.escalation_to_operator;
  return `## Escalation\n**Class:** ${e.category ?? 'strategic-decision'}\n**Reason:** ${e.reason}\n**Question for operator:** ${e.decisionPoint}\n**Recommendation from EA Coordinator:** ${e.recommendation ?? '(none)'}`;
}

function renderDissent(dissenting: SubAgentVerdict[]): string {
  if (dissenting.length === 0) return '';
  const parts = ['## Dissent', 'The following sub-agents disagreed with the dominant verdict. Their reasoning is preserved verbatim:'];
  for (const v of dissenting) {
    parts.push(`\n### ${v.subAgent} — ${v.status}\n${v.reasoning}`);
  }
  return parts.join('\n');
}

function renderCitations(outcome: CoordinatorReviewOutcome): string {
  const all = new Set<string>();
  for (const p of outcome.cited_principles) all.add(`Principle ${p}`);
  for (const a of outcome.cited_adrs) all.add(`ADR ${a}`);
  for (const l of outcome.cited_lessons) all.add(`Lesson ${l}`);
  for (const v of outcome.subAgentVerdicts) {
    if (v.dialogue !== undefined) {
      for (const turn of v.dialogue) for (const s of turn.a.cited_sources) all.add(s);
    }
  }
  if (all.size === 0) return '';
  return `## Citations from the dialogue\n${[...all].map((c) => `- ${c}`).join('\n')}`;
}

function renderFooter(outcome: CoordinatorReviewOutcome, input: SignoffComposeInput): string {
  return `---\n_Generated by \`@caia/ea-architect\` (Coordinator role) at ${input.generatedAtIso}. Dialogue log persisted at ${outcome.dialogueLogPath ?? '(none)'}. Plan context dump persisted at ${input.contextDumpPath ?? '(none)'}. Audit trail integrity verifiable via the \`submission-id\` correlation key (${outcome.submissionId})._`;
}

function oneLine(text: string, n: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  return t.slice(0, n) + '…';
}
