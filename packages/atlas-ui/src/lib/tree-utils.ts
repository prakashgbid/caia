/**
 * Tree helpers used by `<TicketPane>`.
 *
 * Kept separate from the component so the same flat-list and search
 * logic can be tested in isolation.
 */

import type { AtlasTicketNode, TicketLevel, TicketState } from '../types/index.js';

/** A flat row used by the virtualized tree renderer. */
export interface FlatRow {
  ticket: AtlasTicketNode;
  depth: number;
  /** True when this row has children (regardless of expansion). */
  hasChildren: boolean;
  /** True when this row is currently expanded. */
  expanded: boolean;
  /** Parent ids from root → immediate parent. */
  parentIds: string[];
}

export interface FlattenOptions {
  /** Set of ticket ids currently expanded. Missing = collapsed by default. */
  expandedIds: ReadonlySet<string>;
  /** Optional search query. Hides rows that don't match (keeps ancestors). */
  search?: string;
  /** Optional state filter. Hides rows whose state doesn't match. */
  stateFilter?: ReadonlySet<TicketState>;
  /** Optional level filter (e.g. show only `section` and below). */
  minLevel?: TicketLevel;
}

const LEVEL_ORDER: TicketLevel[] = [
  'site',
  'foundation',
  'page',
  'section',
  'widget',
  'story',
  'task',
];

function levelRank(level: TicketLevel): number {
  const idx = LEVEL_ORDER.indexOf(level);
  return idx < 0 ? 99 : idx;
}

/**
 * Flatten the hierarchical tree into a list of visible rows. The
 * result is what react-arborist (or our hand-rolled virtualizer)
 * iterates over.
 *
 * Behaviour notes:
 *
 *   - Roots are always visible.
 *   - A row is shown if its node is expanded AND all ancestors expanded.
 *   - When `search` is set, every row whose `title` or `id` contains
 *     the (case-insensitive) substring is visible AND all ancestors
 *     of matching rows are force-expanded.
 *   - `stateFilter` is applied AFTER search, so the operator can
 *     narrow the search hits to e.g. `in-progress`.
 */
export function flattenTree(
  root: AtlasTicketNode,
  opts: FlattenOptions,
): FlatRow[] {
  const search = opts.search?.trim().toLowerCase() ?? '';
  const stateFilter = opts.stateFilter;
  const minRank = opts.minLevel ? levelRank(opts.minLevel) : 0;

  // First pass — compute the set of ids that must be visible because
  // they match the search, plus all their ancestors.
  const forceVisible = new Set<string>();
  if (search.length > 0) {
    const matchPath: string[] = [];
    function walk(node: AtlasTicketNode): void {
      matchPath.push(node.id);
      const titleMatch =
        node.title.toLowerCase().includes(search) ||
        node.id.toLowerCase().includes(search);
      if (titleMatch) for (const id of matchPath) forceVisible.add(id);
      if (Array.isArray(node.children)) {
        for (const c of node.children) walk(c);
      }
      matchPath.pop();
    }
    walk(root);
  }

  const rows: FlatRow[] = [];

  function walk(node: AtlasTicketNode, depth: number, parentIds: string[]): void {
    const visibleBySearch = search.length === 0 || forceVisible.has(node.id);
    const visibleByState = !stateFilter || stateFilter.has(node.state);
    const visibleByLevel = levelRank(node.level) >= minRank;
    const visible = visibleBySearch && visibleByState && visibleByLevel;
    if (!visible) return;

    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    const expanded =
      hasChildren && (opts.expandedIds.has(node.id) || (search.length > 0 && forceVisible.has(node.id)));

    rows.push({ ticket: node, depth, hasChildren, expanded, parentIds });

    if (expanded && Array.isArray(node.children)) {
      const childParents = [...parentIds, node.id];
      for (const c of node.children) walk(c, depth + 1, childParents);
    }
  }

  walk(root, 0, []);
  return rows;
}

/** Walk the tree and call `fn` on every node (pre-order). */
export function walkTree(
  root: AtlasTicketNode,
  fn: (node: AtlasTicketNode, depth: number) => void,
): void {
  function visit(node: AtlasTicketNode, depth: number): void {
    fn(node, depth);
    if (Array.isArray(node.children)) {
      for (const c of node.children) visit(c, depth + 1);
    }
  }
  visit(root, 0);
}

/** Find a node by id. Returns null when missing. */
export function findNode(
  root: AtlasTicketNode,
  ticketId: string,
): AtlasTicketNode | null {
  let found: AtlasTicketNode | null = null;
  walkTree(root, (n) => {
    if (n.id === ticketId) found = n;
  });
  return found;
}

/**
 * Compute the set of ancestor ids for a target ticket, root → parent.
 * Useful for auto-expanding the tree when a panel selection arrives.
 */
export function ancestorIds(root: AtlasTicketNode, ticketId: string): string[] {
  const path: string[] = [];
  let found: string[] | null = null;
  function visit(node: AtlasTicketNode): void {
    if (found) return;
    path.push(node.id);
    if (node.id === ticketId) {
      // Drop the target itself — return ancestors only.
      found = path.slice(0, -1);
      return;
    }
    if (Array.isArray(node.children)) {
      for (const c of node.children) {
        visit(c);
        if (found) return;
      }
    }
    path.pop();
  }
  visit(root);
  return found ?? [];
}
