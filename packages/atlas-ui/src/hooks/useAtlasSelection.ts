/**
 * `useAtlasSelection` — the React binding for the pure selection
 * reducer in `lib/selection-reducer.ts`.
 *
 * Components consume this hook to read the current selection AND
 * issue selection changes. The hook is the single source of truth
 * shared by `<DesignPane>`, `<TicketPane>`, `<PromptDock>`,
 * `<SelectionBreadcrumb>`, and `<ScopeBoxOverlay>`.
 *
 * Implementation: `useReducer` + a memoised actions bag. We avoid
 * Zustand / Jotai / Redux to keep the library zero-dependency on
 * state management — the spec mentions Zustand for the parent shell
 * but Atlas-UI is a library, not the shell.
 */

import { useCallback, useMemo, useReducer } from 'react';
import type { Mapper } from '@chiefaia/atlas-mapper';

import {
  breadcrumbForSelection,
  initialSelection,
  selectionReducer,
} from '../lib/selection-reducer.js';
import type { AtlasSelection } from '../types/index.js';

export interface UseAtlasSelectionResult {
  /** Current selection. Stable reference between unchanged renders. */
  selection: AtlasSelection;

  /** Replace selection with the click target. mode defaults to `replace`. */
  selectDomId: (domId: string, mode?: 'replace' | 'add' | 'toggle') => void;
  /** Replace selection with the ticket. mode defaults to `replace`. */
  selectTicket: (ticketId: string, mode?: 'replace' | 'add' | 'toggle') => void;
  /** Walk to the enclosing parent ticket. No-op when at the root. */
  drillUp: () => void;
  /** Walk to the first descendant ticket. No-op when at a leaf. */
  drillDown: () => void;
  /** Clear all selection. */
  clear: () => void;

  /** Breadcrumb path root → leaf for the current primary selection. */
  breadcrumb: { id: string; level: string; title: string }[];
}

/**
 * The hook takes the current mapper as a single argument — callers
 * must always pass a fresh mapper if the underlying design version
 * changes. Selection is reset to empty when the mapper identity
 * changes (a new design version has new DOM-IDs).
 */
export function useAtlasSelection(mapper: Mapper): UseAtlasSelectionResult {
  const [selection, dispatch] = useReducer(selectionReducer, initialSelection);

  const selectDomId = useCallback(
    (domId: string, mode: 'replace' | 'add' | 'toggle' = 'replace') => {
      dispatch({ type: 'selectDomId', domId, mode, mapper });
    },
    [mapper],
  );

  const selectTicket = useCallback(
    (ticketId: string, mode: 'replace' | 'add' | 'toggle' = 'replace') => {
      dispatch({ type: 'selectTicket', ticketId, mode, mapper });
    },
    [mapper],
  );

  const drillUp = useCallback(() => {
    dispatch({ type: 'drillUp', mapper });
  }, [mapper]);

  const drillDown = useCallback(() => {
    dispatch({ type: 'drillDown', mapper });
  }, [mapper]);

  const clear = useCallback(() => {
    dispatch({ type: 'clear' });
  }, []);

  const breadcrumb = useMemo(
    () => breadcrumbForSelection(selection, mapper),
    [selection, mapper],
  );

  return {
    selection,
    selectDomId,
    selectTicket,
    drillUp,
    drillDown,
    clear,
    breadcrumb,
  };
}
