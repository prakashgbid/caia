/**
 * `<TicketPane>` — virtualized hierarchical ticket tree.
 *
 * Spec §6.1 (react-arborist), §3 (panel selection), §9.1 (keyboard
 * nav). We implement a hand-rolled virtualizer instead of pulling in
 * react-arborist because Atlas-UI is a *library* — we don't want to
 * add 60kB to consumers' bundles when the only feature we need is
 * "render N visible rows from a flat list."
 *
 * Behaviour mirrors react-arborist:
 *
 *   - `↑/↓` move focus
 *   - `←` collapses (or moves to parent if already collapsed)
 *   - `→` expands (or moves to first child if already expanded)
 *   - `Enter` / `Space` selects
 *   - `Home` / `End` jump to first/last visible row
 *   - Type-to-search via the visible search input at the top
 *
 * For performance: rows are absolutely positioned inside a fixed-
 * height container; only the visible window renders. The whole
 * algorithm is O(visible-rows) per render, regardless of total
 * tree size.
 */

import * as React from 'react';
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ancestorIds,
  flattenTree,
  type FlatRow,
} from '../lib/tree-utils.js';
import type { AtlasTicketNode, TicketState } from '../types/index.js';

export interface TicketPaneProps {
  /** Root of the ticket tree. */
  root: AtlasTicketNode | null;
  /** Currently selected ticket ids — drives the highlighted row. */
  selectedTicketIds: string[];
  /** Fired on row click (panel-driven selection). */
  onSelect?: (
    ticketId: string,
    mode: 'replace' | 'add' | 'toggle',
  ) => void;
  /** Row height in px. Defaults to 28. */
  rowHeight?: number;
  /** Optional aria-label. */
  ariaLabel?: string;
  /** Optional empty state message. */
  emptyMessage?: string;
  /**
   * Live override of each ticket's state — used by the SSE consumer
   * to flip dots without mutating the tree. Keyed by ticket id.
   */
  liveStateOverrides?: Map<string, TicketState>;
}

const DEFAULT_ROW_HEIGHT = 28;
const OVERSCAN = 6;
const FILTER_STATES: TicketState[] = [
  'change-requested',
  'in-progress',
  'failed',
  'verified',
];

