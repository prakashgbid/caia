/**
 * `<DesignPane>` — the iframe + overlay layer.
 *
 * Spec §1.2 (Layer A iframe + Layer B overlay), §3.1 (click→select),
 * §3.4 (hover preview), §6.1 (SVG overlay).
 *
 * Owns:
 *
 *   - The iframe element (sandboxed `allow-scripts` only).
 *   - The bridge created on mount, torn down on unmount.
 *   - ResizeObserver on the iframe wrapper so the overlay tracks
 *     browser-window resizes without polling.
 *   - The rect cache keyed by DOM-ID — the overlay reads from this.
 *
 * Does NOT own:
 *
 *   - The selection state — passed in via `selection` / `onClick`.
 *     Single source of truth lives in `useAtlasSelection`.
 *   - The route — host wires `bridge.route(path)` if needed.
 */

import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAtlasBridge } from '../hooks/useAtlasBridge.js';
import type { AtlasRect } from '../bridge/index.js';
import type { AtlasDesignVersion, AtlasSelection } from '../types/index.js';
import { ScopeBoxOverlay, type ScopeBox } from './ScopeBoxOverlay.js';

export interface DesignPaneProps {
  /** Current design version. */
  design: AtlasDesignVersion | null;
  /** Selection from `useAtlasSelection`. */
  selection: AtlasSelection;
  /**
   * Origin to enforce on iframe messages. `"null"` for sandboxed iframes
   * (dev), the real origin in prod. Defaults to `"null"`.
   */
  expectedOrigin?: string;
  /** Fired on iframe click — host wires to `selectDomId`. */
  onClick?: (
    domId: string,
    modifiers?: { shift?: boolean; meta?: boolean; ctrl?: boolean },
  ) => void;
  /** Fired on iframe hover (debounced). Host MAY use for hover preview. */
  onHover?: (domId: string | null) => void;
  /** Loading state — when true, the iframe is hidden and a skeleton shown. */
  loading?: boolean;
  /** Error state — when set, error message is shown in place of iframe. */
  error?: string | null;
  /**
   * Map of ticket metadata for label rendering on scope boxes. Keyed by
   * DOM-ID. Optional — when omitted, the DOM-ID is shown.
   */
  ticketLabels?: Map<string, string>;
}

export function DesignPane(props: DesignPaneProps): React.ReactElement {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [rectCache, setRectCache] = useState<Map<string, AtlasRect>>(() => new Map());
  const [hoverBox, setHoverBox] = useState<ScopeBox | null>(null);
  const [ready, setReady] = useState(false);

  const onClickRef = useRef(props.onClick);
  onClickRef.current = props.onClick;
  const onHoverRef = useRef(props.onHover);
  onHoverRef.current = props.onHover;

  const bridge = useAtlasBridge({
    iframeRef,
    expectedOrigin: props.expectedOrigin ?? 'null',
    onMessage: useCallback((m) => {
      switch (m.type) {
        case 'atlas:ready':
          setReady(true);
          break;
        case 'atlas:click':
          setRectCache((prev) => {
            const next = new Map(prev);
            next.set(m.domId, m.rect);
            return next;
          });
          onClickRef.current?.(m.domId, m.modifiers);
          break;
        case 'atlas:hover': {
          if (m.domId && m.rect) {
            setHoverBox({ domId: m.domId, rect: m.rect });
          } else {
            setHoverBox(null);
          }
          onHoverRef.current?.(m.domId);
          break;
        }
        case 'atlas:rect':
          setRectCache((prev) => {
            const next = new Map(prev);
            next.set(m.domId, m.rect);
            return next;
          });
          break;
        case 'atlas:not-found':
          setRectCache((prev) => {
            if (!prev.has(m.domId)) return prev;
            const next = new Map(prev);
            next.delete(m.domId);
            return next;
          });
          break;
        default:
          break;
      }
    }, []),
  });

  // When parent selection changes, ask the iframe to highlight each
  // selected DOM-ID. The iframe replies with `atlas:rect` which fills
  // our cache.
  useEffect(() => {
    if (!bridge || !ready) return;
    for (const domId of props.selection.domIds) {
      bridge.select(domId, { scroll: 'none' });
    }
  }, [bridge, ready, props.selection.domIds]);

  // ResizeObserver — keep `size` synced to the iframe wrapper so the
  // overlay scales correctly.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const r = entry.contentRect;
        setSize({ w: r.width, h: r.height });
      }
    });
    ro.observe(el);
    // Seed immediately so first paint has a non-zero size.
    const r = el.getBoundingClientRect();
    setSize({ w: r.width, h: r.height });
    return () => ro.disconnect();
  }, []);

  const boxes: ScopeBox[] = useMemo(() => {
    const out: ScopeBox[] = [];
    for (const domId of props.selection.domIds) {
      const rect = rectCache.get(domId);
      if (!rect) continue;
      const box: ScopeBox = { domId, rect };
      const label = props.ticketLabels?.get(domId);
      if (label !== undefined) box.label = label;
      out.push(box);
    }
    return out;
  }, [props.selection.domIds, rectCache, props.ticketLabels]);

  return (
    <section
      className="atlas-design-pane"
      role="region"
      aria-label="Design preview"
      data-testid="atlas-design-pane"
    >
      <header className="atlas-design-pane__header">
        <span>
          {props.design ? `Design ${props.design.id} · ${props.design.source}` : 'No design loaded'}
        </span>
        <span aria-live="polite" className="atlas-sr-only">
          {props.selection.primary
            ? `Selected ${props.selection.primary.ticketId}`
            : 'No selection'}
        </span>
      </header>
      <div className="atlas-design-pane__iframe-wrap" ref={wrapRef}>
        {props.loading ? (
          <div className="atlas-design-pane__loading" role="status">
            Loading design…
          </div>
        ) : props.error ? (
          <div className="atlas-design-pane__error" role="alert">
            {props.error}
          </div>
        ) : props.design ? (
          <iframe
            ref={iframeRef}
            className="atlas-design-pane__iframe"
            title="Customer design preview"
            src={props.design.iframeUrl}
            sandbox="allow-scripts"
            data-testid="atlas-design-iframe"
          />
        ) : (
          <div className="atlas-design-pane__empty">No design available</div>
        )}
        {props.design && !props.loading && !props.error ? (
          <ScopeBoxOverlay boxes={boxes} hover={hoverBox} width={size.w} height={size.h} />
        ) : null}
      </div>
    </section>
  );
}

DesignPane.displayName = 'DesignPane';
