import { describe, expect, it } from 'vitest';

import { InMemoryFsAdapter } from '../src/fs-adapter.js';
import {
  extractAdrIds,
  loadRepository,
  selectRelevantContext,
  tokenise
} from '../src/repository-loader.js';

import {
  AGENT_MEMORY_ROOT,
  REPO_ROOT,
  sampleRepoFiles
} from './fixtures/sample-repository.js';

describe('repository-loader', () => {
  it('tokenise: splits into lowercase keywords and drops stopwords', () => {
    const tokens = tokenise('We will use shadcn for the UI components.');
    expect(tokens).toContain('shadcn');
    expect(tokens).toContain('components');
    expect(tokens).not.toContain('we');
    expect(tokens).not.toContain('the');
  });

  it('tokenise: drops short tokens and hyphenated tokens are kept', () => {
    const tokens = tokenise('A multi-tenant secrets-broker is X.');
    expect(tokens).toContain('multi-tenant');
    expect(tokens).toContain('secrets-broker');
    expect(tokens).not.toContain('a');
    expect(tokens).not.toContain('x');
  });

  it('extractAdrIds: finds ADR-NNN references', () => {
    const ids = extractAdrIds('Per ADR-015 and ADR-040 we will...');
    expect(ids).toEqual(['ADR-015', 'ADR-040']);
  });

  it('extractAdrIds: deduplicates', () => {
    const ids = extractAdrIds('ADR-001 then ADR-001 again');
    expect(ids).toEqual(['ADR-001']);
  });

  it('loadRepository: finds all ADRs and computes maxAdrId', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    expect(repo.adrs.length).toBe(7);
    expect(repo.maxAdrId).toBe(61);
  });

  it('loadRepository: parses ADR titles correctly', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    const adr15 = repo.adrs.find((a) => a.adrId === 'ADR-015');
    expect(adr15).toBeDefined();
    expect(adr15?.title).toBe('Create @caia/ea-architect for plan approval');
    expect(adr15?.status).toBe('Accepted');
  });

  it('loadRepository: parses affected-components list', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    const adr15 = repo.adrs.find((a) => a.adrId === 'ADR-015');
    expect(adr15?.affectedComponents).toContain('@caia/ea-architect');
    expect(adr15?.affectedComponents).toContain('@caia/state-machine');
  });

  it('loadRepository: parses 5 principles from the fixture', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    expect(repo.principles.length).toBe(5);
    const ids = repo.principles.map((p) => p.id).sort();
    expect(ids).toEqual(['P1', 'P2', 'P3', 'P4', 'P9']);
  });

  it('loadRepository: principle titles parsed correctly', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    const p1 = repo.principles.find((p) => p.id === 'P1');
    expect(p1?.title).toContain('Subscription-only');
  });

  it('loadRepository: finds all lessons-learned files', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    expect(repo.lessons.length).toBe(2);
    expect(repo.lessons.map((l) => l.id)).toContain('01-pixel-perfect-calibration');
    expect(repo.lessons.map((l) => l.id)).toContain('04-local-ai-stack-teardown');
  });

  it('loadRepository: parses risk register sections', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    expect(repo.risks.length).toBeGreaterThanOrEqual(3);
    const cats = repo.risks.map((r) => r.category);
    expect(cats).toContain('Security');
    expect(cats).toContain('Vendor lock-in');
  });

  it('loadRepository: loads all 7 feedback memory files', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    expect(repo.feedback.length).toBe(7);
    const ids = repo.feedback.map((f) => f.id);
    expect(ids).toContain('feedback-no-timelines');
    expect(ids).toContain('feedback-ea-agent-gates-research');
    expect(ids).toContain('feedback-caia-build-uses-pro-subscription-only');
    expect(ids).toContain('project-caia-shadcn-react-first-locked');
  });

  it('loadRepository: handles missing principles file gracefully', () => {
    const files = sampleRepoFiles();
    delete files[`${REPO_ROOT}/principles/00-architecture-principles.md`];
    const fs = new InMemoryFsAdapter(files);
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    expect(repo.principles).toEqual([]);
  });

  it('loadRepository: ignores non-ADR files in decisions dir', () => {
    const files = sampleRepoFiles();
    files[`${REPO_ROOT}/decisions/README.md`] = '# not an ADR';
    files[`${REPO_ROOT}/decisions/INDEX.md`] = '# index';
    const fs = new InMemoryFsAdapter(files);
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    expect(repo.adrs.length).toBe(7);
  });

  it('selectRelevantContext: returns ALL principles regardless of query', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    const ctx = selectRelevantContext(repo, 'unrelated nonsense query xyzzy', []);
    expect(ctx.principles.length).toBe(5);
  });

  it('selectRelevantContext: ranks ADRs by keyword overlap', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    const ctx = selectRelevantContext(repo, 'subscription claude binary', []);
    expect(ctx.adrs.length).toBeGreaterThan(0);
    const topId = ctx.adrs[0]?.item.adrId;
    expect(topId).toBe('ADR-001');
  });

  it('selectRelevantContext: force-includes cited ADRs even if not keyword-matched', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    // Query has nothing to do with ADR-060/061 but mentions them.
    const ctx = selectRelevantContext(repo, 'Per ADR-061 we keep going.', []);
    const ids = ctx.adrs.map((m) => m.item.adrId);
    expect(ids).toContain('ADR-061');
  });

  it('selectRelevantContext: returns all 7 feedback memories', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    const ctx = selectRelevantContext(repo, 'any query', []);
    expect(ctx.feedback.length).toBe(7);
  });

  it('selectRelevantContext: lessons surface on tag overlap', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    const ctx = selectRelevantContext(repo, 'local ollama teardown', []);
    expect(ctx.lessons.length).toBeGreaterThan(0);
    expect(ctx.lessons[0]?.item.id).toBe('04-local-ai-stack-teardown');
  });
});
