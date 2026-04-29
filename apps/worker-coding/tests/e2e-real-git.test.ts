/**
 * Coding Agent end-to-end real-git test — CODING-009 (Phase 2C).
 *
 * Drives the full per-story pipeline (claim worktree → run engine → run
 * tests → commit → "open PR" → DoD self-check) against a real git
 * repository on disk. This is the proof-of-life that CODING-001..006
 * compose correctly outside the per-block unit-test mocks.
 *
 * What's real:
 *   - git: a fresh repository created with `git init`, with a bare
 *     remote so `git push` round-trips.
 *   - filesystem: every read/write goes through node's fs.
 *   - WorktreeManager: cuts a real worktree off the integration branch.
 *   - LocalTestRunner: discovers + runs real Node scripts.
 *   - DiffCommitter: stages, commits with conventional-commits, pushes.
 *   - DodSelfCheck: runs against the real worktree state.
 *
 * What's stubbed:
 *   - LLM adapter: a `ScriptedLlmAdapter` performs deterministic file
 *     edits per turn. CODING-009 doesn't burn live Claude tokens by
 *     default; opt in to a real adapter via CAIA_E2E_REAL_LLM=1
 *     (currently a no-op until a ClaudeSdkAdapter ships).
 *   - `gh` CLI: replaced with a tiny shim that records invocations to a
 *     log file. The DiffCommitter's spawned `gh` instead points at this
 *     shim, so we can assert the PR-create payload without touching
 *     GitHub.
 *
 * The test is gated behind a guard for `git` availability so it doesn't
 * fail in environments that lack git on the PATH. CI has git.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { WorktreeManager } from '../src/worktree-manager';
import { ImplementationEngine, DONE_MARKER } from '../src/implementation-engine';
import type { LlmAdapter, LlmTurnResult } from '../src/implementation-engine';
import { LocalTestRunner } from '../src/local-test-runner';
import { DiffCommitter } from '../src/diff-committer';
import { DodSelfCheck } from '../src/dod-self-check';
import type { Bundle } from '../src/bundle-reader';

// ─── Guard: only run on systems with git ────────────────────────────────────

const GIT_AVAILABLE = (() => {
  try {
    const r = spawnSync('git', ['--version'], { encoding: 'utf8' });
    return r.status === 0;
  } catch {
    return false;
  }
})();

const maybeIt = GIT_AVAILABLE ? it : it.skip;

// ─── Helpers ────────────────────────────────────────────────────────────────

function git(cwd: string, args: string[], envExtra: Record<string, string> = {}): string {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      // Quiet, deterministic git for tests
      GIT_AUTHOR_NAME: 'caia-test',
      GIT_AUTHOR_EMAIL: 'caia@example.com',
      GIT_COMMITTER_NAME: 'caia-test',
      GIT_COMMITTER_EMAIL: 'caia@example.com',
      ...envExtra,
    },
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  }
  return r.stdout.toString();
}

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `caia-e2e-${prefix}-`));
}

interface Sandbox {
  root: string;
  repo: string;
  bareRemote: string;
  worktreeBase: string;
  ghLog: string;
  ghShim: string;
  cleanup: () => void;
}

/**
 * Build a sandbox repo + bare remote + a fake `gh` shim.
 *
 * Layout:
 *   <root>/
 *     repo/                — actual working repo, branch `main`
 *     repo.git/            — bare remote, set as origin
 *     bin/gh               — shim that logs invocations + writes a fake PR url
 *     gh.log               — newline-delimited record of every gh call
 *     worktrees/           — base directory for the WorktreeManager
 */
