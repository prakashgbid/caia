export interface FiberNode {
  type: unknown;
  return: FiberNode | null;
  child: FiberNode | null;
  sibling: FiberNode | null;
  index: number;
  key: string | null;
  stateNode: unknown;
  tag: number;
  pendingProps: Record<string, unknown>;
  memoizedProps: Record<string, unknown>;
}

export const HOST_COMPONENT = 5;

export function getDomFiber(element: Element): FiberNode | null {
  const key = Object.keys(element).find(
    k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
  );
  if (!key) return null;
  return (element as unknown as Record<string, FiberNode>)[key] ?? null;
}

export function getFiberComponentName(fiber: FiberNode): string | null {
  const type = fiber.type;
  if (!type || typeof type === 'string') return null;

  if (typeof type === 'function') {
    return (
      (type as { displayName?: string }).displayName ||
      (type as { name?: string }).name ||
      null
    );
  }

  if (typeof type === 'object') {
    const t = type as { displayName?: string; type?: { displayName?: string; name?: string } };
    return t.displayName || t.type?.displayName || t.type?.name || null;
  }

  return null;
}

export function walkFiberAncestors(fiber: FiberNode | null): FiberNode[] {
  const ancestors: FiberNode[] = [];
  let current = fiber;
  while (current) {
    ancestors.push(current);
    current = current.return;
  }
  return ancestors;
}
