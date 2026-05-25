import { describe, expect, it } from 'vitest';

import { createDeterministicEmitter } from '../src/code-emitter.js';
import {
  PrOpenerError,
  composeCommitMessage,
  composePrBody,
  composePrTitle,
  openPr,
} from '../src/pr-opener.js';
import { readSpec } from '../src/spec-reader.js';
import {
  makeLoadedTicket,
  newStubGitState,
  stubGit,
  stubLocalGate,
} from './fixtures/ticket-fixture.js';

async function prepare(loaded = makeLoadedTicket()) {
  const brief = readSpec(loaded);
  const emitter = createDeterministicEmitter();
  const emitted = await emitter.emit(brief);
  return { brief, emitted, loaded };
}

describe('openPr', () => {
  it('runs gate, commits in chunks, pushes, opens PR', async () => {
    const { brief, emitted, loaded } = await prepare();
    const state = newStubGitState();
    const r = await openPr({
      brief,
      emitted,
      repoPath: loaded.repoPath,
      branchName: loaded.branchName,
      commitScope: loaded.commitScope,
      git: stubGit(state),
      localGate: stubLocalGate({ passed: true }),
    });
    expect(r.prNumber).toBe(100);
    expect(state.committed).toHaveLength(4);
    expect(state.pushed).toEqual([loaded.branchName]);
    expect(r.localGate.passed).toBe(true);
  });

  it('skips empty file buckets in commits', async () => {
    const { brief, loaded } = await prepare();
    const emitted = {
      frontend: [{ path: 'a.tsx', contents: 'x', attribution: [] }],
      backend: [],
      database: [],
      tests: [],
    };
    const state = newStubGitState();
    await openPr({
      brief,
      emitted,
      repoPath: loaded.repoPath,
      branchName: loaded.branchName,
      commitScope: loaded.commitScope,
      git: stubGit(state),
      localGate: stubLocalGate({ passed: true }),
    });
    expect(state.committed).toHaveLength(1);
  });

  it('throws PrOpenerError when no files are emitted', async () => {
    const { brief, loaded } = await prepare();
    await expect(
      openPr({
        brief,
        emitted: { frontend: [], backend: [], database: [], tests: [] },
        repoPath: loaded.repoPath,
        branchName: loaded.branchName,
        commitScope: loaded.commitScope,
        git: stubGit(),
        localGate: stubLocalGate(),
      }),
    ).rejects.toMatchObject({ code: 'no-files-emitted' });
  });

  it('throws local-gate-failed when typecheck fails', async () => {
    const { brief, emitted, loaded } = await prepare();
    await expect(
      openPr({
        brief,
        emitted,
        repoPath: loaded.repoPath,
        branchName: loaded.branchName,
        commitScope: loaded.commitScope,
        git: stubGit(),
        localGate: stubLocalGate({ passed: false, output: 'typecheck error' }),
      }),
    ).rejects.toMatchObject({ code: 'local-gate-failed' });
  });

  it('honours skipLocalGate=true', async () => {
    const { brief, emitted, loaded } = await prepare();
    const r = await openPr({
      brief,
      emitted,
      repoPath: loaded.repoPath,
      branchName: loaded.branchName,
      commitScope: loaded.commitScope,
      git: stubGit(),
      localGate: stubLocalGate({ passed: false }),
      skipLocalGate: true,
    });
    expect(r.localGate.passed).toBe(true);
    expect(r.localGate.durationMs).toBe(0);
  });

  it('idempotent: returns existing PR when one is already open for the branch', async () => {
    const { brief, emitted, loaded } = await prepare();
    const state = newStubGitState();
    state.prs.push({
      prNumber: 555,
      prUrl: 'https://github.com/example/repo/pull/555',
      branchName: loaded.branchName,
      title: 'existing',
      body: 'body',
      base: 'develop',
    });
    const r = await openPr({
      brief,
      emitted,
      repoPath: loaded.repoPath,
      branchName: loaded.branchName,
      commitScope: loaded.commitScope,
      git: stubGit(state),
      localGate: stubLocalGate({ passed: true }),
    });
    expect(r.prNumber).toBe(555);
    expect(state.prs).toHaveLength(1);
  });

  it('defaults the PR base branch to develop', async () => {
    const { brief, emitted, loaded } = await prepare();
    const state = newStubGitState();
    await openPr({
      brief,
      emitted,
      repoPath: loaded.repoPath,
      branchName: loaded.branchName,
      commitScope: loaded.commitScope,
      git: stubGit(state),
      localGate: stubLocalGate({ passed: true }),
    });
    expect(state.prs[0]?.base).toBe('develop');
  });

  it('uses the provided prBaseBranch override', async () => {
    const { brief, emitted, loaded } = await prepare();
    const state = newStubGitState();
    await openPr({
      brief,
      emitted,
      repoPath: loaded.repoPath,
      branchName: loaded.branchName,
      commitScope: loaded.commitScope,
      git: stubGit(state),
      localGate: stubLocalGate({ passed: true }),
      prBaseBranch: 'main',
    });
    expect(state.prs[0]?.base).toBe('main');
  });

  it('wraps git failures in PrOpenerError(git-failure)', async () => {
    const { brief, emitted, loaded } = await prepare();
    const failingGit = stubGit(newStubGitState(), {
      async stageAndCommit() {
        throw new Error('git boom');
      },
    });
    await expect(
      openPr({
        brief,
        emitted,
        repoPath: loaded.repoPath,
        branchName: loaded.branchName,
        commitScope: loaded.commitScope,
        git: failingGit,
        localGate: stubLocalGate({ passed: true }),
      }),
    ).rejects.toMatchObject({ code: 'git-failure' });
  });
});

