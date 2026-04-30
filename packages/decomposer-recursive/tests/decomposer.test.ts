import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  PORecursiveDecomposer,
  PORecursiveDecomposerCancelled,
} from '../src/decomposer.js';
import { CHILD_SCOPE_OF, DECOMPOSER_SYSTEM_PROMPTS } from '../src/per-scope-prompts.js';
import { STORY_SCOPES } from '../src/types.js';
import {
  fakeOllama,
  fakeClaude,
  installFakeAdapters,
  clearAdapters,
  jsonResponse,
} from './_helpers.js';

function childPayload(scope: string, idx: number, atomic = true): Record<string, unknown> {
  return {
    id: `c${String(idx)}`,
    scope,
    title: `Candidate ${String(idx)}`,
    description: `A description for candidate ${String(idx)} that is long enough`,
    inScope: ['the in-scope item one'],
    outOfScope: [],
    dependencies: [],
    estimatedAtomic: atomic,
    existingArtifacts: [],
    lifecycle: 'new',
  };
}

const exampleParent = {
  id: 'p',
  scope: 'epic' as const,
  title: 'A reasonable epic',
  description: 'A reasonable epic that needs to be split into modules',
  inScope: ['everything in this epic'],
  outOfScope: [],
};

describe('per-scope prompts', () => {
  it('have a non-empty system prompt for every scope', () => {
    for (const scope of STORY_SCOPES) {
      expect(DECOMPOSER_SYSTEM_PROMPTS[scope].length).toBeGreaterThan(100);
    }
  });

  it('child-scope mapping is well-formed', () => {
    expect(CHILD_SCOPE_OF.initiative).toBe('epic');
    expect(CHILD_SCOPE_OF.epic).toBe('module');
    expect(CHILD_SCOPE_OF.module).toBe('story');
    expect(CHILD_SCOPE_OF.story).toBe('task');
    expect(CHILD_SCOPE_OF.task).toBe('subtask');
    expect(CHILD_SCOPE_OF.subtask).toBeNull();
  });
});

describe('PORecursiveDecomposer.decomposeOne', () => {
  beforeEach(() => clearAdapters());
  afterEach(() => clearAdapters());

  it('expands an epic into modules', async () => {
    const ollama = fakeOllama({
      responses: [
        jsonResponse([
          childPayload('module', 1),
          childPayload('module', 2),
        ]),
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const engine = new PORecursiveDecomposer();
    const out = await engine.decomposeOne({
      parent: exampleParent,
      childScope: 'module',
    });

    expect(out.childTickets.length).toBe(2);
    expect(out.childTickets.every((c) => c.scope === 'module')).toBe(true);
    expect(out.audit.parentNodeId).toBe('p');
    expect(out.audit.childScope).toBe('module');
    expect(out.audit.outcome).toBe('committed');
    expect(out.judgeScores.coverage).toBeNull();
    expect(out.judgeScores.disjointness).toBeNull();
    expect(out.clarifyingQuestions).toEqual([]);
  });

  it('cancellation aborts before the LLM call', async () => {
    const ollama = fakeOllama({
      responses: [jsonResponse([childPayload('story', 1)])],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const ac = new AbortController();
    ac.abort();

    const engine = new PORecursiveDecomposer();
    await expect(
      engine.decomposeOne({
        parent: { ...exampleParent, scope: 'module' },
        childScope: 'story',
        signal: ac.signal,
      }),
    ).rejects.toBeInstanceOf(PORecursiveDecomposerCancelled);
  });
});

describe('PORecursiveDecomposer.decomposeRoot', () => {
  beforeEach(() => clearAdapters());
  afterEach(() => clearAdapters());

  it('respects the targetScope guard (story-targeted recursion stops at story)', async () => {
    // Parent is module, target is story. The engine should run one
    // expansion (module → stories) and then stop because every child
    // is at the target scope.
    const ollama = fakeOllama({
      responses: [
        // Expansion: module → stories
        jsonResponse([
          childPayload('story', 1, true),
          childPayload('story', 2, true),
        ]),
        // Atomicity classifier responses (one per child)
        jsonResponse({ atomic: true, confidence: 0.9, rationale: 'INVEST passes', failedCriteria: [] }),
        jsonResponse({ atomic: true, confidence: 0.9, rationale: 'INVEST passes', failedCriteria: [] }),
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const engine = new PORecursiveDecomposer();
    const out = await engine.decomposeRoot({
      parent: { ...exampleParent, scope: 'module' },
      targetScope: 'story',
    });

    expect(out.tree.children.length).toBe(2);
    expect(out.tree.children.every((c) => c.atomic)).toBe(true);
    expect(out.audits.length).toBe(1);
    expect(out.truncated).toBe(false);
  });

  it('halts at maxExpansions (truncated tree)', async () => {
    const ollama = fakeOllama({
      responses: [
        jsonResponse([
          childPayload('module', 1, false),
          childPayload('module', 2, false),
        ]),
        jsonResponse({ atomic: false, confidence: 0.5, rationale: 'too big still', failedCriteria: ['something'] }),
        jsonResponse({ atomic: false, confidence: 0.5, rationale: 'too big still', failedCriteria: ['something'] }),
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const engine = new PORecursiveDecomposer();
    const out = await engine.decomposeRoot({
      parent: { ...exampleParent, scope: 'epic' },
      targetScope: 'subtask',
      maxExpansions: 1,
    });

    expect(out.truncated).toBe(true);
    expect(out.audits.length).toBeLessThanOrEqual(1);
  });

  it('decomposes recursively all the way to atomicity', async () => {
    // Chain: epic → 1 module → 1 story (atomic)
    const ollama = fakeOllama({
      responses: [
        jsonResponse([childPayload('module', 1, false)]),
        jsonResponse({ atomic: false, confidence: 0.5, rationale: 'still too big', failedCriteria: ['something'] }),
        jsonResponse([childPayload('story', 1, true)]),
        jsonResponse({ atomic: true, confidence: 0.9, rationale: 'INVEST passes', failedCriteria: [] }),
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const engine = new PORecursiveDecomposer();
    const out = await engine.decomposeRoot({
      parent: { ...exampleParent, scope: 'epic' },
      targetScope: 'subtask',
    });

    expect(out.audits.length).toBe(2);
    expect(out.tree.children.length).toBe(1);
    expect(out.tree.children[0]?.children.length).toBe(1);
    expect(out.tree.children[0]?.children[0]?.atomic).toBe(true);
  });

  it('returns total cost + duration accumulators', async () => {
    const ollama = fakeOllama({
      responses: [
        jsonResponse([childPayload('module', 1, true)]),
        jsonResponse({ atomic: true, confidence: 0.9, rationale: 'ok looks atomic', failedCriteria: [] }),
      ],
    });
    installFakeAdapters(ollama, fakeClaude({ responses: [] }));

    const engine = new PORecursiveDecomposer();
    const out = await engine.decomposeRoot({
      parent: { ...exampleParent, scope: 'epic' },
      targetScope: 'module',
    });

    expect(out.totalCostUsd).toBeGreaterThanOrEqual(0);
    expect(out.totalDurationMs).toBeGreaterThan(0);
    expect(out.totalCalls).toBeGreaterThan(0);
  });
});
