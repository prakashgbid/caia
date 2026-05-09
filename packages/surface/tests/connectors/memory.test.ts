import { describe, it, expect } from 'vitest';

import { createMemoryConnector, parseGitLog } from '../../src/connectors/memory.js';
import { FakeFs } from '../__fixtures__/fs.js';
import { FakeGit } from '../__fixtures__/runners.js';

const NOW = '2026-05-09T12:00:00.000Z';
const SINCE = '2026-05-08T12:00:00.000Z';

describe('memory connector', () => {
  it('parses git log --name-status output', () => {
    const stdout = [
      '--abc--2026-05-09T01:00:00+00:00--',
      'A\tagent-memory/feedback_new.md',
      'M\tagent-memory/MEMORY.md',
      '--def--2026-05-09T02:00:00+00:00--',
      'M\tagent-memory/feedback_new.md'
    ].join('\n');
    const commits = parseGitLog(stdout);
    expect(commits.length).toBe(2);
    expect(commits[0]?.changes.length).toBe(2);
    expect(commits[1]?.changes.length).toBe(1);
  });

  it('emits findings via git log when repo exists', async () => {
    const fs = new FakeFs().addDir('/repo').addDir('/repo/agent-memory');
    const git = new FakeGit().on('/repo/agent-memory', _ => true, [
      '--abc--2026-05-09T03:00:00+00:00--',
      'A\tagent-memory/feedback_new_2026-05-09.md',
      'M\tagent-memory/MEMORY.md'
    ].join('\n'));

    const c = createMemoryConnector({
      corpusRoot: '/repo/agent-memory',
      memoryGitRepo: '/repo/agent-memory',
      fs,
      git
    });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.findings.length).toBe(2);
    const added = r.findings.find(f => f.kind === 'memory-added');
    expect(added?.tags).toContain('feedback');
    const updated = r.findings.find(f => f.key === 'agent-memory/MEMORY.md');
    expect(updated?.kind).toBe('memory-updated');
    expect(updated?.tags).toContain('index');
  });

  it('falls back to filesystem walk when git fails', async () => {
    const fs = new FakeFs()
      .addDir('/cm')
      .addFile('/cm/feedback_x.md', 'body', '2026-05-09T05:00:00.000Z')
      .addFile('/cm/old.md', 'body', '2026-04-01T00:00:00.000Z');
    const git = new FakeGit().on('/cm', _ => true, new Error('not a git repo'));
    const c = createMemoryConnector({
      corpusRoot: '/cm',
      memoryGitRepo: '/cm',
      fs,
      git
    });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.warnings.some(w => w.includes('memory-git'))).toBe(true);
    const f = r.findings.find(x => x.key === 'feedback_x.md');
    expect(f).toBeDefined();
    expect(f?.tags).toContain('feedback');
    expect(r.findings.find(x => x.key === 'old.md')).toBeUndefined();
  });

  it('returns warning + empty when corpusRoot missing entirely', async () => {
    const fs = new FakeFs(); // empty
    const git = new FakeGit().on('/missing', _ => true, new Error('no repo'));
    const c = createMemoryConnector({
      corpusRoot: '/missing',
      memoryGitRepo: '/missing',
      fs,
      git
    });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.findings.length).toBe(0);
    expect(r.warnings.length).toBeGreaterThanOrEqual(1);
  });

  it('latest-status-wins when same file appears in multiple commits', async () => {
    const fs = new FakeFs().addDir('/repo');
    const git = new FakeGit().on('/repo', _ => true, [
      '--c1--2026-05-09T01:00:00+00:00--',
      'A\tfile.md',
      '--c2--2026-05-09T02:00:00+00:00--',
      'M\tfile.md'
    ].join('\n'));
    const c = createMemoryConnector({ corpusRoot: '/repo', memoryGitRepo: '/repo', fs, git });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.findings.length).toBe(1);
    expect(r.findings[0]?.kind).toBe('memory-updated');
  });

  it('tags directives, completes, lives, etc.', async () => {
    const fs = new FakeFs().addDir('/r');
    const git = new FakeGit().on('/r', _ => true, [
      '--c--2026-05-09T01:00:00+00:00--',
      'A\tagent-memory/curator_agent_directive.md',
      'A\tagent-memory/apprentice_phase1_complete_2026-05-09.md',
      'A\tagent-memory/slot_manager_phase0_live_2026-05-08.md',
      'A\tagent-memory/stolution_data_architecture.md'
    ].join('\n'));
    const c = createMemoryConnector({ corpusRoot: '/r', memoryGitRepo: '/r', fs, git });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    const directiveTag = r.findings.find(f => f.key.endsWith('curator_agent_directive.md'));
    const completeTag = r.findings.find(f => f.key.endsWith('apprentice_phase1_complete_2026-05-09.md'));
    const liveTag = r.findings.find(f => f.key.endsWith('slot_manager_phase0_live_2026-05-08.md'));
    const stolutionTag = r.findings.find(f => f.key.endsWith('stolution_data_architecture.md'));
    expect(directiveTag?.tags).toContain('directive');
    expect(completeTag?.tags).toContain('complete');
    expect(liveTag?.tags).toContain('live');
    expect(stolutionTag?.tags).toContain('stolution');
  });

  it('returns empty findings when git log returns nothing', async () => {
    const fs = new FakeFs().addDir('/r');
    const git = new FakeGit().on('/r', _ => true, '');
    const c = createMemoryConnector({ corpusRoot: '/r', memoryGitRepo: '/r', fs, git });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.findings.length).toBe(0);
    expect(r.warnings.length).toBe(0);
  });

  it('finding ids are deterministic', async () => {
    const fs = new FakeFs().addDir('/r');
    const stdout = [
      '--c--2026-05-09T01:00:00+00:00--',
      'A\tx.md'
    ].join('\n');
    const c1 = createMemoryConnector({
      corpusRoot: '/r', memoryGitRepo: '/r', fs,
      git: new FakeGit().on('/r', _ => true, stdout)
    });
    const c2 = createMemoryConnector({
      corpusRoot: '/r', memoryGitRepo: '/r', fs,
      git: new FakeGit().on('/r', _ => true, stdout)
    });
    const r1 = await c1.collect({ sinceIso: SINCE, untilIso: NOW });
    const r2 = await c2.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r1.findings.map(f => f.id)).toEqual(r2.findings.map(f => f.id));
  });

  it('respects time window via mtime fallback', async () => {
    const fs = new FakeFs()
      .addDir('/r')
      .addFile('/r/in.md', 'b', '2026-05-09T01:00:00.000Z')
      .addFile('/r/out.md', 'b', '2026-05-07T01:00:00.000Z');
    const git = new FakeGit().on('/r', _ => true, new Error('fail'));
    const c = createMemoryConnector({ corpusRoot: '/r', memoryGitRepo: '/r', fs, git });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.findings.find(f => f.key === 'in.md')).toBeDefined();
    expect(r.findings.find(f => f.key === 'out.md')).toBeUndefined();
  });

  it('parseGitLog tolerates malformed lines', () => {
    const stdout = [
      'no-marker-here',
      '--bad',
      '--abc--2026-05-09T01:00:00+00:00--',
      'malformed',
      'A\tgood.md'
    ].join('\n');
    const commits = parseGitLog(stdout);
    expect(commits.length).toBe(1);
    expect(commits[0]?.changes.length).toBe(1);
  });
});
