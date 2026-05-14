import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import {
  classifyMemoryFile,
  createMemoryWalker,
  isEligibleMarkdown,
  parseMarkdown
} from '../src/memory-walker.js';
import { defaultFsReader } from '../src/fs-reader.js';

const FIXTURE_DIR = join(__dirname, '__fixtures__', 'mini-memory');

describe('classifyMemoryFile', () => {
  it.each([
    ['feedback_no_caffeine.md', 'feedback'],
    ['test_directive.md', 'directive'],
    ['some_registry_directive.md', 'directive'],
    ['agent_contract_registry.md', 'registry'],
    ['caia_architecture.md', 'architecture'],
    ['master_backlog.md', 'master'],
    ['enterprise_landscape.md', 'landscape'],
    ['gate_completion.md', 'gate'],
    ['evidence_gate.md', 'gate'],
    ['safety_hardening.md', 'safety'],
    ['phase2-stuff.md', 'phase'],
    ['caia_agent_team.md', 'team'],
    ['orchestrator_handoff.md', 'team'],
    ['backlog_research.md', 'backlog'],
    ['random_note.md', 'other'],
    // APP.1 — directive prefixes for operator-voice handoff/landing records.
    ['_phase4_handoff_2026-05-12.md', 'directive'],
    ['_phase1_design.md', 'directive'],
    ['apprentice_phase1_leg2_reconciliation_2026-05-09.md', 'directive'],
    ['apprentice_phase_2_design_2026-05-08.md', 'directive'],
    ['b15_phase1_landed_2026-05-11.md', 'directive'],
    ['b15_phase2_landed_2026-05-11.md', 'directive'],
    ['t25_p6_lora_deploy_eval_2026-05-13.md', 'directive'],
    ['r_001_some_note.md', 'directive']
  ])('classifies %s as %s', (basename, kind) => {
    expect(classifyMemoryFile(basename)).toBe(kind);
  });
});

describe('isEligibleMarkdown', () => {
  it('accepts plain markdown filenames', () => {
    expect(isEligibleMarkdown('feedback_x.md')).toBe(true);
  });
  it('rejects non-markdown', () => {
    expect(isEligibleMarkdown('feedback_x.txt')).toBe(false);
  });
  it('rejects hidden files', () => {
    expect(isEligibleMarkdown('.hidden.md')).toBe(false);
  });
  it('rejects backup files', () => {
    expect(isEligibleMarkdown('MEMORY.md.bak-2026-05-04')).toBe(false);
  });
  it('rejects MEMORY.md', () => {
    expect(isEligibleMarkdown('MEMORY.md')).toBe(false);
  });
});

describe('parseMarkdown', () => {
  it('strips simple frontmatter', () => {
    const raw = '---\nname: x\ntype: feedback\n---\n# Body\nhello';
    const r = parseMarkdown(raw);
    expect(r.frontmatter).toEqual({ name: 'x', type: 'feedback' });
    expect(r.body.startsWith('# Body')).toBe(true);
  });
  it('returns full input when no frontmatter', () => {
    const raw = '# Just a heading\nbody';
    const r = parseMarkdown(raw);
    expect(r.frontmatter).toEqual({});
    expect(r.body).toBe(raw);
  });
  it('tolerates malformed frontmatter (no closing ---)', () => {
    const raw = '---\nname: x\nbody continues';
    const r = parseMarkdown(raw);
    expect(r.body).toBe(raw);
  });
});

describe('createMemoryWalker — against real fixture dir', () => {
  it('reads both fixture files and skips MEMORY.md', async () => {
    const walker = createMemoryWalker({
      memoryRoot: FIXTURE_DIR,
      fs: defaultFsReader
    });
    const ctx = { maxAgeDays: 365 * 100, nowMs: Date.now() };
    const artifacts = await walker.read(ctx);
    expect(artifacts.length).toBe(2);
    const kinds = artifacts.map((a) => a.kind).sort();
    expect(kinds).toEqual(['directive', 'feedback']);
    // MEMORY.md must NOT appear
    expect(artifacts.find((a) => a.sourceId.endsWith('MEMORY.md'))).toBeUndefined();
  });

  it('returns deterministically sorted output', async () => {
    const walker = createMemoryWalker({
      memoryRoot: FIXTURE_DIR,
      fs: defaultFsReader
    });
    const ctx = { maxAgeDays: 365 * 100, nowMs: Date.now() };
    const a = await walker.read(ctx);
    const b = await walker.read(ctx);
    expect(a.map((x) => x.sourceId)).toEqual(b.map((x) => x.sourceId));
  });

  it('returns empty list for non-existent root', async () => {
    const walker = createMemoryWalker({
      memoryRoot: '/nonexistent-dir-12345-fixture',
      fs: defaultFsReader
    });
    const ctx = { maxAgeDays: 365, nowMs: Date.now() };
    const artifacts = await walker.read(ctx);
    expect(artifacts).toEqual([]);
  });
});