function buildSandbox(): Sandbox {
  const root = tmpDir('sandbox');
  const repo = path.join(root, 'caia');  // basename → integration branch 'main'
  const bareRemote = path.join(root, 'caia.git');
  const worktreeBase = path.join(root, 'worktrees');
  const binDir = path.join(root, 'bin');
  const ghLog = path.join(root, 'gh.log');
  const ghShim = path.join(binDir, 'gh');

  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(bareRemote, { recursive: true });
  fs.mkdirSync(worktreeBase, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });

  // ─── bare remote ─────────────────────────────────────────────────────────
  git(bareRemote, ['init', '--bare', '--initial-branch=main', '.']);

  // ─── working repo ────────────────────────────────────────────────────────
  git(repo, ['init', '--initial-branch=main', '.']);
  git(repo, ['remote', 'add', 'origin', bareRemote]);

  // Seed package.json + a passing test.
  const pkg = {
    name: 'sandbox-app',
    version: '1.0.0',
    private: true,
    scripts: {
      test: 'node test/run.js',
    },
  };
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify(pkg, null, 2));
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src/index.js'), 'module.exports = { greet: (n) => `hello ${n}` };\n');
  // Pin the test command so LocalTestRunner.discoverCommands picks our
  // node script instead of falling back to pnpm (which isn't on the
  // CI shell PATH for sandbox npm-only repos).
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'docs/test-commands.md'),
    '## unit\n\n```bash\nnode test/run.js\n```\n',
  );
  fs.mkdirSync(path.join(repo, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'test/run.js'),
    `const { greet } = require('../src/index');
if (greet('world') !== 'hello world') {
  console.error('FAIL: greet broken');
  process.exit(1);
}
console.log('ok');
`,
  );
  // README so the worker has a non-trivial diff after edits.
  fs.writeFileSync(path.join(repo, 'README.md'), '# sandbox-app\n');

  git(repo, ['add', '-A']);
  git(repo, ['commit', '-m', 'initial']);
  git(repo, ['push', '-u', 'origin', 'main']);

  // ─── gh shim ─────────────────────────────────────────────────────────────
  // The shim records every invocation and emits a fake PR URL on
  // `gh pr create`. The DiffCommitter parses that URL to build OpenPrResult.
  const shim = `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(ghLog)}, JSON.stringify(args) + '\\n');
if (args[0] === 'pr' && args[1] === 'create') {
  // Mimic real gh: a single-line URL on stdout.
  process.stdout.write('https://github.com/caia-test/sandbox-app/pull/42\\n');
  process.exit(0);
}
process.stdout.write('');
process.exit(0);
`;
  fs.writeFileSync(ghShim, shim);
  fs.chmodSync(ghShim, 0o755);

  return {
    root,
    repo,
    bareRemote,
    worktreeBase,
    ghLog,
    ghShim,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Deterministic LLM adapter: walks through a script of edits per turn,
 * then prints the DONE_MARKER. Each turn's "edits" are written to the
 * worktree before the assistant text is returned, so the LocalTestRunner
 * sees them when it later runs.
 */
class ScriptedLlmAdapter implements LlmAdapter {
  private cwd = '';
  private turn = 0;
  constructor(private readonly script: Array<(cwd: string) => void>) {}

  async start(opts: { sessionId: string; systemPrompt: string; cwd: string }): Promise<void> {
    this.cwd = opts.cwd;
    void opts.sessionId;
    void opts.systemPrompt;
  }

  async send(_message: string): Promise<LlmTurnResult> {
    void _message;
    const step = this.script[this.turn++];
    if (step) {
      step(this.cwd);
    }
    const done = this.turn >= this.script.length;
    return {
      text: done ? `${DONE_MARKER}\n` : 'progress made',
      done,
      fixApplied: false,
      fixSha: null,
      tokens: { input: 1, output: 1 },
    };
  }

  async end(): Promise<void> {
    /* no-op */
  }
}

/** Build a minimal Bundle that drives the engine + DoD checks. */
function makeBundle(storyId: string): Bundle {
  return {
    story: {
      id: storyId,
      title: 'add greeting tag',
      description: 'Append a "tagged" greeting helper to src/index.js.',
      status: 'pending',
      rootPromptId: null,
      parentEntityId: null,
      parentEntityType: null,
      bucketId: 'bkt_main',
      templateVersion: 'v1',
      templateValidationStatus: 'valid',
      templateValidationErrors: null,
      enrichedAt: null,
      updatedAt: null,
    },
    prompt: null,
    requirements: [],
    bucket: { id: 'bkt_main', kind: 'parallel', domainSlug: null, sequenceIndex: null, status: 'open' },
    labels: [],
    dependencies: { upstream: [], downstream: [] },
    inputDependencies: [],
    ticket: {
      lifecycle: 'enhance',
      acceptanceCriteria: ['greet() returns a tagged string', 'all tests pass'],
      testCases: [{ id: 'tc1', title: 'greet world returns hello world' }],
      claims: { files: ['src/index.js', 'README.md'], schemas: [] },
    },
  } as unknown as Bundle;
}

// ─── The test ───────────────────────────────────────────────────────────────

describe('Coding Agent — real-git E2E', () => {
  let sb: Sandbox;
  beforeAll(() => {
    if (!GIT_AVAILABLE) return;
    sb = buildSandbox();
  });
  afterAll(() => {
    if (sb) sb.cleanup();
  });

  maybeIt('claims a real worktree and lays down the engine\'s edits', async () => {
    const wm = new WorktreeManager({ baseDir: sb.worktreeBase });
    const wt = wm.claim({ storyId: 'story_e2e_1', repoPath: sb.repo, lifecycle: 'enhance', slug: 'tag-greet' });
    expect(wt.branch).toMatch(/^feat\/story_e2e_1/);
    expect(fs.existsSync(wt.path)).toBe(true);
    expect(fs.existsSync(path.join(wt.path, '.git'))).toBe(true);
    // The worktree shares HEAD with main; package.json must be present.
    expect(fs.existsSync(path.join(wt.path, 'package.json'))).toBe(true);
  });

  maybeIt('drives engine → tests → commit → PR-create with real git operations', async () => {
    const wm = new WorktreeManager({ baseDir: sb.worktreeBase });
    const wt = wm.claim({ storyId: 'story_e2e_2', repoPath: sb.repo, lifecycle: 'enhance', slug: 'tag-greet' });

    // 1. Engine — scripted edits replace src/index.js + extend README.
    const adapter = new ScriptedLlmAdapter([
      (cwd) => {
        fs.writeFileSync(
          path.join(cwd, 'src/index.js'),
          'module.exports = {\n' +
            '  greet: (n) => `hello ${n}`,\n' +
            '  tagged: (n) => `[v1] hello ${n}`,\n' +
            '};\n',
        );
        fs.appendFileSync(path.join(cwd, 'README.md'), '\n## API\n- greet(name)\n- tagged(name)\n');
      },
    ]);
    const bundle = makeBundle('story_e2e_2');
    const engine = new ImplementationEngine({ bundle, worktree: wt, adapter });
    await engine.start();
    const implResult = await engine.implement();
    await engine.end();
    expect(implResult.status).toBe('done');
    expect(implResult.turns).toBe(1);

    // 2. Local tests — exercises real `node test/run.js` against the
    //    edited worktree.
    const runner = new LocalTestRunner();
    const testResult = runner.run(wt, bundle);
    expect(testResult.passed).toBe(true);

    // 3. Commit — real `git commit` + `git push origin <branch>`.
    const dc = new DiffCommitter({ ghBin: sb.ghShim });
    const commit = dc.commit({ worktree: wt, bundle });
    expect(commit.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(commit.branch).toBe(wt.branch);
    // Commit should be reachable from the worktree HEAD.
    const headSha = git(wt.path, ['rev-parse', 'HEAD']).trim();
    expect(headSha).toBe(commit.sha);
    // Diff against integration branch must be non-empty.
    const diffStat = git(wt.path, ['diff', '--stat', wt.integrationBranch, 'HEAD']).trim();
    expect(diffStat.length).toBeGreaterThan(0);

    // 4. Open PR — real push, fake `gh`. The shim writes the URL we
    //    parse + records the invocation for assertion.
    const pr = dc.openPr({ worktree: wt, bundle });
    expect(pr.prNumber).toBe(42);
    expect(pr.prUrl).toBe('https://github.com/caia-test/sandbox-app/pull/42');

    // 4a. The branch must now exist on the bare remote.
    const remoteRefs = git(sb.bareRemote, ['for-each-ref', '--format=%(refname)']);
    expect(remoteRefs).toContain(`refs/heads/${wt.branch}`);

    // 4b. The gh log must capture the correct args.
    const ghCalls = fs
      .readFileSync(sb.ghLog, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);
    const prCall = ghCalls.find((c) => c[0] === 'pr' && c[1] === 'create');
    expect(prCall).toBeTruthy();
    expect(prCall).toContain('--base');
    expect(prCall).toContain(wt.integrationBranch);
    expect(prCall).toContain('--head');
    expect(prCall).toContain(wt.branch);

    // 5. DoD self-check — reads the real worktree + commit + PR meta.
    const dod = new DodSelfCheck();
    // Re-derive the PR body the committer would have submitted (the
    // shim discards stdin so we can't capture it from gh).
    const prBody = dc.buildPrBody(bundle, wt);
    const report = dod.runAll({
      bundle,
      worktree: wt,
      testRun: testResult,
      pr,
      prBody,
      // Skip the lint + typecheck shells: the sandbox doesn't have them
      // wired and they'd false-fail. The structural checks (claims,
      // version-bump, PR body, local-tests-passed) are the meat.
      skipShellChecks: true,
    });
    // We expect the structural checks to pass: claims-files matches the
    // edits, package version wasn't bumped, PR body references the story
    // and test cases.
    const failedIds = report.results.filter((r) => !r.passed).map((r) => r.id);
    // Allow lint/typecheck to be present-but-skipped; they should not
    // appear in failedIds because we set skipLint/skipTypecheck.
    expect(failedIds).not.toContain('claims-files');
    expect(failedIds).not.toContain('package-version-not-bumped');
    expect(failedIds).not.toContain('pr-body-references-story');
    expect(failedIds).not.toContain('pr-body-references-test-cases');
    expect(failedIds).not.toContain('local-tests-passed');
  });
});
