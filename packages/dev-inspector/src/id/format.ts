import { type FiberNode, getFiberComponentName, walkFiberAncestors } from './fiberWalk';

const SKIP_NAMES = new Set([
  'DevInspectorProvider',
  'Overlay',
  'HotReload',
  'ReactDevOverlay',
  'AppRouterAnnouncer',
  'PathnameContextProviderAdapter',
]);

function isUsefulName(name: string): boolean {
  if (SKIP_NAMES.has(name)) return false;
  if (name.startsWith('_') || name.startsWith('$')) return false;
  // Skip lowercase-only names (primitive wrappers) except short known ones
  if (name === name.toLowerCase() && name.length > 3) return false;
  return true;
}

export function buildIdFromFiber(fiber: FiberNode): string | null {
  const ancestors = walkFiberAncestors(fiber.return);

  const path: Array<{ name: string; index: number }> = [];

  for (const f of ancestors) {
    const name = getFiberComponentName(f);
    if (name && isUsefulName(name)) {
      path.push({ name, index: f.index });
      if (path.length >= 3) break;
    }
  }

  if (path.length === 0) return null;

  path.reverse();

  return path
    .map(({ name, index }, i) => {
      const isLast = i === path.length - 1;
      return isLast && index > 0 ? `${name}[${index}]` : name;
    })
    .join('.');
}

export function buildStableKey(fiber: FiberNode): string {
  const name = getFiberComponentName(fiber) ?? 'Unknown';
  const key = fiber.key ? `:${fiber.key}` : '';
  const idx = fiber.index > 0 ? `[${fiber.index}]` : '';
  return `${name}${key}${idx}`;
}
