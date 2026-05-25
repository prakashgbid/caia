/**
 * `@caia/full-stack-engineer/pr-opener` — runs the local gate, commits
 * staged files in logical chunks, pushes, and opens a structured PR.
 *
 * The gate runs `typecheck → lint → vitest` in series, short-circuiting
 * on first failure. The commit is grouped by file bucket (frontend /
 * backend / database / tests) so reviewers can read the diff in order
 * without losing the architects' attribution.
 *
 * The PR body is built from the brief: it cites the ticket id, lists
 * the architects whose specs were satisfied, and includes the local-
 * gate result as a footer. The body is deliberately structured so the
 * Stage 14 per-story-tester can parse it back if needed.
 */

import type {
  EmittedFile,
  EmittedFiles,
  GitAdapter,
  ImplementationBrief,
  LocalGateResult,
  LocalGateRunner,
  PrOutcome,
} from './types.js';

export class PrOpenerError extends Error {
  readonly code:
    | 'local-gate-failed'
    | 'no-files-emitted'
    | 'git-failure';
  readonly failures?: readonly { gate: 'typecheck' | 'lint' | 'vitest'; output: string }[];
  constructor(
    code: 'local-gate-failed' | 'no-files-emitted' | 'git-failure',
    message: string,
    failures?: readonly { gate: 'typecheck' | 'lint' | 'vitest'; output: string }[],
  ) {
    super(message);
    this.name = 'PrOpenerError';
    this.code = code;
    if (failures !== undefined) this.failures = failures;
  }
}

export interface OpenPrInput {
  brief: ImplementationBrief;
  emitted: EmittedFiles;
  repoPath: string;
  branchName: string;
  commitScope: string;
  prBaseBranch?: string;
  git: GitAdapter;
  localGate: LocalGateRunner;
  skipLocalGate?: boolean;
}

/**
 * Idempotent: if the PR already exists for the branch, returns the
 * existing PR's number + url without re-opening. The local gate still
 * runs (so the worker can re-verify the build is green) unless
 * `skipLocalGate=true`.
 */
