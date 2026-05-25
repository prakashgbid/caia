/**
 * Candidate ADR drafter — for each relevant SearchResult, produces a
 * markdown candidate ADR with status `Proposed-by-daily-upgrade-cron`
 * and writes it to `<decisionsRoot>/candidate-<YYYY-MM-DD>-<slug>.md`.
 *
 * Date prefix avoids same-day filename collisions across runs.
 */
import * as path from 'node:path';

import type { CandidateAdr, FsAdapter, JudgedItem, ScanError } from './types.js';

export interface DraftInput {
  judged: JudgedItem[];
  decisionsRoot: string;
  fs: FsAdapter;
  now: Date;
}

export interface DraftResult {
  drafts: CandidateAdr[];
  errors: ScanError[];
}

export function draftCandidateAdrs(input: DraftInput): DraftResult {
  const drafts: CandidateAdr[] = [];
  const errors: ScanError[] = [];
  if (!input.fs.exists(input.decisionsRoot)) input.fs.mkdirp(input.decisionsRoot);
  const date = isoDate(input.now);
  for (const j of input.judged) {
    try {
      const slug = slugify(j.item.title || 'untitled');
      const filename = `candidate-${date}-${slug}.md`;
      const filePath = path.posix.join(input.decisionsRoot, filename);
      const content = renderCandidate(j, date);
      input.fs.writeFile(filePath, content);
      drafts.push({ slug, filePath, content });
    } catch (err) {
      errors.push({
        kind: 'draft-error',
        itemUrl: j.item.url,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { drafts, errors };
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

export function renderCandidate(j: JudgedItem, date: string): string {
  return [
    `# Candidate ADR — ${j.item.title}`,
    '',
    `**Status**: Proposed-by-daily-upgrade-cron`,
    `**Date**: ${date}`,
    `**Source**: [${j.item.sourceId}](${j.item.url})`,
    `**Confidence**: ${j.verdict.confidence.toFixed(2)}`,
    '',
    '## Context',
    '',
    j.item.excerpt || '_no excerpt extracted_',
    '',
    '## Critic reasoning',
    '',
    j.verdict.reason,
    '',
    '## Recommendation',
    '',
    j.verdict.recommendation || '_no recommendation_',
    '',
    '## Next steps',
    '',
    '- Operator triages on Sunday rhythm.',
    '- EA Architect reviews; classifies as accept-for-operator-review / reject-with-reason / defer-to-next-quarter.',
    '- If accepted, this file is renamed to the next ADR number and status changed to `Accepted`.',
    '',
  ].join('\n');
}

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
