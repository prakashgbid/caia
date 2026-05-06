import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultFsReader,
  defaultReportsDir,
  isEligibleMarkdown,
  pathToKind,
  pathToSlug
} from '../src/source-readers.js';

describe('isEligibleMarkdown', () => {
  it('accepts plain feedback markdowns', () => {
    expect(isEligibleMarkdown('feedback_pat_topic.md')).toBe(true);
  });
  it('accepts directive markdowns', () => {
    expect(isEligibleMarkdown('mentor_agent_directive.md')).toBe(true);
  });
  it('accepts handoff-style markdowns', () => {
    expect(isEligibleMarkdown('enterprise-wave-1-leg-1-handoff.md')).toBe(true);
  });
  it('rejects non-markdown files', () => {
    expect(isEligibleMarkdown('foo.txt')).toBe(false);
    expect(isEligibleMarkdown('foo.sqlite')).toBe(false);
  });
  it('rejects hidden files', () => {
    expect(isEligibleMarkdown('.DS_Store')).toBe(false);
    expect(isEligibleMarkdown('.foo.md')).toBe(false);
  });
  it('rejects backup files', () => {
    expect(isEligibleMarkdown('MEMORY.md.bak-2026-05-04')).toBe(false);
    expect(isEligibleMarkdown('foo.bak.md')).toBe(false);
  });
  it('rejects MEMORY.md', () => {
    expect(isEligibleMarkdown('MEMORY.md')).toBe(false);
  });
});

describe('pathToKind', () => {
  it('classifies directives by suffix', () => {
    expect(pathToKind('/m/mentor_agent_directive.md')).toBe('directive');
    expect(pathToKind('/m/curator_agent_directive.md')).toBe('directive');
  });
  it('classifies registries before directives (more specific wins)', () => {
    expect(pathToKind('/m/agent_contract_registry_directive.md')).toBe('registry');
    expect(pathToKind('/m/feature_registry_directive.md')).toBe('registry');
  });
  it('classifies architecture refs', () => {
    expect(pathToKind('/m/caia_architecture.md')).toBe('architecture');
    expect(pathToKind('/m/orchestrator_architecture.md')).toBe('architecture');
  });
  it('classifies team docs (caia_*, orchestrator_*) over architecture', () => {
    // architecture suffix takes precedence, but caia_agent_team is team
    expect(pathToKind('/m/caia_agent_team.md')).toBe('team');
    expect(pathToKind('/m/caia_platform_principle.md')).toBe('team');
  });
  it('classifies master sequencing', () => {
    expect(pathToKind('/m/master_backlog_sequencing_2026-05-05.md')).toBe('master');
    expect(pathToKind('/m/master_sequencing_2026-04-28.md')).toBe('master');
  });
  it('classifies landscape research', () => {
    expect(pathToKind('/m/enterprise_ai_landscape_directive.md')).toBe('landscape');
    expect(pathToKind('/m/mac_dev_landscape.md')).toBe('landscape');
  });
  it('classifies gate completion + evidence rules', () => {
    expect(pathToKind('/m/gate_completion_status_2026-04-28.md')).toBe('gate');
    expect(pathToKind('/m/evidence_gate_2026-04-29.md')).toBe('gate');
  });
  it('classifies feedback before directive', () => {
    expect(pathToKind('/m/feedback_no_token_budgets.md')).toBe('feedback');
  });
  it('classifies anything inside a proposals/ folder as proposal regardless of name', () => {
    expect(pathToKind('/m/proposals/20260505-foo.md')).toBe('proposal');
    expect(pathToKind('/m/proposals/feedback_unrelated.md')).toBe('proposal');
  });
  it('classifies anything inside a reports/ folder as report regardless of name', () => {
    expect(pathToKind('/Users/foo/reports/master-thing.md')).toBe('report');
    expect(pathToKind('/x/reports/principal-overnight.md')).toBe('report');
  });
  it('classifies daemon notes', () => {
    expect(pathToKind('/m/daemon_repoint_2026-04-30.md')).toBe('daemon');
  });
  it('classifies cci, mac, mcp, safety prefixes', () => {
    expect(pathToKind('/m/cci_workers.md')).toBe('cci');
    expect(pathToKind('/m/mac_dev_landscape.md')).toBe('landscape'); // landscape suffix wins
    expect(pathToKind('/m/mcp_security_threat_landscape_2026-04-29.md')).toBe('landscape');
    expect(pathToKind('/m/safety_hardening_2026-04-29.md')).toBe('safety');
  });
  it('classifies phase + backlog + consolidation', () => {
    expect(pathToKind('/m/phase2_completion_directive.md')).toBe('phase');
    expect(pathToKind('/m/backlog_continuous_self_improvement_research_2026-04-30.md')).toBe('backlog');
    expect(pathToKind('/m/consolidation_action_list_2026-04-28.md')).toBe('consolidation');
  });
  it('falls back to "other" for unclassifiable names', () => {
    expect(pathToKind('/m/random_thing.md')).toBe('other');
  });
});