describe('composePrTitle / composePrBody / composeCommitMessage', () => {
  it('title cites scope, ticketId, and ticketTitle', async () => {
    const { brief } = await prepare();
    expect(composePrTitle('feat(scope)', brief)).toMatch(
      /feat\(scope\): implement TKT-DEFAULT — /,
    );
  });

  it('body has the canonical sections', async () => {
    const { brief, emitted } = await prepare();
    const body = composePrBody(
      brief,
      emitted,
      { passed: true, durationMs: 7, failures: [] },
      'sha-123',
    );
    expect(body).toContain('## Ticket');
    expect(body).toContain('## Acceptance criteria satisfied');
    expect(body).toContain('## Architects whose specs were implemented');
    expect(body).toContain('## File summary');
    expect(body).toContain('## Stack lock');
    expect(body).toContain('## Local gate');
    expect(body).toContain('## Test cases');
    expect(body).toContain('`sha-123`');
    expect(body).toContain('Stage 13');
    expect(body).toContain('Stage 14');
  });

  it('body checks off each acceptance criterion', async () => {
    const { brief, emitted } = await prepare();
    const body = composePrBody(
      brief,
      emitted,
      { passed: true, durationMs: 0, failures: [] },
      '',
    );
    for (const ac of brief.acceptanceCriteria) {
      expect(body).toContain(`- [x] ${ac}`);
    }
  });

  it('body lists architect attribution alphabetically', async () => {
    const { brief } = await prepare();
    const emitted = {
      frontend: [{ path: 'a', contents: 'x', attribution: ['frontend-architect'] }],
      backend: [{ path: 'b', contents: 'x', attribution: ['security-architect', 'backend-architect'] }],
      database: [],
      tests: [],
    };
    const body = composePrBody(
      brief,
      emitted,
      { passed: true, durationMs: 0, failures: [] },
      '',
    );
    const idxBackend = body.indexOf('- backend-architect');
    const idxFrontend = body.indexOf('- frontend-architect');
    const idxSecurity = body.indexOf('- security-architect');
    expect(idxBackend).toBeGreaterThan(-1);
    expect(idxFrontend).toBeGreaterThan(idxBackend);
    expect(idxSecurity).toBeGreaterThan(idxFrontend);
  });

  it('body shows local-gate failures when present', async () => {
    const { brief, emitted } = await prepare();
    const body = composePrBody(
      brief,
      emitted,
      {
        passed: false,
        durationMs: 7,
        failures: [{ gate: 'typecheck', output: 'TS2304: Cannot find name' }],
      },
      '',
    );
    expect(body).toContain('Status: failed');
    expect(body).toContain('`typecheck`');
    expect(body).toContain('TS2304');
  });

  it('commit message includes scope, kind, ticketId, and ticketTitle', async () => {
    const { brief } = await prepare();
    expect(composeCommitMessage('feat(test)', 'backend', brief)).toBe(
      'feat(test): backend — TKT-DEFAULT Test ticket',
    );
  });
});

describe('PrOpenerError', () => {
  it('preserves code + failures', () => {
    const e = new PrOpenerError('local-gate-failed', 'gate failed', [
      { gate: 'typecheck', output: 'x' },
    ]);
    expect(e.code).toBe('local-gate-failed');
    expect(e.failures).toHaveLength(1);
    expect(e.name).toBe('PrOpenerError');
  });
});
