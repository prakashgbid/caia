import { decomposeRuleBased } from './rule-based';
import type { DecompositionNode } from './types';

// ─── helpers ─────────────────────────────────────────────────────────────────

function collectAllNodes(nodes: DecompositionNode[]): DecompositionNode[] {
  return nodes.flatMap(n => [n, ...collectAllNodes(n.children ?? [])]);
}

// ─── rule-based decomposer ────────────────────────────────────────────────────

describe('decomposeRuleBased', () => {
  const PROMPT = 'Build a user authentication system with login, registration, and password reset';

  let result: ReturnType<typeof decomposeRuleBased>;

  beforeAll(() => {
    result = decomposeRuleBased(PROMPT);
  });

  it('returns a DecompositionResult with correct shape', () => {
    expect(result).toHaveProperty('originalPrompt', PROMPT);
    expect(result).toHaveProperty('hierarchy');
    expect(result).toHaveProperty('totalNodes');
    expect(result).toHaveProperty('estimatedDays');
    expect(result).toHaveProperty('recommendedParallelTracks');
    expect(result).toHaveProperty('summary');
  });

  it('originalPrompt matches the input', () => {
    expect(result.originalPrompt).toBe(PROMPT);
  });

  it('hierarchy contains at least one initiative', () => {
    expect(Array.isArray(result.hierarchy)).toBe(true);
    expect(result.hierarchy.length).toBeGreaterThanOrEqual(1);
  });

  it('top-level nodes are all initiatives', () => {
    for (const node of result.hierarchy) {
      expect(node.level).toBe('initiative');
    }
  });

  it('each initiative has at least one epic child', () => {
    for (const initiative of result.hierarchy) {
      expect(Array.isArray(initiative.children)).toBe(true);
      expect((initiative.children ?? []).length).toBeGreaterThanOrEqual(1);
      for (const epic of initiative.children ?? []) {
        expect(epic.level).toBe('epic');
      }
    }
  });

  it('each epic has at least 2 story children', () => {
    for (const initiative of result.hierarchy) {
      for (const epic of initiative.children ?? []) {
        expect((epic.children ?? []).length).toBeGreaterThanOrEqual(2);
        for (const story of epic.children ?? []) {
          expect(story.level).toBe('story');
        }
      }
    }
  });

  it('each story has task children', () => {
    for (const initiative of result.hierarchy) {
      for (const epic of initiative.children ?? []) {
        for (const story of epic.children ?? []) {
          expect((story.children ?? []).length).toBeGreaterThanOrEqual(1);
          for (const task of story.children ?? []) {
            expect(task.level).toBe('task');
          }
        }
      }
    }
  });

  it('every node has a unique id', () => {
    const all = collectAllNodes(result.hierarchy);
    const ids = all.map(n => n.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('every node has a non-empty title', () => {
    const all = collectAllNodes(result.hierarchy);
    for (const node of all) {
      expect(typeof node.title).toBe('string');
      expect(node.title.length).toBeGreaterThan(0);
    }
  });

  it('every node has a non-empty description', () => {
    const all = collectAllNodes(result.hierarchy);
    for (const node of all) {
      expect(typeof node.description).toBe('string');
      expect(node.description.length).toBeGreaterThan(0);
    }
  });

  it('totalNodes matches the actual count of nodes in the hierarchy', () => {
    const all = collectAllNodes(result.hierarchy);
    expect(result.totalNodes).toBe(all.length);
  });

  it('estimatedDays is a positive number', () => {
    expect(result.estimatedDays).toBeGreaterThan(0);
  });

  it('recommendedParallelTracks is between 1 and 3', () => {
    expect(result.recommendedParallelTracks).toBeGreaterThanOrEqual(1);
    expect(result.recommendedParallelTracks).toBeLessThanOrEqual(3);
  });

  it('stories have acceptanceCriteria arrays', () => {
    for (const initiative of result.hierarchy) {
      for (const epic of initiative.children ?? []) {
        for (const story of epic.children ?? []) {
          expect(Array.isArray(story.acceptanceCriteria)).toBe(true);
          expect((story.acceptanceCriteria ?? []).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('handles a single-line, single-topic prompt gracefully', () => {
    const simple = decomposeRuleBased('Add a dark mode toggle');
    expect(simple.hierarchy.length).toBeGreaterThanOrEqual(1);
    expect(simple.totalNodes).toBeGreaterThan(0);
  });

  it('handles a multi-line prompt by creating multiple epics', () => {
    const multiLine = decomposeRuleBased('Build a login page\nBuild a dashboard\nBuild a settings page');
    const allEpics = multiLine.hierarchy.flatMap(i => i.children ?? []);
    expect(allEpics.length).toBeGreaterThanOrEqual(3);
  });
});
