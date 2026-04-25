import { decompose } from '../decomposer';

describe('decompose', () => {
  it('produces an epic root node', () => {
    const tree = decompose('Build a user authentication system with login and registration pages');
    expect(tree.rootId).toBeTruthy();
    const root = tree.nodes.get(tree.rootId);
    expect(root?.kind).toBe('epic');
    expect(root?.parentId).toBeNull();
  });

  it('creates story children under the epic', () => {
    const tree = decompose('Dashboard with API and database');
    const root = tree.nodes.get(tree.rootId)!;
    const stories = Array.from(tree.nodes.values()).filter(n => n.parentId === root.id);
    expect(stories.length).toBeGreaterThan(0);
    for (const s of stories) {
      expect(s.kind).toBe('story');
      expect(s.parentId).toBe(root.id);
    }
  });

  it('generates non-empty acceptance criteria', () => {
    const tree = decompose('Publications page listing all posts');
    for (const [, node] of tree.nodes) {
      expect(node.acceptanceCriteria.length).toBeGreaterThan(0);
    }
  });

  it('generates specific UI criteria for dashboard input', () => {
    const tree = decompose('Admin dashboard with domain menu items');
    const allCriteria = Array.from(tree.nodes.values()).flatMap(n => n.acceptanceCriteria);
    const hasNavCriteria = allCriteria.some(c =>
      c.toLowerCase().includes('menu') ||
      c.toLowerCase().includes('navigation') ||
      c.toLowerCase().includes('navigate')
    );
    expect(hasNavCriteria).toBe(true);
  });

  it('sibling pointers form a consistent chain', () => {
    const tree = decompose('API with database and tests', { maxDepth: 3 });
    const root = tree.nodes.get(tree.rootId)!;
    const stories = Array.from(tree.nodes.values())
      .filter(n => n.parentId === root.id)
      .sort((a, b) => a.ordinal - b.ordinal);

    for (let i = 0; i < stories.length; i++) {
      if (i > 0) expect(stories[i].prevSiblingId).toBe(stories[i - 1].id);
      if (i < stories.length - 1) expect(stories[i].nextSiblingId).toBe(stories[i + 1].id);
    }
  });

  it('respects maxDepth=2 (epic+stories only)', () => {
    const tree = decompose('Simple feature', { maxDepth: 2 });
    const kinds = new Set(Array.from(tree.nodes.values()).map(n => n.kind));
    expect(kinds.has('epic')).toBe(true);
    expect(kinds.has('story')).toBe(true);
    expect(kinds.has('sub_story')).toBe(false);
  });

  it('generates verification plan entries', () => {
    const tree = decompose('Publications page at /publications route');
    for (const [, node] of tree.nodes) {
      expect(node.verificationPlan.length).toBeGreaterThan(0);
    }
  });
});
