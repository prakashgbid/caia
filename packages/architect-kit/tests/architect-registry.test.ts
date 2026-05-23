import { describe, it, expect, beforeEach } from 'vitest';
import {
  ArchitectRegistry,
  ArchitectRegistryError,
  disjointness,
  getDefaultArchitectRegistry,
  registerArchitect,
  resetDefaultArchitectRegistry,
} from '../src/architect-registry.js';
import {
  StubArchitect,
  makeContract,
  canonicalArchitectSet,
  stubTicket,
} from './fixtures.js';

describe('ArchitectRegistry', () => {
  let r: ArchitectRegistry;
  beforeEach(() => {
    r = new ArchitectRegistry();
  });

  it('registers a single architect', () => {
    r.register(new StubArchitect('foo', makeContract('foo', ['foo.x'])));
    expect(r.size()).toBe(1);
    expect(r.get('foo')).toBeDefined();
  });

  it('throws on duplicate architect name', () => {
    r.register(new StubArchitect('foo', makeContract('foo', ['foo.x'])));
    expect(() =>
      r.register(new StubArchitect('foo', makeContract('foo', ['foo.y']))),
    ).toThrow(ArchitectRegistryError);
  });

  it('throws when sectionContract.architectName does not match the architect name', () => {
    expect(() =>
      r.register(new StubArchitect('foo', makeContract('mismatch', ['x']))),
    ).toThrow(/must match/);
  });

  it('throws when a contract has duplicate paths within itself', () => {
    expect(() =>
      r.register(new StubArchitect('foo', makeContract('foo', ['foo.a', 'foo.a']))),
    ).toThrow(/duplicate paths/);
  });

  it('throws on inter-architect path collision', () => {
    r.register(new StubArchitect('a', makeContract('a', ['shared.x'])));
    expect(() =>
      r.register(new StubArchitect('b', makeContract('b', ['shared.x']))),
    ).toThrow(/already owned by 'a'/);
  });

  it('unregister removes the architect and frees its paths', () => {
    r.register(new StubArchitect('a', makeContract('a', ['p'])));
    expect(r.unregister('a')).toBe(true);
    expect(r.ownerOf('p')).toBeUndefined();
    // path now available for a new architect
    r.register(new StubArchitect('b', makeContract('b', ['p'])));
    expect(r.ownerOf('p')).toBe('b');
  });

  it('unregister returns false for unknown architects', () => {
    expect(r.unregister('nope')).toBe(false);
  });

  it('list returns architects in registration order', () => {
    r.register(new StubArchitect('a', makeContract('a', ['a.x'])));
    r.register(new StubArchitect('b', makeContract('b', ['b.x'])));
    r.register(new StubArchitect('c', makeContract('c', ['c.x'])));
    expect(r.list().map((x) => x.name)).toEqual(['a', 'b', 'c']);
  });

  it('applicableTo filters by appliesPredicate', () => {
    r.register(
      new StubArchitect(
        'always',
        makeContract('always', ['a.x'], { appliesPredicate: () => true }),
      ),
    );
    r.register(
      new StubArchitect(
        'never',
        makeContract('never', ['n.x'], { appliesPredicate: () => false }),
      ),
    );
    const apps = r.applicableTo(stubTicket());
    expect(apps.map((a) => a.name)).toEqual(['always']);
  });

  it('applicableTo can switch behavior by ticket type', () => {
    r.register(
      new StubArchitect(
        'pageOnly',
        makeContract('pageOnly', ['p.x'], {
          appliesPredicate: (t) => t.type === 'Page',
        }),
      ),
    );
    expect(r.applicableTo(stubTicket({ type: 'Page' })).map((a) => a.name)).toEqual([
      'pageOnly',
    ]);
    expect(r.applicableTo(stubTicket({ type: 'Widget' })).map((a) => a.name)).toEqual([]);
  });

  it('validate reports unmet dependencies', () => {
    r.register(
      new StubArchitect(
        'orphan',
        makeContract('orphan', ['o.x'], { dependsOn: ['ghost'] }),
      ),
    );
    const errs = r.validate();
    expect(errs.length).toBe(1);
    expect(errs[0]).toMatch(/'orphan' depends on 'ghost'/);
  });

  it('clear empties the registry', () => {
    r.register(new StubArchitect('a', makeContract('a', ['a'])));
    r.clear();
    expect(r.size()).toBe(0);
  });

  it('handles the full 17-architect canonical set with no validation errors', () => {
    for (const a of canonicalArchitectSet()) r.register(a);
    expect(r.size()).toBe(17);
    expect(r.validate()).toEqual([]);
    // 17 architects × ~2 paths each = the path count from the fixtures
    expect(r.allPaths().length).toBeGreaterThan(20);
    expect(new Set(r.allPaths()).size).toBe(r.allPaths().length);
  });
});

describe('disjointness helper', () => {
  it('returns empty for disjoint contracts', () => {
    expect(disjointness([makeContract('a', ['x']), makeContract('b', ['y'])])).toEqual([]);
  });

  it('returns the conflicting paths and claimants', () => {
    const conflicts = disjointness([
      makeContract('a', ['shared']),
      makeContract('b', ['shared']),
    ]);
    expect(conflicts).toEqual([{ path: 'shared', claimedBy: ['a', 'b'] }]);
  });
});

describe('default singleton', () => {
  beforeEach(() => resetDefaultArchitectRegistry());

  it('registerArchitect uses the singleton', () => {
    registerArchitect(new StubArchitect('one', makeContract('one', ['o'])));
    expect(getDefaultArchitectRegistry().size()).toBe(1);
  });

  it('resetDefaultArchitectRegistry clears between processes (logical resets)', () => {
    registerArchitect(new StubArchitect('one', makeContract('one', ['o'])));
    resetDefaultArchitectRegistry();
    expect(getDefaultArchitectRegistry().size()).toBe(0);
  });
});
