/**
 * LocalTestRunner — CODING-004 unit tests.
 *
 * Stubs spawnSync + fs to verify command discovery (3 tiers: doc,
 * claims-derived, fallback), early-bail behavior on failure, log
 * writing, and the tail-truncation safeguard.
 *
 * 13 cases.
 */

import { LocalTestRunner } from '../src/local-test-runner';
import type { Bundle } from '../src/bundle-reader';
import type { Worktree } from '../src/worktree-manager';

function makeBundle(claimsFiles: string[] = []): Bundle {
  return {
    story: {
      id: 's1',
      title: '',
      description: '',
      status: 'pending',
      rootPromptId: null,
      parentEntityId: null,
      parentEntityType: null,
      bucketId: null,
      templateVersion: 'v1',
      templateValidationStatus: 'pending',
      templateValidationErrors: null,
      enrichedAt: null,
      updatedAt: null,
    },
    ticket: { claims: { files: claimsFiles } },
    ticketParseError: null,
    prompt: null,
    requirement: null,
    bucket: null,
    labels: [],
    dependencies: { upstream: [], downstream: [] },
    inputDependencies: [],
  };
}

function makeWorktree(p = '/tmp/wt/s1'): Worktree {
  return {
    storyId: 's1',
    path: p,
    branch: 'feat/s1',
    integrationBranch: 'main',
    createdAt: 0,
  };
}

function makeFs(opts: { fileMap?: Record<string, string> } = {}) {
  const map = opts.fileMap ?? {};
  const written: Record<string, string> = {};
  return {
    fs: {
      existsSync: (p: string) => p in map,
      readFileSync: (p: string) => map[p] ?? '',
      writeFileSync: (p: string, c: string) => { written[p] = c; },
      mkdirSync: () => undefined,
    } as never,
    written,
  };
}

describe('LocalTestRunner.discoverCommands — docs/test-commands.md', () => {
  it('parses unit + integration fences when present', () => {
    const md = `# Test commands

## unit

\`\`\`bash
pnpm -F @caia-app/worker-coding test
\`\`\`

## integration

\`\`\`bash
pnpm -F @caia-app/orchestrator test:integration
\`\`\`
`;
    const { fs } = makeFs({ fileMap: { '/repo/docs/test-commands.md': md } });
    const r = new LocalTestRunner({ fsImpl: fs });
    const cmds = r.discoverCommands('/repo', makeBundle());
    expect(cmds).toEqual([
      ['unit', 'pnpm -F @caia-app/worker-coding test'],
      ['integration', 'pnpm -F @caia-app/orchestrator test:integration'],
    ]);
  });

  it('handles unit-only file (no integration heading)', () => {
    const md = `## unit\n\n\`\`\`\npnpm -w vitest run\n\`\`\``;
    const { fs } = makeFs({ fileMap: { '/repo/docs/test-commands.md': md } });
    const r = new LocalTestRunner({ fsImpl: fs });
    const cmds = r.discoverCommands('/repo', makeBundle());
    expect(cmds).toEqual([['unit', 'pnpm -w vitest run']]);
  });

  it('falls through to claims when fences are empty', () => {
    const md = `## unit\n\n## integration\n`;
    const { fs } = makeFs({ fileMap: { '/repo/docs/test-commands.md': md } });
    const r = new LocalTestRunner({ fsImpl: fs });
    const cmds = r.discoverCommands('/repo', makeBundle(['apps/orchestrator/src/x.ts']));
    expect(cmds).toEqual([['unit', 'pnpm --filter @caia-app/orchestrator test']]);
  });
});

describe('LocalTestRunner.discoverCommands — claims-derived', () => {
  it('apps/<name>/* → @caia-app/<name>', () => {
    const { fs } = makeFs();
    const r = new LocalTestRunner({ fsImpl: fs });
    const cmds = r.discoverCommands('/repo', makeBundle(['apps/dashboard/app/page.tsx']));
    expect(cmds).toEqual([['unit', 'pnpm --filter @caia-app/dashboard test']]);
  });

  it('packages/<name>/* → @chiefaia/<name>', () => {
    const { fs } = makeFs();
    const r = new LocalTestRunner({ fsImpl: fs });
    const cmds = r.discoverCommands('/repo', makeBundle(['packages/ticket-template/src/x.ts']));
    expect(cmds).toEqual([['unit', 'pnpm --filter @chiefaia/ticket-template test']]);
  });

  it('multiple touched packages → multiple --filter args', () => {
    const { fs } = makeFs();
    const r = new LocalTestRunner({ fsImpl: fs });
    const cmds = r.discoverCommands('/repo', makeBundle([
      'apps/orchestrator/src/x.ts',
      'packages/feature-registry/src/y.ts',
    ]));
    expect(cmds.length).toBe(1);
    const cmd = cmds[0]![1];
    expect(cmd).toContain('--filter @caia-app/orchestrator');
    expect(cmd).toContain('--filter @chiefaia/feature-registry');
  });
});

