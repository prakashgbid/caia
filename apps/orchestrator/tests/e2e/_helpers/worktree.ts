/**
 * Fake worktree builder for the Phase 2 regression suite.
 *
 * The ImplementationEngine only reads `worktree.path`,
 * `worktree.branch`, and `worktree.integrationBranch` to compose its
 * system prompt. The MockLlmAdapter scripts the rest. So an in-process
 * regression test creates a temp directory with a .git child and
 * stamps it as a Worktree — no real git state needed.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Worktree } from '../../../../worker-coding/src/worktree-manager';

export function makeFakeWorktree(
  storyId: string,
  prefix = 'caia-regression-wt',
): { worktree: Worktree; cleanup: () => void } {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-${storyId}-`));
  fs.mkdirSync(path.join(tmpdir, '.git'), { recursive: true });
  return {
    worktree: {
      path: tmpdir,
      branch: `feat/${storyId}`,
      integrationBranch: 'main',
    } as unknown as Worktree,
    cleanup: () => {
      try {
        fs.rmSync(tmpdir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    },
  };
}
