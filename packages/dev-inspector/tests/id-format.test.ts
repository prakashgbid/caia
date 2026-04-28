import { describe, it, expect } from 'vitest';
import { buildIdFromFiber, buildStableKey } from '../src/id/format';
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

function namedFiber(name: string, index = 0, parent: FiberNode | null = null): FiberNode {
  function Comp() { return null; }
  Object.defineProperty(Comp, 'name', { value: name });
  return makeFiber({ type: Comp, index, return: parent });
}

describe('buildIdFromFiber', () => {
  it('returns null when no named ancestors', () => {
    const fiber = makeFiber({ return: null });
    expect(buildIdFromFiber(fiber)).toBeNull();
  });

  it('returns single component name when one ancestor', () => {
    const parent = namedFiber('Button');
    const fiber = makeFiber({ return: parent });
    expect(buildIdFromFiber(fiber)).toBe('Button');
  });

  it('includes sibling index when > 0', () => {
    const parent = namedFiber('Seat', 3);
    const grandparent = namedFiber('PlayPage', 0);
    parent.return = grandparent;
    const fiber = makeFiber({ return: parent });
    const id = buildIdFromFiber(fiber);
    expect(id).toBe('PlayPage.Seat[3]');
  });

  it('skips internal names like DevInspectorProvider', () => {
    const internal = namedFiber('DevInspectorProvider');
    const real = namedFiber('Button', 0, internal);
    const fiber = makeFiber({ return: real });
    expect(buildIdFromFiber(fiber)).toBe('Button');
  });

  it('caps path depth at 3', () => {
    const d = namedFiber('Deep');
    const c = namedFiber('C', 0, d);
    const b = namedFiber('B', 0, c);
    const a = namedFiber('A', 0, b);
    const fiber = makeFiber({ return: a });
    const id = buildIdFromFiber(fiber);
    // max 3 segments: B.C.Deep (skipping A since we're at depth limit coming from top)
    // Actually we walk from the fiber up, so first 3 named ancestors are A, B, C (reversed to A.B.C)
    expect(id?.split('.').length).toBeLessThanOrEqual(3);
  });

  it('handles displayName over name', () => {
    const fn = function MyFunc() { return null; };
    (fn as { displayName?: string }).displayName = 'CustomDisplay';
    const parent = makeFiber({ type: fn, index: 0 });
    const fiber = makeFiber({ return: parent });
    expect(buildIdFromFiber(fiber)).toBe('CustomDisplay');
  });
});

describe('buildStableKey', () => {
  it('includes fiber key when set', () => {
    const fiber = namedFiber('Card', 2);
    fiber.key = 'card-42';
    expect(buildStableKey(fiber)).toBe('Card:card-42[2]');
  });

  it('omits index when 0', () => {
    const fiber = namedFiber('Header', 0);
    expect(buildStableKey(fiber)).toBe('Header');
  });
});
