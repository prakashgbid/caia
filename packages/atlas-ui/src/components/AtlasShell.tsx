/**
 * `<AtlasShell>` — the top-level split-screen layout.
 *
 * Composes `<DesignPane>`, `<TicketPane>`, `<PromptDock>`,
 * `<SelectionBreadcrumb>`, and optional `<AgentStatusSidebar>`
 * into the single full-screen surface the operator sees.
 *
 * The shell is intentionally *thin* — it does NOT own the selection
 * state, the bridge, or the SSE subscription. Hosts pass those in
 * via props so the same composition can be driven by the production
 * Next.js app, Storybook stories, or Playwright e2e harnesses.
 *
 * The split layout uses CSS Grid (no `react-resizable-panels`
 * dependency) so resize is one CSS variable update — no layout
 * thrash, no library bytes. The divider is a focusable button with
 * keyboard support (Left/Right adjusts the split).
 */

import * as React from 'react';
import {
  type CSSProperties,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useState,
} from 'react';

import type { AtlasSseEvent } from '../types/index.js';

export interface AtlasShellProps {
  /** Main design area — usually `<DesignPane>`. */
  designPane: React.ReactNode;
  /** Side panel — usually `<TicketPane>`. */
  ticketPane: React.ReactNode;
  /** Optional breadcrumb rendered above the design pane. */
  breadcrumb?: React.ReactNode;
  /** Optional dock rendered inside the design pane (it positions itself). */
  promptDock?: React.ReactNode;
  /** Optional sidebar — usually `<AgentStatusSidebar>`. */
  agentSidebar?: React.ReactNode;
  /** Initial split — fraction of width allocated to the design pane. */
  initialSplit?: number;
  /** Min and max for the split — fraction of width. */
  minSplit?: number;
  maxSplit?: number;
  /** Live region announcements driven by selection changes / SSE. */
  liveRegionMessage?: string;
  /** SSE events for the live region narration. */
  recentEvents?: AtlasSseEvent[];
  /** Optional className on the root. */
  className?: string;
}

export function AtlasShell(props: AtlasShellProps): React.ReactElement {
  const initialSplit = props.initialSplit ?? 0.62;
  const minSplit = props.minSplit ?? 0.3;
  const maxSplit = props.maxSplit ?? 0.85;
  const [split, setSplit] = useState(initialSplit);
  const [dragging, setDragging] = useState(false);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    setDragging(true);
    e.preventDefault();
  }, []);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent): void => {
      const target = (e.currentTarget as Window | null) ?? window;
      const w = target.innerWidth;
      const sidebarSlot = props.agentSidebar ? 260 : 0;
      const usable = w - 8 - sidebarSlot;
      const next = e.clientX / Math.max(1, usable);
      setSplit(Math.max(minSplit, Math.min(maxSplit, next)));
    };
    const onUp = (): void => setDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, props.agentSidebar, minSplit, maxSplit]);

  const onDividerKey = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowLeft') {
        setSplit((s) => Math.max(minSplit, s - 0.02));
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        setSplit((s) => Math.min(maxSplit, s + 0.02));
        e.preventDefault();
      }
    },
    [minSplit, maxSplit],
  );

  const designPct = `${Math.round(split * 100)}fr`;
  const panelPct = `${Math.round((1 - split) * 100)}fr`;
  const style: CSSProperties = {
    gridTemplateColumns: props.agentSidebar
      ? `${designPct} 8px ${panelPct} 260px`
      : `${designPct} 8px ${panelPct}`,
  };

  return (
    <div
      className={[
        'atlas-shell',
        props.agentSidebar ? 'atlas-shell--with-sidebar' : '',
        props.className,
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      data-testid="atlas-shell"
    >
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {props.breadcrumb}
        {props.designPane}
        {props.promptDock}
      </div>
      <div
        className="atlas-shell__divider"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panels"
        aria-valuenow={Math.round(split * 100)}
        aria-valuemin={Math.round(minSplit * 100)}
        aria-valuemax={Math.round(maxSplit * 100)}
        tabIndex={0}
        onMouseDown={onMouseDown}
        onKeyDown={onDividerKey}
        data-testid="atlas-divider"
      />
      {props.ticketPane}
      {props.agentSidebar}
      {/* Live region — visually hidden, announces selection changes. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="atlas-sr-only"
        data-testid="atlas-live-region"
      >
        {props.liveRegionMessage ?? ''}
      </div>
    </div>
  );
}

AtlasShell.displayName = 'AtlasShell';
