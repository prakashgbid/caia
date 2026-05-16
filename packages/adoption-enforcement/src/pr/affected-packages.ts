import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { PullRequest } from './types.js';

interface PackageJsonShape {
  name?: string;
}

/**
 * Infer (target, consumer) workspace packages from the PR diff.
 *
 * Heuristic:
 * - A changed file at `packages/<dir>/...` whose package.json declares a
 *   `@chiefaia/*` name and whose adoption PR title hints at "adopt <pkg>"
 *   is treated as the *target* (the artefact being adopted).
 * - Every other changed-file package is a *consumer* (a place adopting the
 *   artefact).
 *
 * If the title heuristic fails (no `@chiefaia/<x>` token in the PR title),
 * we leave `target` empty and fall back to "every changed package is a
 * consumer." V3 then runs the repo-wide build.
 */
export async function inferPackages(opts: {
  readonly worktreeDir: string;
  readonly pr: PullRequest;
}): Promise<{ targetPackages: string[]; consumerPackages: string[] }> {
  const changedPkgDirs = new Set<string>();
  for (const f of opts.pr.files) {
    const m = /^packages\/([^/]+)\//.exec(f.path);
    if (m && m[1]) {
      changedPkgDirs.add(m[1]);
    }
  }

  const pkgNames = new Map<string, string>();
  for (const dir of changedPkgDirs) {
    const name = await readPackageName(path.join(opts.worktreeDir, 'packages', dir));
    if (name) pkgNames.set(dir, name);
  }

  const titleTarget = extractTargetFromTitle(opts.pr.title, opts.pr.headRefName);

  const targetPackages: string[] = [];
  const consumerPackages: string[] = [];
  for (const [, name] of pkgNames) {
    if (titleTarget && name === titleTarget) {
      targetPackages.push(name);
    } else {
      consumerPackages.push(name);
    }
  }

  if (targetPackages.length === 0 && titleTarget) {
    targetPackages.push(titleTarget);
  }

  return { targetPackages, consumerPackages };
}

async function readPackageName(pkgDir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(pkgDir, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as PackageJsonShape;
    return typeof parsed.name === 'string' ? parsed.name : null;
  } catch {
    return null;
  }
}

const TITLE_RE = /(@chiefaia\/[a-z0-9][a-z0-9-]*)/i;
const BRANCH_RE = /^adopt\/([a-z0-9][a-z0-9-]*?)(?:-[0-9a-f]{7,})?$/i;

function extractTargetFromTitle(title: string, branch: string): string | null {
  const titleMatch = TITLE_RE.exec(title);
  if (titleMatch && titleMatch[1]) return titleMatch[1];
  const branchMatch = BRANCH_RE.exec(branch);
  if (branchMatch && branchMatch[1]) return `@chiefaia/${branchMatch[1]}`;
  return null;
}