describe('LocalTestRunner.discoverCommands — fallback', () => {
  it('no doc + no claims → repo-wide pnpm test', () => {
    const { fs } = makeFs();
    const r = new LocalTestRunner({ fsImpl: fs });
    const cmds = r.discoverCommands('/repo', makeBundle());
    expect(cmds).toEqual([['unit', 'pnpm -w test']]);
  });
});

describe('LocalTestRunner.run — execution', () => {
  it('runs each phase + writes log file + reports passed when all exit 0', () => {
    const { fs, written } = makeFs({ fileMap: {} });
    let tick = 1000;
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const exec = ((_bin: string, args: string[], opts: { cwd: string }) => {
      calls.push({ args, cwd: opts.cwd });
      tick += 25;
      return { status: 0, stdout: 'tests pass', stderr: '' };
    }) as never;
    const r = new LocalTestRunner({
      fsImpl: fs,
      execImpl: exec,
      now: () => tick++,
    });
    const result = r.run(makeWorktree('/repo'), makeBundle(['apps/orchestrator/src/x.ts']));
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.phase).toBe('unit');
    expect(result.results[0]!.exitCode).toBe(0);
    expect(result.logPath).toBe('/repo/.test-output.log');
    expect(written['/repo/.test-output.log']).toContain('pnpm --filter @caia-app/orchestrator test');
    expect(written['/repo/.test-output.log']).toContain('tests pass');
  });

  it('bails on first failure (skips subsequent phases)', () => {
    const md = `## unit\n\n\`\`\`\npnpm test:u\n\`\`\`\n\n## integration\n\n\`\`\`\npnpm test:i\n\`\`\``;
    const { fs } = makeFs({ fileMap: { '/repo/docs/test-commands.md': md } });
    let phase = 0;
    const calls: string[] = [];
    const exec = ((_bin: string, args: string[]) => {
      calls.push(args[1]!);
      phase++;
      return phase === 1
        ? { status: 1, stdout: '', stderr: 'BOOM' }
        : { status: 0, stdout: 'never reached', stderr: '' };
    }) as never;
    const r = new LocalTestRunner({ fsImpl: fs, execImpl: exec, now: () => 0 });
    const result = r.run(makeWorktree('/repo'), makeBundle());
    expect(result.passed).toBe(false);
    expect(result.results).toHaveLength(1);          // bailed after the unit phase
    expect(calls).toEqual(['pnpm test:u']);          // integration NOT executed
  });

  it('reports passed=false when no phases discovered (defensive)', () => {
    const { fs } = makeFs();
    // intentionally cause discovery to return [] by stubbing it
    const r = new LocalTestRunner({ fsImpl: fs, execImpl: (() => ({ status: 0 })) as never });
    // monkey-patch discoverCommands for this test
    (r as unknown as { discoverCommands: () => unknown }).discoverCommands = () => [];
    const result = r.run(makeWorktree('/repo'), makeBundle());
    expect(result.passed).toBe(false);
    expect(result.results).toEqual([]);
  });
});

describe('LocalTestRunner.run — tail truncation', () => {
  it('truncates stdout/stderr to tailBytes', () => {
    const { fs } = makeFs();
    const big = 'x'.repeat(50_000);
    const exec = (() => ({ status: 0, stdout: big, stderr: big })) as never;
    const r = new LocalTestRunner({ fsImpl: fs, execImpl: exec, tailBytes: 100, now: () => 0 });
    const result = r.run(makeWorktree('/repo'), makeBundle(['apps/x/y.ts']));
    expect(result.results[0]!.stdoutTail.length).toBeLessThan(200);
    expect(result.results[0]!.stdoutTail).toContain('truncated');
  });
});
