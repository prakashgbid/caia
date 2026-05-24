import { describe, expect, it } from 'vitest';

import {
  applySupersessions,
  formatAdrId,
  patchSupersededBy,
  renderAdrMarkdown,
  slugifyTitle,
  updateDecisionsIndex,
  writeNewAdr
} from '../src/adr-writer.js';
import { InMemoryFsAdapter } from '../src/fs-adapter.js';
import { loadRepository } from '../src/repository-loader.js';
import type { NewAdrDraft } from '../src/types.js';

import {
  AGENT_MEMORY_ROOT,
  REPO_ROOT,
  sampleRepoFiles
} from './fixtures/sample-repository.js';

const SAMPLE_DRAFT: NewAdrDraft = {
  title: 'Adopt event bus emission for EA review transitions',
  status: 'Accepted',
  context: 'EA Architect Agent needs to emit transitions.',
  decision: 'Emit dot-namespaced events on every transition.',
  consequences: 'Positive: dashboard visibility. Negative: small overhead.',
  affectedComponents: ['@caia/ea-architect'],
  reversibility: 'Reversible',
  decisionMakers: 'EA Architect Agent'
};

describe('adr-writer', () => {
  it('slugifyTitle: kebab-cases and strips em-dashes', () => {
    expect(slugifyTitle('EA Architect — review pipeline')).toBe('ea-architect-review-pipeline');
  });

  it('slugifyTitle: collapses multiple separators', () => {
    expect(slugifyTitle('  foo!! bar?  baz  ')).toBe('foo-bar-baz');
  });

  it('formatAdrId: zero-pads to 3 digits', () => {
    expect(formatAdrId(7)).toBe('ADR-007');
    expect(formatAdrId(62)).toBe('ADR-062');
    expect(formatAdrId(123)).toBe('ADR-123');
  });

  it('renderAdrMarkdown: includes header fields and body sections', () => {
    const body = renderAdrMarkdown(62, SAMPLE_DRAFT, new Date('2026-05-23T00:00:00Z'));
    expect(body).toContain('# ADR-062');
    expect(body).toContain('- **Status:** Accepted');
    expect(body).toContain('- **Date:** 2026-05-23');
    expect(body).toContain('- **Affected-components:** @caia/ea-architect');
    expect(body).toContain('## Context');
    expect(body).toContain('## Decision');
    expect(body).toContain('## Consequences');
    expect(body).toContain('EA Architect Agent needs to emit transitions.');
  });

  it('renderAdrMarkdown: handles missing optional fields with defaults', () => {
    const minimal: NewAdrDraft = {
      title: 'Minimal',
      status: 'Accepted',
      context: '',
      decision: 'do X',
      consequences: ''
    };
    const body = renderAdrMarkdown(99, minimal, new Date('2026-05-23T00:00:00Z'));
    expect(body).toContain('- **Reversibility:** Reversible');
    expect(body).toContain('- **Supersedes:** none');
    expect(body).toContain('- **Affected-components:** (none specified)');
  });

  it('writeNewAdr: writes file at next id and slug', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    expect(repo.maxAdrId).toBe(61);
    const result = writeNewAdr(repo, SAMPLE_DRAFT, new Date('2026-05-23T00:00:00Z'), fs);
    expect(result.adrId).toBe('ADR-062');
    expect(result.filePath).toBe(
      `${REPO_ROOT}/decisions/ADR-062-adopt-event-bus-emission-for-ea-review-transitions.md`
    );
    expect(fs.has(result.filePath)).toBe(true);
    expect(repo.maxAdrId).toBe(62);
  });

  it('writeNewAdr: subsequent writes increment monotonically', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    const r1 = writeNewAdr(repo, SAMPLE_DRAFT, new Date('2026-05-23T00:00:00Z'), fs);
    const r2 = writeNewAdr(
      repo,
      { ...SAMPLE_DRAFT, title: 'Second decision' },
      new Date('2026-05-23T00:00:00Z'),
      fs
    );
    expect(r1.adrId).toBe('ADR-062');
    expect(r2.adrId).toBe('ADR-063');
  });

  it('writeNewAdr: forceId override works for deterministic tests', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    const result = writeNewAdr(repo, SAMPLE_DRAFT, new Date('2026-05-23T00:00:00Z'), fs, 200);
    expect(result.adrId).toBe('ADR-200');
  });

  it('patchSupersededBy: updates "none" to the new ADR id', () => {
    const body = `- **Supersedes:** ADR-060\n- **Superseded-by:** none\n\n## Context\n`;
    const patched = patchSupersededBy(body, 'ADR-062');
    expect(patched).toContain('- **Superseded-by:** ADR-062');
  });

  it('patchSupersededBy: idempotent if already pointing at the new id', () => {
    const body = `- **Superseded-by:** ADR-062\n`;
    const patched = patchSupersededBy(body, 'ADR-062');
    expect(patched).toBe(body);
  });

  it('patchSupersededBy: appends to existing list if multi-supersede', () => {
    const body = `- **Superseded-by:** ADR-099\n`;
    const patched = patchSupersededBy(body, 'ADR-100');
    expect(patched).toContain('ADR-099, ADR-100');
  });

  it('patchSupersededBy: fallback footer when no field exists', () => {
    const body = `# ADR-001\n\nbody only\n`;
    const patched = patchSupersededBy(body, 'ADR-200');
    expect(patched).toContain('**Superseded by ADR-200**');
  });

  it('applySupersessions: marks the existing ADR superseded-by the new one', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    const newAdr = { adrId: 'ADR-062' };
    const adr009Path = `${REPO_ROOT}/decisions/ADR-009-bypass-cd-direct-build-for-caia-dashboard.md`;
    expect(fs.readFile(adr009Path)).not.toContain('ADR-062');
    const out = applySupersessions(
      fs,
      repo,
      [{ adrId: 'ADR-009', action: 'supersede' }],
      [newAdr]
    );
    expect(out).toEqual([{ adrId: 'ADR-009', supersededBy: 'ADR-062' }]);
    expect(fs.readFile(adr009Path)).toContain('ADR-062');
  });

  it('applySupersessions: ignores amend actions', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    const out = applySupersessions(
      fs,
      repo,
      [{ adrId: 'ADR-009', action: 'amend' }],
      [{ adrId: 'ADR-062' }]
    );
    expect(out).toEqual([]);
  });

  it('updateDecisionsIndex: creates INDEX.md when missing', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    updateDecisionsIndex(fs, repo, [
      { adrId: 'ADR-062', title: 'Test', filePath: `${REPO_ROOT}/decisions/ADR-062-test.md` }
    ]);
    const indexPath = `${REPO_ROOT}/decisions/INDEX.md`;
    expect(fs.has(indexPath)).toBe(true);
    expect(fs.readFile(indexPath)).toContain('ADR-062');
    expect(fs.readFile(indexPath)).toContain('| ADR | Title | Status |');
  });

  it('updateDecisionsIndex: appends new rows to an existing file', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    updateDecisionsIndex(fs, repo, [
      { adrId: 'ADR-062', title: 'First', filePath: `${REPO_ROOT}/decisions/ADR-062-first.md` }
    ]);
    updateDecisionsIndex(fs, repo, [
      { adrId: 'ADR-063', title: 'Second', filePath: `${REPO_ROOT}/decisions/ADR-063-second.md` }
    ]);
    const body = fs.readFile(`${REPO_ROOT}/decisions/INDEX.md`);
    expect(body).toContain('ADR-062');
    expect(body).toContain('ADR-063');
  });

  it('updateDecisionsIndex: does not duplicate the same ADR row on re-call', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    updateDecisionsIndex(fs, repo, [
      { adrId: 'ADR-062', title: 'First', filePath: `${REPO_ROOT}/decisions/ADR-062-first.md` }
    ]);
    updateDecisionsIndex(fs, repo, [
      { adrId: 'ADR-062', title: 'First', filePath: `${REPO_ROOT}/decisions/ADR-062-first.md` }
    ]);
    const body = fs.readFile(`${REPO_ROOT}/decisions/INDEX.md`);
    // The "| [ADR-062](" row anchor appears at most once.
    const rowOccurrences = body.split('| [ADR-062](').length - 1;
    expect(rowOccurrences).toBe(1);
  });
});