describe('pathToSlug', () => {
  it('strips path + extension + lowercases', () => {
    expect(pathToSlug('/x/y/Feedback_PAT_Topic.md')).toBe('feedback_pat_topic');
  });
  it('collapses non-alnum to dashes', () => {
    expect(pathToSlug('/x/y/foo bar baz!.md')).toBe('foo-bar-baz-');
  });
  it('handles paths with no slash', () => {
    expect(pathToSlug('plain.md')).toBe('plain');
  });
});

describe('defaultReportsDir', () => {
  it('returns a path under the home dir', () => {
    expect(defaultReportsDir()).toMatch(/Documents.projects.reports$/);
  });
});

describe('defaultFsReader.readDir', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'librarian-fs-test-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns empty for a non-existent memoryDir', () => {
    const out = defaultFsReader.readDir({ memoryDir: join(tmpRoot, 'missing') });
    expect(out).toEqual([]);
  });

  it('walks memoryDir + proposals subfolder + reports', () => {
    const memoryDir = join(tmpRoot, 'memory');
    const proposalsDir = join(memoryDir, 'proposals');
    const reportsDir = join(tmpRoot, 'reports');
    mkdirSync(memoryDir, { recursive: true });
    mkdirSync(proposalsDir, { recursive: true });
    mkdirSync(reportsDir, { recursive: true });

    writeFileSync(join(memoryDir, 'feedback_x.md'), 'feedback x');
    writeFileSync(join(memoryDir, 'mentor_agent_directive.md'), 'mentor');
    writeFileSync(join(memoryDir, 'master_thing.md'), 'master');
    writeFileSync(join(memoryDir, 'MEMORY.md'), 'meta'); // excluded
    writeFileSync(join(memoryDir, 'feedback_x.md.bak-1'), 'bak'); // excluded
    writeFileSync(join(memoryDir, 'random.txt'), 'no md'); // excluded

    writeFileSync(join(proposalsDir, '20260505-foo.md'), 'proposal');
    writeFileSync(join(proposalsDir, '.hidden.md'), 'hidden'); // excluded

    writeFileSync(join(reportsDir, 'leg-1-handoff.md'), 'report');

    const out = defaultFsReader.readDir({ memoryDir, reportsDir });
    const names = out.map((s) => s.path.split('/').pop()).sort();
    expect(names).toEqual([
      '20260505-foo.md',
      'feedback_x.md',
      'leg-1-handoff.md',
      'master_thing.md',
      'mentor_agent_directive.md'
    ]);

    const kindByName: Record<string, string> = {};
    for (const s of out) kindByName[s.path.split('/').pop() ?? ''] = s.kind;
    expect(kindByName['feedback_x.md']).toBe('feedback');
    expect(kindByName['mentor_agent_directive.md']).toBe('directive');
    expect(kindByName['master_thing.md']).toBe('master');
    expect(kindByName['20260505-foo.md']).toBe('proposal');
    expect(kindByName['leg-1-handoff.md']).toBe('report');
  });

  it('skips reports gracefully when reportsDir is undefined', () => {
    const memoryDir = join(tmpRoot, 'memory');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, 'feedback_x.md'), 'feedback x');
    const out = defaultFsReader.readDir({ memoryDir });
    expect(out.length).toBe(1);
    expect(out[0]?.kind).toBe('feedback');
  });

  it('skips reports gracefully when reportsDir does not exist', () => {
    const memoryDir = join(tmpRoot, 'memory');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, 'feedback_x.md'), 'feedback x');
    const out = defaultFsReader.readDir({
      memoryDir,
      reportsDir: join(tmpRoot, 'nonexistent')
    });
    expect(out.length).toBe(1);
  });

  it('emits sources sorted by absolute path', () => {
    const memoryDir = join(tmpRoot, 'memory');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, 'zzz_directive.md'), 'z');
    writeFileSync(join(memoryDir, 'aaa_directive.md'), 'a');
    writeFileSync(join(memoryDir, 'mmm_directive.md'), 'm');
    const out = defaultFsReader.readDir({ memoryDir });
    const names = out.map((s) => s.path.split('/').pop());
    expect(names).toEqual(['aaa_directive.md', 'mmm_directive.md', 'zzz_directive.md']);
  });
});
