/**
 * `<ScopeBoxOverlay>` — the SVG layer that draws selection +
 * hover-preview bounding boxes over the iframe.
 *
 * Spec §6.1 — SVG over Canvas. We use one `<rect>` per locked box
 * plus an optional dashed `<rect>` for the hover preview.
 *
 * Everything is positioned in the iframe's content coordinate space,
 * which is the same as the parent overlay's coordinate space because
 * we mount the SVG directly over the iframe (no scroll offset).
 *
 * The component is `aria-hidden` per spec §9.2 — the visible box is
 * decorative; the same info is announced via the live region in
 * `<AtlasShell>`.
 */

import * as React from 'react';
import { memo } from 'react';

import type { AtlasRect } from '../bridge/index.js';

export interface ScopeBox {
  /** DOM-ID this box represents. */
  domId: string;
  /** Pixel rect. */
  rect: AtlasRect;
  /** Optional label (usually `level: title`). */
  label?: string;
}

export interface ScopeBoxOverlayProps {
  /** Locked-selection boxes (solid stroke). */
  boxes: ScopeBox[];
  /** Optional hover-preview box (dashed). */
  hover?: ScopeBox | null;
  /** Width/height of the SVG canvas — must match iframe viewport. */
  width: number;
  height: number;
  /** Optional override class. */
  className?: string;
}

function clampRect(r: AtlasRect, w: number, h: number): AtlasRect {
  return {
    x: Math.max(-w, Math.min(2 * w, r.x)),
    y: Math.max(-h, Math.min(2 * h, r.y)),
    w: Math.max(1, Math.min(2 * w, r.w)),
    h: Math.max(1, Math.min(2 * h, r.h)),
  };
}

const LABEL_PADDING_X = 6;
const LABEL_HEIGHT = 16;

function ScopeBoxOverlayImpl(props: ScopeBoxOverlayProps): React.ReactElement {
  const { boxes, hover, width, height } = props;
  return (
    <svg
      className={['atlas-design-pane__overlay', props.className].filter(Boolean).join(' ')}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="presentation"
      aria-hidden="true"
      data-testid="atlas-scope-overlay"
    >
      {hover ? (
        <rect
          key={`hover-${hover.domId}`}
          className="atlas-scope-box atlas-scope-box--hover"
          x={clampRect(hover.rect, width, height).x}
          y={clampRect(hover.rect, width, height).y}
          width={clampRect(hover.rect, width, height).w}
          height={clampRect(hover.rect, width, height).h}
          data-atlas-overlay="hover"
          data-domid={hover.domId}
        />
      ) : null}

      {boxes.map((box) => {
        const c = clampRect(box.rect, width, height);
        const labelText = box.label ?? box.domId;
        const labelWidth = Math.max(48, labelText.length * 6 + LABEL_PADDING_X * 2);
        const labelY = c.y >= LABEL_HEIGHT ? c.y - LABEL_HEIGHT - 2 : c.y + 2;
        return (
          <g key={`box-${box.domId}`} data-atlas-overlay="box" data-domid={box.domId}>
            <rect className="atlas-scope-box" x={c.x} y={c.y} width={c.w} height={c.h} />
            <rect
              className="atlas-scope-box__inner"
              x={c.x + 1}
              y={c.y + 1}
              width={Math.max(0, c.w - 2)}
              height={Math.max(0, c.h - 2)}
            />
            <rect
              className="atlas-scope-box__label-bg"
              x={c.x}
              y={labelY}
              width={labelWidth}
              height={LABEL_HEIGHT}
              rx={3}
            />
            <text
              className="atlas-scope-box__label"
              x={c.x + LABEL_PADDING_X}
              y={labelY + LABEL_HEIGHT - 5}
            >
              {labelText}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export const ScopeBoxOverlay = memo(ScopeBoxOverlayImpl);
ScopeBoxOverlay.displayName = 'ScopeBoxOverlay';