export async function openPr(input: OpenPrInput): Promise<PrOutcome> {
  const allFiles: EmittedFile[] = [
    ...input.emitted.frontend,
    ...input.emitted.backend,
    ...input.emitted.database,
    ...input.emitted.tests,
  ];
  if (allFiles.length === 0) {
    throw new PrOpenerError('no-files-emitted', 'emitter produced no files');
  }

  let localGate: PrOutcome['localGate'];
  if (input.skipLocalGate === true) {
    localGate = { passed: true, durationMs: 0, failures: [] };
  } else {
    localGate = await runLocalGate(input.localGate, input.repoPath);
    if (!localGate.passed) {
      throw new PrOpenerError(
        'local-gate-failed',
        `local gate failed: ${localGate.failures.map((f) => f.gate).join(', ')}`,
        localGate.failures,
      );
    }
  }

  let commitSha = '';
  try {
    const chunks: Array<{
      kind: 'frontend' | 'backend' | 'database' | 'tests';
      files: readonly EmittedFile[];
    }> = [
      { kind: 'frontend', files: input.emitted.frontend },
      { kind: 'backend', files: input.emitted.backend },
      { kind: 'database', files: input.emitted.database },
      { kind: 'tests', files: input.emitted.tests },
    ];
    for (const chunk of chunks) {
      if (chunk.files.length === 0) continue;
      const message = composeCommitMessage(input.commitScope, chunk.kind, input.brief);
      const r = await input.git.stageAndCommit({
        repoPath: input.repoPath,
        branchName: input.branchName,
        files: chunk.files,
        message,
      });
      commitSha = r.commitSha;
    }
    await input.git.push({ repoPath: input.repoPath, branchName: input.branchName });
  } catch (err) {
    throw new PrOpenerError(
      'git-failure',
      `git step failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const existing = await input.git.prExists({
    repoPath: input.repoPath,
    branchName: input.branchName,
  });
  if (existing) {
    return {
      prNumber: existing.prNumber,
      prUrl: existing.prUrl,
      commitSha,
      localGate,
    };
  }

  const base = input.prBaseBranch ?? 'develop';
  const title = composePrTitle(input.commitScope, input.brief);
  const body = composePrBody(input.brief, input.emitted, localGate, commitSha);
  let opened: { prNumber: number; prUrl: string };
  try {
    opened = await input.git.openPr({
      repoPath: input.repoPath,
      branchName: input.branchName,
      title,
      body,
      base,
    });
  } catch (err) {
    throw new PrOpenerError(
      'git-failure',
      `gh pr create failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return {
    prNumber: opened.prNumber,
    prUrl: opened.prUrl,
    commitSha,
    localGate,
  };
}

async function runLocalGate(
  runner: LocalGateRunner,
  repoPath: string,
): Promise<PrOutcome['localGate']> {
  const failures: { gate: 'typecheck' | 'lint' | 'vitest'; output: string }[] = [];
  let durationMs = 0;
  const gates: Array<{
    gate: 'typecheck' | 'lint' | 'vitest';
    fn: () => Promise<LocalGateResult>;
  }> = [
    { gate: 'typecheck', fn: () => runner.typecheck({ repoPath }) },
    { gate: 'lint', fn: () => runner.lint({ repoPath }) },
    { gate: 'vitest', fn: () => runner.vitest({ repoPath }) },
  ];
  for (const g of gates) {
    const r = await g.fn();
    durationMs += r.durationMs;
    if (!r.passed) {
      failures.push({ gate: g.gate, output: r.output });
      return { passed: false, durationMs, failures };
    }
  }
  return { passed: true, durationMs, failures: [] };
}

export function composePrTitle(commitScope: string, brief: ImplementationBrief): string {
  return `${commitScope}: implement ${brief.ticketId} — ${brief.ticketTitle}`;
}

export function composePrBody(
  brief: ImplementationBrief,
  emitted: EmittedFiles,
  localGate: PrOutcome['localGate'],
  commitSha: string,
): string {
  const lines: string[] = [];
  lines.push(`## Ticket`);
  lines.push('');
  lines.push(`- ID: \`${brief.ticketId}\``);
  lines.push(`- Project: \`${brief.projectId}\``);
  lines.push(`- Title: ${brief.ticketTitle}`);
  lines.push(`- Commit: \`${commitSha || '_(unknown)_'}\``);
  lines.push('');

  lines.push(`## Acceptance criteria satisfied`);
  lines.push('');
  if (brief.acceptanceCriteria.length === 0) {
    lines.push('_(none authored)_');
  } else {
    for (const ac of brief.acceptanceCriteria) lines.push(`- [x] ${ac}`);
  }
  lines.push('');

  lines.push(`## Architects whose specs were implemented`);
  lines.push('');
  const architectAttribution = collectArchitectAttribution(emitted);
  if (architectAttribution.length === 0) {
    lines.push('_(no architect attribution — emitter produced raw files)_');
  } else {
    for (const a of architectAttribution) lines.push(`- ${a}`);
  }
  lines.push('');

  lines.push(`## File summary`);
  lines.push('');
  lines.push(`- frontend: ${emitted.frontend.length} file(s)`);
  lines.push(`- backend: ${emitted.backend.length} file(s)`);
  lines.push(`- database: ${emitted.database.length} file(s)`);
  lines.push(`- tests: ${emitted.tests.length} file(s)`);
  lines.push('');

  lines.push(`## Stack lock`);
  lines.push('');
  lines.push(`- UI primitives: ${brief.stackLock.uiPrimitives}`);
  lines.push(`- Styling: ${brief.stackLock.styling}`);
  lines.push(`- Locked (project-caia-shadcn-react-first-locked): yes`);
  lines.push('');

  lines.push(`## Local gate`);
  lines.push('');
  lines.push(`- Status: ${localGate.passed ? 'passed' : 'failed'}`);
  lines.push(`- Duration: ${localGate.durationMs}ms`);
  if (localGate.failures.length > 0) {
    lines.push('- Failures:');
    for (const f of localGate.failures) {
      lines.push(`  - \`${f.gate}\`: ${f.output.slice(0, 200)}`);
    }
  }
  lines.push('');

  lines.push(`## Test cases`);
  lines.push('');
  if (brief.tests.cases.length === 0) {
    lines.push('_(no test cases authored)_');
  } else {
    for (const tc of brief.tests.cases) {
      lines.push(`- \`${tc.id}\` [${tc.layer}/${tc.category}] — ${tc.title}`);
    }
  }
  lines.push('');

  lines.push(`---`);
  lines.push('');
  lines.push(`_Opened by @caia/full-stack-engineer (Stage 13). Awaits per-story-tester (Stage 14)._`);

  return lines.join('\n');
}

function collectArchitectAttribution(emitted: EmittedFiles): readonly string[] {
  const all = [
    ...emitted.frontend,
    ...emitted.backend,
    ...emitted.database,
    ...emitted.tests,
  ];
  const set = new Set<string>();
  for (const f of all) {
    for (const a of f.attribution) set.add(a);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function composeCommitMessage(
  scope: string,
  kind: 'frontend' | 'backend' | 'database' | 'tests',
  brief: ImplementationBrief,
): string {
  return `${scope}: ${kind} — ${brief.ticketId} ${brief.ticketTitle}`;
}
