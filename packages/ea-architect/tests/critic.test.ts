import { describe, expect, it } from 'vitest';

import {
  applyHallucinationGuard,
  buildCriticPrompt,
  EA_ARCHITECT_SYSTEM_PROMPT,
  parseCriticOutput
} from '../src/critic.js';
import { InMemoryFsAdapter } from '../src/fs-adapter.js';
import { loadRepository, selectRelevantContext } from '../src/repository-loader.js';
import type { CriticOutput } from '../src/types.js';

import { AGENT_MEMORY_ROOT, REPO_ROOT, sampleRepoFiles } from './fixtures/sample-repository.js';

describe('buildCriticPrompt', () => {
  function makeInput() {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    const context = selectRelevantContext(repo, 'subscription claude', []);
    return {
      planMarkdown: '## Plan\n\nWe will route Claude via spawner.',
      planType: 'spec' as const,
      affectedComponents: ['@caia/x'],
      context,
      iteration: 1,
      modelTier: 'sonnet' as const
    };
  }

  it('includes the system prompt header', () => {
    const prompt = buildCriticPrompt(makeInput());
    expect(prompt).toContain('EA Architect Agent');
    expect(prompt).toContain('CRITICAL: never approve');
  });

  it('includes Architecture Principles section', () => {
    const prompt = buildCriticPrompt(makeInput());
    expect(prompt).toContain('### Architecture Principles');
    expect(prompt).toContain('P1');
  });

  it('includes Relevant ADRs section', () => {
    const prompt = buildCriticPrompt(makeInput());
    expect(prompt).toContain('### Relevant ADRs');
  });

  it('includes Operator Feedback Memories section', () => {
    const prompt = buildCriticPrompt(makeInput());
    expect(prompt).toContain('### Operator Feedback Memories');
  });

  it('includes the plan markdown verbatim', () => {
    const prompt = buildCriticPrompt(makeInput());
    expect(prompt).toContain('We will route Claude via spawner.');
  });

  it('includes the affected components', () => {
    const prompt = buildCriticPrompt(makeInput());
    expect(prompt).toContain('@caia/x');
  });

  it('includes iteration counter', () => {
    const prompt = buildCriticPrompt({ ...makeInput(), iteration: 3 });
    expect(prompt).toContain('iteration 3');
  });

  it('system prompt declares strict JSON output requirement', () => {
    expect(EA_ARCHITECT_SYSTEM_PROMPT).toContain('OUTPUT STRICT JSON');
  });
});

describe('parseCriticOutput', () => {
  it('parses a clean JSON envelope', () => {
    const raw = JSON.stringify({
      status: 'approved',
      reasoning: 'looks good',
      cited_adrs: ['ADR-001'],
      cited_principles: ['P1'],
      cited_lessons: [],
      requested_modifications: [],
      new_adrs_to_file: [],
      affected_existing_adrs: []
    });
    const out = parseCriticOutput(raw);
    expect(out.ok).toBe(true);
    expect(out.status).toBe('approved');
    expect(out.cited_adrs).toEqual(['ADR-001']);
  });

  it('parses JSON wrapped in a markdown code fence', () => {
    const raw =
      '```json\n' +
      JSON.stringify({ status: 'rejected', reasoning: 'no' }) +
      '\n```';
    const out = parseCriticOutput(raw);
    expect(out.status).toBe('rejected');
  });

  it('parses JSON inside a claude --output-format json envelope', () => {
    const inner = JSON.stringify({
      status: 'approved-with-modifications',
      reasoning: 'fix X',
      cited_adrs: ['ADR-009'],
      cited_principles: [],
      cited_lessons: [],
      requested_modifications: ['drop the timeline section'],
      new_adrs_to_file: [],
      affected_existing_adrs: []
    });
    const envelope = JSON.stringify({ type: 'result', result: inner });
    const out = parseCriticOutput(envelope);
    expect(out.status).toBe('approved-with-modifications');
    expect(out.requested_modifications).toEqual(['drop the timeline section']);
  });

  it('handles malformed JSON gracefully (returns ok=false)', () => {
    const out = parseCriticOutput('not json at all');
    expect(out.ok).toBe(false);
    expect(out.status).toBe('rejected');
  });

  it('normalises unknown status to needs-clarification', () => {
    const raw = JSON.stringify({ status: 'maybe', reasoning: 'unclear' });
    const out = parseCriticOutput(raw);
    expect(out.status).toBe('needs-clarification');
  });

  it('strips invalid new_adrs entries (missing title)', () => {
    const raw = JSON.stringify({
      status: 'approved',
      reasoning: 'ok',
      new_adrs_to_file: [
        { title: 'Valid one', context: 'c', decision: 'd', consequences: 'e' },
        { context: 'no title' }
      ]
    });
    const out = parseCriticOutput(raw);
    expect(out.new_adrs_to_file.length).toBe(1);
    expect(out.new_adrs_to_file[0]?.title).toBe('Valid one');
  });

  it('parses escalation_to_operator block', () => {
    const raw = JSON.stringify({
      status: 'approved',
      reasoning: 'pivot',
      escalation_to_operator: {
        reason: 'product direction',
        decisionPoint: 'pivot?',
        recommendation: 'no',
        category: 'product-pivot'
      }
    });
    const out = parseCriticOutput(raw);
    expect(out.escalation_to_operator?.category).toBe('product-pivot');
    expect(out.escalation_to_operator?.recommendation).toBe('no');
  });
});

