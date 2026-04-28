'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HoverTarget } from './useHover';
import { copyId } from './copy';

interface OverlayProps {
  target: HoverTarget | null;
}

const RED = '#DC2626';
const BADGE_BG = 'rgba(0,0,0,0.9)';
const FONT = 'Menlo, Consolas, monospace';

function useScrollRect(target: HoverTarget | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!target) {
      setRect(null);
      return;
    }

    function tick() {
      if (!target) return;
      setRect(target.element.getBoundingClientRect());
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target]);

  return rect;
}

function OverlayInner({ target }: OverlayProps) {
  const rect = useScrollRect(target);
  const [portal, setPortal] = useState<Element | null>(null);

  useEffect(() => {
    setPortal(document.body);
  }, []);

  if (!portal || !rect || !target) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    outline: `3px solid ${RED}`,
    boxShadow: `0 0 0 1px ${RED}44, 0 0 8px ${RED}44`,
    borderRadius: 2,
    pointerEvents: 'none',
    zIndex: 2147483646,
    boxSizing: 'border-box',
  };

  const badgeStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    background: BADGE_BG,
    color: '#fff',
    fontFamily: FONT,
    fontSize: 11,
    lineHeight: '16px',
    padding: '1px 5px',
    borderRadius: 2,
    pointerEvents: 'auto',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    maxWidth: 320,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    zIndex: 2147483647,
    transform: 'translateY(-100%)',
  };

  return createPortal(
    <div style={style} data-dev-inspector-overlay>
      <div
        style={badgeStyle}
        onClick={e => {
          e.stopPropagation();
          copyId(target.id);
        }}
        title={`Click to copy: ${target.id}`}
      >
        {target.id}
      </div>
    </div>,
    portal
  );
}

export function Overlay(props: OverlayProps) {
  return <OverlayInner {...props} />;
}
