import { describe, it, expect, beforeEach } from 'vitest';
import { getDomFiber, getFiberComponentName, walkFiberAncestors } from '../src/id/fiberWalk';
import type { FiberNode } from '../src/id/fiberWalk';

function makeFiber(overrides: Partial<FiberNode> = {}): FiberNode {
  return {
    type: null,
    return: null,
    child: null,
    sibling: null,
    index: 0,
    key: null,
    stateNode: null,
    tag: 5,
    pendingProps: {},
    memoizedProps: {},
    ...overrides,
  };
}

describe('getDomFiber', () => {
  it('returns null when no react fiber key', () => {
    const el = document.createElement('div');
    expect(getDomFiber(el)).toBeNull();
  });

  it('returns fiber when __reactFiber$ key present', () => {
    const el = document.createElement('div');
    const fiber = makeFiber({ tag: 5 });
    (el as unknown as Record<string, unknown>)['__reactFiber$abc123'] = fiber;
    expect(getDomFiber(el)).toBe(fiber);
  });

  it('returns fiber when __reactInternalInstance$ key present (legacy React)', () => {
    const el = document.createElement('div');
    const fiber = makeFiber({ tag: 5 });
    (el as unknown as Record<string, unknown>)['__reactInternalInstance$xyz'] = fiber;
    expect(getDomFiber(el)).toBe(fiber);
  });
});

describe('getFiberComponentName', () => {
  it('returns null for string type (host element)', () => {
    const fiber = makeFiber({ type: 'div' });
    expect(getFiberComponentName(fiber)).toBeNull();
  });

  it('returns null for null type', () => {
    const fiber = makeFiber({ type: null });
    expect(getFiberComponentName(fiber)).toBeNull();
  });

  it('returns function name', () => {
    function MyButton() { return null; }
    const fiber = makeFiber({ type: MyButton });
    expect(getFiberComponentName(fiber)).toBe('MyButton');
  });

  it('prefers displayName over function name', () => {
    function Card() { return null; }
    (Card as { displayName?: string }).displayName = 'Card.Root';
    const fiber = makeFiber({ type: Card });
    expect(getFiberComponentName(fiber)).toBe('Card.Root');
  });

  it('handles memo wrapped components', () => {
    function Inner() { return null; }
    const memoType = { $$typeof: Symbol.for('react.memo'), type: Inner, displayName: undefined };
    const fiber = makeFiber({ type: memoType });
    expect(getFiberComponentName(fiber)).toBe('Inner');
  });

  it('returns null for explicitly unnamed functions', () => {
    // Use a function with name explicitly set to empty string
    const fn = function() { return null; };
    Object.defineProperty(fn, 'name', { value: '', configurable: true });
    const fiber = makeFiber({ type: fn });
    expect(getFiberComponentName(fiber)).toBeNull();
  });
});

describe('walkFiberAncestors', () => {
  it('returns empty array for null', () => {
    expect(walkFiberAncestors(null)).toEqual([]);
  });

  it('returns single fiber chain', () => {
    const fiber = makeFiber();
    const result = walkFiberAncestors(fiber);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(fiber);
  });

  it('walks full chain', () => {
    const root = makeFiber();
    const mid = makeFiber({ return: root });
    const leaf = makeFiber({ return: mid });

    const result = walkFiberAncestors(leaf);
    expect(result).toHaveLength(3);
    expect(result[0]).toBe(leaf);
    expect(result[1]).toBe(mid);
    expect(result[2]).toBe(root);
  });
});