export function TicketPane(props: TicketPaneProps): React.ReactElement {
  const rowHeight = props.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const ariaLabel = props.ariaLabel ?? 'Ticket hierarchy';
  const [search, setSearch] = useState('');
  const [stateFilters, setStateFilters] = useState<Set<TicketState>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['_root_']));
  const [focusIdx, setFocusIdx] = useState<number>(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);

  // Auto-expand ancestors of the current selection so it's visible.
  useEffect(() => {
    if (!props.root || props.selectedTicketIds.length === 0) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const sel of props.selectedTicketIds) {
        const ancestors = ancestorIds(props.root!, sel);
        // Also expand the root itself (and the selected node).
        for (const a of [...ancestors, props.root!.id, sel]) {
          if (!next.has(a)) {
            next.add(a);
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [props.root, props.selectedTicketIds]);

  const rows = useMemo<FlatRow[]>(() => {
    if (!props.root) return [];
    const flattenOpts: Parameters<typeof flattenTree>[1] = {
      expandedIds: expanded,
      search,
    };
    if (stateFilters.size > 0) flattenOpts.stateFilter = stateFilters;
    return flattenTree(props.root, flattenOpts);
  }, [props.root, expanded, search, stateFilters]);

  // Apply state overrides on top of the flat rows. Cheap O(rows).
  const overriddenRows = useMemo<FlatRow[]>(() => {
    if (!props.liveStateOverrides || props.liveStateOverrides.size === 0) return rows;
    return rows.map((r) => {
      const ov = props.liveStateOverrides!.get(r.ticket.id);
      if (!ov || ov === r.ticket.state) return r;
      return { ...r, ticket: { ...r.ticket, state: ov } };
    });
  }, [rows, props.liveStateOverrides]);

  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      setViewportHeight(el.clientHeight);
    });
    ro.observe(el);
    setViewportHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.target as HTMLDivElement).scrollTop);
  }, []);

  const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
  const endIdx = Math.min(
    overriddenRows.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN,
  );

  const visible = overriddenRows.slice(startIdx, endIdx);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onRowClick = useCallback(
    (row: FlatRow, e: React.MouseEvent) => {
      const mode: 'replace' | 'add' | 'toggle' = e.shiftKey
        ? 'add'
        : e.metaKey || e.ctrlKey
          ? 'toggle'
          : 'replace';
      props.onSelect?.(row.ticket.id, mode);
    },
    [props.onSelect],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (overriddenRows.length === 0) return;
      let nextFocus = focusIdx;
      switch (e.key) {
        case 'ArrowDown':
          nextFocus = Math.min(overriddenRows.length - 1, focusIdx < 0 ? 0 : focusIdx + 1);
          e.preventDefault();
          break;
        case 'ArrowUp':
          nextFocus = Math.max(0, focusIdx <= 0 ? 0 : focusIdx - 1);
          e.preventDefault();
          break;
        case 'Home':
          nextFocus = 0;
          e.preventDefault();
          break;
        case 'End':
          nextFocus = overriddenRows.length - 1;
          e.preventDefault();
          break;
        case 'Enter':
        case ' ': {
          if (focusIdx >= 0) {
            const row = overriddenRows[focusIdx];
            if (row) props.onSelect?.(row.ticket.id, 'replace');
          }
          e.preventDefault();
          break;
        }
        case 'ArrowRight': {
          if (focusIdx >= 0) {
            const row = overriddenRows[focusIdx];
            if (row && row.hasChildren && !row.expanded) {
              toggleExpand(row.ticket.id);
            } else if (row && row.hasChildren && row.expanded) {
              nextFocus = Math.min(overriddenRows.length - 1, focusIdx + 1);
            }
            e.preventDefault();
          }
          break;
        }
        case 'ArrowLeft': {
          if (focusIdx >= 0) {
            const row = overriddenRows[focusIdx];
            if (row && row.hasChildren && row.expanded) {
              toggleExpand(row.ticket.id);
            } else if (row && row.parentIds.length > 0) {
              const parentId = row.parentIds[row.parentIds.length - 1];
              const parentIdx = overriddenRows.findIndex((r) => r.ticket.id === parentId);
              if (parentIdx >= 0) nextFocus = parentIdx;
            }
            e.preventDefault();
          }
          break;
        }
        default:
          return;
      }
      if (nextFocus !== focusIdx) {
        setFocusIdx(nextFocus);
        const el = listRef.current;
        if (el) {
          const topOfRow = nextFocus * rowHeight;
          const bottomOfRow = topOfRow + rowHeight;
          if (topOfRow < el.scrollTop) el.scrollTop = topOfRow;
          else if (bottomOfRow > el.scrollTop + el.clientHeight)
            el.scrollTop = bottomOfRow - el.clientHeight;
        }
      }
    },
    [focusIdx, overriddenRows, props.onSelect, rowHeight, toggleExpand],
  );

  const toggleStateFilter = useCallback((s: TicketState) => {
    setStateFilters((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }, []);

  if (!props.root) {
    return (
      <aside
        className="atlas-ticket-pane"
        role="region"
        aria-label={ariaLabel}
        data-testid="atlas-ticket-pane"
      >
        <div className="atlas-ticket-pane__header">
          <span className="atlas-ticket-pane__title">{ariaLabel}</span>
        </div>
        <div style={{ padding: 12, color: 'var(--atlas-text-muted)' }}>
          {props.emptyMessage ?? 'No tickets loaded yet.'}
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="atlas-ticket-pane"
      role="region"
      aria-label={ariaLabel}
      data-testid="atlas-ticket-pane"
    >
      <div className="atlas-ticket-pane__header">
        <span className="atlas-ticket-pane__title">{ariaLabel}</span>
        <label className="atlas-sr-only" htmlFor="atlas-ticket-search">
          Search tickets
        </label>
        <input
          id="atlas-ticket-search"
          className="atlas-ticket-pane__search"
          placeholder="Search by id or title…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="atlas-ticket-search"
        />
        <div className="atlas-ticket-pane__filters" role="group" aria-label="Filter by state">
          {FILTER_STATES.map((s) => (
            <button
              key={s}
              type="button"
              className="atlas-ticket-pane__filter"
              aria-pressed={stateFilters.has(s)}
              onClick={() => toggleStateFilter(s)}
              data-state-filter={s}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={listRef}
        className="atlas-ticket-pane__list"
        role="tree"
        aria-label={ariaLabel}
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        data-testid="atlas-ticket-list"
      >
        <div style={{ height: overriddenRows.length * rowHeight, position: 'relative' }}>
          {visible.map((row, i) => {
            const idx = startIdx + i;
            const selected = props.selectedTicketIds.includes(row.ticket.id);
            const rowStyle: CSSProperties = {
              top: idx * rowHeight,
              height: rowHeight,
              paddingLeft: 8 + row.depth * 14,
            };
            const className =
              'atlas-ticket-pane__row' +
              (focusIdx === idx ? ' atlas-ticket-pane__row--focus' : '');
            return (
              <div
                key={row.ticket.id}
                className={className}
                style={rowStyle}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={selected}
                aria-expanded={row.hasChildren ? row.expanded : undefined}
                data-ticket-id={row.ticket.id}
                onClick={(e) => onRowClick(row, e)}
              >
                <span
                  className={
                    'atlas-ticket-pane__caret' +
                    (row.hasChildren ? '' : ' atlas-ticket-pane__caret--leaf')
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    if (row.hasChildren) toggleExpand(row.ticket.id);
                  }}
                  aria-hidden="true"
                >
                  {row.hasChildren ? (row.expanded ? '▾' : '▸') : '·'}
                </span>
                <span
                  className="atlas-ticket-pane__state"
                  data-state={row.ticket.state}
                  aria-label={`status: ${row.ticket.state}`}
                  role="img"
                />
                <span className="atlas-ticket-pane__label" title={row.ticket.id}>
                  {row.ticket.title}
                </span>
                <span className="atlas-ticket-pane__level">{row.ticket.level}</span>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

TicketPane.displayName = 'TicketPane';
