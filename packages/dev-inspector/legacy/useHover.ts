'use client';

import { useEffect, useState, useCallback, useRef } from 'react';

export interface HoverTarget {
  element: Element;
  id: string;
  rect: DOMRect;
}

const ATTR = 'data-inspector-id';
const FRAME_MS = 1000 / 60;

export function useHover(active: boolean): HoverTarget | null {
  const [target, setTarget] = useState<HoverTarget | null>(null);
  const lastUpdateRef = useRef(0);

  const onMouseMove = useCallback((e: MouseEvent) => {
    const now = performance.now();
    if (now - lastUpdateRef.current < FRAME_MS) return;
    lastUpdateRef.current = now;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) {
      setTarget(null);
      return;
    }

    const nearest = el.closest(`[${ATTR}]`);
    if (!nearest) {
      setTarget(null);
      return;
    }

    const id = nearest.getAttribute(ATTR)!;
    const rect = nearest.getBoundingClientRect();
    setTarget({ element: nearest, id, rect });
  }, []);

  const onMouseLeave = useCallback(() => setTarget(null), []);

  useEffect(() => {
    if (!active) {
      setTarget(null);
      return;
    }

    document.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mouseleave', onMouseLeave, { passive: true });

    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [active, onMouseMove, onMouseLeave]);

  return target;
}