describe('applyHallucinationGuard', () => {
  function makeOutput(overrides: Partial<CriticOutput> = {}): CriticOutput {
    return {
      status: 'approved',
      reasoning: '',
      cited_adrs: ['ADR-001', 'ADR-999'],
      cited_principles: ['P1', 'P99'],
      cited_lessons: ['01-pixel-perfect-calibration', 'bogus-lesson'],
      requested_modifications: [],
      new_adrs_to_file: [],
      affected_existing_adrs: [
        { adrId: 'ADR-001', action: 'amend' },
        { adrId: 'ADR-999', action: 'supersede' }
      ],
      ok: true,
      ...overrides
    };
  }

  it('drops cited ADRs that do not exist', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    const context = selectRelevantContext(repo, 'x', []);
    const knownAdr = new Set(repo.adrs.map((a) => a.adrId));
    const knownPrinc = new Set(repo.principles.map((p) => p.id));
    const knownLesson = new Set(repo.lessons.map((l) => l.id));
    const guarded = applyHallucinationGuard(
      makeOutput(),
      context,
      knownAdr,
      knownPrinc,
      knownLesson
    );
    expect(guarded.cited_adrs).toEqual(['ADR-001']);
    expect(guarded.cited_principles).toEqual(['P1']);
    expect(guarded.cited_lessons).toEqual(['01-pixel-perfect-calibration']);
    expect(guarded.affected_existing_adrs.length).toBe(1);
    expect(guarded.affected_existing_adrs[0]?.adrId).toBe('ADR-001');
  });

  it('drops bogus supersedes target from a new ADR draft', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    const context = selectRelevantContext(repo, 'x', []);
    const out = makeOutput({
      new_adrs_to_file: [
        {
          title: 'New decision',
          status: 'Accepted',
          context: 'c',
          decision: 'd',
          consequences: 'e',
          supersedes: ['ADR-999']
        }
      ]
    });
    const guarded = applyHallucinationGuard(
      out,
      context,
      new Set(repo.adrs.map((a) => a.adrId)),
      new Set(repo.principles.map((p) => p.id)),
      new Set(repo.lessons.map((l) => l.id))
    );
    expect(guarded.new_adrs_to_file[0]?.supersedes).toBeUndefined();
  });

  it('keeps valid supersedes target', () => {
    const fs = new InMemoryFsAdapter(sampleRepoFiles());
    const repo = loadRepository(REPO_ROOT, AGENT_MEMORY_ROOT, fs);
    const context = selectRelevantContext(repo, 'x', []);
    const out = makeOutput({
      new_adrs_to_file: [
        {
          title: 'New decision',
          status: 'Accepted',
          context: 'c',
          decision: 'd',
          consequences: 'e',
          supersedes: ['ADR-060', 'ADR-bogus']
        }
      ]
    });
    const guarded = applyHallucinationGuard(
      out,
      context,
      new Set(repo.adrs.map((a) => a.adrId)),
      new Set(repo.principles.map((p) => p.id)),
      new Set(repo.lessons.map((l) => l.id))
    );
    expect(guarded.new_adrs_to_file[0]?.supersedes).toEqual(['ADR-060']);
  });
});
