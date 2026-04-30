import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ATOMICITY_RUBRICS, classifyAtomicity } from '../src/atomicity-classifier.js';
import { STORY_SCOPES } from '../src/types.js';
import type { ChildTicket } from '../src/types.js';
import { fakeOllama, fakeClaude, installFakeAdapters, clearAdapters, jsonResponse } from './_helpers.js';

function fixtureChild(scope: ChildTicket['scope']): ChildTicket {
  return {
    id: `child-${scope}`,
    scope,
    title: `A ${scope} candidate`,
    description: `Concrete description for the ${scope} candidate`,
    inScope: ['the in-scope item one', 'in-scope item two'],
    outOfScope: ['out-of-scope item'],
    dependencies: [],
    estimatedAtomic: false,
    existingArtifacts: [],
    lifecycle: 'new',
    acceptanceCriteria: ['When user does X, the system does Y reliably'],
  };
}

describe('ATOMICITY_RUBRICS', () => {
  it('non-empty for every scope', () => {
    for (const scope of STORY_SCOPES) {
      const r = ATOMICITY_RUBRICS[scope];
      expect(r.length).toBeGreaterThan(0);
      for (const item of r) expect(item.length).toBeGreaterThan(10);
    }
  });
  it('story rubric mentions INVEST', () => {
    expect(ATOMICITY_RUBRICS.story.join('\n')).toMatch(/INVEST/i);
  });
  it('epic rubric mentions SAFe or PI', () => {
    expect(ATOMICITY_RUBRICS.epic.join('\n')).toMatch(/SAFe|PI/);
  });
  it('module rubric mentions DDD or bounded', () => {
    expect(ATOMICITY_RUBRICS.module.join('\n')).toMatch(/DDD|bounded/i);
  });
});

describe('classifyAtomicity', () => {
  beforeEach(() => clearAdapters());
  afterEach(() => clearAdapters());

  it('atomic=true with empty failedCriteria passes', async () => {
    const ollama = fakeOllama({ responses: [jsonResponse({ atomic: true, confidence: 0.9, rationale: 'INVEST passes', failedCriteria: [] })] });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));
    const v = await classifyAtomicity({ child: fixtureChild('story') });
    expect(v.atomic).toBe(true);
  });

  it('atomic=false with failedCriteria passes', async () => {
    const ollama = fakeOllama({ responses: [jsonResponse({ atomic: false, confidence: 0.7, rationale: 'two concerns', failedCriteria: ['some criterion'] })] });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));
    const v = await classifyAtomicity({ child: fixtureChild('story') });
    expect(v.atomic).toBe(false);
    expect(v.failedCriteria.length).toBe(1);
  });

  it('force-corrects true+nonEmpty to false', async () => {
    const ollama = fakeOllama({ responses: [jsonResponse({ atomic: true, confidence: 0.4, rationale: 'short rationale', failedCriteria: ['something'] })] });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));
    const v = await classifyAtomicity({ child: fixtureChild('module') });
    expect(v.atomic).toBe(false);
  });

  it('force-corrects false+empty to true', async () => {
    const ollama = fakeOllama({ responses: [jsonResponse({ atomic: false, confidence: 0.4, rationale: 'short rationale', failedCriteria: [] })] });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));
    const v = await classifyAtomicity({ child: fixtureChild('task') });
    expect(v.atomic).toBe(true);
  });

  it('exercises every scope', async () => {
    for (const scope of STORY_SCOPES) {
      clearAdapters();
      const ollama = fakeOllama({ responses: [jsonResponse({ atomic: true, confidence: 0.8, rationale: 'a sufficient rationale', failedCriteria: [] })] });
      installFakeAdapters(ollama, fakeClaude({ responses: [] }));
      const v = await classifyAtomicity({ child: fixtureChild(scope) });
      expect(v.atomic).toBe(true);
    }
  });

  it('telemetry passes through', async () => {
    const ollama = fakeOllama({ responses: [{ response: JSON.stringify({ atomic: true, confidence: 0.85, rationale: 'a sufficient rationale', failedCriteria: [] }), model: 'qwen2.5-coder:7b', durationMs: 41 }] });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));
    const v = await classifyAtomicity({ child: fixtureChild('subtask') });
    expect(v.model).toBe('qwen2.5-coder:7b');
    expect(v.durationMs).toBe(41);
  });
});
