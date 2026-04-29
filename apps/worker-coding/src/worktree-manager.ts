/**
 * WorktreeManager — CODING-002 (Phase 2C).
 *
 * Owns the per-story git worktree lifecycle for a Coding Agent worker.
 * Each story gets its own worktree under `~/.caia/worktrees/<storyId>/`
 * cut from the repository's integration branch (per
 * feedback_pr_lifecycle_and_branching.md):
 *
 *   - caia       → main
 *   - pokerzeno  → master
 *   - roulette*  → master
 *   - other      → develop, falling back to main
 *
 * The branch cut on top of the worktree is named per the lifecycle:
 *   feat/<storyId>-<slug>     for lifecycle in {new, enhance, refactor}
 *   fix/<storyId>-<slug>      for lifecycle = bug
 *   chore/<storyId>-<slug>    for lifecycle in {chore, docs}
 *
 * The worktree is **kept** when handing off to the Fix-It Test Agent
 * (same Claude SDK session reuses it). It's only released after
 * `task.tested_and_done` and PR merged.
 *
 * @owner coding-agent (Phase 2C worker track)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Worktree {
  storyId: string;
  path: string;
  branch: string;
  integrationBranch: string;
  createdAt: number;
}

export interface ClaimInput {
  storyId: string;
  /** Absolute path to the canonical repo (where `.git` lives). */
  repoPath: string;
  /** Hint for branch naming. Defaults to 'enhance'. */
  lifecycle?: 'new' | 'enhance' | 'refactor' | 'bug' | 'chore' | 'docs';
  /** Short URL-safe slug for the branch suffix. Auto-generated from storyId if missing. */
  slug?: string;
}

export interface WorktreeManagerOptions {
  /** Override base directory for worktrees. Default ~/.caia/worktrees. */
  baseDir?: string;
  /** Override the git executable. Default 'git'. */
  gitBin?: string;
  /** Override fs (tests). */
  fsImpl?: typeof fs;
  /** Override execSync (tests). */
  execImpl?: typeof spawnSync;
  /** Override now. */
  now?: () => number;
}

// ─── Per-repo branch table (from feedback_pr_lifecycle_and_branching.md) ───

const REPO_INTEGRATION_BRANCH: Record<string, string> = {
  caia: 'main',
  pokerzeno: 'master',
  roulettecommunity: 'master',
  'roulette-advisor-ai': 'master',
};

/** Returns the configured integration branch for a repo, or 'develop' as fallback. */
export function detectIntegrationBranch(repoName: string): string {
  return REPO_INTEGRATION_BRANCH[repoName] ?? 'develop';
}

// ─── Class ──────────────────────────────────────────────────────────────────

export class WorktreeManager {
  private readonly baseDir: string;
  private readonly gitBin: string;
  private readonly fs: typeof fs;
  private readonly exec: typeof spawnSync;
  private readonly now: () => number;

  constructor(opts: WorktreeManagerOptions = {}) {
    this.baseDir = opts.baseDir ?? path.join(os.homedir(), '.caia', 'worktrees');
    this.gitBin = opts.gitBin ?? 'git';
    this.fs = opts.fsImpl ?? fs;
    this.exec = opts.execImpl ?? spawnSync;
    this.now = opts.now ?? Date.now;
  }

  /**
   * Cuts a fresh worktree off the integration branch for the given story.
   * Throws on git failure with the stderr captured. Idempotent: if a
   * worktree for this storyId already exists, returns the existing record
   * (so Fix-It Agent reusing the same worktree is safe).
   */
  claim(input: ClaimInput): Worktree {
    const wtPath = this.pathFor(input.storyId);
    const branch = this.branchName(input);
    const repoName = path.basename(input.repoPath);
    const integrationBranch = detectIntegrationBranch(repoName);

    if (this.exists(input.storyId)) {
      // Reuse — read the current branch.
      const head = this.git(['rev-parse', '--abbrev-ref', 'HEAD'], wtPath).trim();
      return {
        storyId: input.storyId,
        path: wtPath,
        branch: head,
        integrationBranch,
        createdAt: this.now(),
      };
    }

    if (!this.fs.existsSync(this.baseDir)) {
      this.fs.mkdirSync(this.baseDir, { recursive: true });
    }

    // 1. Sync the integration branch in the source repo.
    this.git(['fetch', 'origin', integrationBranch], input.repoPath);

    // 2. Add a worktree on a new branch off origin/<integration>.
    this.git(
      ['worktree', 'add', '-b', branch, wtPath, `origin/${integrationBranch}`],
      input.repoPath,
    );

    return {
      storyId: input.storyId,
      path: wtPath,
      branch,
      integrationBranch,
      createdAt: this.now(),
    };
  }

  /**
   * Releases a worktree — runs `git worktree remove` and deletes the
   * directory. Pass `keep: true` to skip removal (useful when handing off
   * to Fix-It Agent which will release later).
   */
  release(storyId: string, repoPath: string, opts: { keep?: boolean } = {}): void {
    if (opts.keep) return;
    const wtPath = this.pathFor(storyId);
    if (!this.fs.existsSync(wtPath)) return;
    // best-effort: `git worktree remove --force` cleans both the
    // metadata and the directory.
    this.git(['worktree', 'remove', '--force', wtPath], repoPath);
  }

  /** Returns true if a worktree directory exists for this story. */
  exists(storyId: string): boolean {
    return this.fs.existsSync(this.pathFor(storyId));
  }

  /** Absolute path of the worktree directory for a story id. */
  pathFor(storyId: string): string {
    return path.join(this.baseDir, storyId);
  }

  /**
   * Returns the branch name a fresh claim() would use for this story.
   * Useful for callers that want to predict the branch name (e.g.
   * for PR body construction).
   */
  branchName(input: ClaimInput): string {
    const slug = (input.slug ?? this.deriveSlug(input.storyId)).slice(0, 40);
    const lifecycle = input.lifecycle ?? 'enhance';
    const prefix = (() => {
      if (lifecycle === 'bug') return 'fix';
      if (lifecycle === 'chore' || lifecycle === 'docs') return 'chore';
      return 'feat';
    })();
    return `${prefix}/${input.storyId}-${slug}`;
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private deriveSlug(storyId: string): string {
    return storyId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40);
  }

  private git(args: string[], cwd: string): string {
    const res = this.exec(this.gitBin, args, { cwd, encoding: 'utf8' });
    if (res.status !== 0) {
      throw new Error(
        `git ${args.join(' ')} failed in ${cwd}: ${res.stderr || res.stdout || `exit ${res.status}`}`,
      );
    }
    return String(res.stdout ?? '');
  }
}
