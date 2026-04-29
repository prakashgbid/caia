/**
 * BUCKET-008 — chain-fragmenter unit tests.
 */

import {
  fragmentChains,
  buildFragmentInput,
  type FragmentInput,
} from '../../src/scheduling/chain-fragmenter';

function input(stories: string[], deps: Record<string, string[]>): FragmentInput {
  const blockedBy = new Map<string, string[]>();
  for (const s of stories) blockedBy.set(s, deps[s] ?? []);
  return { storyIds: stories, blockedBy };
}

describe('fragmentChains — empty + trivial', () => {
  it('empty input -> empty output', () => {
    const r = fragmentChains({ storyIds: [], blockedBy: new Map() });
    expect(r.wccs).toEqual([]);
    expect(r.cycleStoryIds).toEqual([]);
  });

  it('single story with no blockers -> one WCC, one level', () => {
    const r = fragmentChains(input(['s1'], {}));
    expect(r.wccs).toHaveLength(1);
    expect(r.wccs[0]!.levels).toEqual([['s1']]);
    expect(r.wccs[0]!.longestChain).toBe(1);
  });
});

describe('fragmentChains — single chain', () => {
  it('A -> B -> C -> D: one WCC, four levels', () => {
    const r = fragmentChains(
      input(['a', 'b', 'c', 'd'], { b: ['a'], c: ['b'], d: ['c'] }),
    );
    expect(r.wccs).toHaveLength(1);
    expect(r.wccs[0]!.levels).toEqual([['a'], ['b'], ['c'], ['d']]);
    expect(r.wccs[0]!.longestChain).toBe(4);
  });
});

describe('fragmentChains — parallel chains', () => {
  it('two independent chains -> two WCCs', () => {
    const r = fragmentChains(input(['a', 'b', 'c', 'd'], { b: ['a'], d: ['c'] }));
    expect(r.wccs).toHaveLength(2);
    const all = r.wccs.flatMap((w) => w.storyIds).sort();
    expect(all).toEqual(['a', 'b', 'c', 'd']);
    for (const w of r.wccs) expect(w.levels).toHaveLength(2);
  });

  it('three independent starts each with one downstream', () => {
    const r = fragmentChains(
      input(['a', 'b', 'e', 'f', 'g', 'h'], { b: ['a'], f: ['e'], h: ['g'] }),
    );
    expect(r.wccs).toHaveLength(3);
    for (const w of r.wccs) expect(w.longestChain).toBe(2);
  });
});

describe('fragmentChains — diamond', () => {
  it('A -> {B,C} -> D: one WCC, three levels', () => {
    const r = fragmentChains(
      input(['a', 'b', 'c', 'd'], { b: ['a'], c: ['a'], d: ['b', 'c'] }),
    );
    expect(r.wccs).toHaveLength(1);
    expect(r.wccs[0]!.levels[0]).toEqual(['a']);
    expect(r.wccs[0]!.levels[1]?.sort()).toEqual(['b', 'c']);
    expect(r.wccs[0]!.levels[2]).toEqual(['d']);
    expect(r.wccs[0]!.longestChain).toBe(3);
  });
});

describe('fragmentChains — tree', () => {
  it('shallow tree: A root, B/C/D leaves', () => {
    const r = fragmentChains(
      input(['a', 'b', 'c', 'd'], { b: ['a'], c: ['a'], d: ['a'] }),
    );
    expect(r.wccs).toHaveLength(1);
    expect(r.wccs[0]!.levels[0]).toEqual(['a']);
    expect(r.wccs[0]!.levels[1]?.sort()).toEqual(['b', 'c', 'd']);
    expect(r.wccs[0]!.longestChain).toBe(2);
  });
});

describe('fragmentChains — cycles', () => {
  it('A <-> B: cycle members surface, no infinite loop', () => {
    const r = fragmentChains(input(['a', 'b'], { a: ['b'], b: ['a'] }));
    expect(r.cycleStoryIds.sort()).toEqual(['a', 'b']);
    const placed = r.wccs.flatMap((w) => w.levels.flat());
    expect(placed).not.toContain('a');
    expect(placed).not.toContain('b');
  });
});

describe('fragmentChains — proposal worked example', () => {
  it('section 9.5 8-story example: 3 starts, longest chain 4', () => {
    const r = fragmentChains(
      input(
        ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'],
        { s2: ['s1'], s3: ['s2'], s4: ['s3'], s6: ['s5'], s8: ['s7'] },
      ),
    );
    expect(r.wccs).toHaveLength(3);
    const longest = Math.max(...r.wccs.map((w) => w.longestChain));
    expect(longest).toBe(4);
    const level0 = r.wccs.map((w) => w.levels[0]!).flat().sort();
    expect(level0).toEqual(['s1', 's5', 's7']);
  });
});

describe('fragmentChains — out-of-set blockers', () => {
  it('blockers outside the input set are ignored', () => {
    const r = fragmentChains(input(['s1', 's2'], { s1: ['external'] }));
    expect(r.wccs[0]!.levels[0]?.sort()).toEqual(['s1', 's2']);
  });
});

describe('buildFragmentInput', () => {
  it('parses stories rows into FragmentInput', () => {
    const inp = buildFragmentInput([
      { id: 'a', blockedByJson: '[]' },
      { id: 'b', blockedByJson: '["a"]' },
      { id: 'c', blockedByJson: null },
    ]);
    expect(inp.storyIds).toEqual(['a', 'b', 'c']);
    expect(inp.blockedBy.get('a')).toEqual([]);
    expect(inp.blockedBy.get('b')).toEqual(['a']);
    expect(inp.blockedBy.get('c')).toEqual([]);
  });

  it('handles malformed JSON gracefully', () => {
    const inp = buildFragmentInput([{ id: 'a', blockedByJson: 'not json' }]);
    expect(inp.blockedBy.get('a')).toEqual([]);
  });
});
