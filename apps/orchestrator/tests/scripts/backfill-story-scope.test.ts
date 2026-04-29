/**
 * ACR-008 — backfill-story-scope tests.
 *
 * The pure `inferScope()` function is exhaustively unit-tested for every
 * inference branch. We mock the DB row shape because the real DB-driven
 * end-to-end behaviour is exercised by ACR-010's E2E test.
 */

import { inferScope } from '../../scripts/backfill-story-scope';

interface PartialRow {
  id?: string;
  kind?: string;
  storyScope?: string;
  parentEntityType?: string | null;
  parentId?: string | null;
  acceptanceCriteriaJson?: string;
  description?: string;
  agentContributionsJson?: string;
}

function row(overrides: PartialRow = {}) {
  return {
    id: 'st_x',
    kind: 'story',
    storyScope: 'story',
    parentEntityType: null,
    parentId: null,
    acceptanceCriteriaJson: '[]',
    description: '',
    agentContributionsJson: '{}',
    ...overrides,
  };
}

describe('inferScope — explicit kind column wins', () => {
  it("kind='epic' -> epic", () => {
    expect(inferScope(row({ kind: 'epic' }), false)).toBe('epic');
  });

  it("kind='sub_task' -> subtask", () => {
    expect(inferScope(row({ kind: 'sub_task' }), false)).toBe('subtask');
  });

  it("kind='todo' -> subtask", () => {
    expect(inferScope(row({ kind: 'todo' }), false)).toBe('subtask');
  });
});

describe('inferScope — initiative heuristic', () => {
  const longDesc = Array(90).fill('word').join(' ');

  it('parent=null + long description + empty agentSections -> initiative', () => {
    expect(
      inferScope(
        row({ parentEntityType: null, description: longDesc, agentContributionsJson: '{}' }),
        false,
      ),
    ).toBe('initiative');
  });

  it('parent=null + short description -> NOT initiative', () => {
    expect(inferScope(row({ description: 'too short' }), false)).not.toBe('initiative');
  });

  it('parent=null + long description + populated agentSections -> NOT initiative', () => {
    expect(
      inferScope(
        row({
          description: longDesc,
          agentContributionsJson: '{"architecture":{"notes":"x"}}',
        }),
        false,
      ),
    ).not.toBe('initiative');
  });
});

describe('inferScope — epic heuristic', () => {
  it("parentEntityType='requirement' + has children -> epic", () => {
    expect(inferScope(row({ parentEntityType: 'requirement' }), true)).toBe('epic');
  });

  it("parentEntityType='requirement' + no children -> falls back", () => {
    // Falls through to story (default).
    expect(inferScope(row({ parentEntityType: 'requirement' }), false)).toBe('story');
  });
});

describe('inferScope — task heuristic', () => {
  it("parentEntityType='story' + zero AC -> task", () => {
    expect(
      inferScope(row({ parentEntityType: 'story', acceptanceCriteriaJson: '[]' }), false),
    ).toBe('task');
  });

  it("parentEntityType='story' + non-empty AC -> NOT task (defaults to story)", () => {
    expect(
      inferScope(
        row({
          parentEntityType: 'story',
          acceptanceCriteriaJson: '["AC1","AC2","AC3"]',
        }),
        false,
      ),
    ).toBe('story');
  });
});

describe('inferScope — default + edge cases', () => {
  it('returns story when no rule matches', () => {
    expect(inferScope(row(), false)).toBe('story');
  });

  it('handles malformed JSON gracefully (treats as empty)', () => {
    expect(
      inferScope(
        row({ parentEntityType: 'story', acceptanceCriteriaJson: 'not-json' }),
        false,
      ),
    ).toBe('task');
  });

  it('explicit kind=epic beats parent=story heuristic', () => {
    expect(
      inferScope(
        row({ kind: 'epic', parentEntityType: 'story' }),
        false,
      ),
    ).toBe('epic');
  });

  it('explicit kind=todo beats long-description initiative heuristic', () => {
    const longDesc = Array(90).fill('word').join(' ');
    expect(
      inferScope(row({ kind: 'todo', description: longDesc }), false),
    ).toBe('subtask');
  });
});
