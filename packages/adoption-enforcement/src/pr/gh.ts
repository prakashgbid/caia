import { runCommand } from '../verify/runner.js';
import {
  ADOPTION_BRANCH_PREFIX,
  ADOPTION_FAILED_LABEL,
  ADOPTION_VERIFIED_LABEL,
  COMMENT_MARKER,
  type PullRequest,
} from './types.js';

const GH_TIMEOUT_MS = 60 * 1000;

interface RawPrListItem {
  number: number;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  url: string;
  title: string;
  isDraft: boolean;
  mergeable: string;
  labels: Array<{ name: string }>;
  files?: Array<{ path: string }>;
}

interface ListOptions {
  readonly repoCwd: string;
  readonly state?: 'open' | 'closed' | 'all';
  readonly limit?: number;
}

export async function listAdoptionPRs(options: ListOptions): Promise<PullRequest[]> {
  const state = options.state ?? 'open';
  const limit = options.limit ?? 50;
  const args = [
    'pr',
    'list',
    '--state',
    state,
    '--limit',
    String(limit),
    '--json',
    'number,headRefName,headRefOid,baseRefName,url,title,isDraft,mergeable,labels',
  ];
  const result = await runCommand('gh', args, {
    cwd: options.repoCwd,
    timeoutMs: GH_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `gh pr list failed (exit ${result.exitCode}): ${result.stderrTail.slice(-500)}`,
    );
  }
  const parsed = JSON.parse(result.stdoutTail || '[]') as RawPrListItem[];
  const adoption = parsed.filter((row) => row.headRefName.startsWith(ADOPTION_BRANCH_PREFIX));

  const enriched: PullRequest[] = [];
  for (const row of adoption) {
    const files = await listFiles(options.repoCwd, row.number);
    enriched.push({
      number: row.number,
      headRefName: row.headRefName,
      headRefOid: row.headRefOid,
      baseRefName: row.baseRefName,
      url: row.url,
      title: row.title,
      isDraft: row.isDraft,
      mergeable: normalizeMergeable(row.mergeable),
      labels: row.labels.map((l) => ({ name: l.name })),
      files,
    });
  }
  return enriched;
}

export async function getPR(
  repoCwd: string,
  prNumber: number,
): Promise<PullRequest> {
  const args = [
    'pr',
    'view',
    String(prNumber),
    '--json',
    'number,headRefName,headRefOid,baseRefName,url,title,isDraft,mergeable,labels',
  ];
  const result = await runCommand('gh', args, {
    cwd: repoCwd,
    timeoutMs: GH_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `gh pr view ${prNumber} failed (exit ${result.exitCode}): ${result.stderrTail.slice(-500)}`,
    );
  }
  const row = JSON.parse(result.stdoutTail) as RawPrListItem;
  const files = await listFiles(repoCwd, prNumber);
  return {
    number: row.number,
    headRefName: row.headRefName,
    headRefOid: row.headRefOid,
    baseRefName: row.baseRefName,
    url: row.url,
    title: row.title,
    isDraft: row.isDraft,
    mergeable: normalizeMergeable(row.mergeable),
    labels: row.labels.map((l) => ({ name: l.name })),
    files,
  };
}

async function listFiles(
  repoCwd: string,
  prNumber: number,
): Promise<Array<{ path: string }>> {
  const args = ['pr', 'view', String(prNumber), '--json', 'files'];
  const result = await runCommand('gh', args, {
    cwd: repoCwd,
    timeoutMs: GH_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    return [];
  }
  const parsed = JSON.parse(result.stdoutTail) as { files?: Array<{ path: string }> };
  return parsed.files ?? [];
}

function normalizeMergeable(value: string): PullRequest['mergeable'] {
  if (value === 'MERGEABLE' || value === 'CONFLICTING' || value === 'UNKNOWN') return value;
  return 'UNKNOWN';
}

export interface UpsertCommentOptions {
  readonly repoCwd: string;
  readonly prNumber: number;
  readonly body: string;
  readonly marker?: string;
}

/**
 * Idempotent comment upsert: if a comment with the marker already exists, edit
 * it; otherwise create a new one. The marker is appended automatically if not
 * already present in `body`.
 */
export async function upsertVerificationComment(
  options: UpsertCommentOptions,
): Promise<{ action: 'created' | 'updated'; commentId?: string }> {
  const marker = options.marker ?? COMMENT_MARKER;
  const body = options.body.includes(marker) ? options.body : `${marker}\n${options.body}`;

  const existingId = await findCommentId(options.repoCwd, options.prNumber, marker);

  if (existingId !== null) {
    const editArgs = [
      'api',
      '--method',
      'PATCH',
      `repos/{owner}/{repo}/issues/comments/${existingId}`,
      '-f',
      `body=${body}`,
    ];
    const result = await runCommand('gh', editArgs, {
      cwd: options.repoCwd,
      timeoutMs: GH_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `gh api PATCH comment failed (exit ${result.exitCode}): ${result.stderrTail.slice(-500)}`,
      );
    }
    return { action: 'updated', commentId: existingId };
  }

  const createArgs = [
    'pr',
    'comment',
    String(options.prNumber),
    '--body',
    body,
  ];
  const result = await runCommand('gh', createArgs, {
    cwd: options.repoCwd,
    timeoutMs: GH_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `gh pr comment failed (exit ${result.exitCode}): ${result.stderrTail.slice(-500)}`,
    );
  }
  return { action: 'created' };
}

async function findCommentId(
  repoCwd: string,
  prNumber: number,
  marker: string,
): Promise<string | null> {
  const args = [
    'api',
    `repos/{owner}/{repo}/issues/${prNumber}/comments`,
    '--paginate',
  ];
  const result = await runCommand('gh', args, {
    cwd: repoCwd,
    timeoutMs: GH_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    return null;
  }
  try {
    const comments = JSON.parse(result.stdoutTail) as Array<{ id: number; body: string }>;
    const hit = comments.find((c) => typeof c.body === 'string' && c.body.includes(marker));
    return hit ? String(hit.id) : null;
  } catch {
    return null;
  }
}

export interface SetLabelOptions {
  readonly repoCwd: string;
  readonly prNumber: number;
  readonly addLabels?: readonly string[];
  readonly removeLabels?: readonly string[];
}

export async function setLabels(options: SetLabelOptions): Promise<void> {
  const args = ['pr', 'edit', String(options.prNumber)];
  for (const label of options.addLabels ?? []) {
    args.push('--add-label', label);
  }
  for (const label of options.removeLabels ?? []) {
    args.push('--remove-label', label);
  }
  if (args.length === 3) return;
  const result = await runCommand('gh', args, {
    cwd: options.repoCwd,
    timeoutMs: GH_TIMEOUT_MS,
  });
  if (result.exitCode !== 0 && !result.stderrTail.includes('not found')) {
    throw new Error(
      `gh pr edit labels failed (exit ${result.exitCode}): ${result.stderrTail.slice(-500)}`,
    );
  }
}

export async function applyVerdictLabels(
  repoCwd: string,
  prNumber: number,
  passed: boolean,
): Promise<void> {
  if (passed) {
    await setLabels({
      repoCwd,
      prNumber,
      addLabels: [ADOPTION_VERIFIED_LABEL],
      removeLabels: [ADOPTION_FAILED_LABEL],
    });
  } else {
    await setLabels({
      repoCwd,
      prNumber,
      addLabels: [ADOPTION_FAILED_LABEL],
      removeLabels: [ADOPTION_VERIFIED_LABEL],
    });
  }
}
